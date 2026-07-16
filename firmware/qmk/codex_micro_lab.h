/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "quantum.h"

#define CM_REPORT_SIZE 64
#define CM_TARGET_COUNT 17

bool codex_micro_lab_command(uint8_t *data, uint8_t length);
bool codex_micro_lab_process_record(uint16_t keycode, keyrecord_t *record);
bool codex_micro_lab_encoder_preprocess(uint8_t index, bool clockwise);
void codex_micro_lab_task(void);
