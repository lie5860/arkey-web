import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ArkeySettings, StoredBindings, StoredTasks } from "./contracts.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class AtomicJsonStore<T> {
  constructor(
    readonly path: string,
    private readonly fallback: () => T,
    private readonly validate: (value: unknown) => value is T,
  ) {}

  read(): T {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      return this.validate(value) ? clone(value) : this.fallback();
    } catch {
      return this.fallback();
    }
  }

  write(value: T): void {
    if (!this.validate(value)) throw new Error(`Refusing to write invalid store ${this.path}`);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.path);
      chmodSync(this.path, 0o600);
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isStoredBindings(value: unknown): value is StoredBindings {
  if (!isObject(value) || value.version !== 1 || !Number.isInteger(value.revision) || !Array.isArray(value.bindings)) return false;
  return value.bindings.every((binding) =>
    isObject(binding) &&
    typeof binding.controlId === "string" &&
    typeof binding.instanceId === "string" &&
    typeof binding.actionId === "string" &&
    typeof binding.profileId === "string" &&
    typeof binding.layoutHash === "string" &&
    typeof binding.createdAt === "string" &&
    typeof binding.updatedAt === "string" &&
    (binding.taskId === undefined || typeof binding.taskId === "string")
  );
}

export function isSettings(value: unknown): value is ArkeySettings {
  const allowed = new Set(["version", "workspaceRoot", "hardwareSync", "atmosphereMix", "taskSort", "onboardingSkipped", "selectedModel"]);
  return isObject(value) && Object.keys(value).every((key) => allowed.has(key)) &&
    value.version === 1 &&
    typeof value.workspaceRoot === "string" &&
    typeof value.hardwareSync === "boolean" &&
    typeof value.atmosphereMix === "number" &&
    value.atmosphereMix >= 0 &&
    value.atmosphereMix <= 1 &&
    ["priority", "recent", "pinned", "custom"].includes(String(value.taskSort)) &&
    typeof value.onboardingSkipped === "boolean" &&
    (value.selectedModel === undefined || typeof value.selectedModel === "string");
}

export function isStoredTasks(value: unknown): value is StoredTasks {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.tasks)) return false;
  if (value.selectedTaskId !== undefined && typeof value.selectedTaskId !== "string") return false;
  return value.tasks.every((task) =>
    isObject(task) &&
    typeof task.taskId === "string" &&
    (task.slotIndex === undefined || (typeof task.slotIndex === "number" && Number.isInteger(task.slotIndex) && task.slotIndex >= 0)) &&
    typeof task.title === "string" &&
    typeof task.state === "string" &&
    typeof task.unread === "boolean" &&
    typeof task.selected === "boolean" &&
    typeof task.pinned === "boolean" &&
    typeof task.recencyAt === "string" &&
    typeof task.pendingApprovalCount === "number" &&
    typeof task.pendingStructuredRequestCount === "number" &&
    (task.threadId === undefined || typeof task.threadId === "string")
  );
}

export interface ArkeyStores {
  bindings: AtomicJsonStore<StoredBindings>;
  settings: AtomicJsonStore<ArkeySettings>;
  tasks: AtomicJsonStore<StoredTasks>;
}

export function createStores(runtimeDirectory: string, workspaceRoot = process.cwd()): ArkeyStores {
  return {
    bindings: new AtomicJsonStore<StoredBindings>(join(runtimeDirectory, "bindings-v1.json"), () => ({ version: 1, revision: 0, bindings: [] }), isStoredBindings),
    settings: new AtomicJsonStore<ArkeySettings>(join(runtimeDirectory, "settings-v1.json"), () => ({
      version: 1,
      workspaceRoot,
      hardwareSync: true,
      atmosphereMix: 0.12,
      taskSort: "priority",
      onboardingSkipped: false,
    }), isSettings),
    tasks: new AtomicJsonStore<StoredTasks>(join(runtimeDirectory, "appserver-tasks-v1.json"), () => ({ version: 1, tasks: [] }), isStoredTasks),
  };
}
