import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firmware = readFileSync(new URL("../../firmware/qmk/arkey.c", import.meta.url), "utf8");
const header = readFileSync(new URL("../../firmware/qmk/arkey.h", import.meta.url), "utf8");
const generated = readFileSync(new URL("../../firmware/qmk/arkey_generated.h", import.meta.url), "utf8");
const q6Patch = readFileSync(new URL("../../firmware/keychron-q6-pro.patch", import.meta.url), "utf8");

test("firmware includes heartbeat watchdog and restore path", () => {
  assert.match(header, /AG_WATCHDOG_MS 3000/);
  assert.match(firmware, /timer_elapsed32\(last_heartbeat\).*AG_WATCHDOG_MS/);
  assert.match(firmware, /arkey_restore\(\)/);
  assert.match(firmware, /AG_COMPLETE_DURATION_MS 1600/);
  assert.match(firmware, /AG_ERROR_DURATION_MS 2200/);
});

test("firmware never writes RGB state to EEPROM", () => {
  assert.doesNotMatch(firmware, /eeconfig_update|rgb_matrix_(?:mode|sethsv|enable|disable)\(/);
  assert.match(firmware, /rgb_matrix_mode_noeeprom/);
});

test("firmware advertises v2 inside the unchanged 32-byte v1 envelope", () => {
  assert.match(header, /#define AG_REPORT_SIZE 32/);
  assert.match(header, /#define AG_VERSION 1/);
  assert.match(header, /#define AG_EXTENSION_VERSION 2/);
  assert.match(header, /#include "arkey_generated.h"/);
  assert.match(generated, /#define AG_PROFILE_CRC32 0xDE355358UL/);
  assert.match(generated, /#define AG_PROFILE_LED_COUNT 108/);
  assert.match(generated, /#define AG_DEFAULT_ATMOSPHERE_MIX 12/);
  assert.match(firmware, /uint8_t payload\[16\]/);
  assert.match(firmware, /payload\[8\] = \(uint8_t\)\(AG_PROFILE_CRC32 >> 24\)/);
  assert.match(firmware, /payload\[11\] = \(uint8_t\)AG_PROFILE_CRC32/);
  assert.match(firmware, /first four hash bytes, not a LE integer/);
  assert.match(firmware, /payload\[15\] = AG_DEFAULT_ATMOSPHERE_MIX/);
});

test("firmware implements staged two-record single-key effect packets", () => {
  assert.match(header, /#define AG_SET_KEY_EFFECTS 0x10/);
  assert.match(header, /#define AG_CLEAR_KEY_EFFECTS 0x11/);
  assert.match(firmware, /#define AG_MAX_EFFECT_RECORDS 2/);
  assert.match(firmware, /_Static_assert\(sizeof\(arkey_key_effect_t\) == 10/);
  assert.match(firmware, /length != \(uint8_t\)\(6 \+ count \* 10\)/);
  assert.match(firmware, /AG_EFFECT_PACKET_RESET/);
  assert.match(firmware, /AG_EFFECT_PACKET_FINAL/);
  assert.match(firmware, /commit_staged_effects/);
  assert.match(firmware, /memcpy\(overlays, staged_overlays, sizeof\(overlays\)\)/);
});

test("firmware renders every Arkey single-key primitive with status-first mixing", () => {
  for (const effect of [
    "AG_EFFECT_OFF",
    "AG_EFFECT_SOLID",
    "AG_EFFECT_BREATH",
    "AG_EFFECT_SHALLOW_BREATH",
    "AG_EFFECT_DOUBLE_PULSE",
    "AG_EFFECT_RISE_FADE",
    "AG_EFFECT_PRESS_FLASH",
  ]) {
    assert.match(generated, new RegExp(effect));
    assert.match(firmware, new RegExp(`case ${effect}`));
  }
  assert.match(generated, /AG_EFFECT_SHALLOW_BREATH = 2/);
  assert.match(generated, /AG_EFFECT_BREATH = 3/);
  assert.match(firmware, /arkey_key_effect_t overlays\[RGB_MATRIX_LED_COUNT\]/);
  assert.match(firmware, /semantic \* \(100 - atmosphere_mix\).*global_value\(i\) \* atmosphere_mix/);
  assert.match(firmware, /AG_EFFECT_OFF[\s\S]*mixed = 0; \/\* Unassigned is forced black/);
  assert.match(firmware, /rgb_matrix_indicators_advanced_kb/);
  assert.match(firmware, /rgb_matrix_indicators_advanced_user\(led_min, led_max\)/);
});

test("firmware capture and binding controls are leased, bounded, and fail open", () => {
  assert.match(header, /#define AG_SET_CAPTURE_MODE 0x14/);
  assert.match(header, /#define AG_SET_BINDING_MASK 0x15/);
  assert.match(header, /#define AG_BINDING_MASK_BYTES 16/);
  assert.match(header, /#define AG_CAPTURE_MAX_MS 30000/);
  assert.match(header, /#define AG_EVENT_QUEUE_SIZE 16/);
  assert.match(firmware, /timer_elapsed32\(last_heartbeat\) <= AG_WATCHDOG_MS/);
  assert.match(firmware, /enqueue_suppressing_press/);
  assert.match(firmware, /suppressed_mask/);
  assert.match(firmware, /capture_suppressed_mask/);
  assert.match(firmware, /if \(!using_usb\(\)\)[\s\S]*arkey_restore\(\)/);
});

test("firmware reserves ring capacity for every suppressed release, even at the full boundary", () => {
  assert.match(firmware, /static uint8_t reserved_release_count;/);
  assert.match(
    firmware,
    /event_count \+ reserved_release_count \+ 2U > AG_EVENT_QUEUE_SIZE/,
  );
  assert.match(firmware, /enqueue_suppressing_press[\s\S]*reserved_release_count\+\+;/);
  assert.match(firmware, /complete_suppressed_release[\s\S]*reserved_release_count--;/);

  const matrixRelease = firmware.match(/if \(!pressed && mask_get\(suppressed_mask[\s\S]*?return false;\n    }/)?.[0] ?? "";
  assert.match(matrixRelease, /using_usb\(\) && !enqueue_event\([^\n]+false/);
  assert.ok(matrixRelease.indexOf("!enqueue_event") < matrixRelease.indexOf("mask_set(suppressed_mask"));
  assert.ok(matrixRelease.indexOf("mask_set(suppressed_mask") < matrixRelease.indexOf("complete_suppressed_release"));

  const encoderRelease = firmware.match(/if \(!pressed && \(encoder_suppressed_mask[\s\S]*?return false;\n    }/)?.[0] ?? "";
  assert.match(encoderRelease, /using_usb\(\) && !enqueue_event\([^\n]+false/);
  assert.ok(encoderRelease.indexOf("!enqueue_event") < encoderRelease.indexOf("encoder_suppressed_mask &="));
  assert.ok(encoderRelease.indexOf("encoder_suppressed_mask &=") < encoderRelease.indexOf("complete_suppressed_release"));

  // Model the firmware invariant at the worst boundary: eight queued presses
  // reserve the remaining eight entries, so every release still fits.
  let queued = 0;
  let reserved = 0;
  const press = () => {
    if (queued + reserved + 2 > 16) return false;
    queued += 1;
    reserved += 1;
    return true;
  };
  for (let index = 0; index < 8; index += 1) assert.equal(press(), true);
  assert.equal(press(), false, "a ninth press must fail open instead of stealing release capacity");
  for (let index = 0; index < 8; index += 1) {
    assert.ok(queued < 16, "the paired release always has a reserved slot");
    queued += 1;
    reserved -= 1;
  }
  assert.deepEqual({ queued, reserved }, { queued: 16, reserved: 0 });
});

test("firmware exposes an explicit not-armed state so a live v2 host can safely re-arm", () => {
  assert.match(firmware, /#define AG_STATUS_NOT_ARMED 4/);
  assert.match(firmware, /static bool binding_armed;/);
  assert.match(firmware, /static bool v2_session_seen;/);
  assert.match(firmware, /arkey_restore\(void\)[\s\S]*binding_armed = false;/);
  assert.match(firmware, /handle_binding_mask[\s\S]*binding_armed = true;[\s\S]*touch_lease\(\);/);
  assert.match(
    firmware,
    /case AG_HEARTBEAT:[\s\S]*v2_session_seen[\s\S]*AG_STATUS_NOT_USB[\s\S]*AG_STATUS_NOT_ARMED[\s\S]*send_ack/,
  );
  assert.match(firmware, /case AG_RESTORE:[\s\S]*arkey_restore\(\);[\s\S]*v2_session_seen = false;/);
});

test("firmware reports matrix and encoder controls outside process_record", () => {
  assert.match(header, /#define AG_CONTROL_EVENT 0x13/);
  assert.match(firmware, /KEYLOC_ENCODER_CW/);
  assert.match(firmware, /KEYLOC_ENCODER_CCW/);
  assert.match(firmware, /AG_EVENT_ENCODER_CCW 1/);
  assert.match(firmware, /AG_EVENT_ENCODER_CW 2/);
  assert.match(firmware, /static void send_next_event/);
  assert.doesNotMatch(
    firmware.match(/bool arkey_process_record[\s\S]*?\n}/)?.[0] ?? "",
    /raw_hid_send/,
  );
  assert.match(q6Patch, /arkey_process_record\(keycode, record\)/);
  assert.match(q6Patch, /void matrix_scan_kb\(void\)[\s\S]*arkey_task\(\)/);
  assert.match(q6Patch, /arkey_command\(data, length\)/);
});
