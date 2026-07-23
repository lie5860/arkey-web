import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const main = source("firmware/esp32s3-codex-micro-lab/main/main.c");
const protocol = source("firmware/esp32s3-codex-micro-lab/main/micro_protocol.c");
const protocolHeader = source("firmware/esp32s3-codex-micro-lab/main/micro_protocol.h");
const component = source("firmware/esp32s3-codex-micro-lab/main/CMakeLists.txt");
const project = source("firmware/esp32s3-codex-micro-lab/CMakeLists.txt");
const defaults = source("firmware/esp32s3-codex-micro-lab/sdkconfig.defaults");
const manifest = source("firmware/esp32s3-codex-micro-lab/main/idf_component.yml");
const builder = source("scripts/build-codex-micro-esp32s3-lab.sh");

test("firmware and build metadata agree on version 0.2.1", () => {
  assert.match(main, /CM_FIRMWARE_VERSION "0\.2\.1-arkey-esp32s3-lab"/);
  assert.match(project, /set\(PROJECT_VER "0\.2\.1"\)/);
  assert.match(main, /"firmwareVersion", CM_FIRMWARE_VERSION/);
});

test("firmware carries control and HID over one native USB connection", () => {
  assert.match(main, /#include "tinyusb_cdc_acm\.h"/);
  assert.match(main, /TUD_HID_INOUT_DESCRIPTOR/);
  assert.match(main, /TUD_CDC_DESCRIPTOR/);
  assert.match(main, /tinyusb_cdcacm_read/);
  assert.match(main, /tinyusb_cdcacm_write_queue/);
  assert.match(main, /\.bDeviceClass = TUSB_CLASS_MISC/);
  assert.match(defaults, /CONFIG_TINYUSB_HID_COUNT=1/);
  assert.match(defaults, /CONFIG_TINYUSB_CDC_ENABLED=y/);
  assert.match(defaults, /CONFIG_TINYUSB_CDC_COUNT=1/);
  assert.doesNotMatch(main, /#include "driver\/uart\.h"|uart_driver_install|uart_read_bytes|uart_write_bytes/);
  assert.doesNotMatch(component, /esp_driver_uart/);
  assert.match(defaults, /CONFIG_ESP_CONSOLE_NONE=y/);
  assert.match(defaults, /CONFIG_ESPTOOLPY_FLASHSIZE_8MB=y/);
  assert.doesNotMatch(defaults, /CONFIG_ESP_CONSOLE_UART_DEFAULT=y/);
  assert.doesNotMatch(main, /fgets\s*\(\s*stdin|printf\s*\(|fflush\s*\(\s*stdout/);
});

test("firmware exposes the fixed Codex Micro HID plus allowlisted CDC controls", () => {
  assert.match(main, /#define CM_USB_VID 0x303A/);
  assert.match(main, /#define CM_USB_PID 0x8360/);
  assert.match(main, /TUD_HID_INOUT_DESCRIPTOR/);
  assert.match(protocolHeader, /#define CM_REPORT_ID 0x06/);
  assert.match(protocolHeader, /#define CM_REPORT_SIZE 64/);
  for (const key of ["AG%02d", "ACT06", "ACT07", "ACT08", "ACT09", "ACT10", "ACT12", "ENC_PRESS", "ENC_CW", "ENC_CC"]) {
    assert.match(protocol, new RegExp(key.replaceAll(".", "\\.")));
  }
  assert.match(protocol, /v\.oai\.rad/);
  assert.match(main, /desktop_not_connected/);
  assert.doesNotMatch(main, /system\(|popen\(|execv?\(/);
});

test("firmware build stays pinned, explicit, and compile-only", () => {
  assert.match(manifest, /idf: "6\.0\.1"/);
  assert.match(manifest, /version: "2\.2\.1"/);
  assert.match(manifest, /espressif\/cjson:\n\s+version: "1\.7\.19~2"/);
  assert.match(builder, /--acknowledge-device-identity-test/);
  assert.match(builder, /set-target esp32s3 build/);
  assert.doesNotMatch(builder, /idf\.py[^\n]*(?:flash|erase-flash)|esptool[^\n]*(?:write_flash|erase_flash)|dfu-util/);
});
