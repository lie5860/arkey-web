/* SPDX-License-Identifier: MIT */
#include "arkey.h"

#include <string.h>

#include "raw_hid.h"
#include "rgb_matrix.h"
#include "timer.h"

#ifdef KC_BLUETOOTH_ENABLE
#    include "transport.h"
#endif

#define AG_IDLE 0
#define AG_COMPLETE 4
#define AG_ERROR 5
#define AG_COMPLETE_DURATION_MS 1600
#define AG_ERROR_DURATION_MS 2200

#define AG_LEGACY_CAPABILITIES 0x07
#define AG_LEGACY_MAX_EVENTS 12
#define AG_MAX_EFFECT_RECORDS 2

#define AG_EFFECT_PACKET_COUNT_MASK 0x0F
#define AG_EFFECT_PACKET_RESET 0x40
#define AG_EFFECT_PACKET_FINAL 0x80
#define AG_EFFECT_PRESENT 0x80

#define AG_CAPTURE_ENABLE 0x01

#define AG_STATUS_OK 0
#define AG_STATUS_BAD_LENGTH 1
#define AG_STATUS_BAD_VALUE 2
#define AG_STATUS_NOT_USB 3
#define AG_STATUS_NOT_ARMED 4

#define AG_EVENT_KEY 0
#define AG_EVENT_ENCODER_CCW 1
#define AG_EVENT_ENCODER_CW 2
#define AG_EVENT_FLAG_CAPTURE 0x01

typedef struct PACKED {
    uint8_t  led;
    uint8_t  effect;
    uint8_t  hue;
    uint8_t  saturation;
    uint8_t  value;
    uint8_t  speed;
    uint8_t  phase;
    uint16_t duration_10ms;
    uint8_t  flags;
} arkey_key_effect_t;

_Static_assert(sizeof(arkey_key_effect_t) == 10, "Arkey key effect wire record must remain 10 bytes");
_Static_assert(RGB_MATRIX_LED_COUNT == AG_PROFILE_LED_COUNT, "Arkey profile LED count does not match QMK target");
_Static_assert(MATRIX_ROWS == AG_MATRIX_ROWS && MATRIX_COLS == AG_MATRIX_COLS, "Arkey profile matrix does not match QMK target");

typedef struct {
    uint16_t sequence;
    uint32_t device_tick;
    uint16_t capture_token;
    uint8_t  kind;
    uint8_t  row;
    uint8_t  col;
    uint8_t  pressed;
    uint8_t  flags;
} arkey_control_event_t;

static uint8_t levels[RGB_MATRIX_LED_COUNT];
static uint8_t state;
static uint8_t hue = 145;
static uint8_t saturation = 255;
static uint8_t intensity = 180;
static uint32_t last_heartbeat;
static uint32_t last_decay;
static uint32_t state_started;

static bool global_active;
static bool base_saved;
static bool saved_enabled;
static uint8_t saved_mode;
static uint8_t saved_hue;
static uint8_t saved_sat;
static uint8_t saved_val;

static arkey_key_effect_t overlays[RGB_MATRIX_LED_COUNT];
static arkey_key_effect_t staged_overlays[RGB_MATRIX_LED_COUNT];
static uint32_t overlay_started[RGB_MATRIX_LED_COUNT];
static uint16_t overlay_revision;
static uint16_t overlay_epoch;
static uint8_t atmosphere_mix = AG_DEFAULT_ATMOSPHERE_MIX;
static bool overlays_active;
static bool staging_valid;
static uint16_t staging_revision;
static uint16_t staging_epoch;
static uint8_t staging_mix;

static uint8_t binding_mask[AG_BINDING_MASK_BYTES];
static uint8_t encoder_binding_mask;
static uint16_t binding_revision;
static bool lease_active;
static bool binding_armed;
static bool v2_session_seen;

static bool capture_active;
static uint16_t capture_token;
static uint32_t capture_started;
static uint32_t capture_timeout_ms;

static uint8_t suppressed_mask[AG_BINDING_MASK_BYTES];
static uint8_t capture_suppressed_mask[AG_BINDING_MASK_BYTES];
static uint8_t encoder_suppressed_mask;
static uint8_t encoder_capture_suppressed_mask;

