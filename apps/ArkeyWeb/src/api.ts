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
};
