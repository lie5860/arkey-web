import type { MicroBridgePort, Snapshot, ThreadCandidate, WebConfiguration } from "./types";

export type HardwareControl =
  | "agent-1" | "agent-2" | "agent-3" | "agent-4" | "agent-5" | "agent-6"
  | "fast" | "approve" | "decline" | "continue" | "ptt" | "send"
  | "reasoning-press" | "encoder-cw" | "encoder-ccw"
  | "joystick-up" | "joystick-right" | "joystick-down" | "joystick-left";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = await response.json() as { result?: T; error?: string };
  if (!response.ok || payload.error) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload.result as T;
}

export const api = {
  snapshot: () => request<Snapshot>("/api/snapshot"),
  rpc: <T>(method: string, params: Record<string, unknown> = {}) => request<T>("/api/rpc", {
    method: "POST",
    body: JSON.stringify({ method, params }),
  }),
  saveConfiguration: (configuration: WebConfiguration & { workspaceRoot: string; selectedModel?: string }) =>
    request<{ restarted: boolean }>("/api/config", {
      method: "POST",
      body: JSON.stringify(configuration),
    }),
  hardwarePorts: () => request<MicroBridgePort[]>("/api/hardware/ports"),
  hardwareEvent: (control: HardwareControl, phase: "down" | "up" | "tap") => request<{ acknowledged: true }>("/api/hardware/event", {
    method: "POST",
    body: JSON.stringify({ control, phase }),
  }),
  threadCandidates: () => request<ThreadCandidate[]>("/api/bindings/candidates"),
  bindThread: (taskId: string, candidateToken: string) => request<{ bound: true }>("/api/bindings", {
    method: "POST",
    body: JSON.stringify({ taskId, candidateToken }),
  }),
  bindNewThread: (taskId: string) => request<{ bound: true }>("/api/bindings/new", {
    method: "POST",
    body: JSON.stringify({ taskId }),
  }),
  unbindThread: (taskId: string) => request<{ bound: false }>("/api/bindings/unbind", {
    method: "POST",
    body: JSON.stringify({ taskId }),
  }),
};
