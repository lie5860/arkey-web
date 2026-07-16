import { EventEmitter } from "node:events";
import { HID, devices, type Device } from "node-hid";
import {
  CapabilityFlag,
  decodeCapabilities,
  decodeControlEvent,
  decodePacket,
  encodePacket,
  normalizeReport,
  Opcode,
  REPORT_SIZE,
  type ControlEvent,
  type FirmwareCapabilities,
  type Packet,
} from "./protocol.js";
import { profiles, type KeyboardProfile } from "./profile.js";

export interface HidHandle {
  write(data: number[]): number;
  readTimeout(timeout: number): number[];
  close(): void;
  on?(event: "data", listener: (data: Buffer | number[]) => void): unknown;
  on?(event: "error", listener: (error: Error) => void): unknown;
  off?(event: "data", listener: (data: Buffer | number[]) => void): unknown;
  off?(event: "error", listener: (error: Error) => void): unknown;
}

export type DeviceSupport = "arkey" | "via-only" | "unavailable";

export interface ConnectedKeyboard {
  profile: KeyboardProfile;
  support: DeviceSupport;
  product: string;
  capabilities?: FirmwareCapabilities;
  extensionVersion: number;
  layoutMatches: boolean;
  fullControl: boolean;
}

export interface KeyboardTransportEvents {
  packet: [Packet];
  control: [ControlEvent];
  disconnect: [Error | undefined];
  error: [Error];
}

export class KeyboardTransport extends EventEmitter<KeyboardTransportEvents> {
  private handle?: HidHandle;
  private sequence = 0;
  private recentPackets = new Set<string>();
  private recentPacketOrder: string[] = [];
  private readonly dataListener = (data: Buffer | number[]) => this.consume(data);
  private readonly errorListener = (error: Error) => this.handleError(error);
  connection?: ConnectedKeyboard;

  constructor(
    private readonly listDevices: () => Device[] = devices,
    private readonly open: (path: string) => HidHandle = (path) => new HID(path),
  ) {
    super();
  }

  connect(): ConnectedKeyboard | undefined {
    this.close(false);
    for (const profile of profiles) {
      const usb = profile.transports.usb;
      const match = this.listDevices().find((device) =>
        device.path &&
        device.vendorId === usb.vendorId &&
        usb.productIds.includes(device.productId) &&
        device.usagePage === usb.usagePage &&
        device.usage === usb.usage
      );
      if (!match?.path) continue;
      try {
        this.handle = this.open(match.path);
      } catch (error) {
        this.reportError(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      const detection = this.detectSupport(profile);
      const extensionVersion = detection.capabilities?.extensionVersion ?? (detection.support === "arkey" ? 1 : 0);
      const expectedHash = Number.parseInt(profile.layoutHash.slice(0, 8), 16) >>> 0;
      const capabilities = detection.capabilities;
      const layoutMatches = capabilities?.layoutHash32 === undefined || capabilities.layoutHash32 === 0 || capabilities.layoutHash32 === expectedHash;
      const requiredFlags = CapabilityFlag.PerKeyEffects | CapabilityFlag.ControlEvents | CapabilityFlag.CaptureMode | CapabilityFlag.BindingMask;
      const featureComplete = capabilities !== undefined && (capabilities.flags & requiredFlags) === requiredFlags;
      const matrixMatches = capabilities?.matrixRows === undefined || capabilities.matrixRows === 0 ||
        (capabilities.matrixRows === profile.matrix.rows && capabilities.matrixColumns === profile.matrix.columns);
      const fullControl = detection.support === "arkey" && extensionVersion >= 2 && layoutMatches && matrixMatches && featureComplete;
      this.connection = {
        profile,
        support: detection.support,
        product: match.product ?? profile.name,
        capabilities: detection.capabilities,
        extensionVersion,
        layoutMatches,
        fullControl,
      };
      this.attachListeners();
      return this.connection;
    }
    return undefined;
  }

  send(opcode: Opcode, payload: Uint8Array<ArrayBufferLike> = new Uint8Array()): boolean {
    if (!this.handle || this.connection?.support !== "arkey") return false;
    try {
      this.write(encodePacket(opcode, payload, this.sequence++));
      return true;
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  private detectSupport(profile: KeyboardProfile): { support: DeviceSupport; capabilities?: FirmwareCapabilities } {
    if (!this.handle) return { support: "unavailable" };
    try {
      this.write(encodePacket(Opcode.Hello));
      const response = this.handle.readTimeout(250);
      if (response.length) {
        const packet = decodePacket(normalizeReport(response));
        // A generic ACK is deliberately insufficient: only Capabilities proves
        // the peer implements Arkey rather than another Raw HID protocol.
        if (packet.opcode === Opcode.Capabilities) {
          const capabilities = decodeCapabilities(packet.payload);
          if (capabilities.ledCount !== profile.ledCount) return { support: "unavailable", capabilities };
          return { support: "arkey", capabilities };
        }
      }
    } catch { /* Stock VIA firmware will not understand Arkey. */ }

    try {
      const via = new Uint8Array(REPORT_SIZE);
      via[0] = 0x01;
      this.write(via);
      const response = this.handle.readTimeout(250);
      if (response[0] === 0x01 || response[1] === 0x01) return { support: "via-only" };
    } catch { /* Device is present but did not answer either protocol. */ }
    return { support: "unavailable" };
  }

  private attachListeners(): void {
    this.handle?.on?.("data", this.dataListener);
    this.handle?.on?.("error", this.errorListener);
  }

  private detachListeners(): void {
    this.handle?.off?.("data", this.dataListener);
    this.handle?.off?.("error", this.errorListener);
  }

  private consume(data: ArrayLike<number>): void {
    try {
      const packet = decodePacket(normalizeReport(data));
      const key = `${packet.opcode}:${packet.sequence}`;
      if (this.recentPackets.has(key)) return;
      this.recentPackets.add(key);
      this.recentPacketOrder.push(key);
      if (this.recentPacketOrder.length > 64) {
        const removed = this.recentPacketOrder.shift();
        if (removed) this.recentPackets.delete(removed);
      }
      this.emit("packet", packet);
      if (packet.opcode === Opcode.ControlEvent) this.emit("control", decodeControlEvent(packet.payload));
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleError(error: Error): void {
    this.reportError(error);
    const wasConnected = this.connection !== undefined;
    this.close(false);
    if (wasConnected) this.emit("disconnect", error);
  }

  private reportError(error: Error): void {
    if (this.listenerCount("error") > 0) this.emit("error", error);
  }

  private write(packet: Uint8Array): void {
    if (!this.handle) throw new Error("Keyboard is not connected");
    this.handle.write([0, ...packet]);
  }

  close(emitDisconnect = false): void {
    const hadConnection = this.connection !== undefined;
    this.detachListeners();
    try { this.handle?.close(); } catch { /* Device may already be gone. */ }
    this.handle = undefined;
    this.connection = undefined;
    this.recentPackets.clear();
    this.recentPacketOrder.length = 0;
    if (emitDisconnect && hadConnection) this.emit("disconnect", undefined);
  }
}
