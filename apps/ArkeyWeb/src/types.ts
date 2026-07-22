export type TaskState =
  | "unassigned"
  | "idle"
  | "working"
  | "completeUnread"
  | "requiresInput"
  | "error"
  | "offline";

export interface AgentTask {
  taskId: string;
  slotIndex: number;
  bound: boolean;
  statusObserved: boolean;
  title: string;
  state: TaskState;
  unread: boolean;
  selected: boolean;
  pinned: boolean;
  recencyAt: string;
  pendingApprovalCount: number;
  pendingStructuredRequestCount: number;
  serviceTier?: string;
  effort?: string;
  model?: string;
  lastError?: string;
}

export interface ThreadCandidate {
  candidateToken: string;
  title: string;
  workspace?: string;
  updatedAt?: string;
  source?: string;
  currentWorkspace: boolean;
}

export interface RuntimeModel {
  model: string;
  displayName?: string;
  isDefault?: boolean;
  efforts: string[];
  serviceTiers: string[];
}

export interface RuntimeStatus {
  running: boolean;
  appServer: "starting" | "ready" | "offline" | "restarting";
  authenticated: boolean;
  selectedTaskId?: string;
  models: RuntimeModel[];
  capabilities: {
    appServer: boolean;
    fullHardwareControl: boolean;
    plan: boolean;
  };
}

export interface RuntimeSettings {
  workspaceRoot: string;
  selectedModel?: string;
}

export interface WebConfiguration {
  nodePath: string;
  codexPath: string;
  controlMode: "appServer" | "esp32s3MicroLab";
  microBridgePort: string;
}

export interface WebState extends WebConfiguration {
  managedDaemon: boolean;
  daemonOnline: boolean;
  serverOrigin: string;
  lastError?: string;
}

export interface MicroBridgePort {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
}

export interface MicroSlotLight {
  slot: number;
  color?: number;
  brightness?: number;
  effect?: number;
  speed?: number;
}

export interface HardwareState {
  enabled: boolean;
  connection: "disabled" | "offline" | "connecting" | "ready" | "error";
  configuredPort: string;
  usbMounted: boolean;
  desktopConnected: boolean;
  slotLights: MicroSlotLight[];
  lastError?: string;
}

export interface Snapshot {
  status: RuntimeStatus;
  settings: RuntimeSettings;
  tasks: AgentTask[];
  web: WebState;
  hardware: HardwareState;
}
