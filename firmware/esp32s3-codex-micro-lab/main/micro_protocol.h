/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define CM_REPORT_ID 0x06
#define CM_RPC_CHANNEL 0x02
#define CM_REPORT_SIZE 64
#define CM_REPORT_PAYLOAD_SIZE 61
#define CM_JSON_BUFFER_SIZE 8192
#define CM_MAX_EVENT_MESSAGES 2
#define CM_EVENT_MESSAGE_SIZE 128
#define CM_INPUT_REPLAY_CAPACITY 16

typedef enum {
    CM_PHASE_DOWN,
    CM_PHASE_UP,
    CM_PHASE_TAP,
} cm_phase_t;

typedef enum {
    CM_CONTROL_AGENT_1,
    CM_CONTROL_AGENT_2,
    CM_CONTROL_AGENT_3,
    CM_CONTROL_AGENT_4,
    CM_CONTROL_AGENT_5,
    CM_CONTROL_AGENT_6,
    CM_CONTROL_FAST,
    CM_CONTROL_APPROVE,
    CM_CONTROL_DECLINE,
    CM_CONTROL_CONTINUE,
    CM_CONTROL_PTT,
    CM_CONTROL_SEND,
    CM_CONTROL_REASONING_PRESS,
    CM_CONTROL_ENCODER_CW,
    CM_CONTROL_ENCODER_CCW,
    CM_CONTROL_JOYSTICK_UP,
    CM_CONTROL_JOYSTICK_RIGHT,
    CM_CONTROL_JOYSTICK_DOWN,
    CM_CONTROL_JOYSTICK_LEFT,
    CM_CONTROL_INVALID,
} cm_control_t;

typedef enum {
    CM_INPUT_REPLAY_NEW,
    CM_INPUT_REPLAY_DUPLICATE,
    CM_INPUT_REPLAY_CONFLICT,
} cm_input_replay_result_t;

typedef struct {
    bool used;
    uint32_t sequence;
    cm_control_t control;
    cm_phase_t phase;
} cm_input_replay_entry_t;

typedef struct {
    cm_input_replay_entry_t entries[CM_INPUT_REPLAY_CAPACITY];
    size_t next;
} cm_input_replay_cache_t;

typedef struct {
    char buffer[CM_JSON_BUFFER_SIZE];
    size_t length;
} cm_json_accumulator_t;

typedef bool (*cm_report_sink_t)(const uint8_t report[CM_REPORT_SIZE], void *context);
typedef void (*cm_json_sink_t)(const char *json, void *context);

cm_control_t cm_control_from_name(const char *name);
bool cm_phase_from_name(const char *name, cm_phase_t *phase);
size_t cm_build_control_messages(cm_control_t control, cm_phase_t phase, char messages[CM_MAX_EVENT_MESSAGES][CM_EVENT_MESSAGE_SIZE]);
bool cm_frame_json(const char *json, cm_report_sink_t sink, void *context);
void cm_json_accumulator_reset(cm_json_accumulator_t *accumulator);
bool cm_json_accumulator_append(cm_json_accumulator_t *accumulator, const uint8_t report[CM_REPORT_SIZE], cm_json_sink_t sink, void *context);
void cm_input_replay_cache_reset(cm_input_replay_cache_t *cache);
cm_input_replay_result_t cm_input_replay_lookup(const cm_input_replay_cache_t *cache, uint32_t sequence, cm_control_t control, cm_phase_t phase);
void cm_input_replay_record(cm_input_replay_cache_t *cache, uint32_t sequence, cm_control_t control, cm_phase_t phase);
