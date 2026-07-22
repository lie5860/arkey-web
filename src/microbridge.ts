import { SerialPort } from "serialport";

const BAUD_RATE = 115_200;
const MAX_LINE_BYTES = 16 * 1024;
const DEFAULT_ACK_TIMEOUT_MS = 2_000;
const DEFAULT_ACK_RETRY_MS = 250;
const DEFAULT_RECONNECT_INTERVAL_MS = 2_500;

export const MICRO_CONTROLS = [
  "agent-1",
  "agent-2",
  "agent-3",
  "agent-4",
  "agent-5",
  "agent-6",
  "fast",
  "approve",
  "decline",
  "continue",
  "ptt",
  "send",
  "reasoning-press",
  "encoder-cw",
  "encoder-ccw",
  "joystick-up",
  "joystick-right",
  "joystick-down",
  "joystick-left",
] as const;

export const MICRO_PHASES = ["down", "up", "tap"] as const;

export type MicroControl = typeof MICRO_CONTROLS[number];
export type MicroPhase = typeof MICRO_PHASES[number];
export type MicroBridgeConnection = "disabled" | "offline" | "connecting" | "ready" | "error";

export interface MicroBridgePort {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
}

export interface MicroSlotLight {
  slot: number;
  color?: number;
  brightness?: number;
  effect?: number;
  speed?: number;
}

export interface MicroBridgeState {
  enabled: boolean;
  connection: MicroBridgeConnection;
  configuredPort: string;
  usbMounted: boolean;
  desktopConnected: boolean;
  slotLights: MicroSlotLight[];
  lastError?: string;
}

export interface MicroBridgeSerialPort {
  isOpen: boolean;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: () => void): this;
  open(callback: (error?: Error | null) => void): void;
  close(callback: (error?: Error | null) => void): void;
  write(data: string, callback: (error?: Error | null) => void): void;
}

export interface MicroBridgeControllerOptions {
  createPort?: (path: string, baudRate: number) => MicroBridgeSerialPort;
  acknowledgementTimeoutMs?: number;
  acknowledgementRetryMs?: number;
  reconnectIntervalMs?: number;
}

interface PendingAck {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  retryTimer?: NodeJS.Timeout;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isMicroControl(value: unknown): value is MicroControl {
  return typeof value === "string" && (MICRO_CONTROLS as readonly string[]).includes(value);
}

export function isMicroPhase(value: unknown): value is MicroPhase {
  return typeof value === "string" && (MICRO_PHASES as readonly string[]).includes(value);
}

function optionalString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maximum) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function sanitizeSlotLights(value: unknown): MicroSlotLight[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const bySlot = new Map<number, MicroSlotLight>();
  for (const item of value) {
    if (!isObject(item)) continue;
    const slot = finiteNumber(item.slot);
    if (slot === undefined || !Number.isInteger(slot) || slot < 0 || slot > 5) continue;
    const color = finiteNumber(item.c);
    const brightness = finiteNumber(item.b);
    const effect = finiteNumber(item.e);
    const speed = finiteNumber(item.s);
    bySlot.set(slot, {
      slot,
      color: color === undefined ? undefined : Math.floor(clamp(color, 0, 0xFFFFFF)),
      brightness: brightness === undefined ? undefined : clamp(brightness, 0, 1),
      effect: effect === undefined ? undefined : Math.floor(clamp(effect, 0, 255)),
      speed: speed === undefined ? undefined : clamp(speed, 0, 1),
    });
  }
  return [...bySlot.values()].sort((left, right) => left.slot - right.slot);
}

export class MicroBridgeLineDecoder {
  private buffer = "";

  append(chunk: Buffer | string): Record<string, unknown>[] {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_LINE_BYTES) {
      this.buffer = "";
      return [];
    }
    const messages: Record<string, unknown>[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.startsWith("{") && line.endsWith("}")) {
        try {
          const value = JSON.parse(line) as unknown;
          if (isObject(value)) messages.push(value);
        } catch {
          // ESP-IDF boot logs and malformed lines are ignored.
        }
      }
      newline = this.buffer.indexOf("\n");
    }
    return messages;
  }
}

