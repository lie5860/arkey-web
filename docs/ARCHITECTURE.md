# Architecture

Arkey 有两种本机入口，它们共享同一个 React 控制面和 UART 语义：

```text
Tauri desktop                         Browser
      │                                  │
      ▼                                  ▼
Rust localhost + serial bridge       Node localhost + serial bridge
      │                                  │
      └──────── JSONL / USB-UART ────────┘
                         │
                         ▼
ESP32-S3 firmware
        │ native USB HID report 0x06
        ▼
Codex Desktop
```

Codex Desktop 返回的六槽颜色、亮度和灯效沿反方向送到 Web。固件、Rust 和 Node 都只处理固定控制名、连接状态以及脱敏灯光参数，不传递 thread ID、turn ID、消息内容、token 或账号数据。

## Component boundaries

### Web

`apps/ArkeyWeb` 模拟实体控制面，不实现会话管理。按键只有按下和弹起反馈，没有持续选中态。窗口失焦、指针取消或页面隐藏时，会为仍按下的控制发送释放事件。

设置页可以选择串口、控制桌面窗口置顶，并显示四项信息：UART、native USB、Desktop 握手和固件版本。macOS 桌面会话还可以开启“按键时置前 Codex”；此项默认关闭，浏览器会话不显示开关。

### Tauri desktop

`apps/ArkeyWeb/src-tauri` 是桌面运行链路。启动时它会：

1. 在 `127.0.0.1:0` 上取得一个随机空闲端口。
2. 生成一次性 256-bit 启动令牌和独立的 256-bit 会话令牌。
3. 用一次性路径启动 WebView，换取 HttpOnly SameSite 会话 Cookie 后立即使启动令牌失效。
4. 从 Tauri 内置资源解析器提供 Web 文件，并在 Rust 内完成串口枚举、连接、JSONL 解析和 ACK 重试。

静态资源和全部 API 都要求会话；写请求还要求精确的随机 localhost Origin。Tauri 窗口没有 IPC 权限，导航也被限制在本次随机 localhost Origin；拖动、设置与硬件操作都走认证后的 localhost API。会话 Cookie 名包含随机端口，避免与固定端口的 Node 服务或另一个 App 实例互相覆盖。

设置中的“在浏览器打开”会创建另一组一次性启动令牌和浏览器会话，然后打开同一个随机 localhost Origin。浏览器会话可以使用静态资源和硬件 API，但不能调整 Tauri 窗口或继续派生浏览器会话。所有客户端共享进程内唯一的 `Arc<Bridge>`；串口只有一个 owner，命令在桥线程中串行执行。Tauri 单实例插件阻止第二个桌面进程再创建 bridge，并在重复启动时聚焦已有窗口。

默认内容区是 288×285，原生窗口关闭装饰、阴影并启用透明 WebView，键盘外侧留白是拖动区。打开设置时 Rust 记录物理位置和内容尺寸并居中展开；关闭设置时恢复记录的几何信息。置顶状态由 Rust 原生窗口 API 控制并随设置持久化；退出入口也只在桌面设置页出现。

macOS 上开启 Codex 置前开关时，Rust 用 `AXIsProcessTrustedWithOptions` 触发一次系统辅助功能授权提示，但不会在启动时主动弹窗。开关可在授权完成前保存；之后的状态轮询只检查权限而不再弹窗。每个通过 allowlist 验证的 `down` 或 `tap` 输入会先尝试取消 Codex 主窗口的最小化状态并激活 `com.openai.codex`，然后照常进入 UART bridge。置前失败是 best-effort，不改变或阻塞硬件事件。

### Browser bridge

`src/webserver.ts` 只监听 `127.0.0.1`。写请求要求精确 loopback Origin 和 HttpOnly SameSite session cookie。HTTP API 只有：

- `GET /api/snapshot`
- `GET /api/hardware/ports`
- `POST /api/hardware/event`
- `POST /api/settings`
- `POST /api/window/settings`（浏览器版为空操作，桌面版负责窗口几何）
- `POST /api/window/always-on-top`（仅桌面会话可调整原生窗口置顶状态）
- `POST /api/codex/focus-on-input`（仅 macOS 桌面会话可调整，开启时触发辅助功能授权提示）
- `POST /api/window/start-dragging`（仅桌面会话可从键盘外壳或按键缝隙开始原生拖动）
- `POST /api/app/exit`（仅桌面会话可退出 App）
- `POST /api/browser/open`（仅 Tauri 桌面会话可用）

`src/microbridge.ts` 使用 `serialport`，只允许预定义控制和 `down` / `up` / `tap`。每条命令带 sequence；若 ACK 丢失，Node 使用相同 sequence 重发一次，固件的 replay cache 防止重复 HID 事件。

桌面和浏览器 bridge 启动时优先连接已保存端口。该端口失败或未配置时，只枚举 USB 串口并发送固定 `hello`，以带相同 sequence 的成功 ACK 作为识别条件；仅有一个匹配设备时自动采用，多个匹配时要求用户选择。

### Firmware

固件用 UART0 GPIO43/44、115200 8N1。`0.1.6` 禁用 ESP-IDF UART console，并通过 `esp_driver_uart` 安装 2048-byte RX/TX 缓冲。RX 任务逐行解析有界 JSON；TX 只由一个高优先级任务写入，ACK 进入优先队列。HID 处理保持在较低优先级，避免 USB 工作饿死 UART 应答。

native USB 只暴露固定 report `0x06`。Web 输入只有在 USB 已枚举且 Desktop 已完成握手后才会进入 HID 队列。

## Stored data

应用设置保存在 `~/.arkey/web-settings-v1.json`：

```json
{
  "version": 1,
  "microBridgePort": "/dev/cu.usbmodem-example",
  "alwaysOnTop": true,
  "focusCodexOnInput": false
}
```

不存储 Codex 会话、消息、凭据或硬件序列号。`alwaysOnTop` 仅控制 Tauri 桌面窗口；`focusCodexOnInput` 只保存布尔偏好，macOS 的授权状态仍由系统管理。Node 浏览器 bridge 读取并保留两个桌面偏好，但不能调整它们。

## Runtime ownership

Tauri 桌面版不启动 Node，也不打开固定的 `127.0.0.1:4765`。Node 代码只服务显式的 `npm run web` 独立浏览器工作流；删除它会同时删除无桌面 App 时的浏览器入口，因此目前保留。两个独立 bridge 不能保证共享一个串口；App 与浏览器并用时必须从 App 内创建浏览器会话。