static arkey_control_event_t event_queue[AG_EVENT_QUEUE_SIZE];
static uint8_t event_head;
static uint8_t event_tail;
static uint8_t event_count;
/* One reservation for every press Arkey suppressed from the host OS. */
static uint8_t reserved_release_count;
static uint16_t event_sequence;

static uint16_t read_u16_le(const uint8_t *data) {
    return (uint16_t)data[0] | ((uint16_t)data[1] << 8);
}

static void write_u16_le(uint8_t *data, uint16_t value) {
    data[0] = (uint8_t)value;
    data[1] = (uint8_t)(value >> 8);
}

static void write_u32_le(uint8_t *data, uint32_t value) {
    data[0] = (uint8_t)value;
    data[1] = (uint8_t)(value >> 8);
    data[2] = (uint8_t)(value >> 16);
    data[3] = (uint8_t)(value >> 24);
}

static bool using_usb(void) {
#ifdef KC_BLUETOOTH_ENABLE
    return get_transport() == TRANSPORT_USB;
#else
    return true;
#endif
}

static void send_report(uint8_t opcode, uint8_t sequence, const uint8_t *payload, uint8_t payload_length) {
    uint8_t response[AG_REPORT_SIZE] = {AG_MAGIC_0, AG_MAGIC_1, AG_VERSION, opcode, payload_length, sequence};
    if (payload_length > 0) memcpy(&response[AG_HEADER_SIZE], payload, payload_length);
    raw_hid_send(response, sizeof(response));
}

static void send_ack(uint8_t sequence, uint8_t acked_opcode, uint8_t status, uint16_t revision, uint16_t epoch) {
    uint8_t payload[10];
    payload[0] = acked_opcode;
    payload[1] = status;
    write_u16_le(&payload[2], revision);
    write_u16_le(&payload[4], epoch);
    write_u32_le(&payload[6], timer_read32());
    send_report(AG_ACK, sequence, payload, sizeof(payload));
}

static void send_capabilities(uint8_t sequence) {
    uint8_t payload[16] = {
        RGB_MATRIX_LED_COUNT,
        AG_LEGACY_CAPABILITIES,
        AG_LEGACY_MAX_EVENTS,
        AG_EXTENSION_VERSION,
    };
    write_u32_le(&payload[4], AG_FEATURE_FLAGS);
    /* The profile prefix is intentionally the first four hash bytes, not a LE integer. */
    payload[8] = (uint8_t)(AG_PROFILE_CRC32 >> 24);
    payload[9] = (uint8_t)(AG_PROFILE_CRC32 >> 16);
    payload[10] = (uint8_t)(AG_PROFILE_CRC32 >> 8);
    payload[11] = (uint8_t)AG_PROFILE_CRC32;
    payload[12] = AG_MATRIX_ROWS;
    payload[13] = AG_MATRIX_COLS;
    payload[14] = AG_MAX_EFFECT_RECORDS;
    payload[15] = AG_DEFAULT_ATMOSPHERE_MIX;
    send_report(AG_CAPABILITIES, sequence, payload, sizeof(payload));
}

static void save_rgb_base(void) {
    if (base_saved) return;
    saved_enabled = rgb_matrix_is_enabled();
    saved_mode = rgb_matrix_get_mode();
    saved_hue = rgb_matrix_get_hue();
    saved_sat = rgb_matrix_get_sat();
    saved_val = rgb_matrix_get_val();
    base_saved = true;
}

static void apply_saved_rgb(bool release_snapshot) {
    if (!base_saved) return;
    rgb_matrix_sethsv_noeeprom(saved_hue, saved_sat, saved_val);
    rgb_matrix_mode_noeeprom(saved_mode);
    if (saved_enabled || overlays_active) {
        rgb_matrix_enable_noeeprom();
    } else {
        rgb_matrix_disable_noeeprom();
    }
    if (release_snapshot) base_saved = false;
}

static void activate_global(void) {
    save_rgb_base();
    global_active = true;
    last_heartbeat = timer_read32();
    state_started = last_heartbeat;
    rgb_matrix_enable_noeeprom();
    rgb_matrix_mode_noeeprom(RGB_MATRIX_CUSTOM_arkey);
}

static void stop_global(void) {
    if (!global_active) return;
    global_active = false;
    memset(levels, 0, sizeof(levels));
    apply_saved_rgb(!overlays_active);
}

