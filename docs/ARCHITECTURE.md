# Architecture

Arkey Web 只有一条运行链路：

```text
React control surface
        │ loopback HTTP, fixed semantic allowlist
        ▼
Node bridge on 127.0.0.1:4765
        │ JSONL over user-selected USB-UART
        ▼
ESP32-S3 firmware
        │ native USB HID report 0x06
        ▼
Codex Desktop
```

Codex Desktop 返回的六槽颜色、亮度和灯效沿反方向送到 Web。固件和 Node 都只处理固定控制名、连接状态以及脱敏灯光参数，不传递 thread ID、turn ID、消息内容、token 或账号数据。

## Component boundaries

### Web

`apps/ArkeyWeb` 模拟实体控制面，不实现会话管理。按键只有按下和弹起反馈，没有持续选中态。窗口失焦、指针取消或页面隐藏时，会为仍按下的控制发送释放事件。

设置页只选择串口并显示四项信息：UART、native USB、Desktop 握手和固件版本。

### Local bridge

`src/webserver.ts` 只监听 `127.0.0.1`。写请求要求精确 loopback Origin 和 HttpOnly SameSite session cookie。HTTP API 只有：

- `GET /api/snapshot`
- `GET /api/hardware/ports`
- `POST /api/hardware/event`
- `POST /api/settings`

`src/microbridge.ts` 使用 `serialport`，只允许预定义控制和 `down` / `up` / `tap`。每条命令带 sequence；若 ACK 丢失，Node 使用相同 sequence 重发一次，固件的 replay cache 防止重复 HID 事件。

### Firmware

固件用 UART0 GPIO43/44、115200 8N1。`0.1.6` 禁用 ESP-IDF UART console，并通过 `esp_driver_uart` 安装 2048-byte RX/TX 缓冲。RX 任务逐行解析有界 JSON；TX 只由一个高优先级任务写入，ACK 进入优先队列。HID 处理保持在较低优先级，避免 USB 工作饿死 UART 应答。

native USB 只暴露固定 report `0x06`。Web 输入只有在 USB 已枚举且 Desktop 已完成握手后才会进入 HID 队列。

## Stored data

唯一的应用设置是 `~/.arkey/web-settings-v1.json`：

```json
{
  "version": 1,
  "microBridgePort": "/dev/cu.usbmodem-example"
}
```

不存储 Codex 会话、消息、凭据或硬件序列号。

## Future Rust launcher

Rust 应用应同时承担固定 WebView 窗口、静态资源服务和串口桥，之后才能删除 Node。仅用 Rust 打开 `http://127.0.0.1:4765` 仍然需要 Node 服务，不算完成替换。
