import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CircleNotch,
  GitFork,
  Lightning,
  Microphone,
  OpenAiLogo,
  PaperPlaneTilt,
  Plus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { api, type HardwareControl } from "./api";
import type { AgentTask, MicroBridgePort, MicroSlotLight, Snapshot, TaskState, ThreadCandidate } from "./types";

type ActionName = "approve" | "decline" | "continue" | "fast" | "plan" | "reasoning" | "review";

interface SpeechRecognitionResultLike {
  readonly 0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const STATE_LABELS: Record<TaskState, string> = {
  unassigned: "未开始",
  idle: "空闲",
  working: "工作中",
  completeUnread: "已完成",
  requiresInput: "需确认",
  error: "错误",
  offline: "离线",
};

function taskState(value: string): TaskState {
  return value in STATE_LABELS ? value as TaskState : "offline";
}

function taskStatus(task: AgentTask | undefined): string {
  if (!task) return "空位";
  return STATE_LABELS[taskState(task.state)];
}

function agentStatus(task: AgentTask | undefined): string {
  if (!task?.bound) return "未绑定";
  return task.statusObserved ? taskStatus(task) : "状态未知";
}

function selectedTask(snapshot: Snapshot | undefined): AgentTask | undefined {
  return snapshot?.tasks.find((task) => task.taskId === snapshot.status.selectedTaskId) ?? snapshot?.tasks.find((task) => task.selected);
}

function stateClass(task: AgentTask | undefined): string {
  if (task?.bound && !task.statusObserved) return "state-unobserved";
  return `state-${taskState(task?.state ?? "unassigned")}`;
}

function slotColor(light: MicroSlotLight | undefined): string {
  const value = light?.color ?? 0;
  return `#${Math.max(0, Math.min(0xFFFFFF, value)).toString(16).padStart(6, "0")}`;
}

function slotLightStyle(light: MicroSlotLight | undefined): CSSProperties {
  const color = slotColor(light);
  const brightness = light?.brightness ?? 0;
  return {
    "--agent-light-color": color,
    "--agent-light-opacity": String(Math.max(0, brightness)),
    "--agent-key-surface": hardwareKeySurface(light),
  } as CSSProperties;
}

function hardwareKeySurface(light: MicroSlotLight | undefined): string {
  const value = light?.color ?? 0;
  const brightness = Math.max(0, Math.min(1, light?.brightness ?? 0));
  if (brightness <= 0.01) return "#25262b";

  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  const max = Math.max(red, green, blue) / 255;
  const min = Math.min(red, green, blue) / 255;
  const delta = max - min;
  if (delta < 0.06) return `hsl(0 0% ${Math.round(20 + brightness * 72)}%)`;

  let hue: number;
  if (max === red / 255) hue = 60 * (((green - blue) / 255) / delta % 6);
  else if (max === green / 255) hue = 60 * (((blue - red) / 255) / delta + 2);
  else hue = 60 * (((red - green) / 255) / delta + 4);
  if (hue < 0) hue += 360;
  return `hsl(${Math.round(hue)} 58% ${Math.round(34 + brightness * 23)}%)`;
}

function slotEffect(light: MicroSlotLight | undefined): string {
  if (!light || (light.brightness ?? 0) === 0 || light.effect === 0) return "灯光关闭";
  const labels: Record<number, string> = {
    1: "常亮",
    2: "流动",
    3: "彩虹",
    4: "呼吸",
    5: "渐变",
    6: "浅呼吸",
  };
  return labels[light.effect ?? 1] ?? `未知灯效 ${light.effect}`;
}

interface KeyProps {
  label: string;
  hint?: string;
  className?: string;
  disabled?: boolean;
  busy?: boolean;
  pressed?: boolean;
  onClick?: () => void;
  onPress?: () => void;
  onRelease?: () => void;
  style?: CSSProperties;
  children: React.ReactNode;
}

function KeyboardKey({ label, hint, className = "", disabled, busy, pressed, onClick, onPress, onRelease, style, children }: KeyProps) {
  return (
    <button
      className={`keyboard-key has-tooltip ${className}`}
      type="button"
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      data-tooltip={`${label}\n${hint ?? label}`}
      disabled={disabled || busy}
      onClick={onClick}
      onPointerDown={onPress ? (event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onPress();
      } : undefined}
      onPointerUp={onRelease ? () => onRelease() : undefined}
      onPointerCancel={onRelease ? () => onRelease() : undefined}
      style={style}
    >
      <span className="key-face">{busy ? <CircleNotch className="spin" weight="bold" /> : children}</span>
    </button>
  );
}

interface SettingsDraft {
  nodePath: string;
  codexPath: string;
  workspaceRoot: string;
  selectedModel: string;
  controlMode: "appServer" | "esp32s3MicroLab";
  microBridgePort: string;
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connectionError, setConnectionError] = useState<string>();
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({ nodePath: "", codexPath: "", workspaceRoot: "", selectedModel: "", controlMode: "appServer", microBridgePort: "" });
  const [hardwarePorts, setHardwarePorts] = useState<MicroBridgePort[]>([]);
  const [hardwarePortsLoading, setHardwarePortsLoading] = useState(false);
  const [threadCandidates, setThreadCandidates] = useState<ThreadCandidate[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateSelections, setCandidateSelections] = useState<Record<string, string>>({});
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);
  const busyRef = useRef<string | undefined>(undefined);
  const hardwareEventQueue = useRef<Promise<void>>(Promise.resolve());
  const pressedHardwareControls = useRef(new Set<HardwareControl>());

  const refresh = useCallback(async () => {
    try {
      const next = await api.snapshot();
      setSnapshot(next);
      setConnectionError(undefined);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    recognition.current?.stop();
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(undefined), 3_200);
  }, []);

  const run = useCallback(async (name: string, operation: () => Promise<unknown>, success: string) => {
    if (busyRef.current) return;
    busyRef.current = name;
    setBusy(name);
    try {
      await operation();
      showNotice(success);
      await refresh();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = undefined;
      setBusy(undefined);
    }
  }, [refresh, showNotice]);

  const hardwareEvent = useCallback((control: HardwareControl, phase: "down" | "up" | "tap") => {
    const operation = hardwareEventQueue.current
      .catch(() => undefined)
      .then(() => api.hardwareEvent(control, phase))
      .then(() => undefined);
    hardwareEventQueue.current = operation;
    void operation.catch((error) => {
      showNotice(error instanceof Error ? error.message : String(error));
    });
  }, [showNotice]);

  const hardwarePress = useCallback((control: HardwareControl) => {
    if (pressedHardwareControls.current.has(control)) return;
    pressedHardwareControls.current.add(control);
    hardwareEvent(control, "down");
  }, [hardwareEvent]);

  const hardwareRelease = useCallback((control: HardwareControl) => {
    if (!pressedHardwareControls.current.delete(control)) return;
    hardwareEvent(control, "up");
  }, [hardwareEvent]);

  const releaseAllHardwareControls = useCallback(() => {
    const controls = [...pressedHardwareControls.current];
    pressedHardwareControls.current.clear();
    for (const control of controls) hardwareEvent(control, "up");
  }, [hardwareEvent]);

  useEffect(() => {
    const releaseAll = () => releaseAllHardwareControls();
    const releaseWhenHidden = () => {
      if (document.hidden) releaseAllHardwareControls();
    };
    window.addEventListener("blur", releaseAll);
    window.addEventListener("pointerup", releaseAll);
    window.addEventListener("pointercancel", releaseAll);
    document.addEventListener("visibilitychange", releaseWhenHidden);
    return () => {
      window.removeEventListener("blur", releaseAll);
      window.removeEventListener("pointerup", releaseAll);
      window.removeEventListener("pointercancel", releaseAll);
      document.removeEventListener("visibilitychange", releaseWhenHidden);
      releaseAllHardwareControls();
    };
  }, [releaseAllHardwareControls]);

  const hardwareKeyProps = useCallback((control: HardwareControl) => ({
    onPress: () => hardwarePress(control),
    onRelease: () => hardwareRelease(control),
  }), [hardwarePress, hardwareRelease]);

  const hardwarePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, control: HardwareControl) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    hardwarePress(control);
  }, [hardwarePress]);

  const loadHardwarePorts = useCallback(async () => {
    setHardwarePortsLoading(true);
    try {
      setHardwarePorts(await api.hardwarePorts());
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setHardwarePortsLoading(false);
    }
  }, [showNotice]);

  const currentTask = selectedTask(snapshot);
  const hardwareMode = snapshot?.web.controlMode === "esp32s3MicroLab";
  const hardwareReady = hardwareMode && snapshot?.hardware.connection === "ready";
  const microConnected = hardwareReady && snapshot?.hardware.usbMounted && snapshot?.hardware.desktopConnected;
  const agentTasks = useMemo(() => {
    const bySlot = new Map(snapshot?.tasks.map((task) => [task.slotIndex, task]) ?? []);
    return Array.from({ length: 6 }, (_, slot) => bySlot.get(slot));
  }, [snapshot?.tasks]);
  const slotLights = useMemo(() => {
    const bySlot = new Map(snapshot?.hardware.slotLights.map((light) => [light.slot, light]) ?? []);
    return Array.from({ length: 6 }, (_, slot) => bySlot.get(slot));
  }, [snapshot?.hardware.slotLights]);
  const ready = snapshot?.status.appServer === "ready";
  const canSend = ready && snapshot?.status.authenticated && currentTask?.bound && composer.trim().length > 0;
  const fastActive = !hardwareMode && currentTask?.serviceTier !== undefined;
  const currentModel = snapshot?.status.models.find((model) => model.model === (currentTask?.model ?? snapshot.settings.selectedModel)) ??
    snapshot?.status.models.find((model) => model.isDefault) ?? snapshot?.status.models[0];
  const reasoningEfforts = currentModel?.efforts ?? [];
  const filteredThreadCandidates = useMemo(() => {
    const query = candidateQuery.trim().toLocaleLowerCase();
    if (!query) return threadCandidates;
    return threadCandidates.filter((candidate) =>
      [candidate.title, candidate.workspace, candidate.source].some((value) => value?.toLocaleLowerCase().includes(query))
    );
  }, [candidateQuery, threadCandidates]);

  const selectAgent = (task: AgentTask | undefined, slot: number) => {
    if (task) {
      void run(`agent-${slot}`, () => api.rpc("task.activate", { taskId: task.taskId }), `Agent ${slot + 1} 会话已激活`);
      return;
    }
    void run(`agent-${slot}`, async () => {
      const created = await api.rpc<AgentTask>("task.create", { title: `Agent ${slot + 1}` });
      return api.rpc("task.select", { taskId: created.taskId });
    }, `已创建 Agent ${slot + 1}`);
  };

  const trigger = (actionId: ActionName, extra: Record<string, unknown> = {}, success?: string) => {
    if (!currentTask) {
      showNotice("请先选择一个 Agent");
      return;
    }
    const messages: Record<ActionName, string> = {
      approve: "已发送批准",
      decline: "已发送拒绝",
      continue: "已创建续接任务",
      fast: "已启用 Fast",
      plan: "下一轮将使用计划模式",
      reasoning: "推理强度已调整",
      review: "已开始审阅工作区改动",
    };
    void run(actionId, () => api.rpc("action.trigger", { actionId, taskId: currentTask.taskId, source: "web", ...extra }), success ?? messages[actionId]);
  };

  const toggleFast = () => {
    trigger("fast", { enabled: !fastActive }, fastActive ? "Fast 已关闭" : "Fast 已开启");
  };

  const cycleReasoning = (direction: 1 | -1) => {
    if (!reasoningEfforts.length) {
      showNotice("当前模型没有可用的推理档位");
      return;
    }
    const options: Array<string | undefined> = [undefined, ...reasoningEfforts];
    const currentIndex = currentTask?.effort ? Math.max(0, options.indexOf(currentTask.effort)) : 0;
    const next = options[(currentIndex + direction + options.length) % options.length];
    trigger("reasoning", { effort: next ?? null }, next ? `推理强度已设为 ${next.toUpperCase()}` : "推理强度已恢复 Auto");
  };

  const send = () => {
    if (!canSend || !currentTask) return;
    const text = composer.trim();
    setComposer("");
    setComposerOpen(false);
    void run("send", () => api.rpc("composer.send", { taskId: currentTask.taskId, text }), "消息已发送");
  };

  const newTask = () => {
    if (!currentTask) {
      showNotice("请先选择 Agent 1 到 6");
      return;
    }
    void run("new-task", () => api.bindNewThread(currentTask.taskId), `已为 Agent ${currentTask.slotIndex + 1} 新建会话`);
  };

  const loadThreadCandidates = useCallback(async () => {
    setBindingsLoading(true);
    try {
      setThreadCandidates(await api.threadCandidates());
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBindingsLoading(false);
    }
  }, [showNotice]);

  const openSettings = () => {
    if (!snapshot) return;
    setSettingsDraft({
      nodePath: snapshot.web.nodePath,
      codexPath: snapshot.web.codexPath,
      workspaceRoot: snapshot.settings.workspaceRoot,
      selectedModel: snapshot.settings.selectedModel ?? "",
      controlMode: snapshot.web.controlMode,
      microBridgePort: snapshot.web.microBridgePort,
    });
    setSettingsOpen(true);
    if (snapshot.web.controlMode === "appServer") void loadThreadCandidates();
    void loadHardwarePorts();
  };

  const bindAgent = (task: AgentTask) => {
    const candidateToken = candidateSelections[task.taskId];
    if (!candidateToken) {
      showNotice("请先选择一个 Codex 会话");
      return;
    }
    void run(`bind-${task.taskId}`, async () => {
      await api.bindThread(task.taskId, candidateToken);
      setCandidateSelections((selections) => ({ ...selections, [task.taskId]: "" }));
      await loadThreadCandidates();
    }, `Agent ${task.slotIndex + 1} 已绑定`);
  };

  const bindNewAgent = (task: AgentTask) => {
    void run(`bind-new-${task.taskId}`, async () => {
      await api.bindNewThread(task.taskId);
      await loadThreadCandidates();
    }, `Agent ${task.slotIndex + 1} 已新建会话`);
  };

  const unbindAgent = (task: AgentTask) => {
    void run(`unbind-${task.taskId}`, async () => {
      await api.unbindThread(task.taskId);
      await loadThreadCandidates();
    }, `Agent ${task.slotIndex + 1} 已解绑，会话没有被删除`);
  };

  const saveSettings = () => {
    void run("settings", async () => {
      await api.saveConfiguration({
        nodePath: settingsDraft.nodePath.trim(),
        codexPath: settingsDraft.codexPath.trim(),
        workspaceRoot: settingsDraft.workspaceRoot.trim(),
        selectedModel: settingsDraft.selectedModel || undefined,
        controlMode: settingsDraft.controlMode,
        microBridgePort: settingsDraft.microBridgePort.trim(),
      });
      setSettingsOpen(false);
    }, "设置已保存");
  };

  const startVoice = async (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!currentTask?.bound || isRecording) return;
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) {
      showNotice("当前浏览器不支持语音识别，请改用文字输入");
      return;
    }
    try {
      const instance = new Constructor();
      instance.continuous = true;
      instance.interimResults = false;
      instance.lang = navigator.language || "zh-CN";
      instance.onresult = (speechEvent) => {
        const text = Array.from(speechEvent.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
        if (text) {
          setComposer((previous) => [previous.trim(), text].filter(Boolean).join(" "));
          setComposerOpen(true);
        }
      };
      instance.onerror = () => {
        setIsRecording(false);
        void api.rpc("voice.state", { state: "error" }).catch(() => undefined);
        showNotice("语音识别失败，请检查麦克风权限");
      };
      instance.onend = () => {
        setIsRecording(false);
        void api.rpc("voice.state", { state: "ready" }).then(() => window.setTimeout(() => void api.rpc("voice.state", { state: "idle" }), 600)).catch(() => undefined);
      };
      recognition.current = instance;
      instance.start();
      setIsRecording(true);
      await api.rpc("voice.state", { state: "recording" });
    } catch (error) {
      setIsRecording(false);
      showNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const stopVoice = () => {
    if (!isRecording) return;
    void api.rpc("voice.state", { state: "processing" }).catch(() => undefined);
    recognition.current?.stop();
  };

  const changeReasoning = (event: WheelEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (hardwareMode) {
      hardwareEvent(event.deltaY < 0 ? "encoder-cw" : "encoder-ccw", "tap");
    } else {
      cycleReasoning(event.deltaY < 0 ? 1 : -1);
    }
  };

  const openComposer = () => {
    if (!currentTask?.bound) {
      showNotice("请先在设置中为当前 Agent 绑定或新建 Codex 会话");
      return;
    }
    setComposerOpen(true);
  };

  return (
    <main className="app-shell">
      <section className="workspace" id="main-control">
        <section className="deck-zone" aria-label="Codex 键盘控制面">
          <div className="keyboard-deck" aria-label="虚拟 Codex 键盘">
            <div className="keyboard-grid">
              <div
                className="joystick-module has-tooltip"
                aria-label="工作流旋钮"
                data-tooltip={`WORKFLOW\n${hardwareMode ? "转动或按下以发送固定硬件信号" : "浏览工作流选项：计划、续接、审阅和 Fast"}`}
              >
                <button
                  type="button"
                  aria-label={hardwareMode ? "摇杆向上" : "计划模式"}
                  onClick={hardwareMode ? undefined : () => trigger("plan")}
                  onPointerDown={hardwareMode ? (event) => hardwarePointerDown(event, "joystick-up") : undefined}
                  onPointerUp={hardwareMode ? () => hardwareRelease("joystick-up") : undefined}
                  onPointerCancel={hardwareMode ? () => hardwareRelease("joystick-up") : undefined}
                  disabled={hardwareMode ? !microConnected : !currentTask || busy !== undefined}
                ><ArrowUp weight="bold" /></button>
                <button
                  type="button"
                  aria-label={hardwareMode ? "摇杆向左" : "续接新任务"}
                  onClick={hardwareMode ? undefined : () => trigger("continue")}
                  onPointerDown={hardwareMode ? (event) => hardwarePointerDown(event, "joystick-left") : undefined}
                  onPointerUp={hardwareMode ? () => hardwareRelease("joystick-left") : undefined}
                  onPointerCancel={hardwareMode ? () => hardwareRelease("joystick-left") : undefined}
                  disabled={hardwareMode ? !microConnected : !currentTask || busy !== undefined}
                ><ArrowLeft weight="bold" /></button>
                <span className="joystick-center" />
                <button
                  type="button"
                  aria-label={hardwareMode ? "摇杆向右" : "审阅改动"}
                  onClick={hardwareMode ? undefined : () => trigger("review")}
                  onPointerDown={hardwareMode ? (event) => hardwarePointerDown(event, "joystick-right") : undefined}
                  onPointerUp={hardwareMode ? () => hardwareRelease("joystick-right") : undefined}
                  onPointerCancel={hardwareMode ? () => hardwareRelease("joystick-right") : undefined}
                  disabled={hardwareMode ? !microConnected : !currentTask || busy !== undefined}
                ><ArrowRight weight="bold" /></button>
                <button
                  type="button"
                  aria-label={hardwareMode ? "摇杆向下" : "Fast 模式"}
                  aria-pressed={hardwareMode ? undefined : fastActive}
                  onClick={hardwareMode ? undefined : toggleFast}
                  onPointerDown={hardwareMode ? (event) => hardwarePointerDown(event, "joystick-down") : undefined}
                  onPointerUp={hardwareMode ? () => hardwareRelease("joystick-down") : undefined}
                  onPointerCancel={hardwareMode ? () => hardwareRelease("joystick-down") : undefined}
                  disabled={hardwareMode ? !microConnected : !currentTask || busy !== undefined}
                ><ArrowDown weight="bold" /></button>
                <span className="module-label">WORKFLOW</span>
              </div>

              {agentTasks.slice(0, 2).map((task, index) => (
                <KeyboardKey
                  key={task?.taskId ?? `slot-${index}`}
                  label={`AGENT ${index + 1}`}
                  hint={hardwareMode ? `Codex Micro 槽位 ${index + 1}，${slotEffect(slotLights[index])}` : `${task?.title ?? `Agent ${index + 1}`}，${agentStatus(task)}`}
                  className={`agent-key ${hardwareMode ? `hardware-agent effect-${slotLights[index]?.effect ?? 0}` : stateClass(task)}`}
                  busy={!hardwareMode && busy === `agent-${index}`}
                  disabled={hardwareMode && !microConnected}
                  onClick={hardwareMode ? undefined : () => selectAgent(task, index)}
                  {...(hardwareMode ? hardwareKeyProps(`agent-${index + 1}` as HardwareControl) : {})}
                  style={hardwareMode ? slotLightStyle(slotLights[index]) : undefined}
                >
                  <span className="agent-number">{index + 1}</span>
                  <span className="agent-state-label">{hardwareMode ? slotEffect(slotLights[index]) : agentStatus(task)}</span>
                  <span className="agent-light" />
                </KeyboardKey>
              ))}

              <button
                className={`reasoning-module has-tooltip ${hardwareMode ? "hardware-reasoning" : currentTask?.effort ? "has-explicit-effort" : "is-auto"}`}
                type="button"
                aria-label={hardwareMode ? "推理旋钮；按下发送旋钮按键，滚轮发送旋转事件" : `调整推理强度，当前 ${currentTask?.effort?.toUpperCase() ?? "AUTO"}，滚轮向上增加，向下降低`}
                data-tooltip={`REASONING\n${hardwareMode ? "按下或滚动以发送固定硬件信号" : `当前 ${currentTask?.effort?.toUpperCase() ?? "AUTO"}，点击或滚动切换`}`}
                disabled={hardwareMode ? !microConnected : !currentTask || busy !== undefined}
                onClick={hardwareMode ? undefined : () => cycleReasoning(1)}
                onPointerDown={hardwareMode ? (event) => hardwarePointerDown(event, "reasoning-press") : undefined}
                onPointerUp={hardwareMode ? () => hardwareRelease("reasoning-press") : undefined}
                onPointerCancel={hardwareMode ? () => hardwareRelease("reasoning-press") : undefined}
                onWheel={changeReasoning}
              >
                <span className="dial"><span className="dial-notch" /></span>
                <span className="module-label">REASONING</span>
                <span className="dial-value" aria-live="polite">{hardwareMode ? "ENCODER" : currentTask?.effort?.toUpperCase() ?? "AUTO"}</span>
              </button>

              {agentTasks.slice(2, 6).map((task, offset) => {
                const index = offset + 2;
                return (
                  <KeyboardKey
                    key={task?.taskId ?? `slot-${index}`}
                    label={`AGENT ${index + 1}`}
                    hint={hardwareMode ? `Codex Micro 槽位 ${index + 1}，${slotEffect(slotLights[index])}` : `${task?.title ?? `Agent ${index + 1}`}，${agentStatus(task)}`}
                    className={`agent-key ${hardwareMode ? `hardware-agent effect-${slotLights[index]?.effect ?? 0}` : stateClass(task)}`}
                    busy={!hardwareMode && busy === `agent-${index}`}
                    disabled={hardwareMode && !microConnected}
                    onClick={hardwareMode ? undefined : () => selectAgent(task, index)}
                    {...(hardwareMode ? hardwareKeyProps(`agent-${index + 1}` as HardwareControl) : {})}
                    style={hardwareMode ? slotLightStyle(slotLights[index]) : undefined}
                  >
                    <span className="agent-number">{index + 1}</span>
                    <span className="agent-state-label">{hardwareMode ? slotEffect(slotLights[index]) : agentStatus(task)}</span>
                    <span className="agent-light" />
                  </KeyboardKey>
                );
              })}

              <KeyboardKey
                label="FAST"
                hint={"切换快速模式\nTurn Fast mode on or off in the current composer"}
                className="accent-key"
                busy={!hardwareMode && busy === "fast"}
                pressed={hardwareMode ? undefined : fastActive}
                disabled={hardwareMode ? !microConnected : !currentTask}
                onClick={hardwareMode ? undefined : toggleFast}
                {...(hardwareMode ? hardwareKeyProps("fast") : {})}
              ><Lightning weight="fill" /></KeyboardKey>
              <KeyboardKey
                label="APPROVE"
                hint={"批准\nApprove the active request"}
                className="approve-key"
                busy={!hardwareMode && busy === "approve"}
                disabled={hardwareMode ? !microConnected : !currentTask?.pendingApprovalCount}
                onClick={hardwareMode ? undefined : () => trigger("approve")}
                {...(hardwareMode ? hardwareKeyProps("approve") : {})}
              ><Check weight="bold" /></KeyboardKey>
              <KeyboardKey
                label="DECLINE"
                hint={"拒绝\nDecline the active request"}
                className="decline-key"
                busy={!hardwareMode && busy === "decline"}
                disabled={hardwareMode ? !microConnected : !currentTask?.pendingApprovalCount}
                onClick={hardwareMode ? undefined : () => trigger("decline")}
                {...(hardwareMode ? hardwareKeyProps("decline") : {})}
              ><X weight="bold" /></KeyboardKey>
              <KeyboardKey
                label={hardwareMode ? "FORK" : "NEW CHAT"}
                hint={hardwareMode ? "在新任务中继续\nCreate a new chat from the current chat" : "新建会话\nCreate a new empty chat in this slot"}
                className="new-key"
                busy={!hardwareMode && busy === "new-task"}
                disabled={hardwareMode ? !microConnected : !currentTask || !ready}
                onClick={hardwareMode ? undefined : newTask}
                {...(hardwareMode ? hardwareKeyProps("continue") : {})}
              >{hardwareMode ? <GitFork weight="bold" /> : <Plus weight="bold" />}</KeyboardKey>

              <button
                className="deck-status has-tooltip"
                type="button"
                aria-label="查看连接状态并打开设置"
                data-tooltip={`SETTINGS\n${hardwareMode ? `UART ${hardwareReady ? "READY" : "OFFLINE"} / USB ${snapshot?.hardware.usbMounted ? "ACTIVE" : "WAITING"} / HOST ${snapshot?.hardware.desktopConnected ? "CONNECTED" : "WAITING"}` : `NODE ${snapshot?.web.daemonOnline ? "ONLINE" : "OFFLINE"} / CODEX ${ready ? "READY" : "WAITING"}`}`}
                onClick={openSettings}
                disabled={!snapshot}
              >
                <span className="status-light-stack" aria-hidden="true">
                  <span className={`mini-light ${hardwareMode ? hardwareReady ? "active" : "" : snapshot?.web.daemonOnline ? "active" : ""}`} />
                  <span className={`mini-light ${hardwareMode ? snapshot?.hardware.usbMounted ? "active" : "" : ready ? "active" : ""}`} />
                  <span className={`mini-light ${hardwareMode ? snapshot?.hardware.desktopConnected ? "working" : "" : currentTask?.state === "working" ? "working" : ""}`} />
                </span>
                <span className="status-settings-knob" aria-hidden="true" />
              </button>
              <button
                className={`ptt-key has-tooltip ${isRecording ? "recording" : ""}`}
                type="button"
                aria-label="按住说话，松开转成文字"
                data-tooltip={"MIC\n按住说话，松开停止"}
                disabled={hardwareMode ? !microConnected : !currentTask?.bound || !ready}
                onPointerDown={hardwareMode ? (event) => hardwarePointerDown(event, "ptt") : (event) => void startVoice(event)}
                onPointerUp={hardwareMode ? () => hardwareRelease("ptt") : stopVoice}
                onPointerCancel={hardwareMode ? () => hardwareRelease("ptt") : stopVoice}
              >
                <Microphone weight={isRecording ? "fill" : "bold"} />
                <span>{hardwareMode ? "PTT" : isRecording ? "LISTENING" : "HOLD TO TALK"}</span>
              </button>
              <KeyboardKey
                label="CODEX"
                hint={hardwareMode ? "发送消息\nSend the current composer message" : "打开输入框\nOpen the composer for this Agent"}
                className="send-key"
                busy={!hardwareMode && busy === "send"}
                disabled={hardwareMode ? !microConnected : !currentTask?.bound || !ready}
                onClick={hardwareMode ? undefined : openComposer}
                {...(hardwareMode ? hardwareKeyProps("send") : {})}
              ><OpenAiLogo weight="regular" /></KeyboardKey>
            </div>
          </div>
        </section>

      </section>

      {(notice || connectionError) ? (
        <div className={`toast ${connectionError ? "error" : ""}`} role="status">
          {connectionError ? <WarningCircle weight="fill" /> : <Check weight="bold" />}
          <span>{connectionError ?? notice}</span>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSettingsOpen(false);
        }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-header">
              <div><p className="eyebrow">ARKEY CONFIGURATION</p><h2 id="settings-title">键盘设置</h2></div>
              <button className="icon-button" type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X weight="bold" /></button>
            </div>

            <section className="control-mode-section" aria-labelledby="control-mode-title">
              <div className="settings-section-heading">
                <div>
                  <h3 id="control-mode-title">控制链路</h3>
                  <p>两种模式互不混用。原生硬件模式复现固定 USB 信号；App Server 模式直接管理 Codex 会话。</p>
                </div>
              </div>
              <div className="mode-options">
                <label className={settingsDraft.controlMode === "esp32s3MicroLab" ? "selected" : ""}>
                  <input
                    type="radio"
                    name="control-mode"
                    checked={settingsDraft.controlMode === "esp32s3MicroLab"}
                    onChange={() => setSettingsDraft((draft) => ({ ...draft, controlMode: "esp32s3MicroLab" }))}
                  />
                  <span><strong>ESP32-S3 原生硬件</strong><small>Web → UART → 固定 Codex Micro USB HID</small></span>
                </label>
                <label className={settingsDraft.controlMode === "appServer" ? "selected" : ""}>
                  <input
                    type="radio"
                    name="control-mode"
                    checked={settingsDraft.controlMode === "appServer"}
                    onChange={() => {
                      setSettingsDraft((draft) => ({ ...draft, controlMode: "appServer" }));
                      void loadThreadCandidates();
                    }}
                  />
                  <span><strong>App Server 软件模式</strong><small>Web → Arkey daemon → codex app-server</small></span>
                </label>
              </div>
            </section>

            {settingsDraft.controlMode === "appServer" ? <>
            <section className="agent-bindings-section" aria-labelledby="agent-bindings-title">
              <div className="settings-section-heading">
                <div>
                  <h3 id="agent-bindings-title">Agent 1-6 会话绑定</h3>
                  <p>每个按键是固定槽位。可绑定本机近期的 CLI、VS Code 或 App Server 会话；当前工作目录会优先显示。</p>
                </div>
                <button className="secondary-button compact-button" type="button" onClick={() => void loadThreadCandidates()} disabled={bindingsLoading || busy !== undefined}>
                  <CircleNotch className={bindingsLoading ? "spin" : ""} weight="bold" />刷新
                </button>
              </div>
              <div className="binding-list">
                <div className="binding-toolbar">
                  <label>
                    搜索已有会话
                    <input
                      type="search"
                      value={candidateQuery}
                      onChange={(event) => {
                        setCandidateQuery(event.target.value);
                        setCandidateSelections({});
                      }}
                      placeholder="按标题、工作目录或来源筛选"
                    />
                  </label>
                  <span>{filteredThreadCandidates.length} / {threadCandidates.length} 个可用会话</span>
                </div>
                {agentTasks.map((task, index) => task ? (
                  <div className="binding-row" key={task.taskId}>
                    <div className="binding-identity">
                      <span>AGENT {index + 1}</span>
                      <strong>{task.bound ? task.title : "未绑定"}</strong>
                    </div>
                    <select
                      aria-label={`Agent ${index + 1} 会话`}
                      value={candidateSelections[task.taskId] ?? ""}
                      onChange={(event) => setCandidateSelections((selections) => ({ ...selections, [task.taskId]: event.target.value }))}
                      disabled={bindingsLoading || busy !== undefined}
                    >
                      <option value="">选择已有会话</option>
                      {filteredThreadCandidates.map((candidate) => (
                        <option key={candidate.candidateToken} value={candidate.candidateToken}>
                          {candidate.currentWorkspace ? "[当前目录] " : ""}{candidate.title}{candidate.workspace ? ` · ${candidate.workspace}` : ""}{candidate.source ? ` · ${candidate.source}` : ""}
                        </option>
                      ))}
                    </select>
                    <button className="secondary-button compact-button" type="button" disabled={!candidateSelections[task.taskId] || busy !== undefined} onClick={() => bindAgent(task)}>
                      {task.bound ? "替换" : "绑定"}
                    </button>
                    <button className="secondary-button compact-button" type="button" disabled={!ready || busy !== undefined} onClick={() => bindNewAgent(task)}>
                      {task.bound ? "新建并替换" : "新建"}
                    </button>
                    {task.bound ? <button className="text-button" type="button" disabled={busy !== undefined} onClick={() => unbindAgent(task)}>解绑</button> : <span className="binding-spacer" />}
                  </div>
                ) : null)}
              </div>
              {!bindingsLoading && threadCandidates.length === 0 ? <p className="empty-binding-note">App Server 没有返回可恢复的未占用会话，仍可为任意 Agent 新建会话。</p> : null}
              {!bindingsLoading && threadCandidates.length > 0 && filteredThreadCandidates.length === 0 ? <p className="empty-binding-note">没有会话匹配当前搜索条件。</p> : null}
              <p className="binding-safety-note">解绑或替换不会删除原 Codex 会话。绑定后，按键会显示由 Arkey 发起的后续 turn 状态；其他客户端中已经运行的 turn 不保证实时镜像。</p>
            </section>

            <section className="runtime-settings" aria-labelledby="runtime-settings-title">
              <div className="settings-section-heading">
                <div><h3 id="runtime-settings-title">本地运行环境</h3><p>默认使用启动 Web 服务的 Node；自动识别失败时再指定其他可执行文件。</p></div>
              </div>
              <label>Node 可执行文件<input value={settingsDraft.nodePath} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, nodePath: event.target.value }))} placeholder="/opt/homebrew/bin/node" spellCheck={false} /></label>
              <label>Codex 可执行文件<input value={settingsDraft.codexPath} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, codexPath: event.target.value }))} placeholder="/Applications/ChatGPT.app/Contents/Resources/codex" spellCheck={false} /></label>
              <label>工作目录<input value={settingsDraft.workspaceRoot} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, workspaceRoot: event.target.value }))} placeholder="/path/to/project" spellCheck={false} /></label>
              <label>默认模型
                <select value={settingsDraft.selectedModel} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, selectedModel: event.target.value }))}>
                  <option value="">Codex 默认模型</option>
                  {snapshot?.status.models.map((model) => <option key={model.model} value={model.model}>{model.displayName ?? model.model}</option>)}
                </select>
              </label>
              <div className="settings-note"><WarningCircle weight="bold" /><span>路径变更只会重启由本页启动的 daemon。外部 daemon 不会被终止。</span></div>
            </section>
            </> : <section className="hardware-settings" aria-labelledby="hardware-settings-title">
              <div className="settings-section-heading">
                <div>
                  <h3 id="hardware-settings-title">ESP32-S3 USB-UART 桥</h3>
                  <p>选择开发板的 UART/下载口。另一条原生 USB 口连接同一台 Mac，并由 Codex Desktop 识别为 Codex Micro。</p>
                </div>
                <button className="secondary-button compact-button" type="button" onClick={() => void loadHardwarePorts()} disabled={hardwarePortsLoading || busy !== undefined}>
                  <CircleNotch className={hardwarePortsLoading ? "spin" : ""} weight="bold" />刷新
                </button>
              </div>
              <label>串口设备
                <select
                  value={settingsDraft.microBridgePort}
                  onChange={(event) => setSettingsDraft((draft) => ({ ...draft, microBridgePort: event.target.value }))}
                >
                  <option value="">选择开发板串口</option>
                  {settingsDraft.microBridgePort && !hardwarePorts.some((port) => port.path === settingsDraft.microBridgePort) ? (
                    <option value={settingsDraft.microBridgePort}>{settingsDraft.microBridgePort}（当前未枚举）</option>
                  ) : null}
                  {hardwarePorts.map((port) => (
                    <option key={port.path} value={port.path}>
                      {port.path}{port.manufacturer ? ` · ${port.manufacturer}` : ""}{port.vendorId && port.productId ? ` · ${port.vendorId}:${port.productId}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="hardware-checklist">
                <div><span className={`status-dot ${snapshot?.hardware.connection === "ready" ? "online" : "offline"}`} /><span>UART 桥：{snapshot?.hardware.connection ?? "disabled"}</span></div>
                <div><span className={`status-dot ${snapshot?.hardware.usbMounted ? "online" : "waiting"}`} /><span>原生 USB：{snapshot?.hardware.usbMounted ? "已枚举" : "等待连接"}</span></div>
                <div><span className={`status-dot ${snapshot?.hardware.desktopConnected ? "online" : "waiting"}`} /><span>Codex Desktop：{snapshot?.hardware.desktopConnected ? "握手完成" : "等待握手"}</span></div>
              </div>
              {snapshot?.hardware.lastError ? <p className="empty-binding-note">串口错误：{snapshot.hardware.lastError}</p> : null}
              <div className="settings-note"><WarningCircle weight="bold" /><span>此页不安装或刷写固件。Agent 1-6 的会话绑定在 Codex Desktop 的 Codex Micro 界面中完成，Web 只发送实体按键等价信号。</span></div>
            </section>}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>取消</button>
              <button
                type="button"
                className="primary-button"
                disabled={busy === "settings" || (settingsDraft.controlMode === "appServer" ? !settingsDraft.nodePath || !settingsDraft.workspaceRoot : !settingsDraft.microBridgePort)}
                onClick={saveSettings}
              >
                {busy === "settings" ? <CircleNotch className="spin" weight="bold" /> : <Check weight="bold" />}保存并验证
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {composerOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setComposerOpen(false);
        }}>
          <section className="composer-modal" role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <div className="modal-header">
              <div><p className="eyebrow">AGENT {currentTask ? currentTask.slotIndex + 1 : ""}</p><h2 id="composer-title">发送消息</h2></div>
              <button className="icon-button" type="button" aria-label="关闭输入框" onClick={() => setComposerOpen(false)}><X weight="bold" /></button>
            </div>
            <textarea
              autoFocus
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
              }}
              placeholder="输入任务，Command + Enter 发送"
              rows={8}
            />
            <div className="composer-footer">
              <span>{composer.length.toLocaleString()} / 50,000</span>
              <div className="modal-actions compact-actions">
                <button type="button" className="secondary-button" onClick={() => setComposerOpen(false)}>取消</button>
                <button type="button" className="primary-button" disabled={!canSend || busy !== undefined} onClick={send}>
                  <PaperPlaneTilt weight="fill" />发送
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
