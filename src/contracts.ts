import type { EffectSpec } from "./protocol.js";

export type ActionKind =
  | "task_agent"
  | "approve"
  | "decline"
  | "ptt"
  | "send"
  | "continue"
  | "fast"
  | "reasoning"
  | "plan"
  | "review"
  | "skill"
  | "local";

export interface ActionDescriptor {
  actionId: string;
  kind: ActionKind;
  title: string;
  symbol: string;
  repeatable: boolean;
  enabled: boolean;
  disabledReason?: string;
  priority: number;
}

export interface ActionInstance {
  instanceId: string;
  actionId: string;
  taskId?: string;
  createdAt: string;
}

export interface Binding {
  controlId: string;
  instanceId: string;
  actionId: string;
  taskId?: string;
  profileId: string;
  layoutHash: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskLightState = "unassigned" | "idle" | "working" | "completeUnread" | "requiresInput" | "error" | "offline";
export type TaskSortMode = "priority" | "recent" | "pinned" | "custom";

export interface TaskSlot {
  taskId: string;
  /** Stable Agent Key ordinal. Sorting never changes this value. */
  slotIndex: number;
  threadId?: string;
  title: string;
  state: TaskLightState;
  unread: boolean;
  selected: boolean;
  pinned: boolean;
  recencyAt: string;
  activeTurnId?: string;
  pendingApprovalCount: number;
  pendingStructuredRequestCount: number;
  serviceTier?: string;
  effort?: string;
  model?: string;
  lastError?: string;
}

export interface ArkeySettings {
  version: 1;
  workspaceRoot: string;
  hardwareSync: boolean;
  atmosphereMix: number;
  taskSort: TaskSortMode;
  onboardingSkipped: boolean;
  selectedModel?: string;
}

export interface LightingPreview {
  previewId: string;
  effects: EffectSpec[];
  durationMs: number;
  atmosphereMix: number;
  startedAt: string;
}

export interface RuntimeEvent<T = unknown> {
  version: 1;
  event: string;
  sequence: number;
  timestamp: string;
  data: T;
}

export interface RpcRequest {
  type: "rpc";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  version: 1;
  id: string | number;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface StoredBindings {
  version: 1;
  revision: number;
  bindings: Binding[];
}

export interface StoredTasks {
  version: 1;
  selectedTaskId?: string;
  tasks: TaskSlot[];
}

export const defaultActions: ActionDescriptor[] = [
  { actionId: "task_agent", kind: "task_agent", title: "Agent Key", symbol: "sparkles", repeatable: true, enabled: true, priority: 0 },
  { actionId: "approve", kind: "approve", title: "Approve", symbol: "checkmark", repeatable: false, enabled: true, priority: 10 },
  { actionId: "decline", kind: "decline", title: "Decline", symbol: "xmark", repeatable: false, enabled: true, priority: 11 },
  { actionId: "ptt", kind: "ptt", title: "Push to Talk", symbol: "waveform", repeatable: false, enabled: true, priority: 12 },
  { actionId: "send", kind: "send", title: "Send", symbol: "arrow.up", repeatable: false, enabled: true, priority: 13 },
  { actionId: "continue", kind: "continue", title: "Continue in new task", symbol: "arrow.triangle.branch", repeatable: true, enabled: true, priority: 14 },
  { actionId: "fast", kind: "fast", title: "Fast", symbol: "bolt.fill", repeatable: false, enabled: true, priority: 15 },
  { actionId: "reasoning", kind: "reasoning", title: "Reasoning", symbol: "dial.medium", repeatable: false, enabled: true, priority: 16 },
  { actionId: "plan", kind: "plan", title: "Plan", symbol: "list.bullet.rectangle", repeatable: false, enabled: false, disabledReason: "Requires collaborationMode/list support", priority: 20 },
  { actionId: "review", kind: "review", title: "Review", symbol: "checklist", repeatable: true, enabled: true, priority: 21 },
  { actionId: "skill", kind: "skill", title: "Skill", symbol: "shippingbox", repeatable: true, enabled: true, priority: 22 },
  { actionId: "git_commit", kind: "local", title: "Commit", symbol: "arrow.trianglehead.branch", repeatable: false, enabled: true, priority: 23 },
  { actionId: "create_pr", kind: "local", title: "Pull Request", symbol: "arrow.triangle.pull", repeatable: false, enabled: true, priority: 24 },
  { actionId: "navigate_back", kind: "local", title: "Back", symbol: "chevron.backward", repeatable: false, enabled: true, priority: 30 },
  { actionId: "navigate_forward", kind: "local", title: "Forward", symbol: "chevron.forward", repeatable: false, enabled: true, priority: 31 },
  { actionId: "toggle_sidebar", kind: "local", title: "Sidebar", symbol: "sidebar.left", repeatable: false, enabled: true, priority: 32 },
  { actionId: "terminal", kind: "local", title: "Terminal", symbol: "terminal", repeatable: true, enabled: true, priority: 33 },
  { actionId: "browser", kind: "local", title: "Browser", symbol: "safari", repeatable: true, enabled: true, priority: 34 },
  { actionId: "attach", kind: "local", title: "Attach", symbol: "paperclip", repeatable: true, enabled: true, priority: 35 },
  { actionId: "cancel", kind: "local", title: "Cancel", symbol: "escape", repeatable: false, enabled: true, priority: 36 },
  { actionId: "scheduled_tasks", kind: "local", title: "Scheduled Tasks", symbol: "calendar.badge.clock", repeatable: false, enabled: false, disabledReason: "No public Codex App Server mapping", priority: 99 },
];
