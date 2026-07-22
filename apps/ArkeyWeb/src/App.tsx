import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Browser,
  Check,
  CircleNotch,
  GearSix,
  GitFork,
  Lightning,
  Microphone,
  OpenAiLogo,
  Power,
  PushPinSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { api, type HardwareControl } from "./api";
import { reasoningControlForWheelEvent } from "./reasoningWheel";
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

interface TooltipTarget {
  element: HTMLElement;
  text: string;
}

interface TooltipPosition {
  left: number;
  top: number;
  ready: boolean;
}

function tooltipTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>(".has-tooltip[data-tooltip]")
    : null;
}

function ViewportTooltip() {
  const [target, setTarget] = useState<TooltipTarget>();
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0, ready: false });
  const tooltip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const element = tooltipTarget(event.target);
      const text = element?.dataset.tooltip;
      if (!element || !text) return;
      setTarget((current) => current?.element === element && current.text === text
        ? current
        : { element, text });
    };
    const hideAfterPointerExit = (event: MouseEvent) => {
      const from = tooltipTarget(event.target);
      const to = tooltipTarget(event.relatedTarget);
      if (from && from !== to) setTarget(undefined);
    };
    const hideAfterFocusExit = (event: FocusEvent) => {
      const from = tooltipTarget(event.target);
      const to = tooltipTarget(event.relatedTarget);
      if (from && from !== to) setTarget(undefined);
    };

    document.addEventListener("mouseover", show);
    document.addEventListener("mouseout", hideAfterPointerExit);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hideAfterFocusExit);
    return () => {
      document.removeEventListener("mouseover", show);
      document.removeEventListener("mouseout", hideAfterPointerExit);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hideAfterFocusExit);
    };
  }, []);

  useLayoutEffect(() => {
    const overlay = tooltip.current;
    if (!target || !overlay) {
      setPosition({ left: 0, top: 0, ready: false });
      return;
    }

    const update = () => {
      if (!target.element.isConnected) {
        setTarget(undefined);
        return;
      }
      const edge = 8;
      const gap = 8;
      const anchor = target.element.getBoundingClientRect();
      const tip = overlay.getBoundingClientRect();
      let top = anchor.top - tip.height - gap;
      if (top < edge) top = anchor.bottom + gap;
      top = Math.max(edge, Math.min(top, window.innerHeight - tip.height - edge));
      const centered = anchor.left + (anchor.width - tip.width) / 2;
      const left = Math.max(edge, Math.min(centered, window.innerWidth - tip.width - edge));
      setPosition({ left, top, ready: true });
    };

    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [target]);

  if (!target) return null;
  return (
    <div
      ref={tooltip}
      className={"viewport-tooltip " + (position.ready ? "visible" : "")}
      role="tooltip"
      style={{ left: position.left, top: position.top }}
    >
      {target.text}
    </div>
  );
}

