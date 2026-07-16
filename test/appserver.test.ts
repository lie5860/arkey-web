import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CodexAppServerClient, isBinaryApprovalMethod, isStructuredRequestMethod, resolveCodexExecutable, type AppServerProcess } from "../src/appserver.js";

class FakeChild extends EventEmitter implements AppServerProcess {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill(): boolean { this.killed = true; return true; }
}

test("App Server client performs the stable stdio handshake and routes JSON-RPC", async () => {
  const child = new FakeChild();
  const methods: string[] = [];
  const responses: Array<Record<string, unknown>> = [];
  let initializeParams: Record<string, unknown> | undefined;
  let input = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => {
    input += chunk;
    let newline: number;
    while ((newline = input.indexOf("\n")) >= 0) {
      const message = JSON.parse(input.slice(0, newline)) as Record<string, unknown>;
      input = input.slice(newline + 1);
      if (typeof message.method === "string") methods.push(message.method);
      if (message.method === "initialize") {
        initializeParams = message.params as Record<string, unknown>;
        child.stdout.write(`${JSON.stringify({ id: message.id, result: { codexHome: "/tmp/codex" } })}\n`);
      }
      else if (message.method === "account/read") child.stdout.write(`${JSON.stringify({ id: message.id, result: { account: { type: "chatgpt" }, requiresOpenaiAuth: false } })}\n`);
      else if (message.method === "model/list") child.stdout.write(`${JSON.stringify({ id: message.id, result: { data: [{
        model: "test-model", isDefault: true, defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }],
        serviceTiers: [{ id: "standard", name: "Standard" }, { id: "priority", name: "Fast" }],
      }] } })}\n`);
      else if (message.method === "thread/start") child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: "thread-1" } } })}\n`);
      else if (message.result) responses.push(message);
    }
  });

  const client = new CodexAppServerClient(() => child);
  const ready = await client.start();
  assert.deepEqual(methods.slice(0, 4), ["initialize", "initialized", "account/read", "model/list"]);
  assert.deepEqual(initializeParams?.capabilities, { experimentalApi: true, requestAttestation: false });
  assert.equal(ready.models[0].model, "test-model");
  assert.equal(client.fastTier(), "priority");
  client.models[0].serviceTiers = [{ id: "priority" }];
  assert.equal(client.fastTier(), undefined, "a tier id alone must not be hardcoded as Fast");
  assert.deepEqual(client.reasoningEfforts(), ["low", "medium", "high"]);
  assert.deepEqual(await client.request("thread/start", { cwd: "/tmp/project" }), { thread: { id: "thread-1" } });

  const requestPromise = once(client, "serverRequest");
  child.stdout.write(`${JSON.stringify({ id: 81, method: "item/commandExecution/requestApproval", params: { threadId: "thread-1" } })}\n`);
  const [request] = await requestPromise;
  assert.equal(request.id, 81);
  client.respond(81, { decision: "accept" });
  assert.deepEqual(responses.at(-1), { id: 81, result: { decision: "accept" } });

  assert.equal(isBinaryApprovalMethod("item/fileChange/requestApproval"), true);
  assert.equal(isStructuredRequestMethod("item/permissions/requestApproval"), true);
  await client.stop();
  assert.equal(child.killed, true);
});

test("Codex executable resolution works under launchd without relying on a shell", () => {
  const existing = new Set(["/custom/codex", "/opt/homebrew/bin/codex"]);
  const exists = (path: string) => existing.has(path);
  assert.equal(resolveCodexExecutable({ CODEX_PATH: "/custom/codex", PATH: "" }, exists), "/custom/codex");
  assert.equal(resolveCodexExecutable({ PATH: "" }, exists), "/opt/homebrew/bin/codex");
  assert.throws(() => resolveCodexExecutable({ CODEX_PATH: "relative/codex", PATH: "" }, () => false), /CODEX_PATH/);
});
