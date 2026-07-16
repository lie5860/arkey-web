import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { Readable, Writable } from "node:stream";

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface AppServerProcess {
  stdin: Pick<Writable, "write" | "end">;
  stdout: Pick<Readable, "on" | "off">;
  stderr: Pick<Readable, "on" | "off">;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  off(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type AppServerProcessFactory = () => AppServerProcess;

export interface AppServerModel {
  id?: string;
  model: string;
  displayName?: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string }>;
  defaultServiceTier?: string | null;
  serviceTiers?: Array<{ id: string; name?: string; description?: string }>;
}

export interface AppServerReady {
  initialize: Record<string, unknown>;
  account: Record<string, unknown>;
  models: AppServerModel[];
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface CodexAppServerEvents {
  ready: [AppServerReady];
  notification: [JsonRpcNotification];
  serverRequest: [JsonRpcRequest];
  state: [{ state: "starting" | "ready" | "offline" | "restarting"; retryMs?: number; error?: string }];
  stderr: [string];
}

function defaultFactory(): AppServerProcess {
  return spawn(resolveCodexExecutable(), ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  }) as ChildProcessWithoutNullStreams;
}

export function resolveCodexExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  const candidates: string[] = [];
  if (environment.CODEX_PATH && isAbsolute(environment.CODEX_PATH)) candidates.push(environment.CODEX_PATH);
  for (const directory of (environment.PATH ?? "").split(delimiter).filter(Boolean)) candidates.push(join(directory, "codex"));
  candidates.push(
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/usr/bin/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
  );
  const executable = [...new Set(candidates)].find((candidate) => exists(candidate));
  if (!executable) throw new Error("Codex CLI was not found; set CODEX_PATH to an absolute codex executable path");
  return executable;
}

export class CodexAppServerClient extends EventEmitter<CodexAppServerEvents> {
  private child?: AppServerProcess;
  private nextId = 1;
  private pending = new Map<JsonRpcId, PendingRequest>();
  private stdoutBuffer = "";
  private stopping = false;
  private restartTimer?: NodeJS.Timeout;
  private restartAttempt = 0;
  private startPromise?: Promise<AppServerReady>;
  private readonly stdoutListener = (chunk: Buffer | string) => this.consume(String(chunk));
  private readonly stderrListener = (chunk: Buffer | string) => this.emit("stderr", String(chunk));
  private readonly closeListener = (code: number | null, signal: NodeJS.Signals | null) => this.closed(code, signal);
  private readonly processErrorListener = (error: Error) => {
    this.emit("state", { state: "offline", error: error.message });
  };

  account?: Record<string, unknown>;
  models: AppServerModel[] = [];

  constructor(private readonly processFactory: AppServerProcessFactory = defaultFactory) {
    super();
  }

  start(): Promise<AppServerReady> {
    if (this.startPromise) return this.startPromise;
    this.stopping = false;
    this.startPromise = this.launch().catch((error) => {
      this.startPromise = undefined;
      try { this.child?.kill("SIGTERM"); } catch { /* close handler owns restart */ }
      throw error;
    });
    return this.startPromise;
  }

