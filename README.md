# Arkey Web

Arkey Web 用一个本机 Web 控制面和 ESP32-S3 开发板复现 Codex Micro 的固定实体输入链路：

```text
Web 按键 → localhost Node 串口桥 → ESP32-S3 UART0
         → ESP32-S3 native USB HID → Codex Desktop

Codex Desktop → ESP32-S3 native USB HID → 六槽灯光状态 → Web
```

当前固件版本是 `0.1.6-arkey-esp32s3-lab`。这次版本把不稳定的 `stdin/stdout` 控制台传输替换为固件独占的、带 RX/TX 缓冲的 UART0 驱动。

## 项目来源与致谢

Arkey Web 是基于 [shuhari04/arkey](https://github.com/shuhari04/arkey) 继续开发的派生项目，并非从零开始。感谢原作者公开 Arkey 以及其中的 Codex Micro Lab 研究与实现；本项目继承并改造了上游对当前 Codex Micro 实验兼容面的理解，包括 native HID report、固定控制语义和六个 Agent 槽位状态。

本分支将上游的 QMK/Keychron 实验路径改造成独立 ESP32-S3 开发板，并用 React Web 控制面和本机 Node 串口桥取代原来的 macOS 客户端与 App Server 主链路。为保持项目目标清晰，当前仓库不再包含上游的 QMK 固件、Swift 客户端或 Codex App Server daemon；需要这些能力时，请直接查看[原始 Arkey 项目](https://github.com/shuhari04/arkey)。详细继承边界和许可说明见[第三方通知](docs/legal/THIRD_PARTY_NOTICES.md)。

> [!WARNING]
> 本项目是非官方、仅用于自有硬件互操作研究的实验。固件会呈现当前实验观察到的 USB 身份和 HID 行为；它不是 OpenAI 或 Work Louder 支持的接口，Desktop 更新后可能失效。不要销售或把写入该固件的设备描述成官方 Codex Micro。

## 仓库范围

- `firmware/esp32s3-codex-micro-lab`：ESP32-S3 固件源码、协议测试和固定依赖。
- `scripts/build-codex-micro-esp32s3-lab.sh`：只构建固件，不打开串口、不刷写。
- `scripts/test-codex-micro-esp32s3-protocol.sh`：本机 C 协议测试。
- `src/microbridge.ts`：Web 与开发板之间的最小 USB-UART 桥。
- `src/webserver.ts`：只监听 `127.0.0.1` 的静态服务和硬件 API。
- `apps/ArkeyWeb`：只有实体键盘控制面与串口设置。
- `docs/ARCHITECTURE.md`：当前 Web、Node、UART 与 native USB 的组件边界。
- `docs/FIRMWARE.md`：备份、构建、版本核对、手动写入和恢复说明。

仓库不再包含 QMK、Keychron 固件、Codex App Server daemon、macOS Swift 客户端、Virtual Lab 或 GitHub CI。

## 启动 Web

要求 Node.js 20 或更高版本。`npm run check` 还需要系统提供 C11 编译器（`cc`；macOS 可通过 Xcode Command Line Tools 安装）：

```bash
npm ci
npm run check
npm run web
```

打开 <http://127.0.0.1:4765>，点击左下角状态键，在设置中选择开发板的 COM / USB-UART 端口。Web 不自动选择串口，也不会调用任何刷写命令。

主界面只有真实硬件语义：按钮按下时发送 `down`，弹起时发送 `up`；旋钮滚动发送 CW/CCW；摇杆发送四个固定方向。Agent 1–6 的会话绑定发生在 Codex Desktop 的 Codex Micro 设置里，Web 不读取线程、消息、凭据或会话 ID。

设置保存在 `~/.arkey/web-settings-v1.json`。启动时能只读提取旧格式中的 `microBridgePort`，不会因为迁移而自动覆盖已有文件；只有用户点击“保存”才写入新的最小设置。

## 构建固件

要求 ESP-IDF `6.0.1`：

```bash
npm run firmware:test
npm run firmware:build
```

构建脚本要求显式确认实验身份，但仍然只执行 `set-target esp32s3 build`。产物位于 `build/esp32s3-codex-micro-lab/`，不会被 Git 跟踪。

任何硬件写入都必须先完成恢复预检，并在写入前获得一次新的明确确认。详细步骤见 [固件说明](docs/FIRMWARE.md)。

## Rust 桌面外壳边界

未来 Rust 应用可以提供固定窗口和内置 Web 资源，但不能只打开网页后就删除本地桥：普通浏览器/WKWebView 不能在所有目标环境中可靠独占 USB-UART。合理的替换关系是：

```text
现在：React Web + Node localhost/serialport
未来：React Web + Rust WebView + Rust serial port bridge
```

Rust 版本完成并验证以前，最小 Node 桥属于运行必需部分。

## 许可

项目是独立、非官方、非商业用途的实验。根目录代码按 [PolyForm Noncommercial 1.0.0](LICENSE) 提供；固件文件保留其 SPDX 文件级许可。上游及第三方通知见[第三方通知](docs/legal/THIRD_PARTY_NOTICES.md)，名称使用边界见[商标说明](docs/legal/TRADEMARKS.md)。参与开发前请阅读[贡献指南](docs/CONTRIBUTING.md)；安全问题请按[安全策略](docs/SECURITY.md)报告。

## 社区致谢

Learn AI on LinuxDO — [LinuxDO](https://linux.do/)
