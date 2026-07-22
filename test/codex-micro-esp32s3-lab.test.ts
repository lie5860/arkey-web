import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../../firmware/esp32s3-codex-micro-lab/main/main.c", import.meta.url), "utf8");
const protocol = readFileSync(new URL("../../firmware/esp32s3-codex-micro-lab/main/micro_protocol.c", import.meta.url), "utf8");
const protocolHeader = readFileSync(new URL("../../firmware/esp32s3-codex-micro-lab/main/micro_protocol.h", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../../firmware/esp32s3-codex-micro-lab/main/idf_component.yml", import.meta.url), "utf8");
const builder = readFileSync(new URL("../../scripts/build-codex-micro-esp32s3-lab.sh", import.meta.url), "utf8");
const npmIgnore = readFileSync(new URL("../../.npmignore", import.meta.url), "utf8");
const packageDocument = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { files?: string[] };

test("ESP32-S3 lab exposes the observed Codex Micro USB identity and bidirectional report", () => {
  assert.match(main, /#define CM_USB_VID 0x303A/);
  assert.match(main, /#define CM_USB_PID 0x8360/);
  assert.match(main, /#define CM_USB_BCD_DEVICE 0x0100/);
  assert.match(main, /"Work Louder"/);
  assert.match(main, /TUD_HID_INOUT_DESCRIPTOR/);
  assert.match(protocolHeader, /#define CM_REPORT_ID 0x06/);
  assert.match(protocolHeader, /#define CM_REPORT_SIZE 64/);
  assert.match(protocolHeader, /#define CM_REPORT_PAYLOAD_SIZE 61/);
  assert.match(main, /0x06, 0x00, 0xFF/);
  assert.match(main, /0x95, 0x3F/);
  assert.match(main, /0x91, 0x82/);
  assert.match(main, /TINYUSB_DEFAULT_CONFIG\(tinyusb_event_handler\)/);
  assert.match(main, /tud_hid_report_complete_cb/);
  assert.match(main, /xSemaphoreTake\(hid_report_complete/);
  assert.doesNotMatch(main, /void tud_(?:mount|umount|suspend|resume)_cb/);
});

test("ESP32-S3 lab implements the observed host handshake and sanitized light bridge", () => {
  for (const method of ["sys.version", "device.status", "v.oai.thstatus", "v.oai.rgbcfg"]) {
    assert.match(main, new RegExp(method.replaceAll(".", "\\.")));
  }
  assert.match(main, /bridge_emit_slot_status/);
  assert.match(main, /"slot_status"/);
  assert.match(main, /"desktopConnected"/);
  assert.doesNotMatch(main, /threadId|turnId|accessToken|responseText/);
});

test("ESP32-S3 lab maps Web controls only to fixed native key events", () => {
  for (const key of ["AG%02d", "ACT06", "ACT07", "ACT08", "ACT09", "ACT10", "ACT12", "ENC_PRESS", "ENC_CW", "ENC_CC"]) {
    assert.match(protocol, new RegExp(key.replaceAll(".", "\\.")));
  }
  assert.match(protocol, /v\.oai\.rad/);
  assert.match(protocol, /cm_input_replay_lookup/);
  assert.match(main, /CM_INPUT_REPLAY_DUPLICATE/);
  assert.match(main, /xQueueSendToFront\(uart_tx_queue/);
  assert.match(main, /desktop_not_connected/);
  assert.doesNotMatch(main, /system\(|popen\(|execv?\(/);
});

test("ESP32-S3 lab build is pinned, explicit, and compile-only", () => {
  assert.match(manifest, /idf: "6\.0\.1"/);
  assert.match(manifest, /version: "2\.2\.1"/);
  assert.match(manifest, /espressif\/cjson:\n\s+version: "1\.7\.19~2"/);
  assert.match(builder, /--acknowledge-device-identity-test/);
  assert.match(builder, /set-target esp32s3 build/);
  assert.doesNotMatch(builder, /idf\.py[^\n]*(?:flash|erase-flash)|esptool[^\n]*(?:write_flash|erase_flash)|dfu-util/);
  assert.match(npmIgnore, /firmware\/esp32s3-codex-micro-lab\/managed_components\//);
  assert.match(npmIgnore, /firmware\/esp32s3-codex-micro-lab\/sdkconfig/);
  assert.equal(packageDocument.files?.includes("firmware"), false);
  assert.equal(packageDocument.files?.includes("firmware/esp32s3-codex-micro-lab/main"), true);
});
