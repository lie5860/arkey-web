import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isMicroControl,
  isMicroPhase,
  listMicroBridgePorts,
  MicroBridgeController,
} from "./microbridge.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4765;
const MAX_BODY_BYTES = 16 * 1024;
const SESSION_COOKIE = "arkey_session";

export interface WebSettings {
  version: 1;
  microBridgePort: string;
  alwaysOnTop: boolean;
  focusCodexOnInput: boolean;
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
    typeof value.microBridgePort === "string" &&
    value.microBridgePort.length <= 1_024 &&
    typeof value.alwaysOnTop === "boolean" &&
    typeof value.focusCodexOnInput === "boolean" &&
    Object.keys(value).every((key) => ["version", "microBridgePort", "alwaysOnTop", "focusCodexOnInput"].includes(key));
}

function readSettings(path: string): WebSettings {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (isWebSettings(parsed)) return parsed;
    // Read the port from an older App Server-era settings file without rewriting it.
    if (isObject(parsed) && parsed.version === 1 && typeof parsed.microBridgePort === "string") {
      return {
        version: 1,
        microBridgePort: parsed.microBridgePort.slice(0, 1_024),
        alwaysOnTop: parsed.alwaysOnTop === true,
        focusCodexOnInput: parsed.focusCodexOnInput === true,
      };
    }
  } catch {
    // Missing or invalid settings fall back to startup discovery.
  }
  return { version: 1, microBridgePort: "", alwaysOnTop: false, focusCodexOnInput: false };
}

function writeSettings(path: string, settings: WebSettings): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

function hostName(value: string | undefined): string {
  if (!value) return "";
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1).toLowerCase();
  return value.split(":", 1)[0]?.toLowerCase() ?? "";
}

export function isAllowedHost(value: string | undefined, port: number): boolean {
  if (!value) return false;
  const expected = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return expected.has(value.toLowerCase()) && ["127.0.0.1", "localhost"].includes(hostName(value));
}

export function isAllowedOrigin(value: string | undefined, host: string | undefined, port: number): boolean {
  if (!value || !host || !isAllowedHost(host, port)) return false;
  return value === `http://${host.toLowerCase()}`;
}

function cookies(request: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    result[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return result;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_BODY_BYTES) throw new Error("请求内容过大");
    chunks.push(bytes);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!isObject(value)) throw new Error("请求必须是 JSON 对象");
  return value;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".map": return "application/json; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function staticPath(root: string, pathname: string): string | undefined {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : normalize(decoded).replace(/^[/\\]+/, "");
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}/`)) return undefined;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  const fallback = join(root, "index.html");
  return existsSync(fallback) ? fallback : undefined;
}

export async function startWebServer(options: WebServerOptions = {}): Promise<{
  origin: string;
  stop: () => Promise<void>;
}> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  if (host !== DEFAULT_HOST) throw new Error("Arkey Web 只允许监听 127.0.0.1");
  const staticDirectory = resolve(options.staticDirectory ?? join(dirname(fileURLToPath(import.meta.url)), "../../apps/ArkeyWeb/dist"));
  const settingsPath = options.settingsPath ?? join(homedir(), ".arkey", "web-settings-v1.json");
  let settings = readSettings(settingsPath);
  const sessionToken = randomBytes(32).toString("hex");
  const bridge = new MicroBridgeController(settings.microBridgePort);
  await bridge.start();

  const server = createServer(async (request, response) => {
    try {
      if (!isAllowedHost(request.headers.host, port)) {
        json(response, 400, { error: "无效 Host" });
        return;
      }
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      const mutating = request.method === "POST";
      if (mutating && (
        !isAllowedOrigin(request.headers.origin, request.headers.host, port) ||
        cookies(request)[SESSION_COOKIE] !== sessionToken
      )) {
        json(response, 403, { error: "请求来源验证失败" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/snapshot") {
        json(response, 200, {
          web: { serverOrigin: `http://${host}:${port}` },
          hardware: bridge.state(),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/hardware/ports") {
        json(response, 200, { ports: await listMicroBridgePorts() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/hardware/event") {
        const body = await readJson(request);
        if (!isMicroControl(body.control) || !isMicroPhase(body.phase)) {
          json(response, 400, { error: "无效的硬件按键事件" });
          return;
        }
        await bridge.send(body.control, body.phase);
        json(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/settings") {
        const body = await readJson(request);
        const microBridgePort = typeof body.microBridgePort === "string" ? body.microBridgePort.trim() : "";
        if (microBridgePort.length > 1_024 || (microBridgePort && !isAbsolute(microBridgePort))) {
          json(response, 400, { error: "USB 控制设备路径必须是绝对路径" });
          return;
        }
        settings = { ...settings, microBridgePort };
        writeSettings(settingsPath, settings);
        await bridge.configure(microBridgePort);
        json(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/window/settings") {
        const body = await readJson(request);
        if (typeof body.open !== "boolean") {
          json(response, 400, { error: "无效的窗口设置状态" });
          return;
        }
        // A normal browser has no native window for the server to resize.
        json(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/window/always-on-top") {
        json(response, 409, { error: "浏览器版没有可置顶的应用窗口" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/codex/focus-on-input") {
        json(response, 409, { error: "浏览器版不能调整 Codex 置前设置" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/window/start-dragging") {
        json(response, 409, { error: "浏览器版没有可拖动的应用窗口" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/app/exit") {
        json(response, 409, { error: "浏览器版没有可退出的应用窗口" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/browser/open") {
        json(response, 409, { error: "浏览器版已经在浏览器中运行" });
        return;
      }
      if (request.method !== "GET" || url.pathname.startsWith("/api/")) {
        json(response, 404, { error: "未找到接口" });
        return;
      }

      const path = staticPath(staticDirectory, url.pathname);
      if (!path) {
        json(response, 404, { error: "Web 资源尚未构建" });
        return;
      }
      response.writeHead(200, {
        "Cache-Control": path.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "Content-Type": contentType(path),
        "Set-Cookie": `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      });
      response.end(readFileSync(path));
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400);
      json(response, 500, { error: message });
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => resolveListen());
  });

  return {
    origin: `http://${host}:${port}`,
    stop: async () => {
      await bridge.stop();
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const running = await startWebServer();
  console.log(`Arkey Web ready: ${running.origin}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await running.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}