static bool any_overlay_present(void) {
    for (uint8_t i = 0; i < RGB_MATRIX_LED_COUNT; i++) {
        if (overlays[i].flags & AG_EFFECT_PRESENT) return true;
    }
    return false;
}

static void clear_all_overlays(void) {
    memset(overlays, 0, sizeof(overlays));
    memset(staged_overlays, 0, sizeof(staged_overlays));
    memset(overlay_started, 0, sizeof(overlay_started));
    overlays_active = false;
    staging_valid = false;
    if (!global_active) apply_saved_rgb(true);
}

void arkey_restore(void) {
    bool had_base = base_saved;
    global_active = false;
    overlays_active = false;
    lease_active = false;
    binding_armed = false;
    capture_active = false;
    staging_valid = false;
    memset(levels, 0, sizeof(levels));
    memset(overlays, 0, sizeof(overlays));
    memset(staged_overlays, 0, sizeof(staged_overlays));
    memset(overlay_started, 0, sizeof(overlay_started));
    memset(binding_mask, 0, sizeof(binding_mask));
    encoder_binding_mask = 0;
    event_head = event_tail = event_count = 0;
    /* Suppressed releases and their reservations remain latched until their
     * physical release arrives. Clearing the event ring cannot make an
     * intercepted key leak its original release to the host OS. */
    if (had_base) apply_saved_rgb(true);
}

static void touch_lease(void) {
    lease_active = true;
    last_heartbeat = timer_read32();
}

static bool lease_is_valid(void) {
    return using_usb() && lease_active && timer_elapsed32(last_heartbeat) <= AG_WATCHDOG_MS;
}

static uint8_t matrix_bit(uint8_t row, uint8_t col) {
    return (uint8_t)(row * AG_MATRIX_COLS + col);
}

static bool mask_get(const uint8_t *mask, uint8_t row, uint8_t col) {
    if (row >= AG_MATRIX_ROWS || col >= AG_MATRIX_COLS) return false;
    uint8_t bit = matrix_bit(row, col);
    return (mask[bit >> 3] & (1U << (bit & 7))) != 0;
}

static void mask_set(uint8_t *mask, uint8_t row, uint8_t col, bool enabled) {
    if (row >= AG_MATRIX_ROWS || col >= AG_MATRIX_COLS) return;
    uint8_t bit = matrix_bit(row, col);
    if (enabled) {
        mask[bit >> 3] |= (uint8_t)(1U << (bit & 7));
    } else {
        mask[bit >> 3] &= (uint8_t)~(1U << (bit & 7));
    }
}

static bool enqueue_event(uint8_t kind, uint8_t row, uint8_t col, bool pressed, uint16_t token, uint8_t flags) {
    if (event_count >= AG_EVENT_QUEUE_SIZE) return false;
    arkey_control_event_t *event = &event_queue[event_tail];
    event->sequence = ++event_sequence;
    event->device_tick = timer_read32();
    event->capture_token = token;
    event->kind = kind;
    event->row = row;
    event->col = col;
    event->pressed = pressed ? 1 : 0;
    event->flags = flags;
    event_tail = (uint8_t)((event_tail + 1) % AG_EVENT_QUEUE_SIZE);
    event_count++;
    return true;
}

static bool enqueue_suppressing_press(uint8_t kind, uint8_t row, uint8_t col, uint16_t token, uint8_t flags) {
    /* A captured press consumes one queue entry now and must retain one entry
     * for its paired release. This invariant makes release enqueue infallible:
     * event_count + reserved_release_count never exceeds the ring size. */
    if ((uint16_t)event_count + reserved_release_count + 2U > AG_EVENT_QUEUE_SIZE) return false;
    if (!enqueue_event(kind, row, col, true, token, flags)) return false;
    reserved_release_count++;
    return true;
}

static void complete_suppressed_release(void) {
    if (reserved_release_count > 0) reserved_release_count--;
}

static void send_next_event(void) {
    if (event_count == 0 || !using_usb()) return;
    const arkey_control_event_t *event = &event_queue[event_head];
    uint8_t payload[13];
    write_u16_le(&payload[0], event->sequence);
    write_u32_le(&payload[2], event->device_tick);
    payload[6] = event->kind;
    payload[7] = event->row;
    payload[8] = event->col;
    payload[9] = event->pressed;
    write_u16_le(&payload[10], event->capture_token);
    payload[12] = event->flags;
    send_report(AG_CONTROL_EVENT, (uint8_t)event->sequence, payload, sizeof(payload));
    event_head = (uint8_t)((event_head + 1) % AG_EVENT_QUEUE_SIZE);
    event_count--;
}