export async function listMicroBridgePorts(): Promise<MicroBridgePort[]> {
  const ports = await SerialPort.list();
  return ports.map((port) => ({
    path: port.path,
    manufacturer: optionalString(port.manufacturer, 200),
    vendorId: optionalString(port.vendorId, 16),
    productId: optionalString(port.productId, 16),
  })).sort((left, right) => left.path.localeCompare(right.path));
}

export class MicroBridgeController {
  private configuredPort: string;
  private connection: MicroBridgeConnection;
  private usbMounted = false;
  private desktopConnected = false;
  private slotLights: MicroSlotLight[] = [];
  private lastError?: string;
  private port?: MicroBridgeSerialPort;
  private reconnectTimer?: NodeJS.Timeout;
  private connecting?: Promise<void>;
  private stopping = false;
  private sequence = 0;
  private readonly pending = new Map<number, PendingAck>();
  private decoder = new MicroBridgeLineDecoder();
  private readonly createPort: (path: string, baudRate: number) => MicroBridgeSerialPort;
  private readonly acknowledgementTimeoutMs: number;
  private readonly acknowledgementRetryMs: number;
  private readonly reconnectIntervalMs: number;

  constructor(configuredPort = "", options: MicroBridgeControllerOptions = {}) {
    this.configuredPort = configuredPort;
    this.connection = configuredPort ? "offline" : "disabled";
    this.createPort = options.createPort ?? ((path, baudRate) => new SerialPort({ path, baudRate, autoOpen: false, lock: true }) as MicroBridgeSerialPort);
    this.acknowledgementTimeoutMs = options.acknowledgementTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.acknowledgementRetryMs = options.acknowledgementRetryMs ?? DEFAULT_ACK_RETRY_MS;
    this.reconnectIntervalMs = options.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS;
  }

  state(): MicroBridgeState {
    return {
      enabled: this.configuredPort.length > 0,
      connection: this.connection,
      configuredPort: this.configuredPort,
      usbMounted: this.usbMounted,
      desktopConnected: this.desktopConnected,
      slotLights: this.slotLights.map((slot) => ({ ...slot })),
      lastError: this.lastError,
    };
  }

  async start(): Promise<void> {
    this.stopping = false;
    if (!this.configuredPort) {
      this.connection = "disabled";
      return;
    }
    await this.connect().catch(() => undefined);
    this.scheduleReconnect();
  }

