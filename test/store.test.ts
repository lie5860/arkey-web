import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStores } from "../src/store.js";

test("versioned stores atomically persist only non-content Arkey state with mode 0600", () => {
  const directory = mkdtempSync(join(tmpdir(), "arkey-store-"));
  try {
    const stores = createStores(directory, "/tmp/project");
    const settings = stores.settings.read();
    settings.hardwareSync = false;
    stores.settings.write(settings);
    stores.bindings.write({
      version: 1,
      revision: 4,
      bindings: [{
        controlId: "r0c1", instanceId: "instance-1", actionId: "task_agent", taskId: "task-1",
        profileId: "keychron-q6-pro-ansi-knob", layoutHash: "8".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    const settingsPath = join(directory, "settings-v1.json");
    const bindingPath = join(directory, "bindings-v1.json");
    assert.equal(statSync(settingsPath).mode & 0o777, 0o600);
    assert.equal(statSync(bindingPath).mode & 0o777, 0o600);
    const serialized = readFileSync(bindingPath, "utf8");
    assert.doesNotMatch(serialized, /prompt|audio|transcript/i);
    assert.equal(stores.bindings.read().revision, 4);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
