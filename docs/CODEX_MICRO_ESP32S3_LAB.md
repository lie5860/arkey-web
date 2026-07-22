# ESP32-S3 Codex Micro Hardware Lab

This is an isolated, unofficial, development-only interoperability path. It is
not an OpenAI or Work Louder SDK, product, authorization, or supported Codex
API. The firmware temporarily presents the USB identity and native-facing HID
behavior observed by this repository's existing Codex Micro Lab. Do not sell or
distribute a programmed board as a Codex Micro device. The behavior is
version-sensitive and may stop working after a ChatGPT Desktop update.

Current status: **hardware smoke-tested, not fully accepted**. Firmware `0.1.4`
completed the Web-to-UART-to-HID main flow on a `YD-ESP32-23 2022-V1.3` board
with an `ESP32-S3-N8R8` module and CH343P USB-UART bridge. Firmware `0.1.5`
adds reliability changes that remain build-tested only until a separately
approved write. Dual-port VBUS safety and the complete control matrix still
require physical acceptance before this board can be called supported.

## Purpose and boundaries

This Lab replaces only the fixed keyboard electronics, not Codex Desktop:

```text
localhost Web keyboard
        │ semantic press/release commands, JSONL at 115200 baud
        ▼
ESP32-S3 USB-UART console
        │
        ├── fixed control allowlist; no arbitrary HID JSON injection
        │
        ▼
ESP32-S3 native USB device port
        │ report 0x06, 64-byte vendor HID IN/OUT
        ▼
ChatGPT Desktop / Codex Micro integration
        │ thread light updates
        └──────── sanitized six-slot lights ───────► Web keyboard
```

The Web hardware mode does not launch `codex app-server`, create Arkey task
records, or bind Codex threads itself. Agent 1–6 bindings remain owned by the
Codex Micro interface in ChatGPT Desktop. A Web Agent key emits the same fixed
press and release messages as the Lab keyboard; the six Web lights display
only the color/brightness/effect fields returned by `v.oai.thstatus`. The bridge
does not forward thread IDs, turn IDs, prompts, replies, approval payloads, or
credentials to the browser.

The normal App Server mode remains available as a separate setting. The two
modes must not be blended or described as the same protocol.

## USB compatibility surface

The native USB port exposes one full-speed vendor HID interface:

- VID/PID: `303A:8360`;
- device version: `0x0100`;
- manufacturer string: `Work Louder`;
- report ID: `0x06`;
- usage page/usage: `0xFF00` / `0x61`;
- 63-byte input and output payloads, 64 bytes including the report ID;
- separate interrupt OUT `0x01` and IN `0x81` endpoints.

The firmware handles `sys.version`, `device.status`, `v.oai.thstatus`, and
`v.oai.rgbcfg`. It refuses Web input until native USB is mounted and a valid
host request has completed the Desktop-facing handshake. No private SDK,
captured application binary, authentication secret, challenge bypass, QMK
firmware, report `0x07`, matrix mapping, EEPROM mapping, or automatic updater is
included.

The Web-to-UART control allowlist is fixed to:

- Agent 1–6: `AG00` through `AG05`;
- Fast, Approve, Decline, Continue, PTT, Send: `ACT06`, `ACT07`, `ACT08`,
  `ACT09`, `ACT10`, `ACT12`;
- reasoning press and rotation: `ENC_PRESS`, `ENC_CW`, `ENC_CC`;
- joystick up/right/down/left: angles `90`, `0`, `270`, `180`.

Each button has physical down/up semantics. Encoder rotation is a momentary
`act: 2` event. The bridge does not accept a raw `method`, raw JSON-RPC payload,
USB descriptor change, flash request, shell command, or arbitrary key name.

UART commands carry a monotonically increasing sequence. The firmware records
the last 16 successfully queued inputs: an identical retry returns the original
success without emitting a second HID event, while reuse of the sequence for a
different control is rejected. ACK lines use a priority UART queue. The Node
bridge retries one missing ACK after 250 ms with the same sequence, and the Web
client releases every held control on pointer cancellation, window blur, or
page hiding.

## Reproducible build

The project pins ESP-IDF `6.0.1`, `espressif/esp_tinyusb` `2.2.1`, and the
managed `espressif/cjson` component `1.7.19~2`. Activate a matching ESP-IDF
environment, then run:

```bash
npm run codex-micro-esp32s3-lab:test
./scripts/build-codex-micro-esp32s3-lab.sh --acknowledge-device-identity-test
```

The first command compiles and runs the portable C framing/control tests with
the host compiler. The second runs only `idf.py set-target esp32s3 build` into
`build/esp32s3-codex-micro-lab`. It does not open a serial port, enter a
bootloader, erase flash, or write firmware. Generated binaries stay below the
ignored `build/` directory and must not be committed or distributed.

No install, erase, write, monitor, or recovery command is intentionally
provided in this phase. Adding a hardware-write procedure requires a separate
recovery preflight and fresh user confirmation immediately before the write.

## Web configuration

In Web settings, select **ESP32-S3 原生硬件**, then choose the board's
USB-UART serial device. Arkey stores only the selected serial path in
`~/.arkey/web-settings-v1.json`. It never auto-selects a port and does not use a
USB serial number as an identifier.

The status sequence is:

1. `BRIDGE READY`: the selected USB-UART port is open and acknowledged `hello`;
2. `USB 已枚举`: the ESP32-S3 native USB device is mounted by the Mac;
3. `Codex Desktop 握手完成`: a valid native request was received;
4. Agent lights update only after `v.oai.thstatus` arrives.

Before step 3, every Web key is disabled. Disconnecting either port marks the
bridge offline and clears the Desktop-connected state; it does not fall back to
App Server automatically.

## Recorded physical preflight

The 2026-07-22 smoke run recorded:

1. `YD-ESP32-23 2022-V1.3`, module `ESP32-S3-N8R8`, 8 MB flash and 8 MB PSRAM;
2. CH343P USB-UART connector and a separate native ESP32-S3 USB connector;
3. ESP32-S3 revision 0.2 with Secure Boot and Flash Encryption disabled;
4. an 8,388,608-byte pre-write flash backup with a separately recorded SHA-256;
5. successful write verification, UART boot, `303A:8360` enumeration, Desktop
   handshake, six sanitized slot lights, and Agent 1/2 press/release switching.

The board's closed-looking `USB-OTG` solder bridge may connect both connector
VBUS rails. No authoritative schematic or electrical measurement has yet
established that two ordinary powered cables are safe for continuous use. The
factory backup has been validated but a restore has not been performed.

## Hardware acceptance after a separately approved write

Full acceptance still requires:

- USB descriptor, HID report descriptor, IN/OUT endpoint sizes, detach/reconnect;
- complete multi-report `device.status` after the `0.1.5` completion-wait fix;
- press and release for all six Agent keys and six Command keys;
- encoder press/CW/CCW and four joystick directions;
- Web reconnect after unplugging only UART and only native USB;
- no crash when Desktop is closed, logged out, or does not recognize the device;
- successful recovery to a known bootloader/factory state.

Only those observed items may be called hardware-verified. ChatGPT Desktop UI
behavior, action assignments, and light effect meanings must be recorded by
version rather than assumed stable.
