import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firmware = readFileSync(new URL("../../firmware/qmk/codex_micro_lab.c", import.meta.url), "utf8");
const header = readFileSync(new URL("../../firmware/qmk/codex_micro_lab.h", import.meta.url), "utf8");
const keyboardPatch = readFileSync(new URL("../../firmware/codex-micro-lab-q6-pro.patch", import.meta.url), "utf8");
const hidPatch = readFileSync(new URL("../../firmware/codex-micro-lab-qmk-hid.patch", import.meta.url), "utf8");
const encoderPatch = readFileSync(new URL("../../firmware/codex-micro-lab-qmk-encoder.patch", import.meta.url), "utf8");
const configurator = readFileSync(new URL("../../scripts/codex-micro-lab-config.mjs", import.meta.url), "utf8");
const bindingMapper = readFileSync(new URL("../../scripts/codex-micro-lab-bindings.mjs", import.meta.url), "utf8");
const builder = readFileSync(new URL("../../scripts/build-codex-micro-lab-q6-pro.sh", import.meta.url), "utf8");

test("Codex Micro lab uses the observed USB identity and isolated 64-byte report framing", () => {
  assert.match(keyboardPatch, /"vid": "0x303A"/);
  assert.match(keyboardPatch, /"pid": "0x8360"/);
  assert.match(keyboardPatch, /"manufacturer": "Work Louder"/);
  assert.match(keyboardPatch, /"device_version": "1\.0\.0"/);
  assert.match(hidPatch, /RAW_USAGE_PAGE 0xFF00/);
  assert.match(hidPatch, /RAW_EPSIZE 64/);
  assert.match(hidPatch, /HID_RI_REPORT_ID\(8, 0x06\)/);
  assert.match(hidPatch, /HID_RI_REPORT_ID\(8, 0x07\)/);
  assert.match(header, /#define CM_REPORT_SIZE 64/);
});

test("all virtual Codex controls are mapped by matrix position instead of fixed F-keys", () => {
  assert.match(header, /#define CM_TARGET_COUNT 17/);
  assert.match(firmware, /cm_mapping_t mappings\[CM_TARGET_COUNT\]/);
  assert.match(firmware, /target_for_position/);
  assert.match(firmware, /assign_mapping\(capture_target, row, col\)/);
  assert.match(firmware, /eeconfig_update_user_datablock/);
  assert.doesNotMatch(firmware, /KC_F(?:[1-9]|1[0-2])/);
  for (const target of [
    "agent-1", "agent-6", "command-1", "command-6", "encoder-press",
    "joystick-up", "joystick-right", "joystick-down", "joystick-left",
  ]) assert.match(bindingMapper, new RegExp(`"${target}"`));
  assert.match(configurator, /sync-arkey/);
});

test("Arkey configuration framing rejects oversized and malformed payloads", () => {
  assert.match(configurator, /payload\.length > REPORT_SIZE - 6/);
  assert.match(configurator, /bytes\.length !== REPORT_SIZE/);
  assert.match(configurator, /length > REPORT_SIZE - 6 \|\| 6 \+ length > bytes\.length/);
  assert.match(configurator, /count > targetNames\.length \|\| report\.payload\.length !== 2 \+ count \* 3/);
  assert.match(firmware, /payload_length > CM_REPORT_SIZE - 6/);
});

test("fresh installs and resets use the complete Q6 Pro native Micro mapping", () => {
  const defaults = firmware.match(/static const cm_mapping_t default_mappings\[CM_TARGET_COUNT\] = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  const expected = [
    [0, 4, 17], [1, 4, 18], [2, 4, 19],
    [3, 3, 17], [4, 3, 18], [5, 3, 19],
    [6, 2, 20], [7, 0, 17], [8, 0, 20],
    [9, 0, 18], [10, 5, 18], [11, 4, 20],
    [12, 0, 13],
  ];
  for (const [target, row, column] of expected) {
    assert.match(defaults, new RegExp(`\\[${target}\\] = \\{${row}, ${column}\\}`));
  }
  for (const target of [13, 14, 15, 16]) {
    assert.match(defaults, new RegExp(`\\[${target}\\] = \\{CM_MAPPING_UNASSIGNED, CM_MAPPING_UNASSIGNED\\}`));
  }
  assert.match(firmware, /config_defaults\(void\)[\s\S]*memcpy\(config\.mappings, default_mappings, sizeof\(config\.mappings\)\)/);
  assert.match(firmware, /case CM_CONFIG_RESET:[\s\S]*config_defaults\(\);[\s\S]*save_config\(\);/);
});

test("storage v1 is invalidated so existing two-key lab installs receive the new defaults", () => {
  assert.match(firmware, /#define CM_CONFIG_STORAGE_VERSION 2/);
  assert.match(
    firmware,
    /config\.version != CM_CONFIG_STORAGE_VERSION[\s\S]*config_defaults\(\);[\s\S]*save_config\(\);/,
  );
});

test("mapped task lights follow their assigned physical LEDs", () => {
  assert.match(firmware, /g_led_config\.matrix_co\[mapping\.row\]\[mapping\.col\]/);
  assert.match(firmware, /set_mapped_color\(slot, &slots\[slot\]/);
  assert.match(firmware, /CM_TARGET_COMMAND_FIRST; target <= CM_TARGET_ENCODER_PRESS/);
});

test("physical controls without RGB LEDs remain bindable", () => {
  assert.match(firmware, /static bool valid_position\(uint8_t row, uint8_t col\) \{\s*\/\/ Some physical controls[\s\S]*?return row < MATRIX_ROWS && col < MATRIX_COLS;/);
  assert.match(firmware, /if \(led == NO_LED \|\| led < led_min \|\| led >= led_max\) return;/);
});

test("firmware expires capture on-device before a later unrelated keypress", () => {
  assert.match(firmware, /#define CM_CAPTURE_TIMEOUT_MS 30000/);
  assert.match(firmware, /capture_started_at = timer_read32\(\)/);
  assert.match(
    firmware,
    /expire_capture_if_needed\(void\)[\s\S]*timer_elapsed32\(capture_started_at\) >= CM_CAPTURE_TIMEOUT_MS[\s\S]*capture_active = false/,
  );
  assert.match(firmware, /handle_matrix_record\(keyrecord_t \*record\)[\s\S]*expire_capture_if_needed\(\)/);
  assert.match(firmware, /codex_micro_lab_task\(void\)[\s\S]*expire_capture_if_needed\(\);[\s\S]*drain_event\(\)/);
});

test("lab build is explicit, reversible, and does not flash automatically", () => {
  assert.match(builder, /--acknowledge-device-identity-test/);
  assert.match(builder, /trap restore_qmk EXIT INT TERM/);
  assert.match(builder, /diff --quiet HEAD --/);
  assert.match(builder, /quantum\/encoder\.h/);
  assert.match(builder, /codex-micro-lab-qmk-encoder\.patch/);
  assert.match(builder, /Refusing to overwrite existing QMK file/);
  assert.match(builder, /This script did not flash the keyboard/);
  assert.doesNotMatch(builder, /dfu-util\s+-D|qmk\s+flash/);
});

test("encoder interception happens before QMK emits the VIA volume mapping", () => {
  assert.match(header, /codex_micro_lab_encoder_preprocess/);
  assert.match(firmware, /bool codex_micro_lab_encoder_preprocess\(uint8_t index, bool clockwise\)/);
  assert.match(firmware, /codex_micro_lab_encoder_preprocess[\s\S]*if \(!using_usb\(\)\) return true/);
  const preprocess = firmware.match(/bool codex_micro_lab_encoder_preprocess[\s\S]*?\n}/)?.[0] ?? "";
  assert.doesNotMatch(preprocess, /config\.encoder_enabled/);
  assert.match(preprocess, /enqueue_event\(CM_EVENT_HID[\s\S]*return false;/);
  assert.match(firmware, /Q6 Pro's[\s\S]*?opposite to the Codex Micro protocol direction/);
  assert.match(firmware, /enqueue_event\(CM_EVENT_HID, CM_TARGET_ENCODER_PRESS, 2, clockwise \? 1 : 0, index\)/);
  assert.doesNotMatch(firmware, /KEYLOC_ENCODER_CW|KEYLOC_ENCODER_CCW/);
  assert.match(keyboardPatch, /encoder_preprocess_kb\(uint8_t index, bool clockwise\)/);
  assert.match(encoderPatch, /encoder_preprocess_kb\(index, ENCODER_COUNTER_CLOCKWISE\)/);
  assert.match(encoderPatch, /encoder_preprocess_kb\(index, ENCODER_CLOCKWISE\)/);
});

test("encoder rotation is permanent and legacy disable requests cannot release it", () => {
  const handler = firmware.match(/case CM_CONFIG_ENCODER:[\s\S]*?break;/)?.[0] ?? "";
  assert.match(handler, /config\.encoder_enabled = 1/);
  assert.match(handler, /if \(config\.encoder_enabled != 1\)[\s\S]*save_config\(\)/);
  assert.doesNotMatch(handler, /payload\[0\] != 0|config\.encoder_enabled = 0/);
  assert.match(firmware, /config\.encoder_enabled != 1[\s\S]*config\.encoder_enabled = 1/);
  assert.match(configurator, /encoder rotation 永久启用，配置接口不支持关闭/);
  assert.doesNotMatch(configurator, /encoder <on\|off>/);
  assert.match(bindingMapper, /const encoderEnabled = true/);
});

test("native Micro PTT uses ACT10 with physical press and release semantics", () => {
  assert.match(firmware, /"ACT06", "ACT07", "ACT08", "ACT09", "ACT10", "ACT12"/);
  assert.match(firmware, /enqueue_event\(CM_EVENT_HID, \(uint8_t\)target, pressed \? 1 : 0, row, col\)/);
  assert.match(firmware, /v\.oai\.rgbcfg/);
  assert.match(firmware, /CM_EFFECT_SNAKE/);
});
