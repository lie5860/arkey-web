<p align="center">
  <img src="assets/arkey-logo.png" alt="Arkey logo" width="152">
</p>

<h1 align="center">Arkey</h1>

<p align="center">
  An unofficial, development-only Codex command surface with AgentGlow lighting for QMK keyboards.
</p>

Arkey 把一套 Micro 风格的实体工作流带到可改造的 QMK 键盘：六个 Agent Key、任务切换、发送、审批、拒绝、推理强度、Plan/Review、按住说话，以及会随任务状态变化的 AgentGlow RGB 光效。macOS 客户端通过本机 Codex CLI 的公开 App Server 接口管理任务；独立的 Arkey QMK bridge 负责实体键、旋钮和灯效。

> [!IMPORTANT]
> Arkey 是独立、非官方的社区开发项目，与 OpenAI、ChatGPT、Codex、Work Louder、Keychron 或 QMK 没有隶属、合作、赞助或背书关系。它不实现、不复制也不仿冒 Codex Micro 的私有设备协议、USB 身份、VID/PID 或第三方 SDK。Codex 接入依赖实验性的 `codex app-server`，接口可能随 Codex CLI 更新而变化。

> [!CAUTION]
> 本仓库公开源码，但整体不是 OSI 定义的开源项目。Arkey 自有客户端与工具仅按 PolyForm Noncommercial 1.0.0 提供给没有预期商业应用的非商业开发、研究和测试。QMK/Keychron 派生固件受 GPL/MIT 等上游许可约束，不能附加统一的非商业限制。详见[许可证](#许可证)。

## 它包含什么

- `apps/ArkeyMac`：macOS 14+ SwiftUI 客户端，含 Command Surface、六个任务槽、键盘映射、Composer、审批、语音输入、Light Lab 和菜单栏/刘海岛状态。
- `src`：Node 20+ 本地 daemon/CLI，启动官方 Codex App Server、管理任务/审批/模型状态，并把 AgentGlow 灯效同步到键盘。
- `firmware`：Keychron Q6 Pro ANSI Knob 的可复现 QMK 示例源码与只构建脚本。
- `profiles`：键盘矩阵、LED、几何、传输和效果目录的版本化数据。
- `test` 与 CI：host、协议边界、profile、运行时、Swift 客户端和 Q6 Pro 固件编译检查。

当前真实边界：Q6 Pro ANSI Knob 是唯一示例目标；完整控制只走 USB。蓝牙保持普通键盘输入，但没有 Raw HID 灯效/实体动作同步。其他 QMK 键盘需要按本文和移植指南完成适配，不能只复制一个 JSON 就宣称支持。

## 工作方式

```text
Arkey macOS app
  ├─ local RPC/events ──► Arkey Node daemon
  │                         ├─ stdio JSONL ──► codex app-server
  │                         └─ USB Raw HID ──► QMK firmware
  └─ task/binding UI                              ├─ physical controls
                                                  └─ AgentGlow RGB effects
```

两个接口边界彼此独立：

1. Codex 侧使用公开的 [`codex app-server`](https://developers.openai.com/codex/app-server/)；它负责登录、模型、thread/turn、流式事件和审批请求。
2. 键盘侧使用 [QMK Raw HID](https://docs.qmk.fm/features/rawhid/) 作为传输，并在其中承载公开、独立的 32-byte Arkey 消息格式。这个格式只属于 Arkey，不是 Codex Micro 协议。

完整组件、消息边界、持久化范围与 fail-open 设计见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 已验证范围

| 部分 | 发布门槛 | 当前声明 |
| --- | --- | --- |
| Node host/daemon | `npm run check` | 42 项测试通过并完成类型检查 |
| Codex 接口 | 生成当前安装版本的 App Server schema | 核心接口检查；Plan 是可选实验能力 |
| macOS 客户端 | Swift tests、release build、ad-hoc codesign | 12 项测试、release 构建与签名校验通过 |
| Q6 Pro 示例 | 固定 Keychron commit 的真实 QMK compile | 67,428-byte binary 编译与 DFU suffix 校验通过，未刷写 |
| Q6 Pro v2 实体链路 | 完整物理验收清单 | 下游开发者刷写后验收；不能仅凭 compile 称为硬件验证 |
| 其他 QMK 键盘 | profile + host + firmware + CI + 真机恢复测试 | 尚未支持，提供完整移植流程 |

## 快速开始：macOS 客户端

### 前置条件

- macOS 14 或更高版本；
- Xcode Command Line Tools / Swift 6 toolchain；
- Node.js 20 或更高版本；
- 已安装并可运行的 Codex CLI，且拥有可用的 Codex 登录；
- 如需实体灯效：刷入匹配 Arkey 示例或移植固件的 USB QMK 键盘。

先确认本机工具：

```bash
node --version
swift --version
codex --version
codex app-server --help
```

### 获取、检查和构建

```bash
git clone https://github.com/shuhari04/arkey.git
cd arkey

npm ci
npm run check
./scripts/check-codex-app-server.sh
swift test --package-path apps/ArkeyMac

./scripts/build-macos-app.sh
codesign --verify --deep --strict --verbose=2 build/Arkey.app
open build/Arkey.app
```

`build-macos-app.sh` 会构建 Node host 和 Swift release app，把运行时、profile、依赖及必要文档装入 `build/Arkey.app`，然后做 ad-hoc 签名。应用仍使用本机 Node 20+；当前构建不是完全自包含的 Node runtime 分发包。

首次使用：

1. 在 Onboarding 中确认 Codex、daemon 和键盘状态；未登录时按界面打开官方登录流程，或先运行 `codex login`。
2. 选择工作目录，新建 Agent Key 任务或显式导入已有 Codex thread。
3. 在 Command Surface 里选择动作，再点击或拖到实体键位；Q6 Pro 固件会先进入限时 capture，未绑定按键继续保持普通输入。
4. 在 Composer 发送任务，或用已绑定的 Agent Key、Approve、Decline、Send、PTT、Reasoning 等动作控制。
5. 用 Light Lab 预览灯效；关闭 daemon、USB 断开或心跳超时后，固件恢复原 RGB 状态。

CLI 也可单独使用：

```bash
npm link
arkey start
arkey status
arkey test
arkey restore
arkey stop
```

`npm link` 只用于开发者命令行；从 `build/Arkey.app` 启动时，应用会使用包内 host 并在需要时修复本地 LaunchAgent。

## Keychron Q6 Pro 示例固件

示例严格锁定：

- Keychron Q6 Pro ANSI Knob；
- QMK target `keychron/q6_pro/ansi_encoder`，keymap `via`；
- Keychron QMK commit `618127a725a1773e85f13455602cf6f72ab4de17`；
- STM32L432 / STM32 DFU；
- 保留原键盘身份 `3434:0660`，不模拟其他产品。

构建：

```bash
git clone --filter=blob:none --no-checkout \
  https://github.com/Keychron/qmk_firmware.git qmk_firmware
git -C qmk_firmware checkout 618127a725a1773e85f13455602cf6f72ab4de17
git -C qmk_firmware submodule update --init --recursive
python3 -m pip install -r qmk_firmware/requirements.txt
qmk config user.qmk_home="$PWD/qmk_firmware"

QMK_HOME="$PWD/qmk_firmware" ./scripts/build-q6-pro.sh
shasum -a 256 build/arkey-q6-pro-ansi-v0.1.0.bin
git -C qmk_firmware status --short
```

脚本会拒绝错误型号、错误 commit 和脏的目标文件；无论成功或失败都会恢复临时改动，且永远不会刷写。仓库不跟踪预编译 `.bin`，因为开发者应从固定源码生成、记录 SHA-256，并在自己的 PCB revision 上完成恢复预检。

刷写前的备份、DFU 确认、恢复边界、可选写入命令和完整物理验收见 [`docs/FIRMWARE.md`](docs/FIRMWARE.md)。不要让 agent 或脚本跳过这些门槛。

## 适配其他 QMK 键盘

先阅读 [`docs/PORTING_QMK.md`](docs/PORTING_QMK.md)。完整适配至少包括：

1. 核实准确型号、PCB revision、QMK target、MCU、bootloader、原 VID/PID 和官方恢复路径。
2. 核实 Raw HID、RGB Matrix、矩阵、`g_led_config`、LED 顺序、旋钮数量及 flash/RAM 余量。
3. 新增 profile 和 layout hash；不能伪造其他产品的 USB 身份。
4. 将 profile registry、runtime、contract generator 和 Swift layout 从 Q6 假设扩展到新板。
5. 添加可逆 QMK patch/userspace、固定 commit 的 build-only 脚本和上游许可记录。
6. 增加 host、profile、protocol、firmware、Swift 与 CI 测试。
7. 在干净 QMK tree 编译，确认退出后 tree 仍干净。
8. 完成普通输入、层、旋钮、VIA、RGB、重连、watchdog、蓝牙降级和官方恢复测试后，才可标为 supported。

当前 bridge 的硬限制包括单旋钮、最多 255 个 LED、128 个矩阵绑定位置及 32-byte report。超出限制需要做版本化的 host/firmware 协同升级，不能静默截断。

## 不写代码，也可以让 agent 完成适配

适合有硬件/QMK 使用经验但不熟悉代码的开发者。建议把工作拆成四个独立阶段，每阶段检查结果后再继续。让 agent 先阅读根目录 [`AGENTS.md`](AGENTS.md)。

### 1. 只读兼容性审计

```text
请先只读检查这把键盘是否能适配 Arkey。核实准确型号、布局和 PCB
revision、上游仓库与 QMK target、MCU、bootloader、原 VID/PID、Raw HID、
RGB Matrix、矩阵、g_led_config/LED 映射、旋钮、固件空间和官方恢复路径。
不要修改文件、不要编译、不要刷写、不要进入 DFU。输出每项证据、缺失
信息、风险，以及是否允许进入实现阶段。不得引入 Codex Micro 私有协议或
任何第三方 USB 身份。
```

### 2. 在新分支实现

```text
根据已确认的兼容性审计，在 codex/<board>-arkey-port 新分支完成适配。
同时实现 profile、layout hash、host registry/runtime、board contract、可逆
QMK 集成、build-only 脚本、测试、CI、UPSTREAM/恢复文档。保留未绑定按键
普通输入与 watchdog fail-open。不要刷写。完成后列出全部文件、许可证、
测试结果、仍未验证的硬件边界和回滚方法。
```

### 3. 只构建并审计产物

```text
只在干净且固定 commit 的 QMK tree 中构建，不刷写。先验证型号、target、
MCU、bootloader 和 VID/PID guard；构建后报告 binary 路径、大小、SHA-256、
编译器/QMK commit，并证明成功或失败后上游 worktree 都保持干净。任何 guard
不匹配都必须停止，不能用 allow-untested 变量绕过。
```

### 4. 刷写前预检

```text
只做刷写预检，不写入设备。逐项确认 PCB revision、VIA 备份、匹配的官方
恢复固件、第二把键盘、binary SHA-256、DFU 设备与 alt setting、内存地址和
物理验收表。缺一项就停止。即使全部通过，也必须在实际写入命令前再次向我
请求明确确认，不能自动进入 DFU 或自动运行 dfu-util/qmk flash。
```

agent 的输出仍需由人审核。尤其不要把 compile-only 结果写成 hardware verified。

## 隐私与安全

- Arkey 在 `~/.arkey` 保存运行设置、绑定、task/thread ID、标题和必要状态；不主动持久化 prompt、回复正文或麦克风音频。
- Codex 认证与会话仍由本机 Codex CLI 管理；Arkey 不复制 access token。
- App Server 仅通过子进程 stdio 使用，不开放网络端口。
- Codex/OpenAI 服务自身的数据处理由你的账户和服务条款决定，Arkey 不对此作额外保证。
- 所有 firmware 脚本默认只构建；安全问题请按 [`SECURITY.md`](SECURITY.md) 私下报告。

## 贡献

欢迎修复、测试、文档改进和新键盘适配。请先阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)：新键盘 PR 必须同时提供精确硬件证据、固定上游 commit、profile、可复现源码、恢复方案、测试和真机边界；不接受 binary-only、私有协议、第三方身份仿冒或开发过程报告。

## 许可证

本仓库采用路径分层许可：

- 自有 macOS 客户端、Node host、脚本、profile、测试和文档：[`PolyForm-Noncommercial-1.0.0`](LICENSES/PolyForm-Noncommercial-1.0.0.txt)，仅限许可条款定义的非商业用途。
- 修改 Keychron/QMK GPL 文件的 patch：[`GPL-2.0-only`](LICENSES/GPL-2.0-only.txt)。
- 带 MIT SPDX header 的独立 Arkey QMK module：[`MIT`](LICENSES/MIT.txt)。
- 第三方依赖：保留其上游许可，见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
- Arkey 名称与 Logo：不随软件许可授权，见 [`TRADEMARKS.md`](TRADEMARKS.md)。

这意味着：完整的 Arkey 自有客户端不能在 PolyForm 许可之外二次商用；但 GPL/MIT 固件部分依法可能被商业使用，不能用根目录的非商业条款覆盖。由于非商业限制不符合 [OSI Open Source Definition](https://opensource.org/osd)，项目准确称为 **public source / source-available**，而不是单一 OSI 开源作品。如需商业授权，应先取得权利人的单独书面许可。精确条款优先；本说明不构成法律意见。

## 参考

- [Codex App Server 官方文档](https://developers.openai.com/codex/app-server/)
- [OpenAI Codex 开源组件](https://github.com/openai/codex)
- [QMK Raw HID](https://docs.qmk.fm/features/rawhid/)
- [Keychron QMK firmware](https://github.com/Keychron/qmk_firmware)
- [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
