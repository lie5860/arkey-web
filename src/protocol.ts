export const REPORT_SIZE = 32;
export const MAX_PAYLOAD_SIZE = REPORT_SIZE - 6;
export const MAGIC = [0xb0, 0x47] as const;
/** v2 is an extension inside the v1 wire envelope. */
export const PROTOCOL_VERSION = 1;
export const EXTENSION_VERSION = 2;
export const EFFECT_RECORD_SIZE = 10;
export const DEFAULT_ATMOSPHERE_MIX = 0.12;

export enum Opcode {
  Hello = 0x01,
  Capabilities = 0x02,
  SetState = 0x03,
  KeyEvents = 0x04,
  Heartbeat = 0x05,
  Restore = 0x06,
  SetKeyEffects = 0x10,
  ClearKeyEffects = 0x11,
  ControlEvent = 0x13,
  SetCaptureMode = 0x14,
  SetBindingMask = 0x15,
  Ack = 0x7f,
}

export enum CapabilityFlag {
  PerKeyEffects = 1 << 0,
  ControlEvents = 1 << 1,
  CaptureMode = 1 << 2,
  BindingMask = 1 << 3,
}

export enum AckStatus {
  Ok = 0,
  BadLength = 1,
  BadValue = 2,
  NotUsb = 3,
  NotArmed = 4,
}

export enum AgentState {
  Idle = 0,
  Thinking = 1,
  Tool = 2,
  Streaming = 3,
  Complete = 4,
  Error = 5,
}

export enum EffectPrimitive {
  Off = 0,
  Solid = 1,
  ShallowBreath = 2,
  Breath = 3,
  DoublePulse = 4,
  RiseFade = 5,
  PressFlash = 6,
}

export interface Packet {
  opcode: Opcode;
  sequence: number;
  payload: Uint8Array;
}

export interface FirmwareCapabilities {
  ledCount: number;
  extensionVersion: number;
  flags: number;
  legacyFlags?: number;
  maxLegacyEvents?: number;
  layoutHash32?: number;
  matrixRows?: number;
  matrixColumns?: number;
  maxEffectRecords?: number;
  defaultAtmosphereMix?: number;
}

export interface KeyLightEvent {
  led: number;
  intensity?: number;
}

export interface EffectSpec {
  led: number;
  effect: EffectPrimitive;
  hue: number;
  saturation: number;
  value: number;
  speed: number;
  phase: number;
  durationMs: number;
  flags?: number;
}

export interface SetKeyEffectsFrame {
  revision: number;
  epoch: number;
  atmosphereMix: number;
  reset: boolean;
  commit: boolean;
  effects: EffectSpec[];
}

export interface BindingMask {
  revision: number;
  matrixBits: Uint8Array;
  encoderMask: number;
  flags?: number;
}

export enum ControlEventKind {
  Key = 0,
  EncoderCounterClockwise = 1,
  EncoderClockwise = 2,
}

export interface ControlEvent {
  kind: ControlEventKind;
  row: number;
  column: number;
  pressed: boolean;
  eventSequence: number;
  deviceTick: number;
  token: number;
  flags: number;
}

export interface CaptureMode {
  enabled: boolean;
  token: number;
  timeoutMs: number;
}

