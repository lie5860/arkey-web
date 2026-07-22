import assert from "node:assert/strict";
import test from "node:test";
import { reasoningControlForWheelEvent } from "../apps/ArkeyWeb/src/reasoningWheel.js";

test("reasoning wheel sends one encoder step per continuous gesture", () => {
  assert.equal(reasoningControlForWheelEvent(undefined, 1_000, -10), "encoder-cw");
  assert.equal(reasoningControlForWheelEvent(1_000, 1_016, -20), undefined);
  assert.equal(reasoningControlForWheelEvent(1_016, 1_032, -30), undefined);
  assert.equal(reasoningControlForWheelEvent(1_032, 1_400, 10), undefined);
  assert.equal(reasoningControlForWheelEvent(1_400, 1_916, 10), "encoder-ccw");
  assert.equal(reasoningControlForWheelEvent(1_916, 1_932, 0), undefined);
});