static void begin_effect_staging(uint16_t revision, uint16_t epoch, uint8_t mix, bool reset) {
    if (!staging_valid || staging_revision != revision || staging_epoch != epoch) {
        memcpy(staged_overlays, overlays, sizeof(staged_overlays));
        staging_valid = true;
    }
    if (reset) memset(staged_overlays, 0, sizeof(staged_overlays));
    staging_revision = revision;
    staging_epoch = epoch;
    staging_mix = mix > 100 ? 100 : mix;
}

static bool decode_effect(arkey_key_effect_t *effect, const uint8_t *record) {
    if (record[0] >= RGB_MATRIX_LED_COUNT || record[1] > AG_EFFECT_PRESS_FLASH) return false;
    effect->led = record[0];
    effect->effect = record[1];
    effect->hue = record[2];
    effect->saturation = record[3];
    effect->value = record[4];
    effect->speed = record[5];
    effect->phase = record[6];
    effect->duration_10ms = read_u16_le(&record[7]);
    effect->flags = record[9] | AG_EFFECT_PRESENT;
    return true;
}

static void commit_staged_effects(void) {
    uint32_t now = timer_read32();
    save_rgb_base();
    memcpy(overlays, staged_overlays, sizeof(overlays));
    overlay_revision = staging_revision;
    overlay_epoch = staging_epoch;
    atmosphere_mix = staging_mix;
    for (uint8_t i = 0; i < RGB_MATRIX_LED_COUNT; i++) overlay_started[i] = now;
    overlays_active = any_overlay_present();
    staging_valid = false;
    if (overlays_active) {
        rgb_matrix_enable_noeeprom();
    } else if (!global_active) {
        apply_saved_rgb(true);
    }
}

static uint8_t handle_set_key_effects(const uint8_t *payload, uint8_t length) {
    if (length < 6) return AG_STATUS_BAD_LENGTH;
    uint16_t revision = read_u16_le(&payload[0]);
    uint16_t epoch = read_u16_le(&payload[2]);
    uint8_t mix = payload[4];
    uint8_t control = payload[5];
    uint8_t count = control & AG_EFFECT_PACKET_COUNT_MASK;
    if (count > AG_MAX_EFFECT_RECORDS || length != (uint8_t)(6 + count * 10)) return AG_STATUS_BAD_LENGTH;

    begin_effect_staging(revision, epoch, mix, (control & AG_EFFECT_PACKET_RESET) != 0);
    for (uint8_t i = 0; i < count; i++) {
        arkey_key_effect_t effect;
        if (!decode_effect(&effect, &payload[6 + i * 10])) {
            staging_valid = false;
            return AG_STATUS_BAD_VALUE;
        }
        staged_overlays[effect.led] = effect;
    }
    if (control & AG_EFFECT_PACKET_FINAL) commit_staged_effects();
    touch_lease();
    return AG_STATUS_OK;
}

static uint8_t handle_clear_key_effects(const uint8_t *payload, uint8_t length) {
    if (length == 0) {
        clear_all_overlays();
    } else {
        for (uint8_t i = 0; i < length; i++) {
            if (payload[i] >= RGB_MATRIX_LED_COUNT) return AG_STATUS_BAD_VALUE;
        }
        for (uint8_t i = 0; i < length; i++) {
            memset(&overlays[payload[i]], 0, sizeof(overlays[payload[i]]));
            memset(&staged_overlays[payload[i]], 0, sizeof(staged_overlays[payload[i]]));
        }
        overlays_active = any_overlay_present();
        if (!overlays_active && !global_active) apply_saved_rgb(true);
    }
    touch_lease();
    return AG_STATUS_OK;
}

static uint8_t handle_capture_mode(const uint8_t *payload, uint8_t length) {
    if (length != 5) return AG_STATUS_BAD_LENGTH;
    bool enabled = (payload[0] & AG_CAPTURE_ENABLE) != 0;
    capture_token = read_u16_le(&payload[1]);
    uint16_t timeout_ms = read_u16_le(&payload[3]);
    if (enabled) {
        if (!using_usb()) return AG_STATUS_NOT_USB;
        capture_timeout_ms = timeout_ms == 0 ? AG_CAPTURE_MAX_MS : timeout_ms;
        if (capture_timeout_ms > AG_CAPTURE_MAX_MS) capture_timeout_ms = AG_CAPTURE_MAX_MS;
        capture_started = timer_read32();
        capture_active = true;
        touch_lease();
    } else {
        capture_active = false;
    }
    return AG_STATUS_OK;
}