export interface Ack {
  opcode: Opcode;
  status: number;
  revision: number;
  epoch: number;
  deviceTick: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function readU16(source: Uint8Array, offset: number): number {
  return source[offset] | (source[offset + 1] << 8);
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function readU32(source: Uint8Array, offset: number): number {
  return (source[offset] | (source[offset + 1] << 8) | (source[offset + 2] << 16) | (source[offset + 3] << 24)) >>> 0;
}

function writeU32BigEndian(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readU32BigEndian(source: Uint8Array, offset: number): number {
  return ((source[offset] << 24) | (source[offset + 1] << 16) | (source[offset + 2] << 8) | source[offset + 3]) >>> 0;
}

export function encodePacket(opcode: Opcode, payload: Uint8Array<ArrayBufferLike> = new Uint8Array(), sequence = 0): Uint8Array {
  if (payload.length > MAX_PAYLOAD_SIZE) throw new Error(`Arkey payload exceeds ${MAX_PAYLOAD_SIZE} bytes`);
  const packet = new Uint8Array(REPORT_SIZE);
  packet[0] = MAGIC[0];
  packet[1] = MAGIC[1];
  packet[2] = PROTOCOL_VERSION;
  packet[3] = opcode;
  packet[4] = payload.length;
  packet[5] = sequence & 0xff;
  packet.set(payload, 6);
  return packet;
}

export function normalizeReport(data: ArrayLike<number>): Uint8Array {
  const bytes = Uint8Array.from(data);
  if (bytes.length === REPORT_SIZE + 1) return bytes.slice(1);
  if (bytes.length === REPORT_SIZE) return bytes;
  throw new Error(`Unexpected HID report length ${bytes.length}`);
}

export function decodePacket(data: ArrayLike<number>): Packet {
  const bytes = Uint8Array.from(data);
  if (bytes.length < 6 || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]) throw new Error("Not an Arkey packet");
  if (bytes[2] !== PROTOCOL_VERSION) throw new Error(`Unsupported Arkey protocol ${bytes[2]}`);
  const length = bytes[4];
  if (length > MAX_PAYLOAD_SIZE || bytes.length < length + 6) throw new Error("Invalid Arkey payload length");
  return { opcode: bytes[3] as Opcode, sequence: bytes[5], payload: bytes.slice(6, 6 + length) };
}

export function encodeState(state: AgentState, hue = 145, saturation = 255, intensity = 180): Uint8Array {
  return Uint8Array.of(state, hue, saturation, intensity);
}

export function encodeKeyEvents(events: KeyLightEvent[]): Uint8Array {
  const selected = events.slice(0, 12);
  const payload = new Uint8Array(1 + selected.length * 2);
  payload[0] = selected.length;
  selected.forEach((event, index) => {
    payload[1 + index * 2] = event.led & 0xff;
    payload[2 + index * 2] = event.intensity ?? 255;
  });
  return payload;
}

export function encodeCapabilities(capabilities: FirmwareCapabilities): Uint8Array {
  if (capabilities.extensionVersion <= 1 && capabilities.flags === 0 && capabilities.layoutHash32 === undefined) {
    return Uint8Array.of(capabilities.ledCount);
  }
  const payload = new Uint8Array(16);
  payload[0] = capabilities.ledCount & 0xff;
  payload[1] = capabilities.legacyFlags ?? 0x07;
  payload[2] = capabilities.maxLegacyEvents ?? 12;
  payload[3] = capabilities.extensionVersion & 0xff;
  writeU32(payload, 4, capabilities.flags);
  // Profile hashes are displayed and compared in canonical hex byte order,
  // unlike the numeric feature bit field immediately before them.
  writeU32BigEndian(payload, 8, capabilities.layoutHash32 ?? 0);
  payload[12] = capabilities.matrixRows ?? 0;
  payload[13] = capabilities.matrixColumns ?? 0;
  payload[14] = capabilities.maxEffectRecords ?? 2;
  payload[15] = clampByte((capabilities.defaultAtmosphereMix ?? DEFAULT_ATMOSPHERE_MIX) * 100);
  return payload;
}

export function decodeCapabilities(payload: Uint8Array): FirmwareCapabilities {
  if (!payload.length) throw new Error("Capabilities payload is empty");
  if (payload.length < 16) return {
    ledCount: payload[0],
    extensionVersion: 1,
    flags: 0,
    legacyFlags: payload[1],
    maxLegacyEvents: payload[2],
  };
  return {
    ledCount: payload[0],
    legacyFlags: payload[1],
    maxLegacyEvents: payload[2],
    extensionVersion: payload[3],
    flags: readU32(payload, 4),
    layoutHash32: readU32BigEndian(payload, 8),
    matrixRows: payload[12],
    matrixColumns: payload[13],
    maxEffectRecords: payload[14],
    defaultAtmosphereMix: payload[15] / 100,
  };
}

export function encodeEffectRecord(effect: EffectSpec): Uint8Array {
  const record = new Uint8Array(EFFECT_RECORD_SIZE);
  record[0] = clampByte(effect.led);
  record[1] = clampByte(effect.effect);
  record[2] = clampByte(effect.hue);
  record[3] = clampByte(effect.saturation);
  record[4] = clampByte(effect.value);
  record[5] = clampByte(effect.speed);
  record[6] = clampByte(effect.phase);
  writeU16(record, 7, Math.min(655_350, Math.max(0, Math.round(effect.durationMs))) / 10);
  record[9] = clampByte(effect.flags ?? 0);
  return record;
}

export function decodeEffectRecord(record: Uint8Array): EffectSpec {
  if (record.length < EFFECT_RECORD_SIZE) throw new Error("Effect record is truncated");
  return {
    led: record[0],
    effect: record[1] as EffectPrimitive,
    hue: record[2],
    saturation: record[3],
    value: record[4],
    speed: record[5],
    phase: record[6],
    durationMs: readU16(record, 7) * 10,
    flags: record[9],
  };
}

/**
 * Produces one or more v2 payloads. The firmware stages each payload and swaps
 * atomically only when the final payload carries the commit bit.
 */
export function encodeSetKeyEffects(effects: EffectSpec[], revision: number, epoch: number, atmosphereMix = DEFAULT_ATMOSPHERE_MIX): Uint8Array[] {
  const chunks: EffectSpec[][] = [];
  for (let index = 0; index < effects.length; index += 2) chunks.push(effects.slice(index, index + 2));
  if (!chunks.length) chunks.push([]);
  return chunks.map((chunk, index) => {
    const payload = new Uint8Array(6 + chunk.length * EFFECT_RECORD_SIZE);
    writeU16(payload, 0, revision);
    writeU16(payload, 2, epoch);
    payload[4] = clampByte(atmosphereMix * 100);
    payload[5] = chunk.length | (index === 0 ? 0x40 : 0) | (index === chunks.length - 1 ? 0x80 : 0);
    chunk.forEach((effect, effectIndex) => payload.set(encodeEffectRecord(effect), 6 + effectIndex * EFFECT_RECORD_SIZE));
    return payload;
  });
}

export function decodeSetKeyEffects(payload: Uint8Array): SetKeyEffectsFrame {
  if (payload.length < 6) throw new Error("SetKeyEffects payload is truncated");
  const control = payload[5];
  const count = control & 0x0f;
  if (count > 2 || payload.length !== 6 + count * EFFECT_RECORD_SIZE) throw new Error("SetKeyEffects effect count is invalid");
  const effects = Array.from({ length: count }, (_, index) => decodeEffectRecord(payload.slice(6 + index * EFFECT_RECORD_SIZE)));
  return {
    revision: readU16(payload, 0),
    epoch: readU16(payload, 2),
    atmosphereMix: payload[4] / 100,
    reset: (control & 0x40) !== 0,
    commit: (control & 0x80) !== 0,
    effects,
  };
}

export function encodeClearKeyEffects(leds: number[] = []): Uint8Array {
  return Uint8Array.from(leds.slice(0, MAX_PAYLOAD_SIZE).map(clampByte));
}

export function encodeBindingMask(mask: BindingMask): Uint8Array {
  if (mask.matrixBits.length !== 16) throw new Error("Q6 binding mask must contain exactly 16 bytes");
  const payload = new Uint8Array(20);
  writeU16(payload, 0, mask.revision);
  payload.set(mask.matrixBits, 2);
  payload[18] = mask.encoderMask & 0xff;
  payload[19] = mask.flags ?? 0;
  return payload;
}

export function decodeBindingMask(payload: Uint8Array): BindingMask {
  if (payload.length < 20) throw new Error("Binding mask payload is truncated");
  return {
    revision: readU16(payload, 0),
    matrixBits: payload.slice(2, 18),
    encoderMask: payload[18],
    flags: payload[19],
  };
}

export function matrixBindingBits(positions: Array<{ row: number; column: number }>, columns = 21): Uint8Array {
  const mask = new Uint8Array(16);
  for (const { row, column } of positions) {
    const bit = row * columns + column;
    if (bit < 0 || bit >= mask.length * 8) throw new Error(`Matrix position ${row},${column} is outside binding mask`);
    mask[bit >>> 3] |= 1 << (bit & 7);
  }
  return mask;
}

export function encodeCaptureMode(capture: CaptureMode): Uint8Array {
  const payload = new Uint8Array(5);
  payload[0] = capture.enabled ? 1 : 0;
  writeU16(payload, 1, capture.token);
  writeU16(payload, 3, Math.min(30_000, Math.max(0, Math.round(capture.timeoutMs))));
  return payload;
}

export function decodeCaptureMode(payload: Uint8Array): CaptureMode {
  if (payload.length < 5) throw new Error("Capture mode payload is truncated");
  const timeoutMs = readU16(payload, 3);
  return { enabled: (payload[0] & 1) !== 0, token: readU16(payload, 1), timeoutMs: timeoutMs === 0 ? 30_000 : Math.min(30_000, timeoutMs) };
}

export function encodeControlEvent(event: ControlEvent): Uint8Array {
  const payload = new Uint8Array(13);
  writeU16(payload, 0, event.eventSequence);
  writeU32(payload, 2, event.deviceTick);
  payload[6] = event.kind;
  payload[7] = event.row & 0xff;
  payload[8] = event.column & 0xff;
  payload[9] = event.pressed ? 1 : 0;
  writeU16(payload, 10, event.token);
  payload[12] = event.flags & 0xff;
  return payload;
}

export function decodeControlEvent(payload: Uint8Array): ControlEvent {
  if (payload.length < 13) throw new Error("Control event payload is truncated");
  return {
    eventSequence: readU16(payload, 0),
    deviceTick: readU32(payload, 2),
    kind: payload[6] as ControlEventKind,
    row: payload[7],
    column: payload[8],
    pressed: payload[9] !== 0,
    token: readU16(payload, 10),
    flags: payload[12],
  };
}

export function encodeAck(ack: Ack): Uint8Array {
  const payload = new Uint8Array(10);
  payload[0] = ack.opcode;
  payload[1] = ack.status & 0xff;
  writeU16(payload, 2, ack.revision);
  writeU16(payload, 4, ack.epoch);
  writeU32(payload, 6, ack.deviceTick);
  return payload;
}

export function decodeAck(payload: Uint8Array): Ack {
  if (payload.length < 2) throw new Error("Ack payload is truncated");
  return {
    opcode: payload[0] as Opcode,
    status: payload[1],
    revision: payload.length >= 4 ? readU16(payload, 2) : 0,
    epoch: payload.length >= 6 ? readU16(payload, 4) : 0,
    deviceTick: payload.length >= 10 ? readU32(payload, 6) : 0,
  };
}