  async configure(configuredPort: string): Promise<void> {
    if (configuredPort === this.configuredPort) return;
    await this.closePort();
    this.configuredPort = configuredPort;
    this.connection = configuredPort ? "offline" : "disabled";
    this.lastError = undefined;
    this.usbMounted = false;
    this.desktopConnected = false;
    this.slotLights = [];
    if (configuredPort && !this.stopping) {
      await this.connect().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  async send(control: MicroControl, phase: MicroPhase): Promise<void> {
    if (!isMicroControl(control) || !isMicroPhase(phase)) throw new Error("无效的硬件按键事件");
    if (!this.port?.isOpen || this.connection !== "ready") throw new Error("ESP32-S3 串口桥未连接");
    if (!this.usbMounted || !this.desktopConnected) throw new Error("Codex Desktop 尚未连接到开发板的原生 USB 端口");
    const sequence = this.nextSequence();
    await this.writeAndAwaitAck({ command: "input", sequence, control, phase }, sequence);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.reconnectTimer = undefined;
    await this.closePort();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(() => {
      if (!this.stopping && this.configuredPort && !this.port?.isOpen) void this.connect().catch(() => undefined);
    }, this.reconnectIntervalMs);
    this.reconnectTimer.unref();
  }

  private async connect(): Promise<void> {
    if (!this.configuredPort || this.stopping || this.port?.isOpen) return;
    if (this.connecting) return this.connecting;
    this.connection = "connecting";
    const attempt = this.openConfiguredPort();
    this.connecting = attempt;
    try {
      await attempt;
    } finally {
      if (this.connecting === attempt) this.connecting = undefined;
    }
  }

  private async openConfiguredPort(): Promise<void> {
    const port = this.createPort(this.configuredPort, BAUD_RATE);
    this.port = port;
    this.decoder = new MicroBridgeLineDecoder();
    port.on("data", (chunk: Buffer) => {
      for (const message of this.decoder.append(chunk)) this.handleMessage(message);
    });
    port.on("error", (error) => this.handlePortFailure(error));
    port.on("close", () => {
      if (this.port === port) this.port = undefined;
      this.rejectPending("ESP32-S3 串口已断开");
      this.connection = this.configuredPort ? "offline" : "disabled";
      this.usbMounted = false;
      this.desktopConnected = false;
    });
    try {
      await new Promise<void>((resolveOpen, rejectOpen) => port.open((error) => error ? rejectOpen(error) : resolveOpen()));
      this.connection = "ready";
      this.lastError = undefined;
      const sequence = this.nextSequence();
      await this.writeAndAwaitAck({ command: "hello", sequence }, sequence);
    } catch (error) {
      this.handlePortFailure(error);
      if (this.port === port) this.port = undefined;
      if (port.isOpen) await new Promise<void>((resolveClose) => port.close(() => resolveClose()));
      throw error;
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (message.event === "ack") {
      const sequence = finiteNumber(message.sequence);
      if (sequence === undefined) return;
      const pending = this.pending.get(sequence);
      if (!pending) return;
      this.pending.delete(sequence);
      clearTimeout(pending.timer);
      if (pending.retryTimer) clearTimeout(pending.retryTimer);
      if (message.ok === true) pending.resolve();
      else pending.reject(new Error(this.ackError(message.error)));
      return;
    }
    if (message.event === "bridge") {
      this.usbMounted = message.usbMounted === true;
      this.desktopConnected = message.desktopConnected === true;
      return;
    }
    if (message.event === "slot_status") {
      const slots = sanitizeSlotLights(message.slots);
      if (slots) this.slotLights = slots;
    }
  }

  private ackError(value: unknown): string {
    switch (value) {
      case "desktop_not_connected": return "Codex Desktop 尚未连接到开发板的原生 USB 端口";
      case "queue_full": return "开发板的按键队列已满";
      case "invalid_input": return "开发板拒绝了无效按键事件";
      case "sequence_conflict": return "开发板拒绝了冲突的按键序号";
      default: return "开发板拒绝了控制命令";
    }
  }

  private nextSequence(): number {
    this.sequence = (this.sequence + 1) % 0x7FFFFFFF;
    return this.sequence;
  }

  private async writeAndAwaitAck(payload: Record<string, unknown>, sequence: number): Promise<void> {
    const port = this.port;
    if (!port?.isOpen) throw new Error("ESP32-S3 串口桥未连接");
    const line = `${JSON.stringify(payload)}\n`;
    const acknowledgement = new Promise<void>((resolveAck, rejectAck) => {
      const timer = setTimeout(() => {
        this.pending.delete(sequence);
        rejectAck(new Error("开发板确认超时"));
      }, this.acknowledgementTimeoutMs);
      this.pending.set(sequence, { resolve: resolveAck, reject: rejectAck, timer });
    });
    const write = () => new Promise<void>((resolveWrite, rejectWrite) => {
      port.write(line, (error) => error ? rejectWrite(error) : resolveWrite());
    });
    try {
      await write();
      const pending = this.pending.get(sequence);
      if (pending) {
        pending.retryTimer = setTimeout(() => {
          if (!this.pending.has(sequence)) return;
          void write().catch((error: unknown) => {
            const current = this.pending.get(sequence);
            if (!current) return;
            clearTimeout(current.timer);
            this.pending.delete(sequence);
            current.reject(error instanceof Error ? error : new Error(String(error)));
          });
        }, this.acknowledgementRetryMs);
      }
      await acknowledgement;
    } catch (error) {
      const pending = this.pending.get(sequence);
      if (pending) {
        clearTimeout(pending.timer);
        if (pending.retryTimer) clearTimeout(pending.retryTimer);
      }
      this.pending.delete(sequence);
      throw error;
    }
  }

  private handlePortFailure(error: unknown): void {
    this.lastError = error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400);
    this.connection = "error";
    this.usbMounted = false;
    this.desktopConnected = false;
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      if (pending.retryTimer) clearTimeout(pending.retryTimer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private async closePort(): Promise<void> {
    const port = this.port;
    this.port = undefined;
    this.rejectPending("ESP32-S3 串口桥已停止");
    if (port?.isOpen) await new Promise<void>((resolveClose) => port.close(() => resolveClose()));
  }
}