static uint8_t handle_binding_mask(const uint8_t *payload, uint8_t length) {
    if (length != 20) return AG_STATUS_BAD_LENGTH;
    if (!using_usb()) return AG_STATUS_NOT_USB;
    binding_revision = read_u16_le(&payload[0]);
    memcpy(binding_mask, &payload[2], sizeof(binding_mask));
    encoder_binding_mask = payload[18];
    /* payload[19] is reserved for future capture/lease flags. */
    binding_armed = true;
    touch_lease();
    return AG_STATUS_OK;
}

bool arkey_command(uint8_t *data, uint8_t length) {
    if (length < AG_HEADER_SIZE || data[0] != AG_MAGIC_0 || data[1] != AG_MAGIC_1 || data[2] != AG_VERSION) return false;
    uint8_t opcode = data[3];
    uint8_t payload_length = data[4];
    uint8_t sequence = data[5];
    if (payload_length > AG_MAX_PAYLOAD || (uint8_t)(payload_length + AG_HEADER_SIZE) > length) {
        send_ack(sequence, opcode, AG_STATUS_BAD_LENGTH, binding_revision, overlay_epoch);
        return true;
    }
    const uint8_t *payload = &data[AG_HEADER_SIZE];
    uint8_t status = AG_STATUS_OK;

    switch (opcode) {
        case AG_HELLO:
            send_capabilities(sequence);
            break;
        case AG_SET_STATE:
            if (payload_length < 4) {
                status = AG_STATUS_BAD_LENGTH;
            } else {
                state = payload[0];
                hue = payload[1];
                saturation = payload[2];
                intensity = payload[3];
                if (state == AG_IDLE) {
                    stop_global();
                } else {
                    activate_global();
                    state_started = timer_read32();
                }
            }
            break;
        case AG_KEY_EVENTS:
            if (payload_length < 1) {
                status = AG_STATUS_BAD_LENGTH;
            } else {
                activate_global();
                uint8_t count = payload[0] > AG_LEGACY_MAX_EVENTS ? AG_LEGACY_MAX_EVENTS : payload[0];
                for (uint8_t i = 0; i < count && (uint8_t)(2 + i * 2) <= payload_length; i++) {
                    uint8_t led = payload[1 + i * 2];
                    if (led < RGB_MATRIX_LED_COUNT) levels[led] = payload[2 + i * 2];
                }
            }
            break;
        case AG_HEARTBEAT:
            last_heartbeat = timer_read32();
            if (v2_session_seen) {
                uint8_t heartbeat_status = !using_usb() ? AG_STATUS_NOT_USB : (binding_armed ? AG_STATUS_OK : AG_STATUS_NOT_ARMED);
                send_ack(sequence, opcode, heartbeat_status, binding_revision, overlay_epoch);
            }
            break;
        case AG_RESTORE:
            arkey_restore();
            /* An explicit Restore ends v2 status replies; a live v2 host re-arms
             * with SetBindingMask, while a subsequently launched v1 host keeps
             * the original no-ACK heartbeat behavior. */
            v2_session_seen = false;
            break;
        case AG_SET_KEY_EFFECTS:
            v2_session_seen = true;
            status = using_usb() ? handle_set_key_effects(payload, payload_length) : AG_STATUS_NOT_USB;
            send_ack(sequence, opcode, status,
                     payload_length >= 2 ? read_u16_le(&payload[0]) : overlay_revision,
                     payload_length >= 4 ? read_u16_le(&payload[2]) : overlay_epoch);
            break;
        case AG_CLEAR_KEY_EFFECTS:
            v2_session_seen = true;
            status = using_usb() ? handle_clear_key_effects(payload, payload_length) : AG_STATUS_NOT_USB;
            send_ack(sequence, opcode, status, overlay_revision, overlay_epoch);
            break;
        case AG_SET_CAPTURE_MODE:
            v2_session_seen = true;
            status = handle_capture_mode(payload, payload_length);
            send_ack(sequence, opcode, status, binding_revision, overlay_epoch);
            break;
        case AG_SET_BINDING_MASK:
            v2_session_seen = true;
            status = handle_binding_mask(payload, payload_length);
            send_ack(sequence, opcode, status, binding_revision, overlay_epoch);
            break;
        default:
            send_ack(sequence, opcode, AG_STATUS_BAD_VALUE, binding_revision, overlay_epoch);
            break;
    }
    return true;
}

