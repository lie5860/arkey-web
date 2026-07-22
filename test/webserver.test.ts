import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedHost, isAllowedOrigin, isWebSettings } from "../src/webserver.js";

test("Web settings contain only local UI and USB control preferences", () => {
  assert.equal(isWebSettings({ version: 1, microBridgePort: "/dev/cu.usbmodem-test", alwaysOnTop: true, focusCodexOnInput: true }), true);
  assert.equal(isWebSettings({ version: 1, microBridgePort: "", alwaysOnTop: false, focusCodexOnInput: false }), true);
  assert.equal(isWebSettings({ version: 1, microBridgePort: "/dev/test" }), false);
  assert.equal(isWebSettings({ version: 1, microBridgePort: "/dev/test", alwaysOnTop: false, focusCodexOnInput: false, codexPath: "/secret" }), false);
  assert.equal(isWebSettings({ version: 2, microBridgePort: "/dev/test", alwaysOnTop: false, focusCodexOnInput: false }), false);
});

test("Web server accepts only its exact loopback host and origin", () => {
  assert.equal(isAllowedHost("127.0.0.1:4765", 4765), true);
  assert.equal(isAllowedHost("localhost:4765", 4765), true);
  assert.equal(isAllowedHost("example.test:4765", 4765), false);
  assert.equal(isAllowedOrigin("http://127.0.0.1:4765", "127.0.0.1:4765", 4765), true);
  assert.equal(isAllowedOrigin("http://localhost:4765", "127.0.0.1:4765", 4765), false);
  assert.equal(isAllowedOrigin(undefined, "127.0.0.1:4765", 4765), false);
});
