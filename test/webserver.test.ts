import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedHost, isAllowedOrigin, isWebSettings, sanitizeSnapshot } from "../src/webserver.js";

test("Web settings accept only the versioned control configuration document", () => {
  assert.equal(isWebSettings({ version: 1, nodePath: "/usr/bin/node", codexPath: "/usr/bin/codex" }), true);
  assert.equal(isWebSettings({
    version: 1,
    nodePath: "/usr/bin/node",
    codexPath: "",
    controlMode: "esp32s3MicroLab",
    microBridgePort: "/dev/cu.usbserial-test",
  }), true);
  assert.equal(isWebSettings({ version: 1, nodePath: "/usr/bin/node", codexPath: "", controlMode: "unknown" }), false);
  assert.equal(isWebSettings({ version: 1, nodePath: "/usr/bin/node", codexPath: "", token: "secret" }), false);
  assert.equal(isWebSettings({ version: 2, nodePath: "/usr/bin/node", codexPath: "" }), false);
});

test("Web snapshot removes Codex thread identifiers and content fields", () => {
  const snapshot = sanitizeSnapshot({
    status: {
      running: true,
      appServer: "ready",
      authenticated: true,
      selectedTaskId: "task-public",
      models: [{ model: "gpt-test", displayName: "Test", efforts: ["low"], serviceTiers: ["fast"] }],
      capabilities: { appServer: true, fullHardwareControl: false, plan: true },
    },
    settings: { workspaceRoot: "/tmp/project", selectedModel: "gpt-test", accessToken: "do-not-copy" },
    tasks: [{
      taskId: "task-public",
      threadId: "thread-secret",
      statusObserved: true,
      activeTurnId: "turn-secret",
      title: "Agent 1",
      state: "working",
      unread: false,
      selected: true,
      pinned: false,
      recencyAt: "2026-07-18T00:00:00.000Z",
      pendingApprovalCount: 1,
      pendingStructuredRequestCount: 0,
      responseText: "private thread content",
    }],
    bindings: [{ taskId: "task-public", controlId: "r1c1" }],
    account: { token: "secret" },
  }, {
    nodePath: "/usr/bin/node",
    codexPath: "/usr/bin/codex",
    managedDaemon: false,
    daemonOnline: true,
    serverOrigin: "http://127.0.0.1:4765",
  });

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /thread-secret|turn-secret|private thread content|do-not-copy|accessToken/);
  assert.doesNotMatch(serialized, /bindings|account/);
  assert.match(serialized, /task-public/);
  assert.match(serialized, /fullHardwareControl/);
  assert.equal((snapshot.tasks as Array<{ bound?: boolean }>)[0]?.bound, true);
  assert.equal((snapshot.tasks as Array<{ statusObserved?: boolean }>)[0]?.statusObserved, true);
});

test("Web server host and origin checks allow only the exact loopback endpoint", () => {
  assert.equal(isAllowedHost("127.0.0.1:4765", 4765), true);
  assert.equal(isAllowedHost("localhost:4765", 4765), true);
  assert.equal(isAllowedHost("example.test:4765", 4765), false);
  assert.equal(isAllowedOrigin("http://127.0.0.1:4765", "127.0.0.1:4765", 4765), true);
  assert.equal(isAllowedOrigin("http://localhost:4765", "127.0.0.1:4765", 4765), false);
  assert.equal(isAllowedOrigin(undefined, "127.0.0.1:4765", 4765), false);
});