static bool process_matrix_event(keyrecord_t *record) {
    uint8_t row = record->event.key.row;
    uint8_t col = record->event.key.col;
    bool pressed = record->event.pressed;

    /* A duplicate press cannot consume a second reservation for one key. */
    if (pressed && mask_get(suppressed_mask, row, col)) return false;

    if (!pressed && mask_get(suppressed_mask, row, col)) {
        bool was_capture = mask_get(capture_suppressed_mask, row, col);
        /* Bluetooth has no Raw HID consumer. Consume the orphaned original
         * release locally; the desktop synthesizes cancel on USB disconnect.
         * On USB, the reservation invariant guarantees this enqueue succeeds.
         * If it ever does not, retain suppression instead of leaking the key. */
        if (using_usb() && !enqueue_event(AG_EVENT_KEY, row, col, false, was_capture ? capture_token : 0, was_capture ? AG_EVENT_FLAG_CAPTURE : 0)) return false;
        mask_set(suppressed_mask, row, col, false);
        mask_set(capture_suppressed_mask, row, col, false);
        complete_suppressed_release();
        return false;
    }

    if (!pressed || !lease_is_valid()) {
        if (pressed) {
            mask_set(suppressed_mask, row, col, false);
            mask_set(capture_suppressed_mask, row, col, false);
        }
        return true;
    }

    bool capture = capture_active;
    bool bound = mask_get(binding_mask, row, col);
    if (!capture && !bound) return true;
    if (!enqueue_suppressing_press(AG_EVENT_KEY, row, col, capture ? capture_token : 0, capture ? AG_EVENT_FLAG_CAPTURE : 0)) return true;

    mask_set(suppressed_mask, row, col, true);
    if (capture) {
        mask_set(capture_suppressed_mask, row, col, true);
        capture_active = false;
    }
    return false;
}

static bool process_encoder_event(keyrecord_t *record, bool clockwise) {
    uint8_t index = record->event.key.col;
    if (index >= 4) return true; /* Two direction bits per encoder fit in the wire mask. */
    uint8_t direction_bit = (uint8_t)(1U << (index * 2 + (clockwise ? 0 : 1)));
    uint8_t kind = clockwise ? AG_EVENT_ENCODER_CW : AG_EVENT_ENCODER_CCW;
    bool pressed = record->event.pressed;

    if (pressed && (encoder_suppressed_mask & direction_bit)) return false;

    if (!pressed && (encoder_suppressed_mask & direction_bit)) {
        bool was_capture = (encoder_capture_suppressed_mask & direction_bit) != 0;
        if (using_usb() && !enqueue_event(kind, record->event.key.row, index, false, was_capture ? capture_token : 0, was_capture ? AG_EVENT_FLAG_CAPTURE : 0)) return false;
        encoder_suppressed_mask &= (uint8_t)~direction_bit;
        encoder_capture_suppressed_mask &= (uint8_t)~direction_bit;
        complete_suppressed_release();
        return false;
    }

    if (!pressed || !lease_is_valid()) {
        if (pressed) {
            encoder_suppressed_mask &= (uint8_t)~direction_bit;
            encoder_capture_suppressed_mask &= (uint8_t)~direction_bit;
        }
        return true;
    }

    bool capture = capture_active;
    bool bound = (encoder_binding_mask & direction_bit) != 0;
    if (!capture && !bound) return true;
    if (!enqueue_suppressing_press(kind, record->event.key.row, index, capture ? capture_token : 0, capture ? AG_EVENT_FLAG_CAPTURE : 0)) return true;

    encoder_suppressed_mask |= direction_bit;
    if (capture) {
        encoder_capture_suppressed_mask |= direction_bit;
        capture_active = false;
    }
    return false;
}

