import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  isMicroControl,
  isMicroPhase,
  MicroBridgeController,
  MicroBridgeLineDecoder,
  type MicroBridgeSerialPort,
} from "../src/microbridge.js";

class FakeSerialPort extends EventEmitter implements MicroBridgeSerialPort {
  isOpen = false;
  readonly requests: Record<string, unknown>[] = [];
  private inputAttempts = 0;

  constructor(private readonly answersHello = true) {
    super();
  }

  open(callback: (error?: Error | null) => void): void {
    this.isOpen = true;
    queueMicrotask(() => callback());
  }

  close(callback: (error?: Error | null) => void): void {
    this.isOpen = false;
    queueMicrotask(() => {
      this.emit("close");
      callback();
    });
  }

  write(data: string, callback: (error?: Error | null) => void): void {
    const request = JSON.parse(data) as Record<string, unknown>;
    this.requests.push(request);
    queueMicrotask(() => callback());
    if (request.command === "hello" && this.answersHello) {
      queueMicrotask(() => {
        this.emitJson({ event: "ack", sequence: request.sequence, ok: true });
        this.emitJson({
          event: "bridge",
          firmwareVersion: "0.1.6-arkey-esp32s3-lab",
          usbMounted: true,
          desktopConnected: true,
        });
      });
      return;
    }
    if (request.command === "input" && ++this.inputAttempts === 2) {
      queueMicrotask(() => this.emitJson({ event: "ack", sequence: request.sequence, ok: true }));
    }
  }

  push(value: Record<string, unknown>): void {
    this.emitJson(value);
  }

  private emitJson(value: Record<string, unknown>): void {
    this.emit("data", Buffer.from(`${JSON.stringify(value)}\n`));
  }
}

test("ESP32-S3 bridge decoder ignores boot logs and accepts fragmented JSON lines", () => {
  const decoder = new MicroBridgeLineDecoder();
  assert.deepEqual(decoder.append("I (42) boot: ESP-IDF\n{\"event\":\"bri"), []);
  assert.deepEqual(decoder.append("dge\",\"usbMounted\":true,\"desktopConnected\":false}\n"), [{
    event: "bridge",
    usbMounted: true,
    desktopConnected: false,
  }]);
});

test("ESP32-S3 bridge control surface is a fixed semantic allowlist", () => {
  for (const control of ["agent-1", "agent-6", "fast", "approve", "ptt", "reasoning-press", "encoder-cw", "joystick-left"]) {
    assert.equal(isMicroControl(control), true, control);
  }
  assert.equal(isMicroControl("arbitrary-json"), false);
  assert.equal(isMicroControl("flash"), false);
  assert.equal(isMicroPhase("down"), true);
  assert.equal(isMicroPhase("up"), true);
  assert.equal(isMicroPhase("tap"), true);
  assert.equal(isMicroPhase("toggle"), false);
});

test("ESP32-S3 bridge decoder bounds unterminated serial input", () => {
  const decoder = new MicroBridgeLineDecoder();
  assert.deepEqual(decoder.append("x".repeat(20_000)), []);
  assert.deepEqual(decoder.append("{\"event\":\"bridge\"}\n"), [{ event: "bridge" }]);
});

test("ESP32-S3 bridge retries a lost acknowledgement with the same sequence", async () => {
  const port = new FakeSerialPort();
  const bridge = new MicroBridgeController("/dev/fake-esp32s3", {
    createPort: () => port,
    acknowledgementTimeoutMs: 100,
    acknowledgementRetryMs: 10,
    reconnectIntervalMs: 1_000,
  });
  await bridge.start();
  assert.equal(bridge.state().firmwareVersion, "0.1.6-arkey-esp32s3-lab");
  await bridge.send("agent-1", "down");
  await bridge.stop();

  const inputs = port.requests.filter((request) => request.command === "input");
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0]?.sequence, inputs[1]?.sequence);
  assert.equal(inputs[0]?.control, "agent-1");
  assert.equal(inputs[0]?.phase, "down");
});

test("ESP32-S3 bridge merges incremental slot light updates", async () => {
  const port = new FakeSerialPort();
  const bridge = new MicroBridgeController("/dev/fake-esp32s3", {
    createPort: () => port,
    acknowledgementTimeoutMs: 100,
    acknowledgementRetryMs: 10,
    reconnectIntervalMs: 1_000,
  });
  await bridge.start();

  port.push({
    event: "slot_status",
    slots: [
      { slot: 0, c: 0x0000ff, b: 0.8, e: 4, s: 0.25 },
      { slot: 1, c: 0x00ff00, b: 0.6, e: 1, s: 0.5 },
    ],
  });
  port.push({ event: "slot_status", slots: [{ slot: 0, c: 0xff0000 }] });

  assert.deepEqual(bridge.state().slotLights, [
    { slot: 0, color: 0xff0000, brightness: 0.8, effect: 4, speed: 0.25 },
    { slot: 1, color: 0x00ff00, brightness: 0.6, effect: 1, speed: 0.5 },
  ]);
  await bridge.stop();
});

test("ESP32-S3 bridge discovers and connects the only matching USB device", async () => {
  const bridge = new MicroBridgeController("", {
    createPort: (path) => new FakeSerialPort(path === "/dev/arkey"),
    listPorts: async () => [
      { path: "/dev/not-usb" },
      { path: "/dev/other-usb", vendorId: "1111", productId: "2222" },
      { path: "/dev/arkey", vendorId: "303A", productId: "1001" },
    ],
    acknowledgementTimeoutMs: 30,
    acknowledgementRetryMs: 5,
    reconnectIntervalMs: 1_000,
  });

  await bridge.start();
  assert.equal(bridge.state().configuredPort, "/dev/arkey");
  assert.equal(bridge.state().connection, "ready");
  await bridge.stop();
});

test("ESP32-S3 bridge falls back to discovery when the saved path no longer works", async () => {
  const bridge = new MicroBridgeController("/dev/old-arkey", {
    createPort: (path) => new FakeSerialPort(path === "/dev/new-arkey"),
    listPorts: async () => [
      { path: "/dev/old-arkey", vendorId: "303A", productId: "1001" },
      { path: "/dev/new-arkey", vendorId: "303A", productId: "1001" },
    ],
    acknowledgementTimeoutMs: 30,
    acknowledgementRetryMs: 5,
    reconnectIntervalMs: 1_000,
  });

  await bridge.start();
  assert.equal(bridge.state().configuredPort, "/dev/new-arkey");
  assert.equal(bridge.state().connection, "ready");
  await bridge.stop();
});

test("ESP32-S3 bridge does not choose between multiple matching devices", async () => {
  const bridge = new MicroBridgeController("", {
    createPort: () => new FakeSerialPort(),
    listPorts: async () => [
      { path: "/dev/arkey-a", vendorId: "303A", productId: "1001" },
      { path: "/dev/arkey-b", vendorId: "303A", productId: "1001" },
    ],
    acknowledgementTimeoutMs: 30,
    acknowledgementRetryMs: 5,
    reconnectIntervalMs: 1_000,
  });

  await bridge.start();
  assert.equal(bridge.state().configuredPort, "");
  assert.equal(bridge.state().connection, "error");
  assert.match(bridge.state().lastError ?? "", /多个 Arkey 设备/);
  await bridge.stop();
});
