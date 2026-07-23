import type { MicroBridgePort, Snapshot } from "./types";

export type HardwareControl =
  | `agent-${1 | 2 | 3 | 4 | 5 | 6}`
  | "fast"
  | "approve"
  | "decline"
  | "continue"
  | "ptt"
  | "send"
  | "reasoning-press"
  | "encoder-cw"
  | "encoder-ccw"
  | "joystick-up"
  | "joystick-right"
  | "joystick-down"
  | "joystick-left";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const body = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `请求失败 (${response.status})`);
  return body;
}

export const api = {
  snapshot: () => request<Snapshot>("/api/snapshot"),
  hardwarePorts: async () => (await request<{ ports: MicroBridgePort[] }>("/api/hardware/ports")).ports,
  hardwareEvent: (control: HardwareControl, phase: "down" | "up" | "tap") => request<{ ok: true }>("/api/hardware/event", {
    method: "POST",
    body: JSON.stringify({ control, phase }),
  }),
  saveSettings: (microBridgePort: string) => request<{ ok: true }>("/api/settings", {
    method: "POST",
    body: JSON.stringify({ microBridgePort }),
  }),
  setSettingsOpen: (open: boolean) => request<{ ok: true }>("/api/window/settings", {
    method: "POST",
    body: JSON.stringify({ open }),
  }),
  setAlwaysOnTop: (enabled: boolean) => request<{ ok: true }>("/api/window/always-on-top", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  }),
  setShowOnAllDesktops: (enabled: boolean) => request<{ ok: true }>("/api/window/show-on-all-desktops", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  }),
  setFocusCodexOnInput: (enabled: boolean) => request<{ ok: true; accessibilityGranted: boolean }>("/api/codex/focus-on-input", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  }),
  startWindowDrag: () => request<{ ok: true }>("/api/window/start-dragging", { method: "POST" }),
  exitApp: () => request<{ ok: true }>("/api/app/exit", { method: "POST" }),
  openBrowser: () => request<{ ok: true }>("/api/browser/open", { method: "POST" }),
};
