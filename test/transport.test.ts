import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { KeyboardTransport, type HidHandle } from "../src/transport.js";
import { CapabilityFlag, ControlEventKind, encodeCapabilities, encodeControlEvent, encodePacket, Opcode } from "../src/protocol.js";

class FakeHid extends EventEmitter implements HidHandle {
  writes: number[][] = [];
  constructor(private readonly replies: number[][]) { super(); }
  write(data: number[]): number { this.writes.push(data); return data.length; }
  readTimeout(): number[] { return this.replies.shift() ?? []; }
  close(): void {}
}

const device = { vendorId: 0x3434, productId: 0x0660, path: "fake", usagePage: 0xff60, usage: 0x61, product: "Q6 Pro", release: 1, interface: 1 };

test("detects Arkey-capable firmware", () => {
  const fake = new FakeHid([[...encodePacket(Opcode.Capabilities, Uint8Array.of(108))]]);
  const transport = new KeyboardTransport(() => [device], () => fake);
  assert.equal(transport.connect()?.support, "arkey");
});

test("distinguishes stock VIA firmware from Arkey", () => {
  const viaReply = Array(32).fill(0); viaReply[0] = 1; viaReply[2] = 12;
  const fake = new FakeHid([[], viaReply]);
  const transport = new KeyboardTransport(() => [device], () => fake);
  assert.equal(transport.connect()?.support, "via-only");
});

test("generic ACK does not claim the Arkey protocol", () => {
  const viaReply = Array(32).fill(0); viaReply[0] = 1;
  const fake = new FakeHid([[...encodePacket(Opcode.Ack)], viaReply]);
  const transport = new KeyboardTransport(() => [device], () => fake);
  assert.equal(transport.connect()?.support, "via-only");
});

test("skips Raw HID devices that are visible but cannot be opened", () => {
  const transport = new KeyboardTransport(() => [device], () => {
    throw new Error("cannot open device with path fake");
  });
  const errors: string[] = [];
  transport.on("error", (error) => errors.push(error.message));
  assert.equal(transport.connect(), undefined);
  assert.deepEqual(errors, ["cannot open device with path fake"]);
});

test("v2 capability requires the canonical layout hash for full control", () => {
  const capability = (hash: number) => encodeCapabilities({
    ledCount: 108, extensionVersion: 2,
    flags: CapabilityFlag.PerKeyEffects | CapabilityFlag.ControlEvents | CapabilityFlag.CaptureMode | CapabilityFlag.BindingMask,
    layoutHash32: hash, matrixRows: 6, matrixColumns: 21, maxEffectRecords: 2,
  });
  const matched = new KeyboardTransport(() => [device], () => new FakeHid([[...encodePacket(Opcode.Capabilities, capability(0xde355358))]]));
  assert.equal(matched.connect()?.fullControl, true);
  const mismatched = new KeyboardTransport(() => [device], () => new FakeHid([[...encodePacket(Opcode.Capabilities, capability(0x12345678))]]));
  assert.equal(mismatched.connect()?.layoutMatches, false);
  assert.equal(mismatched.connection?.fullControl, false);
});

test("persistent HID listener normalizes report IDs and deduplicates sequence numbers", () => {
  const capabilities = encodeCapabilities({ ledCount: 108, extensionVersion: 2, flags: 15, layoutHash32: 0xde355358 });
  const fake = new FakeHid([[...encodePacket(Opcode.Capabilities, capabilities)]]);
  const transport = new KeyboardTransport(() => [device], () => fake);
  transport.connect();
  const received: number[] = [];
  transport.on("control", (event) => received.push(event.eventSequence));
  const payload = encodeControlEvent({ kind: ControlEventKind.Key, row: 1, column: 2, pressed: true, eventSequence: 300, deviceTick: 99, token: 7, flags: 0 });
  const report = Buffer.from([0, ...encodePacket(Opcode.ControlEvent, payload, 42)]);
  fake.emit("data", report);
  fake.emit("data", report);
  assert.deepEqual(received, [300]);
});