function KeyboardKey({ label, hint, control, disabled, className = "", style, onPress, onRelease, children }: KeyProps) {
  return (
    <button
      className={`keyboard-key has-tooltip ${className}`}
      type="button"
      aria-label={`${label}，${hint}`}
      data-tooltip={`${label}\n${hint}`}
      aria-disabled={disabled}
      onPointerDown={(event) => {
        if (disabled) return;
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
  const [browserOpening, setBrowserOpening] = useState(false);
  const [alwaysOnTopChanging, setAlwaysOnTopChanging] = useState(false);
  const [focusCodexChanging, setFocusCodexChanging] = useState(false);
  const [exiting, setExiting] = useState(false);
  const pressedControls = useRef(new Set<HardwareControl>());
  const lastReasoningWheelAt = useRef<number | undefined>(undefined);
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

  useEffect(() => {
    const desktopMode = snapshot?.web.desktop === true;
    document.documentElement.classList.toggle("desktop-mode", desktopMode);
    return () => document.documentElement.classList.remove("desktop-mode");
  }, [snapshot?.web.desktop]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(undefined), 3_200);
  }, []);

  const startWindowDrag = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (
      snapshot?.web.desktop !== true
      || event.button !== 0
      || event.target !== event.currentTarget
    ) return;
    event.preventDefault();
    void api.startWindowDrag().catch((error) => {
      showNotice(error instanceof Error ? error.message : String(error));
    });
  }, [showNotice, snapshot?.web.desktop]);

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

  const closeSettings = useCallback(async () => {
    try {
      await api.setSettingsOpen(false);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsOpen(false);
    }
  }, [showNotice]);

  const openSettings = async () => {
    try {
      await api.setSettingsOpen(true);
      setSettingsPort(snapshot?.hardware.configuredPort ?? "");
      setSettingsOpen(true);
      void loadPorts();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void closeSettings();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeSettings, settingsOpen]);

  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      await api.saveSettings(settingsPort);
      await refresh();
      await closeSettings();
      showNotice("串口设置已保存");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsSaving(false);
    }
  };

  const openBrowser = async () => {
    setBrowserOpening(true);
    try {
      await api.openBrowser();
      showNotice("已在浏览器打开，共享当前设备连接");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBrowserOpening(false);
    }
  };

  const toggleAlwaysOnTop = async () => {
    const enabled = snapshot?.web.alwaysOnTop !== true;
    setAlwaysOnTopChanging(true);
    try {
      await api.setAlwaysOnTop(enabled);
      setSnapshot((current) => current ? {
        ...current,
        web: { ...current.web, alwaysOnTop: enabled },
      } : current);
      showNotice(enabled ? "窗口已置顶" : "已取消窗口置顶");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setAlwaysOnTopChanging(false);
    }
  };

  const toggleFocusCodexOnInput = async () => {
    const enabled = snapshot?.web.focusCodexOnInput !== true;
    setFocusCodexChanging(true);
    try {
      const result = await api.setFocusCodexOnInput(enabled);
      setSnapshot((current) => current ? {
        ...current,
        web: {
          ...current.web,
          focusCodexOnInput: enabled,
          accessibilityGranted: result.accessibilityGranted,
        },
      } : current);
      showNotice(enabled
        ? (result.accessibilityGranted
          ? "按键时将自动置前 Codex"
          : "已开启；请在系统设置中允许 Arkey 使用辅助功能")
        : "已关闭 Codex 自动置前");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setFocusCodexChanging(false);
    }
  };

  const exitApp = async () => {
    setExiting(true);
    try {
      await api.exitApp();
    } catch (error) {
      setExiting(false);
      showNotice(error instanceof Error ? error.message : String(error));
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
    if (disabled) return;
    const control = reasoningControlForWheelEvent(lastReasoningWheelAt.current, event.timeStamp, event.deltaY);
    if (event.deltaY !== 0) lastReasoningWheelAt.current = event.timeStamp;
    if (control) sendEvent(control, "tap");
  };
  return (
    <main className={"app-shell " + (snapshot?.web.desktop ? "desktop-shell" : "")}>
      <section
        className="workspace"
        onMouseDown={startWindowDrag}
      >
        <div
          className="keyboard-deck"
          aria-label="Codex Micro Web 控制面"
          onMouseDown={startWindowDrag}
        >
          <div
            className="keyboard-grid"
            onMouseDown={startWindowDrag}
          >
            <button
              className="reasoning-module has-tooltip"
              type="button"
              aria-label="推理旋钮；按下发送旋钮按键，滚动发送旋转事件"
              aria-disabled={disabled}
              data-tooltip={"REASONING\n按下或滚动"}
              onPointerDown={(event) => { if (!disabled) pointerDown(event, "reasoning-press"); }}
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
              <button type="button" aria-label="摇杆向上，待开发" aria-disabled="true" tabIndex={-1}><ArrowUp /></button>
              <button type="button" aria-label="摇杆向左，待开发" aria-disabled="true" tabIndex={-1}><ArrowLeft /></button>
              <span className="joystick-center" />
              <button type="button" aria-label="摇杆向右，待开发" aria-disabled="true" tabIndex={-1}><ArrowRight /></button>
              <button type="button" aria-label="摇杆向下，待开发" aria-disabled="true" tabIndex={-1}><ArrowDown /></button>
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
              onClick={() => void openSettings()}
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
              aria-disabled="true"
              data-tooltip={"MIC\n待开发"}
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
          if (event.target === event.currentTarget) void closeSettings();
        }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-header">
              <div><p>ARKEY HARDWARE</p><h1 id="settings-title">连接设置</h1></div>
              <button className="icon-button" type="button" aria-label="关闭" onClick={() => void closeSettings()}><X weight="bold" /></button>
            </div>
            <p className="settings-copy">启动时会自动识别唯一的 Arkey USB-UART；也可以手动指定端口。另一条原生 USB 线连接 Codex Desktop。</p>
            <label className="port-field">
              <span>串口设备</span>
              <div className="port-row">
                <select value={settingsPort} onChange={(event) => setSettingsPort(event.target.value)}>
                  <option value="">自动查找</option>
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
            {snapshot?.web.desktop ? (
              <div className="window-preference">
                <div className="window-preference-copy">
                  <PushPinSimple weight={snapshot.web.alwaysOnTop ? "fill" : "bold"} />
                  <span><strong>窗口置顶</strong><small>让键盘保持在其他窗口上方</small></span>
                </div>
                <button
                  className={"toggle-button " + (snapshot.web.alwaysOnTop ? "active" : "")}
                  type="button"
                  role="switch"
                  aria-checked={snapshot.web.alwaysOnTop === true}
                  aria-label="窗口置顶"
                  disabled={alwaysOnTopChanging}
                  onClick={() => void toggleAlwaysOnTop()}
                >
                  {alwaysOnTopChanging ? <CircleNotch className="spin" /> : <span />}
                </button>
              </div>
            ) : null}
            {snapshot?.web.desktop && snapshot.web.focusCodexAvailable ? (
              <div className="window-preference">
                <div className="window-preference-copy">
                  <OpenAiLogo weight={snapshot.web.focusCodexOnInput ? "fill" : "bold"} />
                  <span>
                    <strong>按键时置前 Codex</strong>
                    <small>{snapshot.web.focusCodexOnInput && !snapshot.web.accessibilityGranted
                      ? "等待“辅助功能”授权"
                      : "操作前恢复并切到 Codex"}</small>
                  </span>
                </div>
                <button
                  className={"toggle-button " + (snapshot.web.focusCodexOnInput ? "active" : "")}
                  type="button"
                  role="switch"
                  aria-checked={snapshot.web.focusCodexOnInput === true}
                  aria-label="按键时置前 Codex"
                  disabled={focusCodexChanging}
                  onClick={() => void toggleFocusCodexOnInput()}
                >
                  {focusCodexChanging ? <CircleNotch className="spin" /> : <span />}
                </button>
              </div>
            ) : null}
            <p className="settings-note"><WarningCircle weight="bold" />此页面不会构建、刷写或修改固件。Agent 1–6 的会话绑定由 Codex Desktop 完成。</p>
            <div className="modal-actions">
              {snapshot?.web.desktop ? (
                <button className="danger-button" type="button" onClick={() => void exitApp()} disabled={exiting}>
                  {exiting ? <CircleNotch className="spin" /> : <Power weight="bold" />}退出 App
                </button>
              ) : null}
              {snapshot?.web.desktop ? (
                <button className="secondary-button browser-button" type="button" onClick={() => void openBrowser()} disabled={browserOpening}>
                  {browserOpening ? <CircleNotch className="spin" /> : <Browser weight="bold" />}在浏览器打开
                </button>
              ) : null}
              <button className="secondary-button" type="button" onClick={() => void closeSettings()}>取消</button>
              <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={settingsSaving}>
                {settingsSaving ? <CircleNotch className="spin" /> : <Check weight="bold" />}保存
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <ViewportTooltip />
    </main>
  );
}
