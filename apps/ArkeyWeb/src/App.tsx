import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CircleNotch,
  GearSix,
  GitFork,
  Lightning,
  Microphone,
  OpenAiLogo,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { api, type HardwareControl } from "./api";
import type { MicroBridgePort, MicroSlotLight, Snapshot } from "./types";

function slotColor(light: MicroSlotLight | undefined): string {
  const value = light?.color ?? 0;
  return `#${Math.max(0, Math.min(0xffffff, value)).toString(16).padStart(6, "0")}`;
}

function keySurface(light: MicroSlotLight | undefined): string {
  const value = light?.color ?? 0;
  const brightness = Math.max(0, Math.min(1, light?.brightness ?? 0));
  if (brightness <= 0.01) return "#d8d8d5";
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  const maximum = Math.max(red, green, blue) / 255;
  const minimum = Math.min(red, green, blue) / 255;
  const delta = maximum - minimum;
  if (delta < 0.06) return `hsl(0 0% ${Math.round(32 + brightness * 58)}%)`;
  let hue = 0;
  if (maximum === red / 255) hue = 60 * (((green - blue) / 255 / delta) % 6);
  else if (maximum === green / 255) hue = 60 * ((blue - red) / 255 / delta + 2);
  else hue = 60 * ((red - green) / 255 / delta + 4);
  if (hue < 0) hue += 360;
  return `hsl(${Math.round(hue)} 56% ${Math.round(36 + brightness * 22)}%)`;
}

function slotStyle(light: MicroSlotLight | undefined): CSSProperties {
  return {
    "--agent-light-color": slotColor(light),
    "--agent-light-opacity": String(Math.max(0.15, light?.brightness ?? 0)),
    "--agent-key-surface": keySurface(light),
  } as CSSProperties;
}

function slotEffect(light: MicroSlotLight | undefined): string {
  if (!light || (light.brightness ?? 0) <= 0.01 || light.effect === 0) return "灯光关闭";
  return ({ 1: "常亮", 2: "流动", 3: "彩虹", 4: "呼吸", 5: "渐变", 6: "浅呼吸" } as Record<number, string>)[light.effect ?? 1] ?? `灯效 ${light.effect}`;
}

interface KeyProps {
  label: string;
  hint: string;
  control: HardwareControl;
  disabled: boolean;
  className?: string;
  style?: CSSProperties;
  onPress: (control: HardwareControl) => void;
  onRelease: (control: HardwareControl) => void;
  children: ReactNode;
}

