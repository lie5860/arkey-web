/* SPDX-License-Identifier: MIT */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "quantum.h"
#include "arkey_generated.h"

/*
 * Arkey keeps the original 32-byte v1 envelope. Protocol v2 is exposed as
 * an extension capability so a v1 host can continue to use global lighting.
 */
#define AG_REPORT_SIZE 32
#define AG_HEADER_SIZE 6
#define AG_MAX_PAYLOAD (AG_REPORT_SIZE - AG_HEADER_SIZE)

#define AG_MAGIC_0 0xB0
#define AG_MAGIC_1 0x47
#define AG_VERSION 1
#define AG_EXTENSION_VERSION 2

#define AG_HELLO 0x01
#define AG_CAPABILITIES 0x02
#define AG_SET_STATE 0x03
#define AG_KEY_EVENTS 0x04
#define AG_HEARTBEAT 0x05
#define AG_RESTORE 0x06
#define AG_SET_KEY_EFFECTS 0x10
#define AG_CLEAR_KEY_EFFECTS 0x11
#define AG_CONTROL_EVENT 0x13
#define AG_SET_CAPTURE_MODE 0x14
#define AG_SET_BINDING_MASK 0x15
#define AG_ACK 0x7F

#define AG_FEATURE_KEY_EFFECTS (1UL << 0)
#define AG_FEATURE_CONTROL_EVENTS (1UL << 1)
#define AG_FEATURE_CAPTURE_MODE (1UL << 2)
#define AG_FEATURE_BINDING_MASK (1UL << 3)
#define AG_FEATURE_STAGED_EFFECTS (1UL << 4)
#define AG_FEATURE_USB_FAIL_OPEN (1UL << 5)
#define AG_FEATURE_FLAGS (AG_FEATURE_KEY_EFFECTS | AG_FEATURE_CONTROL_EVENTS | AG_FEATURE_CAPTURE_MODE | AG_FEATURE_BINDING_MASK | AG_FEATURE_STAGED_EFFECTS | AG_FEATURE_USB_FAIL_OPEN)

#define AG_WATCHDOG_MS 3000
#define AG_CAPTURE_MAX_MS 30000
#define AG_EVENT_QUEUE_SIZE 16
#define AG_BINDING_MASK_BYTES 16

bool arkey_command(uint8_t *data, uint8_t length);
bool arkey_process_record(uint16_t keycode, keyrecord_t *record);
void arkey_task(void);
void arkey_restore(void);
void arkey_color(uint8_t index, uint8_t *red, uint8_t *green, uint8_t *blue);
void arkey_render_overlays(uint8_t led_min, uint8_t led_max);
