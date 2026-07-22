# ESP32-S3 firmware build and write guide

## Supported laboratory board

当前真机是：

- PCB：`YD-ESP32-23 2022-V1.3`
- module：`ESP32-S3-N8R8`
- flash：8 MB
- PSRAM：8 MB
- USB-UART：CH343P（板上 COM 口）
- native USB：ESP32-S3 USB 口

COM 口用于构建后的写入和 Web UART；native USB 口用于 Codex Desktop HID。两个口同时供电的长期电气安全尚未由权威原理图或测量确认。短时工作成功不等于可以长期双 VBUS 供电；优先使用确认断开 VBUS 的数据方案或完成电气核对。

## Non-negotiable preflight

写入前必须全部满足：

1. 精确识别板型、串口和 8 MB flash。
2. Secure Boot 与 Flash Encryption 均未启用。
3. 已读取完整 `0x000000–0x7fffff` 备份，并记录文件大小与 SHA-256。
4. 已知道 BOOT + RST 进入下载模式的方法，且能在另一台机器恢复。
5. 本轮写入前获得用户新的明确确认。

不要在脚本中自动执行 erase、flash 或 restore。

## Read-only identification and backup

先激活 ESP-IDF `6.0.1`，然后把下面路径替换为实际 COM 端口和单独的备份目录：

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

## Build 0.1.6

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

`image-info` 的应用版本必须是 `0.1.6`。源码中的 USB 返回版本必须是 `0.1.6-arkey-esp32s3-lab`。如果两者不一致，停止写入。

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

1. RST 后 COM 口重新枚举。
2. native USB 枚举为本实验设备，Codex Desktop 完成握手。
3. Web 设置页显示 `0.1.6-arkey-esp32s3-lab`。
4. 连续执行至少 50 组 Agent 按下/弹起，ACK 不应出现 2 秒超时。
5. 六个 Agent、六个命令、旋钮和四向摇杆逐项验证。
6. 分别断开 UART 和 native USB，确认 Web 降级为离线且进程不崩溃。
7. 保存构建产物 SHA-256、测试次数和 Desktop 版本；不要记录会话 ID 或内容。

只有这些项目实际通过后，才能把 `0.1.6` 标记为真机验证。

## Recovery

如果新固件无法启动，进入下载模式后用已记录的备份恢复整片 flash：

```bash
export ARKEY_SERIAL_PORT=/dev/cu.usbmodem-example
export ARKEY_BACKUP_FILE=/absolute/path/to/factory-flash-8mb.bin

shasum -a 256 "$ARKEY_BACKUP_FILE"
esptool.py --chip esp32s3 --port "$ARKEY_SERIAL_PORT" write-flash 0x0 "$ARKEY_BACKUP_FILE"
```

恢复也是硬件写入，执行前同样需要明确确认。恢复后重新读取并比对 flash，不能只根据 LED 亮起判断成功。