bool arkey_process_record(uint16_t keycode, keyrecord_t *record) {
    (void)keycode;
#ifdef ENCODER_MAP_ENABLE
    if (record->event.key.row == KEYLOC_ENCODER_CW) return process_encoder_event(record, true);
    if (record->event.key.row == KEYLOC_ENCODER_CCW) return process_encoder_event(record, false);
#endif
    if (record->event.key.row < AG_MATRIX_ROWS && record->event.key.col < AG_MATRIX_COLS) return process_matrix_event(record);
    return true;
}

static uint32_t effect_duration_ms(const arkey_key_effect_t *effect) {
    if (effect->duration_10ms) return (uint32_t)effect->duration_10ms * 10;
    if (effect->effect == AG_EFFECT_RISE_FADE) return 600;
    if (effect->effect == AG_EFFECT_PRESS_FLASH) return 250;
    return 0;
}

static void expire_overlays(void) {
    if (!overlays_active) return;
    bool changed = false;
    for (uint8_t i = 0; i < RGB_MATRIX_LED_COUNT; i++) {
        if (!(overlays[i].flags & AG_EFFECT_PRESENT)) continue;
        uint32_t duration = effect_duration_ms(&overlays[i]);
        if (duration == 0) continue;
        if (timer_elapsed32(overlay_started[i]) >= duration) {
            memset(&overlays[i], 0, sizeof(overlays[i]));
            changed = true;
        }
    }
    if (changed) {
        overlays_active = any_overlay_present();
        if (!overlays_active && !global_active) apply_saved_rgb(true);
    }
}

void arkey_task(void) {
    if (!using_usb()) {
        if (global_active || overlays_active || lease_active || capture_active) arkey_restore();
        return;
    }

    if ((global_active || overlays_active || lease_active || capture_active) && timer_elapsed32(last_heartbeat) > AG_WATCHDOG_MS) {
        arkey_restore();
        return;
    }
    if (capture_active && timer_elapsed32(capture_started) >= capture_timeout_ms) capture_active = false;
    if ((state == AG_COMPLETE && timer_elapsed32(state_started) > AG_COMPLETE_DURATION_MS) ||
        (state == AG_ERROR && timer_elapsed32(state_started) > AG_ERROR_DURATION_MS)) {
        stop_global();
    }
    if (global_active && timer_elapsed32(last_decay) >= 20) {
        last_decay = timer_read32();
        for (uint8_t i = 0; i < RGB_MATRIX_LED_COUNT; i++) levels[i] = levels[i] > 8 ? levels[i] - 8 : 0;
    }
    expire_overlays();
    send_next_event();
}

static uint8_t global_value(uint8_t index) {
    if (!global_active || index >= RGB_MATRIX_LED_COUNT) return rgb_matrix_get_val();
    uint8_t value = ((uint16_t)levels[index] * intensity) / 255;
    if (state == AG_COMPLETE) {
        uint8_t phase = (timer_elapsed32(state_started) / 8) & 0xFF;
        int16_t distance_signed = (int16_t)g_led_config.point[index].x - 112;
        uint8_t distance = distance_signed < 0 ? (uint8_t)-distance_signed : (uint8_t)distance_signed;
        int16_t delta_signed = (int16_t)phase - distance * 2;
        uint8_t delta = delta_signed < 0 ? (uint8_t)-delta_signed : (uint8_t)delta_signed;
        value = delta < 32 ? (uint8_t)(255 - delta * 7) : 10;
    } else if (state == AG_ERROR) {
        value = ((timer_elapsed32(state_started) / 180) & 1) ? intensity : 0;
    } else if (value == 0) {
        value = 3;
    }
    return value;
}

void arkey_color(uint8_t index, uint8_t *red, uint8_t *green, uint8_t *blue) {
    if (!global_active || index >= RGB_MATRIX_LED_COUNT) {
        *red = *green = *blue = 0;
        return;
    }
    RGB rgb = hsv_to_rgb((HSV){hue, saturation, global_value(index)});
    *red = rgb.r;
    *green = rgb.g;
    *blue = rgb.b;
}

static uint8_t triangle_wave(uint8_t phase) {
    return phase < 128 ? (uint8_t)(phase * 2) : (uint8_t)((255 - phase) * 2);
}

static uint8_t eased_triangle(uint8_t phase) {
    uint16_t triangle = triangle_wave(phase);
    return (uint8_t)((triangle * triangle + 255) / 255);
}

