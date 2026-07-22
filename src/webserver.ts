import { randomBytes } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodexExecutable } from "./appserver.js";
import { isMicroControl, isMicroPhase, listMicroBridgePorts, MicroBridgeController } from "./microbridge.js";
import { runtimeDir, sendMessage, sendRpc } from "./runtime.js";
import { AtomicJsonStore } from "./store.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4765;
const MAX_BODY_BYTES = 64 * 1024;
const MUTATING_RPC_METHODS = new Set([
  "task.create",
  "task.select",
  "task.activate",
  "composer.send",
  "action.trigger",
  "settings.update",
  "voice.state",
]);
const WEB_ACTIONS = new Set([
  "task_agent",
  "approve",
  "decline",
  "send",
  "continue",
  "fast",
  "reasoning",
  "plan",
  "review",
  "ptt",
]);

export interface WebSettings {
  version: 1;
  nodePath: string;
  codexPath: string;
  controlMode?: "appServer" | "esp32s3MicroLab";
  microBridgePort?: string;
}

interface DaemonState {
  managedDaemon: boolean;
  daemonOnline: boolean;
  lastError?: string;
}

interface WebServerOptions {
  host?: string;
  port?: number;
  staticDirectory?: string;
  settingsPath?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isWebSettings(value: unknown): value is WebSettings {
  return isObject(value) &&
    value.version === 1 &&
    typeof value.nodePath === "string" &&
    typeof value.codexPath === "string" &&
    (value.controlMode === undefined || value.controlMode === "appServer" || value.controlMode === "esp32s3MicroLab") &&
    (value.microBridgePort === undefined || typeof value.microBridgePort === "string") &&
    Object.keys(value).every((key) => ["version", "nodePath", "codexPath", "controlMode", "microBridgePort"].includes(key));
}

function defaultWebSettings(): WebSettings {
  let codexPath = "";
  try {
    codexPath = resolveCodexExecutable();
  } catch {
    // A user can provide the Codex executable from the Web settings screen.
  }
  return { version: 1, nodePath: process.execPath, codexPath, controlMode: "appServer", microBridgePort: "" };
}

function controlMode(settings: WebSettings): "appServer" | "esp32s3MicroLab" {
  return settings.controlMode === "esp32s3MicroLab" ? "esp32s3MicroLab" : "appServer";
}

function webSettingsStore(path = join(runtimeDir, "web-settings-v1.json")): AtomicJsonStore<WebSettings> {
  return new AtomicJsonStore(path, defaultWebSettings, isWebSettings);
}

function safeString(value: unknown, maximum = 1_000): string | undefined {
  return typeof value === "string" ? value.slice(0, maximum) : undefined;
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function sanitizeSnapshot(value: unknown, web: Record<string, unknown>, hardware: unknown = {}): Record<string, unknown> {
  const snapshot = isObject(value) ? value : {};
  const rawStatus = isObject(snapshot.status) ? snapshot.status : {};
  const rawCapabilities = isObject(rawStatus.capabilities) ? rawStatus.capabilities : {};
  const rawSettings = isObject(snapshot.settings) ? snapshot.settings : {};
  const rawTasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  const rawModels = Array.isArray(rawStatus.models) ? rawStatus.models : [];

  const models = rawModels.flatMap((model) => {
    if (!isObject(model) || typeof model.model !== "string") return [];
    return [{
      model: model.model.slice(0, 200),
      displayName: safeString(model.displayName, 200),
      isDefault: model.isDefault === true,
      efforts: Array.isArray(model.efforts) ? model.efforts.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
      serviceTiers: Array.isArray(model.serviceTiers) ? model.serviceTiers.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
    }];
  });

  const tasks = rawTasks.flatMap((task) => {
    if (!isObject(task) || typeof task.taskId !== "string" || typeof task.title !== "string") return [];
    return [{
      taskId: task.taskId,
      slotIndex: Number.isInteger(task.slotIndex) ? task.slotIndex : 0,
      bound: typeof task.threadId === "string" && task.threadId.length > 0,
      statusObserved: task.statusObserved === true,
      title: task.title.slice(0, 200),
      state: safeString(task.state, 40) ?? "offline",
      unread: task.unread === true,
      selected: task.selected === true,
      pinned: task.pinned === true,
      recencyAt: safeString(task.recencyAt, 80) ?? "",
      pendingApprovalCount: safeCount(task.pendingApprovalCount),
      pendingStructuredRequestCount: safeCount(task.pendingStructuredRequestCount),
      serviceTier: safeString(task.serviceTier, 100),
      effort: safeString(task.effort, 100),
      model: safeString(task.model, 200),
      lastError: safeString(task.lastError, 400),
    }];
  });

  return {
    status: {
      running: rawStatus.running === true,
      appServer: ["starting", "ready", "offline", "restarting"].includes(String(rawStatus.appServer)) ? rawStatus.appServer : "offline",
      authenticated: rawStatus.authenticated === true,
      selectedTaskId: safeString(rawStatus.selectedTaskId, 100),
      models,
      capabilities: {
        appServer: rawCapabilities.appServer === true,
        fullHardwareControl: rawCapabilities.fullHardwareControl === true,
        plan: rawCapabilities.plan === true,
      },
    },
    settings: {
      workspaceRoot: safeString(rawSettings.workspaceRoot, 2_000) ?? "",
      selectedModel: safeString(rawSettings.selectedModel, 200),
    },
    tasks,
    web,
    hardware,
  };
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function isAllowedOrigin(origin: string | undefined, host: string | undefined, port: number): boolean {
  if (!origin || !isAllowedHost(host, port)) return false;
  return origin === `http://${host}`;
}

function validateExecutable(path: string, label: string): void {
  if (!isAbsolute(path)) throw new Error(`${label} 路径必须是绝对路径`);
  let realPath: string;
  try {
    realPath = realpathSync(path);
    accessSync(realPath, constants.X_OK);
    if (!statSync(realPath).isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`${label} 路径不是可执行文件`);
  }
  const probe = spawnSync(realPath, ["--version"], { encoding: "utf8", timeout: 5_000 });
  if (probe.error || probe.status !== 0) throw new Error(`${label} 无法通过 --version 检查`);
}

function validateWorkspace(path: string): void {
  if (!isAbsolute(path)) throw new Error("工作目录必须是绝对路径");
  try {
    if (!statSync(realpathSync(path)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error("工作目录不存在或无法读取");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function rpcWithTimeout(method: string, params: unknown = {}, milliseconds = 2_000): Promise<unknown> {
  return Promise.race([
    sendRpc(method, params),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Arkey daemon 响应超时")), milliseconds)),
  ]);
}

async function legacySnapshot(): Promise<Record<string, unknown>> {
  const [status, settings, tasks] = await Promise.all([
    Promise.race([
      sendMessage({ type: "status" }, true),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Arkey daemon 响应超时")), 2_000)),
    ]),
    rpcWithTimeout("settings.get"),
    rpcWithTimeout("task.list"),
  ]);
  return { status, settings, tasks };
}

class DaemonController {
  private child?: ChildProcess;
  private lastError?: string;

  constructor(
    private settings: WebSettings,
    private readonly cliPath: string,
  ) {}

  configuration(): WebSettings {
    return { ...this.settings };
  }

  state(): DaemonState {
    return {
      managedDaemon: this.child !== undefined,
      daemonOnline: this.lastError === undefined,
      lastError: this.lastError,
    };
  }

  async ensure(): Promise<void> {
    try {
      await this.readSnapshot();
      this.lastError = undefined;
      return;
    } catch {
      // No compatible daemon is listening, so this Web process may start one.
    }
    await this.startManaged();
  }

  async snapshot(): Promise<unknown> {
    try {
      const snapshot = await this.readSnapshot();
      this.lastError = undefined;
      return snapshot;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async configure(next: WebSettings): Promise<{ restarted: boolean; managedDaemon: boolean }> {
    const changed = next.nodePath !== this.settings.nodePath || next.codexPath !== this.settings.codexPath;
    this.settings = next;
    if (!changed) return { restarted: false, managedDaemon: this.child !== undefined };
    if (!this.child) {
      return { restarted: false, managedDaemon: false };
    }
    await this.stopManaged();
    await this.startManaged();
    return { restarted: true, managedDaemon: true };
  }

  async stop(): Promise<void> {
    await this.stopManaged();
  }

  async disable(): Promise<void> {
    await this.stopManaged();
  }

  private async startManaged(): Promise<void> {
    if (this.child) return;
    validateExecutable(this.settings.nodePath, "Node");
    if (this.settings.codexPath) validateExecutable(this.settings.codexPath, "Codex");
    if (!existsSync(this.cliPath)) throw new Error(`Arkey daemon 入口不存在: ${this.cliPath}`);
    const environment = { ...process.env };
    if (this.settings.codexPath) environment.CODEX_PATH = this.settings.codexPath;
    const child = spawn(this.settings.nodePath, [this.cliPath, "daemon"], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout?.resume();
    child.stderr?.resume();
    child.once("error", (error) => {
      this.lastError = `daemon 启动失败: ${error.message}`;
      if (this.child === child) this.child = undefined;
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.lastError = `daemon 已退出 (${signal ?? code ?? "unknown"})`;
    });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        await this.readSnapshot(500);
        this.lastError = undefined;
        return;
      } catch {
        if (this.child !== child) break;
        await delay(100);
      }
    }
    await this.stopManaged();
    throw new Error(this.lastError ?? "daemon 未能在预期时间内启动");
  }

  private async readSnapshot(milliseconds = 2_000): Promise<unknown> {
    try {
      return await rpcWithTimeout("runtime.snapshot", {}, milliseconds);
    } catch (snapshotError) {
      try {
        return await legacySnapshot();
      } catch {
        throw snapshotError;
      }
    }
  }

  private async stopManaged(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    await new Promise<void>((resolveStop) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolveStop();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolveStop();
      });
      child.kill("SIGTERM");
    });
  }
}

function contentType(path: string): string {
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  return types[extname(path)] ?? "application/octet-stream";
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cache-Control", "no-store");
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("请求内容超过 64 KiB 限制");
    chunks.push(buffer);
  }
  const contentTypeHeader = request.headers["content-type"] ?? "";
  if (!contentTypeHeader.startsWith("application/json")) throw new Error("仅接受 application/json 请求");
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!isObject(value)) throw new Error("JSON 请求必须是对象");
  return value;
}

function validateRpc(method: string, params: Record<string, unknown>): void {
  if (!MUTATING_RPC_METHODS.has(method)) throw new Error(`Web 控制台不允许调用 ${method}`);
  if (method === "task.create" && params.title !== undefined && (typeof params.title !== "string" || params.title.length > 120)) {
    throw new Error("任务标题最多 120 个字符");
  }
  if (["task.select", "task.activate"].includes(method) && typeof params.taskId !== "string") throw new Error("激活任务需要 taskId");
  if (method === "composer.send") {
    if (typeof params.taskId !== "string") throw new Error("发送消息需要 taskId");
    if (typeof params.text !== "string" || !params.text.trim() || params.text.length > 50_000) throw new Error("消息必须为 1 到 50000 个字符");
    if (params.attachments !== undefined) throw new Error("首版 Web 控制台暂不接受附件");
  }
  if (method === "action.trigger") {
    if (typeof params.actionId !== "string" || !WEB_ACTIONS.has(params.actionId)) throw new Error("该快捷动作未向 Web 控制台开放");
    if (params.actionId === "review") {
      params.confirmed = true;
      params.reviewTarget = { type: "uncommittedChanges" };
    }
  }
  if (method === "voice.state" && !["idle", "recording", "processing", "ready", "error"].includes(String(params.state))) {
    throw new Error("无效的语音状态");
  }
}

export function createArkeyWebServer(options: WebServerOptions = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  if (host !== DEFAULT_HOST) throw new Error("Arkey Web 仅允许监听 127.0.0.1");
  const moduleDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
  const projectRoot = resolve(moduleDirectory, "..", "..");
  const staticDirectory = resolve(options.staticDirectory ?? join(projectRoot, "apps", "ArkeyWeb", "dist"));
  const store = webSettingsStore(options.settingsPath);
  const settings = store.read();
  const controller = new DaemonController(settings, join(moduleDirectory, "cli.js"));
  const microBridge = new MicroBridgeController(controlMode(settings) === "esp32s3MicroLab" ? (settings.microBridgePort ?? "") : "");
  const session = randomBytes(24).toString("base64url");
  const cookie = `arkey_session=${session}`;
  const threadCandidates = new Map<string, string>();

  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    const hostHeader = request.headers.host;
    if (!isAllowedHost(hostHeader, port)) {
      json(response, 403, { error: "拒绝非 localhost 请求" });
      return;
    }
    const url = new URL(request.url ?? "/", `http://${hostHeader}`);
    try {
      if (url.pathname.startsWith("/api/")) {
        if (!String(request.headers.cookie ?? "").split(/;\s*/).includes(cookie)) {
          json(response, 403, { error: "Web 会话无效，请刷新页面" });
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/snapshot") {
          const mode = controlMode(controller.configuration());
          const raw = mode === "appServer" ? await controller.snapshot() : {
            status: { running: false, appServer: "offline", authenticated: false, models: [], capabilities: {} },
            settings: { workspaceRoot: "" },
            tasks: [],
          };
          const configuration = controller.configuration();
          const daemonState = controller.state();
          json(response, 200, { result: sanitizeSnapshot(raw, {
            ...configuration,
            ...daemonState,
            controlMode: mode,
            microBridgePort: configuration.microBridgePort ?? "",
            daemonOnline: mode === "appServer" && daemonState.daemonOnline,
            serverOrigin: `http://${hostHeader}`,
          }, microBridge.state()) });
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/hardware/ports") {
          json(response, 200, { result: await listMicroBridgePorts() });
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/bindings/candidates") {
          if (controlMode(controller.configuration()) !== "appServer") throw new Error("原生硬件模式由 Codex Desktop 绑定 Agent，不使用 App Server 会话绑定");
          const raw = await rpcWithTimeout("task.bind.candidates", {}, 10_000);
          const object = isObject(raw) ? raw : {};
          const candidates = Array.isArray(object.candidates) ? object.candidates : [];
          threadCandidates.clear();
          const result = candidates.flatMap((candidate) => {
            if (!isObject(candidate) || typeof candidate.id !== "string") return [];
            const candidateToken = randomBytes(18).toString("base64url");
            threadCandidates.set(candidateToken, candidate.id);
            const cwd = safeString(candidate.cwd, 2_000);
            return [{
              candidateToken,
              title: safeString(candidate.name, 200) ?? safeString(candidate.title, 200) ?? "Codex task",
              workspace: cwd ? basename(cwd) : undefined,
              updatedAt: safeString(candidate.updatedAt, 80) ?? safeString(candidate.recencyAt, 80),
              source: safeString(candidate.source, 40),
              currentWorkspace: candidate.currentWorkspace === true,
            }];
          });
          json(response, 200, { result });
          return;
        }
        if (request.method !== "POST" || !isAllowedOrigin(request.headers.origin, hostHeader, port)) {
          json(response, 403, { error: "拒绝跨来源或非 POST 的修改请求" });
          return;
        }
        if (url.pathname === "/api/rpc") {
          if (controlMode(controller.configuration()) !== "appServer") throw new Error("原生硬件模式不调用 Arkey App Server RPC");
          const body = await readJson(request);
          const method = String(body.method ?? "");
          const params = isObject(body.params) ? body.params : {};
          validateRpc(method, params);
          const result = await rpcWithTimeout(method, params, 30_000);
          json(response, 200, { result });
          return;
        }
        if (url.pathname === "/api/hardware/event") {
          if (controlMode(controller.configuration()) !== "esp32s3MicroLab") throw new Error("当前不是 ESP32-S3 原生硬件模式");
          const body = await readJson(request);
          if (!isMicroControl(body.control) || !isMicroPhase(body.phase)) throw new Error("无效的硬件按键事件");
          await microBridge.send(body.control, body.phase);
          json(response, 200, { result: { acknowledged: true } });
          return;
        }
        if (["/api/bindings", "/api/bindings/new", "/api/bindings/unbind"].includes(url.pathname)) {
          if (controlMode(controller.configuration()) !== "appServer") throw new Error("原生硬件模式由 Codex Desktop 管理 Agent 绑定");
          const body = await readJson(request);
          const taskId = String(body.taskId ?? "");
          if (!taskId || taskId.length > 100) throw new Error("Agent 绑定需要有效的 taskId");
          if (url.pathname === "/api/bindings") {
            const candidateToken = String(body.candidateToken ?? "");
            const threadId = threadCandidates.get(candidateToken);
            if (!threadId) throw new Error("会话候选已过期，请刷新后重试");
            await rpcWithTimeout("task.bind", { taskId, threadId, replace: true }, 30_000);
            threadCandidates.clear();
            json(response, 200, { result: { bound: true } });
            return;
          }
          if (url.pathname === "/api/bindings/new") {
            await rpcWithTimeout("task.bind.new", { taskId, replace: true }, 30_000);
            threadCandidates.clear();
            json(response, 200, { result: { bound: true } });
            return;
          }
          await rpcWithTimeout("task.unbind", { taskId }, 10_000);
          threadCandidates.clear();
          json(response, 200, { result: { bound: false } });
          return;
        }
        if (url.pathname === "/api/config") {
          const body = await readJson(request);
          const nodePath = String(body.nodePath ?? "");
          const codexPath = String(body.codexPath ?? "");
          const workspaceRoot = String(body.workspaceRoot ?? "");
          const selectedModel = typeof body.selectedModel === "string" ? body.selectedModel : undefined;
          const nextMode = body.controlMode === "esp32s3MicroLab" ? "esp32s3MicroLab" : body.controlMode === "appServer" ? "appServer" : undefined;
          if (!nextMode) throw new Error("无效的控制模式");
          const microBridgePort = String(body.microBridgePort ?? "").trim();
          if (microBridgePort.length > 2_000) throw new Error("串口路径过长");
          let resolvedNodePath = nodePath;
          let resolvedCodexPath = codexPath;
          if (nextMode === "appServer") {
            validateExecutable(nodePath, "Node");
            if (codexPath) validateExecutable(codexPath, "Codex");
            validateWorkspace(workspaceRoot);
            resolvedNodePath = realpathSync(nodePath);
            resolvedCodexPath = codexPath ? realpathSync(codexPath) : "";
          }
          const next: WebSettings = {
            version: 1,
            nodePath: resolvedNodePath,
            codexPath: resolvedCodexPath,
            controlMode: nextMode,
            microBridgePort,
          };
          store.write(next);
          const daemon = await controller.configure(next);
          await microBridge.configure(nextMode === "esp32s3MicroLab" ? microBridgePort : "");
          if (nextMode === "appServer") {
            await controller.ensure();
            await rpcWithTimeout("settings.update", { workspaceRoot, selectedModel }, 10_000);
          } else {
            await controller.disable();
          }
          json(response, 200, { result: daemon });
          return;
        }
        json(response, 404, { error: "API 不存在" });
        return;
      }

      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        json(response, 400, { error: "无效路径" });
        return;
      }
      const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      let filePath = resolve(staticDirectory, requested);
      if (!filePath.startsWith(`${staticDirectory}/`) && filePath !== staticDirectory) {
        json(response, 403, { error: "拒绝访问" });
        return;
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = join(staticDirectory, "index.html");
      if (!existsSync(filePath)) {
        json(response, 503, { error: "Web 静态资源尚未构建，请先运行 npm run web:build" });
        return;
      }
      if (basename(filePath) === "index.html") {
        response.setHeader("Set-Cookie", `${cookie}; Path=/; HttpOnly; SameSite=Strict`);
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", contentType(filePath));
      response.end(readFileSync(filePath));
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return {
    server,
    origin: `http://${host}:${port}`,
    async start(): Promise<void> {
      if (controlMode(controller.configuration()) === "appServer") await controller.ensure();
      await microBridge.start();
      await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(port, host, () => {
          server.off("error", rejectListen);
          resolveListen();
        });
      });
    },
    async stop(): Promise<void> {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await microBridge.stop();
      await controller.stop();
    },
  };
}

async function main(): Promise<void> {
  const web = createArkeyWebServer({
    port: Number(process.env.ARKEY_WEB_PORT ?? DEFAULT_PORT),
    staticDirectory: process.env.ARKEY_WEB_DIST,
  });
  await web.start();
  process.stdout.write(`Arkey Web 已启动: ${web.origin}\n`);
  const stop = async () => {
    await web.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`arkey-web: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