function KeyboardKey({ label, hint, control, disabled, className = "", style, onPress, onRelease, children }: KeyProps) {
  return (
    <button
      className={`keyboard-key has-tooltip ${className}`}
      type="button"
      aria-label={`${label}，${hint}`}
      data-tooltip={`${label}\n${hint}`}
      disabled={disabled}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onPress(control);
      }}
      onPointerUp={() => onRelease(control)}
      onPointerCancel={() => onRelease(control)}
      style={style}
    >
      <span className="key-face">{children}</span>
    </button>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connectionError, setConnectionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPort, setSettingsPort] = useState("");
  const [ports, setPorts] = useState<MicroBridgePort[]>([]);
  const [portsLoading, setPortsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const pressedControls = useRef(new Set<HardwareControl>());
  const noticeTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot());
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

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(undefined), 3_200);
  }, []);

  const sendEvent = useCallback((control: HardwareControl, phase: "down" | "up" | "tap") => {
    void api.hardwareEvent(control, phase).catch((error) => {
      showNotice(error instanceof Error ? error.message : String(error));
    });
  }, [showNotice]);

  const press = useCallback((control: HardwareControl) => {
    if (pressedControls.current.has(control)) return;
    pressedControls.current.add(control);
    sendEvent(control, "down");
  }, [sendEvent]);

  const release = useCallback((control: HardwareControl) => {
    if (!pressedControls.current.delete(control)) return;
    sendEvent(control, "up");
  }, [sendEvent]);

  const releaseAll = useCallback(() => {
    const controls = [...pressedControls.current];
    pressedControls.current.clear();
    for (const control of controls) sendEvent(control, "up");
  }, [sendEvent]);

  useEffect(() => {
    const whenHidden = () => { if (document.hidden) releaseAll(); };
    window.addEventListener("blur", releaseAll);
    window.addEventListener("pointerup", releaseAll);
    window.addEventListener("pointercancel", releaseAll);
    document.addEventListener("visibilitychange", whenHidden);
    return () => {
      window.removeEventListener("blur", releaseAll);
      window.removeEventListener("pointerup", releaseAll);
      window.removeEventListener("pointercancel", releaseAll);
      document.removeEventListener("visibilitychange", whenHidden);
      releaseAll();
    };
  }, [releaseAll]);

  const pointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, control: HardwareControl) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    press(control);
  }, [press]);

  const loadPorts = useCallback(async () => {
    setPortsLoading(true);
    try {
      setPorts(await api.hardwarePorts());
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setPortsLoading(false);
    }
  }, [showNotice]);

  const openSettings = () => {
    setSettingsPort(snapshot?.hardware.configuredPort ?? "");
    setSettingsOpen(true);
    void loadPorts();
  };

  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      await api.saveSettings(settingsPort);
      await refresh();
      setSettingsOpen(false);
      showNotice("串口设置已保存");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsSaving(false);
    }
  };

  const slotLights = useMemo(() => {
    const bySlot = new Map(snapshot?.hardware.slotLights.map((light) => [light.slot, light]) ?? []);
    return Array.from({ length: 6 }, (_, slot) => bySlot.get(slot));
  }, [snapshot?.hardware.slotLights]);

  const uartReady = snapshot?.hardware.connection === "ready";
  const connected = uartReady && snapshot?.hardware.usbMounted === true && snapshot?.hardware.desktopConnected === true;
  const disabled = !connected;
  const wheelReasoning = (event: WheelEvent<HTMLButtonElement>) => {
    event.preventDefault();
    sendEvent(event.deltaY < 0 ? "encoder-cw" : "encoder-ccw", "tap");
  };
  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="keyboard-deck" aria-label="Codex Micro Web 控制面">
          <div className="keyboard-grid">
            <button
              className="reasoning-module has-tooltip"
              type="button"
              aria-label="推理旋钮；按下发送旋钮按键，滚动发送旋转事件"
              data-tooltip={"REASONING\n按下或滚动"}
              disabled={disabled}
              onPointerDown={(event) => pointerDown(event, "reasoning-press")}
              onPointerUp={() => release("reasoning-press")}
              onPointerCancel={() => release("reasoning-press")}
              onWheel={wheelReasoning}
            >
              <span className="dial"><span className="dial-notch" /></span>
            </button>

            {[0, 1].map((slot) => (
              <KeyboardKey
                key={slot}
                label={`AGENT ${slot + 1}`}
                hint={slotEffect(slotLights[slot])}
                control={`agent-${slot + 1}` as HardwareControl}
                disabled={disabled}
                className={`agent-key effect-${slotLights[slot]?.effect ?? 0}`}
                style={slotStyle(slotLights[slot])}
                onPress={press}
                onRelease={release}
              ><span className="agent-light" /></KeyboardKey>
            ))}

            <div className="joystick-module has-tooltip" aria-label="工作流摇杆，待开发" aria-disabled="true" data-tooltip={"WORKFLOW\n待开发"}>
              <button type="button" aria-label="摇杆向上，待开发" disabled><ArrowUp /></button>
              <button type="button" aria-label="摇杆向左，待开发" disabled><ArrowLeft /></button>
              <span className="joystick-center" />
              <button type="button" aria-label="摇杆向右，待开发" disabled><ArrowRight /></button>
              <button type="button" aria-label="摇杆向下，待开发" disabled><ArrowDown /></button>
            </div>

            {[2, 3, 4, 5].map((slot) => (
              <KeyboardKey
                key={slot}
                label={`AGENT ${slot + 1}`}
                hint={slotEffect(slotLights[slot])}
                control={`agent-${slot + 1}` as HardwareControl}
                disabled={disabled}
                className={`agent-key effect-${slotLights[slot]?.effect ?? 0}`}
                style={slotStyle(slotLights[slot])}
                onPress={press}
                onRelease={release}
              ><span className="agent-light" /></KeyboardKey>
            ))}

            <KeyboardKey label="FAST" hint="快速模式" control="fast" disabled={disabled} className="dark-key" onPress={press} onRelease={release}><Lightning weight="fill" /></KeyboardKey>
            <KeyboardKey label="APPROVE" hint="批准" control="approve" disabled={disabled} className="dark-key" onPress={press} onRelease={release}><Check weight="bold" /></KeyboardKey>
            <KeyboardKey label="DECLINE" hint="拒绝" control="decline" disabled={disabled} className="dark-key" onPress={press} onRelease={release}><X weight="bold" /></KeyboardKey>
            <KeyboardKey label="FORK" hint="在新任务中继续" control="continue" disabled={disabled} className="dark-key" onPress={press} onRelease={release}><GitFork weight="bold" /></KeyboardKey>

            <button
              className="deck-status has-tooltip"
              type="button"
              aria-label="连接状态与设置"
              data-tooltip={`SETTINGS\nUART ${uartReady ? "READY" : "WAITING"} / USB ${snapshot?.hardware.usbMounted ? "ACTIVE" : "WAITING"} / CODEX ${snapshot?.hardware.desktopConnected ? "CONNECTED" : "WAITING"}`}
              onClick={openSettings}
            >
              <span className="status-light-stack" aria-hidden="true">
                <span className={`mini-light ${uartReady ? "active" : ""}`} />
                <span className={`mini-light ${snapshot?.hardware.usbMounted ? "active blue" : ""}`} />
                <span className={`mini-light ${snapshot?.hardware.desktopConnected ? "active yellow" : ""}`} />
              </span>
              <span className="status-settings-knob"><GearSix weight="bold" /></span>
            </button>
            <button
              className="ptt-key has-tooltip"
              type="button"
              aria-label="语音按钮，待开发"
              data-tooltip={"MIC\n待开发"}
              disabled
            ><Microphone weight="bold" /></button>
            <KeyboardKey label="CODEX" hint="发送" control="send" disabled={disabled} className="dark-key" onPress={press} onRelease={release}><OpenAiLogo /></KeyboardKey>
          </div>
        </div>
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
              <div><p>ARKEY HARDWARE</p><h1 id="settings-title">连接设置</h1></div>
              <button className="icon-button" type="button" aria-label="关闭" onClick={() => setSettingsOpen(false)}><X weight="bold" /></button>
            </div>
            <p className="settings-copy">选择开发板的 COM / USB-UART 端口。另一条原生 USB 线连接 Codex Desktop。</p>
            <label className="port-field">
              <span>串口设备</span>
              <div className="port-row">
                <select value={settingsPort} onChange={(event) => setSettingsPort(event.target.value)}>
                  <option value="">不连接</option>
                  {settingsPort && !ports.some((port) => port.path === settingsPort) ? <option value={settingsPort}>{settingsPort}（未枚举）</option> : null}
                  {ports.map((port) => <option key={port.path} value={port.path}>{port.path}{port.manufacturer ? ` · ${port.manufacturer}` : ""}</option>)}
                </select>
                <button className="secondary-button" type="button" onClick={() => void loadPorts()} disabled={portsLoading}>
                  {portsLoading ? <CircleNotch className="spin" /> : "刷新"}
                </button>
              </div>
            </label>
            <div className="hardware-checklist">
              <div><span className={`status-dot ${uartReady ? "online" : ""}`} /><span>UART：{snapshot?.hardware.connection ?? "disabled"}</span></div>
              <div><span className={`status-dot ${snapshot?.hardware.usbMounted ? "online" : ""}`} /><span>原生 USB：{snapshot?.hardware.usbMounted ? "已枚举" : "等待连接"}</span></div>
              <div><span className={`status-dot ${snapshot?.hardware.desktopConnected ? "online" : ""}`} /><span>Codex Desktop：{snapshot?.hardware.desktopConnected ? "握手完成" : "等待握手"}</span></div>
              <div><span className={`status-dot ${snapshot?.hardware.firmwareVersion ? "online" : ""}`} /><span>固件：{snapshot?.hardware.firmwareVersion ?? "尚未读取"}</span></div>
            </div>
            {snapshot?.hardware.lastError ? <p className="hardware-error">{snapshot.hardware.lastError}</p> : null}
            <p className="settings-note"><WarningCircle weight="bold" />此页面不会构建、刷写或修改固件。Agent 1–6 的会话绑定由 Codex Desktop 完成。</p>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setSettingsOpen(false)}>取消</button>
              <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={settingsSaving}>
                {settingsSaving ? <CircleNotch className="spin" /> : <Check weight="bold" />}保存
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
