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
    if (request.command === "hello") {
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