static uint8_t animation_phase(const arkey_key_effect_t *effect, uint32_t elapsed) {
    uint16_t period = (uint16_t)(3200 - (uint16_t)effect->speed * 10);
    if (period < 650) period = 650;
    return (uint8_t)(((elapsed % period) * 256UL / period) + effect->phase);
}

static uint8_t effect_value(const arkey_key_effect_t *effect, uint32_t elapsed) {
    uint8_t envelope;
    switch (effect->effect) {
        case AG_EFFECT_OFF:
            return 0;
        case AG_EFFECT_SOLID:
            return effect->value;
        case AG_EFFECT_BREATH:
            envelope = eased_triangle(animation_phase(effect, elapsed));
            return (uint8_t)(((uint16_t)effect->value * (32 + ((uint16_t)envelope * 223 / 255))) / 255);
        case AG_EFFECT_SHALLOW_BREATH:
            envelope = eased_triangle(animation_phase(effect, elapsed));
            return (uint8_t)(((uint16_t)effect->value * (166 + ((uint16_t)envelope * 89 / 255))) / 255);
        case AG_EFFECT_DOUBLE_PULSE: {
            uint16_t period = (uint16_t)(1700 - (uint16_t)effect->speed * 4);
            if (period < 700) period = 700;
            uint16_t position = (uint16_t)((elapsed + ((uint32_t)effect->phase * period / 256)) % period);
            uint8_t pulse = 0;
            if (position < 180) pulse = eased_triangle((uint8_t)(position * 255UL / 180));
            else if (position >= 280 && position < 460) pulse = eased_triangle((uint8_t)((position - 280) * 255UL / 180));
            return (uint8_t)((uint16_t)effect->value * pulse / 255);
        }
        case AG_EFFECT_RISE_FADE: {
            uint32_t duration = effect_duration_ms(effect);
            if (elapsed >= duration) return 0;
            uint32_t rise = duration / 5;
            if (rise == 0) rise = 1;
            if (elapsed < rise) return (uint8_t)((uint32_t)effect->value * elapsed / rise);
            return (uint8_t)((uint32_t)effect->value * (duration - elapsed) / (duration - rise));
        }
        case AG_EFFECT_PRESS_FLASH: {
            uint32_t duration = effect_duration_ms(effect);
            if (elapsed >= duration) return 0;
            return (uint8_t)((uint32_t)effect->value * (duration - elapsed) / duration);
        }
        default:
            return 0;
    }
}

static bool system_owns_led(uint8_t index) {
#ifdef NUM_LOCK_INDEX
    if (index == NUM_LOCK_INDEX && host_keyboard_led_state().num_lock) return true;
#endif
#ifdef CAPS_LOCK_INDEX
    if (index == CAPS_LOCK_INDEX && host_keyboard_led_state().caps_lock) return true;
#endif
#ifdef SCROLL_LOCK_INDEX
    if (index == SCROLL_LOCK_INDEX && host_keyboard_led_state().scroll_lock) return true;
#endif
    return false;
}

void arkey_render_overlays(uint8_t led_min, uint8_t led_max) {
    if (!overlays_active || !using_usb()) return;
    if (led_max > RGB_MATRIX_LED_COUNT) led_max = RGB_MATRIX_LED_COUNT;
    for (uint8_t i = led_min; i < led_max; i++) {
        const arkey_key_effect_t *effect = &overlays[i];
        if (!(effect->flags & AG_EFFECT_PRESENT) || system_owns_led(i)) continue;
        uint8_t semantic = effect_value(effect, timer_elapsed32(overlay_started[i]));
        uint8_t mixed;
        if (effect->effect == AG_EFFECT_OFF) {
            mixed = 0; /* Unassigned is forced black and never receives atmosphere. */
        } else {
            mixed = (uint8_t)(((uint16_t)semantic * (100 - atmosphere_mix) + (uint16_t)global_value(i) * atmosphere_mix) / 100);
        }
        RGB rgb = hsv_to_rgb((HSV){effect->hue, effect->saturation, mixed});
        rgb_matrix_set_color(i, rgb.r, rgb.g, rgb.b);
    }
}

bool rgb_matrix_indicators_advanced_kb(uint8_t led_min, uint8_t led_max) {
    arkey_render_overlays(led_min, led_max);
    /* Preserve the normal QMK chain; user indicators intentionally render last. */
    return rgb_matrix_indicators_advanced_user(led_min, led_max);
}