  private async launch(): Promise<AppServerReady> {
    this.emit("state", { state: this.restartAttempt ? "restarting" : "starting" });
    const child = this.processFactory();
    this.child = child;
    this.stdoutBuffer = "";
    child.stdout.on("data", this.stdoutListener);
    child.stderr.on("data", this.stderrListener);
    child.on("close", this.closeListener);
    child.on("error", this.processErrorListener);

    const initialize = await this.request<Record<string, unknown>>("initialize", {
      clientInfo: { name: "arkey", title: "Arkey", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify("initialized", {});
    const [accountResponse, modelResponse] = await Promise.all([
      this.request<Record<string, unknown>>("account/read", { refreshToken: false }),
      this.request<{ data?: AppServerModel[] }>("model/list", { limit: 100, includeHidden: false }),
    ]);
    this.account = accountResponse;
    this.models = Array.isArray(modelResponse.data) ? modelResponse.data : [];
    const ready = { initialize, account: accountResponse, models: this.models };
    this.restartAttempt = 0;
    this.emit("state", { state: "ready" });
    this.emit("ready", ready);
    return ready;
  }

  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (!this.child) return Promise.reject(new Error("Codex App Server is not running"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params: unknown = {}): void {
    if (!this.child) throw new Error("Codex App Server is not running");
    this.write({ method, params });
  }

  respond(id: JsonRpcId, result: unknown): void {
    if (!this.child) throw new Error("Codex App Server is not running");
    this.write({ id, result });
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    if (!this.child) throw new Error("Codex App Server is not running");
    this.write({ id, error: { code, message } });
  }

  private write(message: unknown): void {
    this.child!.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consume(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline: number;
    while ((newline = this.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        this.route(JSON.parse(line) as Record<string, unknown>);
      } catch (error) {
        this.emit("stderr", `Invalid App Server JSONL: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }

  private route(message: Record<string, unknown>): void {
    const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : undefined;
    if (id !== undefined && !message.method) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.error && typeof message.error === "object") {
        const value = message.error as Partial<JsonRpcError>;
        pending.reject(new Error(`App Server ${value.code ?? "error"}: ${value.message ?? "request failed"}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== "string") return;
    const request = { id: id as JsonRpcId, method: message.method, params: message.params };
    if (id !== undefined) this.emit("serverRequest", request);
    else this.emit("notification", { method: message.method, params: message.params });
  }

  fastTier(modelId?: string): string | undefined {
    const model = this.selectModel(modelId);
    const tier = model?.serviceTiers?.find((candidate) =>
      candidate.name?.toLowerCase() === "fast" ||
      candidate.description?.toLowerCase().includes("fast")
    );
    return tier?.id;
  }

  reasoningEfforts(modelId?: string): string[] {
    return this.selectModel(modelId)?.supportedReasoningEfforts?.map((item) => item.reasoningEffort) ?? [];
  }

  defaultEffort(modelId?: string): string | undefined {
    return this.selectModel(modelId)?.defaultReasoningEffort;
  }

  private selectModel(modelId?: string): AppServerModel | undefined {
    return this.models.find((model) => model.model === modelId || model.id === modelId) ??
      this.models.find((model) => model.isDefault) ??
      this.models[0];
  }

  private closed(code: number | null, signal: NodeJS.Signals | null): void {
    this.detach();
    const error = new Error(`Codex App Server exited (${code ?? signal ?? "unknown"})`);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.startPromise = undefined;
    this.emit("state", { state: "offline", error: error.message });
    if (!this.stopping) this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return;
    const retryMs = Math.min(30_000, 500 * (2 ** Math.min(this.restartAttempt++, 6)));
    this.emit("state", { state: "restarting", retryMs });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.start().catch((error) => {
        this.emit("state", { state: "offline", error: error instanceof Error ? error.message : String(error) });
        this.scheduleRestart();
      });
    }, retryMs);
    this.restartTimer.unref?.();
  }

  private detach(): void {
    this.child?.stdout.off("data", this.stdoutListener);
    this.child?.stderr.off("data", this.stderrListener);
    this.child?.off("close", this.closeListener);
    this.child?.off("error", this.processErrorListener);
    this.child = undefined;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    for (const pending of this.pending.values()) pending.reject(new Error("Codex App Server stopped"));
    this.pending.clear();
    const child = this.child;
    if (!child) return;
    this.detach();
    try { child.stdin.end(); } catch { /* already closed */ }
    try { child.kill("SIGTERM"); } catch { /* already closed */ }
  }
}

export function isBinaryApprovalMethod(method: string): boolean {
  return method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval";
}

export function isStructuredRequestMethod(method: string): boolean {
  return method === "item/permissions/requestApproval" ||
    method === "item/tool/requestUserInput" ||
    method === "mcpServer/elicitation/request";
}
