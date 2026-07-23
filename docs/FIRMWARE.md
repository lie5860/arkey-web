# ESP32-S3 firmware build and write guide

## Supported laboratory board

当前真机是：

- PCB：`YD-ESP32-23 2022-V1.3`
- module：`ESP32-S3-N8R8`
- flash：8 MB
- PSRAM：8 MB
- USB-UART：CH343P（板上 COM 口）
- native USB：ESP32-S3 USB 口

COM 口只用于构建后的手动写入和恢复；日常运行时断开 COM 口，只连接 native USB。native USB 会同时枚举 Codex Desktop 使用的 HID 接口和 Web bridge 使用的 CDC 控制接口，因此运行时只需一根线。

两个口同时供电的长期电气安全尚未由权威原理图或测量确认。写入时优先断开 native USB，只连接 COM；写入完成后断开 COM，再连接 native USB。短时工作成功不等于可以长期双 VBUS 供电。

## Non-negotiable preflight

写入前必须全部满足：

1. 精确识别板型、串口和 8 MB flash。
2. Secure Boot 与 Flash Encryption 均未启用。
3. 已有一份从该开发板读取、确认可正常工作的完整 `0x000000–0x7fffff` known-good 备份，并再次核对文件大小与 SHA-256。只在首次建立基线、备份丢失/损坏或硬件更换时重新读取整片 Flash，不要求每次写入前重复备份。
4. 已知道 BOOT + RST 进入下载模式的方法，且能在另一台机器恢复。
5. 本轮写入前获得用户新的明确确认。

不要在脚本中自动执行 erase、flash 或 restore。

## Read-only identification and baseline backup

首次为开发板建立 known-good 基线、备份丢失/损坏或更换硬件时，先激活 ESP-IDF `6.0.1`，然后把下面路径替换为实际 COM 端口和单独的备份目录：

```bash
export ARKEY_SERIAL_PORT=/dev/cu.usbmodem-example
export ARKEY_BACKUP_FILE=/absolute/path/to/factory-flash-8mb.bin

esptool.py --chip esp32s3 --port "$ARKEY_SERIAL_PORT" flash-id
espefuse.py --chip esp32s3 --port "$ARKEY_SERIAL_PORT" summary
esptool.py --chip esp32s3 --port "$ARKEY_SERIAL_PORT" read-flash 0x0 0x800000 "$ARKEY_BACKUP_FILE"
wc -c "$ARKEY_BACKUP_FILE"
shasum -a 256 "$ARKEY_BACKUP_FILE"
```

预期备份大小是 `8388608` bytes。不要把备份提交到 Git。

后续写入不重复读取整片 Flash，但必须在写入前重新核对现有 known-good 备份：

```bash
export ARKEY_BACKUP_FILE=/absolute/path/to/known-good-flash-8mb.bin

wc -c "$ARKEY_BACKUP_FILE"
shasum -a 256 "$ARKEY_BACKUP_FILE"
```

文件大小必须仍为 `8388608` bytes，SHA-256 必须与首次建立基线时记录的值一致；不一致则停止写入并重新建立可恢复的基线备份。

## Build 0.2.1

```bash
npm ci
npm run firmware:test
npm run firmware:build
```

构建需要：

- ESP-IDF `6.0.1`
- `espressif/esp_tinyusb` `2.2.1`
- `espressif/cjson` `1.7.19~2`

脚本只构建。完成后核对：

```bash
shasum -a 256 build/esp32s3-codex-micro-lab/arkey_esp32s3_codex_micro_lab.bin
esptool.py --chip esp32s3 image-info build/esp32s3-codex-micro-lab/arkey_esp32s3_codex_micro_lab.bin
```

`image-info` 的应用版本必须是 `0.2.1`。源码中的 USB 返回版本必须是 `0.2.1-arkey-esp32s3-lab`。如果两者不一致，停止写入。

## Manual write

只有完成 preflight 并在当次操作前再次确认后，才在可见终端中执行：

```bash
export ARKEY_SERIAL_PORT=/dev/cu.usbmodem-example
idf.py \
  -C firmware/esp32s3-codex-micro-lab \
  -B build/esp32s3-codex-micro-lab \
  -p "$ARKEY_SERIAL_PORT" \
  flash
```

这会写入 bootloader、partition table 和 application。不要加入 `erase-flash`，除非已经单独诊断并再次确认需要清空整片 flash。

## Post-write acceptance

1. RST 后确认写入完成，然后断开 COM 线。
2. 只连接 native USB，确认系统同时枚举本实验 HID 和一个 CDC 控制端口。
3. Codex Desktop 完成 HID 握手，Web 设置页显示 `0.2.1-arkey-esp32s3-lab`。
4. 连续执行至少 50 组 Agent 按下/弹起，ACK 不应出现 2 秒超时。
5. 六个 Agent、六个命令、旋钮和四向摇杆逐项验证。
6. 断开这一根 native USB，确认 HID 和 Web 同时降级为离线且进程不崩溃；重新连接后应恢复。
7. 保存构建产物 SHA-256、测试次数和 Desktop 版本；不要记录会话 ID 或内容。

复合描述符保留实验 VID/PID 和 HID report，但新增 CDC 接口、IAD device class 和两个接口号。Codex Desktop 是否仍接受该组合必须通过上述真机步骤验证；失败时用 COM 口恢复备份。只有这些项目实际通过后，才能把 `0.2.1` 标记为真机验证。

## Recovery

如果新固件无法启动，进入下载模式后用已记录的备份恢复整片 flash：

```bash
export ARKEY_SERIAL_PORT=/dev/cu.usbmodem-example
export ARKEY_BACKUP_FILE=/absolute/path/to/factory-flash-8mb.bin

shasum -a 256 "$ARKEY_BACKUP_FILE"
esptool.py --chip esp32s3 --port "$ARKEY_SERIAL_PORT" write-flash 0x0 "$ARKEY_BACKUP_FILE"
```

恢复也是硬件写入，执行前同样需要明确确认。恢复后重新读取并比对 flash，不能只根据 LED 亮起判断成功。
