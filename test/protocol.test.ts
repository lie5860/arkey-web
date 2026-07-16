import assert from "node:assert/strict";
import test from "node:test";
import {
  AckStatus,
  AgentState,
  CapabilityFlag,
  ControlEventKind,
  decodeAck,
  decodeBindingMask,
  decodeCapabilities,
  decodeCaptureMode,
  decodeControlEvent,
  decodePacket,
  decodeSetKeyEffects,
  EffectPrimitive,
  encodeAck,
  encodeBindingMask,
  encodeCapabilities,
  encodeCaptureMode,
  encodeClearKeyEffects,
  encodeControlEvent,
  encodeKeyEvents,
  encodePacket,
  encodeSetKeyEffects,
  encodeState,
  matrixBindingBits,
  Opcode,
} from "../src/protocol.js";

test("packet round trip preserves opcode, sequence and payload", () => {
  const encoded = encodePacket(Opcode.SetState, encodeState(AgentState.Tool, 20, 30, 40), 9);
  assert.equal(encoded.length, 32);
  const decoded = decodePacket(encoded);
  assert.equal(decoded.opcode, Opcode.SetState);
  assert.equal(decoded.sequence, 9);
  assert.deepEqual([...decoded.payload], [AgentState.Tool, 20, 30, 40]);
});

test("key event packets are bounded to twelve events", () => {
  const payload = encodeKeyEvents(Array.from({ length: 20 }, (_, led) => ({ led })));
  assert.equal(payload[0], 12);
  assert.equal(payload.length, 25);
});

test("oversized payloads are rejected", () => assert.throws(() => encodePacket(Opcode.KeyEvents, new Uint8Array(27))));

test("v2 capabilities preserve the legacy prefix and canonical big-endian profile hash", () => {
  const payload = encodeCapabilities({
    ledCount: 108,
    legacyFlags: 7,
    maxLegacyEvents: 12,
    extensionVersion: 2,
    flags: CapabilityFlag.PerKeyEffects | CapabilityFlag.BindingMask,
    layoutHash32: 0xde355358,
    matrixRows: 6,
    matrixColumns: 21,
    maxEffectRecords: 2,
    defaultAtmosphereMix: 0.12,
  });
  assert.equal(payload.length, 16);
  assert.deepEqual([...payload.slice(0, 4)], [108, 7, 12, 2]);
  assert.deepEqual([...payload.slice(8, 12)], [0xde, 0x35, 0x53, 0x58]);
  assert.deepEqual(decodeCapabilities(payload), {
    ledCount: 108, legacyFlags: 7, maxLegacyEvents: 12, extensionVersion: 2,
    flags: CapabilityFlag.PerKeyEffects | CapabilityFlag.BindingMask,
    layoutHash32: 0xde355358, matrixRows: 6, matrixColumns: 21,
    maxEffectRecords: 2, defaultAtmosphereMix: 0.12,
  });
  assert.equal(decodeCapabilities(Uint8Array.of(108)).extensionVersion, 1);
});

test("single-key effects use staged two-record frames and exact firmware fields", () => {
  const effects = Array.from({ length: 3 }, (_, led) => ({
    led, effect: EffectPrimitive.DoublePulse, hue: 18, saturation: 255,
    value: 240, speed: 90, phase: led * 4, durationMs: 600, flags: 1,
  }));
  const frames = encodeSetKeyEffects(effects, 0x1234, 0x5678, 0.12);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].length, 26);
  assert.deepEqual([...frames[0].slice(0, 6)], [0x34, 0x12, 0x78, 0x56, 12, 0x42]);
  assert.deepEqual([...frames[1].slice(0, 6)], [0x34, 0x12, 0x78, 0x56, 12, 0x81]);
  assert.equal(decodeSetKeyEffects(frames[0]).reset, true);
  assert.equal(decodeSetKeyEffects(frames[0]).commit, false);
  assert.equal(decodeSetKeyEffects(frames[1]).effects[0].durationMs, 600);
  assert.deepEqual([...encodeClearKeyEffects()], []);
  assert.deepEqual([...encodeClearKeyEffects([1, 9])], [1, 9]);
});

test("capture, binding mask, control events and acknowledgements round trip", () => {
  const bits = matrixBindingBits([{ row: 0, column: 0 }, { row: 5, column: 19 }]);
  const mask = decodeBindingMask(encodeBindingMask({ revision: 513, matrixBits: bits, encoderMask: 1, flags: 0 }));
  assert.equal(mask.revision, 513);
  assert.equal(mask.matrixBits.length, 16);
  assert.equal(mask.encoderMask, 1);

  assert.deepEqual(decodeCaptureMode(encodeCaptureMode({ enabled: true, token: 0x3344, timeoutMs: 30_000 })), {
    enabled: true, token: 0x3344, timeoutMs: 30_000,
  });
  const control = {
    eventSequence: 0x1234, deviceTick: 0x89abcdef, kind: ControlEventKind.Key,
    row: 5, column: 19, pressed: true, token: 77, flags: 2,
  };
  assert.deepEqual(decodeControlEvent(encodeControlEvent(control)), control);
  const ack = { opcode: Opcode.SetBindingMask, status: 0, revision: 9, epoch: 10, deviceTick: 11 };
  assert.deepEqual(decodeAck(encodeAck(ack)), ack);
  assert.equal(AckStatus.NotUsb, 3);
  assert.equal(AckStatus.NotArmed, 4);
});
