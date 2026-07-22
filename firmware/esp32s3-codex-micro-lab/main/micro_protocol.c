/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "micro_protocol.h"

#include <stdio.h>
#include <string.h>

typedef struct {
    const char *name;
    cm_control_t control;
} cm_named_control_t;

static const cm_named_control_t named_controls[] = {
    {"agent-1", CM_CONTROL_AGENT_1},
    {"agent-2", CM_CONTROL_AGENT_2},
    {"agent-3", CM_CONTROL_AGENT_3},
    {"agent-4", CM_CONTROL_AGENT_4},
    {"agent-5", CM_CONTROL_AGENT_5},
    {"agent-6", CM_CONTROL_AGENT_6},
    {"fast", CM_CONTROL_FAST},
    {"approve", CM_CONTROL_APPROVE},
    {"decline", CM_CONTROL_DECLINE},
    {"continue", CM_CONTROL_CONTINUE},
    {"ptt", CM_CONTROL_PTT},
    {"send", CM_CONTROL_SEND},
    {"reasoning-press", CM_CONTROL_REASONING_PRESS},
    {"encoder-cw", CM_CONTROL_ENCODER_CW},
    {"encoder-ccw", CM_CONTROL_ENCODER_CCW},
    {"joystick-up", CM_CONTROL_JOYSTICK_UP},
    {"joystick-right", CM_CONTROL_JOYSTICK_RIGHT},
    {"joystick-down", CM_CONTROL_JOYSTICK_DOWN},
    {"joystick-left", CM_CONTROL_JOYSTICK_LEFT},
};

cm_control_t cm_control_from_name(const char *name) {
    if (name == NULL) return CM_CONTROL_INVALID;
    for (size_t i = 0; i < sizeof(named_controls) / sizeof(named_controls[0]); i++) {
        if (strcmp(name, named_controls[i].name) == 0) return named_controls[i].control;
    }
    return CM_CONTROL_INVALID;
}

bool cm_phase_from_name(const char *name, cm_phase_t *phase) {
    if (name == NULL || phase == NULL) return false;
    if (strcmp(name, "down") == 0) *phase = CM_PHASE_DOWN;
    else if (strcmp(name, "up") == 0) *phase = CM_PHASE_UP;
    else if (strcmp(name, "tap") == 0) *phase = CM_PHASE_TAP;
    else return false;
    return true;
}

static bool is_agent(cm_control_t control) {
    return control >= CM_CONTROL_AGENT_1 && control <= CM_CONTROL_AGENT_6;
}

static bool is_joystick(cm_control_t control) {
    return control >= CM_CONTROL_JOYSTICK_UP && control <= CM_CONTROL_JOYSTICK_LEFT;
}

static bool is_encoder_turn(cm_control_t control) {
    return control == CM_CONTROL_ENCODER_CW || control == CM_CONTROL_ENCODER_CCW;
}

static const char *command_key(cm_control_t control) {
    static const char *const keys[] = {"ACT06", "ACT07", "ACT08", "ACT09", "ACT10", "ACT12"};
    if (control < CM_CONTROL_FAST || control > CM_CONTROL_SEND) return NULL;
    return keys[control - CM_CONTROL_FAST];
}

static int joystick_angle(cm_control_t control) {
    static const int angles[] = {90, 0, 270, 180};
    return is_joystick(control) ? angles[control - CM_CONTROL_JOYSTICK_UP] : 0;
}

static bool build_one(cm_control_t control, int action, char output[CM_EVENT_MESSAGE_SIZE]) {
    int written = -1;
    if (is_agent(control)) {
        int slot = control - CM_CONTROL_AGENT_1;
        written = snprintf(output, CM_EVENT_MESSAGE_SIZE, "{\"method\":\"v.oai.hid\",\"params\":{\"k\":\"AG%02d\",\"act\":%d,\"ag\":%d}}", slot, action, slot);
    } else if (command_key(control) != NULL) {
        written = snprintf(output, CM_EVENT_MESSAGE_SIZE, "{\"method\":\"v.oai.hid\",\"params\":{\"k\":\"%s\",\"act\":%d,\"ag\":0}}", command_key(control), action);
    } else if (control == CM_CONTROL_REASONING_PRESS) {
        written = snprintf(output, CM_EVENT_MESSAGE_SIZE, "{\"method\":\"v.oai.hid\",\"params\":{\"k\":\"ENC_PRESS\",\"act\":%d,\"ag\":0}}", action);
    } else if (is_encoder_turn(control)) {
        written = snprintf(output, CM_EVENT_MESSAGE_SIZE, "{\"method\":\"v.oai.hid\",\"params\":{\"k\":\"%s\",\"act\":2,\"ag\":0}}", control == CM_CONTROL_ENCODER_CW ? "ENC_CW" : "ENC_CC");
    } else if (is_joystick(control)) {
        written = snprintf(output, CM_EVENT_MESSAGE_SIZE, "{\"method\":\"v.oai.rad\",\"params\":{\"a\":%d,\"d\":%d}}", joystick_angle(control), action ? 1 : 0);
    }
    return written > 0 && written < CM_EVENT_MESSAGE_SIZE;
}

size_t cm_build_control_messages(cm_control_t control, cm_phase_t phase, char messages[CM_MAX_EVENT_MESSAGES][CM_EVENT_MESSAGE_SIZE]) {
    if (control == CM_CONTROL_INVALID || messages == NULL) return 0;
    if (is_encoder_turn(control)) return build_one(control, 2, messages[0]) ? 1 : 0;
    if (phase == CM_PHASE_DOWN) return build_one(control, 1, messages[0]) ? 1 : 0;
    if (phase == CM_PHASE_UP) return build_one(control, 0, messages[0]) ? 1 : 0;
    if (!build_one(control, 1, messages[0]) || !build_one(control, 0, messages[1])) return 0;
    return 2;
}

void cm_input_replay_cache_reset(cm_input_replay_cache_t *cache) {
    if (cache == NULL) return;
    memset(cache, 0, sizeof(*cache));
}

cm_input_replay_result_t cm_input_replay_lookup(const cm_input_replay_cache_t *cache, uint32_t sequence, cm_control_t control, cm_phase_t phase) {
    if (cache == NULL) return CM_INPUT_REPLAY_NEW;
    for (size_t i = 0; i < CM_INPUT_REPLAY_CAPACITY; i++) {
        const cm_input_replay_entry_t *entry = &cache->entries[i];
        if (!entry->used || entry->sequence != sequence) continue;
        return entry->control == control && entry->phase == phase ? CM_INPUT_REPLAY_DUPLICATE : CM_INPUT_REPLAY_CONFLICT;
    }
    return CM_INPUT_REPLAY_NEW;
}

void cm_input_replay_record(cm_input_replay_cache_t *cache, uint32_t sequence, cm_control_t control, cm_phase_t phase) {
    if (cache == NULL) return;
    cache->entries[cache->next] = (cm_input_replay_entry_t){
        .used = true,
        .sequence = sequence,
        .control = control,
        .phase = phase,
    };
    cache->next = (cache->next + 1) % CM_INPUT_REPLAY_CAPACITY;
}

bool cm_frame_json(const char *json, cm_report_sink_t sink, void *context) {
    if (json == NULL || sink == NULL) return false;
    const size_t length = strlen(json);
    const size_t framed_length = length + 1;
    size_t offset = 0;
    do {
        uint8_t report[CM_REPORT_SIZE] = {CM_REPORT_ID, CM_RPC_CHANNEL, 0};
        size_t count = framed_length - offset;
        if (count > CM_REPORT_PAYLOAD_SIZE) count = CM_REPORT_PAYLOAD_SIZE;
        for (size_t i = 0; i < count; i++) {
            const size_t position = offset + i;
            report[3 + i] = position < length ? (uint8_t)json[position] : (uint8_t)'\n';
        }
        offset += count;
        report[2] = (uint8_t)count;
        if (!sink(report, context)) return false;
    } while (offset < framed_length);
    return true;
}

void cm_json_accumulator_reset(cm_json_accumulator_t *accumulator) {
    if (accumulator == NULL) return;
    accumulator->length = 0;
    accumulator->buffer[0] = '\0';
}

static bool json_complete(const char *json, size_t length) {
    int depth = 0;
    bool in_string = false;
    bool escaped = false;
    bool started = false;
    for (size_t i = 0; i < length; i++) {
        const char ch = json[i];
        if (in_string) {
            if (escaped) escaped = false;
            else if (ch == '\\') escaped = true;
            else if (ch == '"') in_string = false;
            continue;
        }
        if (ch == '"') in_string = true;
        else if (ch == '{' || ch == '[') {
            depth++;
            started = true;
        } else if (ch == '}' || ch == ']') {
            depth--;
            if (depth < 0) return false;
        }
    }
    return started && depth == 0 && !in_string;
}

bool cm_json_accumulator_append(cm_json_accumulator_t *accumulator, const uint8_t report[CM_REPORT_SIZE], cm_json_sink_t sink, void *context) {
    if (accumulator == NULL || report == NULL || sink == NULL) return false;
    if (report[0] != CM_REPORT_ID || report[1] != CM_RPC_CHANNEL || report[2] > CM_REPORT_PAYLOAD_SIZE) return false;
    const size_t count = report[2];
    if (accumulator->length + count >= sizeof(accumulator->buffer)) {
        cm_json_accumulator_reset(accumulator);
        return false;
    }
    memcpy(&accumulator->buffer[accumulator->length], &report[3], count);
    accumulator->length += count;
    accumulator->buffer[accumulator->length] = '\0';

    char *newline = memchr(accumulator->buffer, '\n', accumulator->length);
    while (newline != NULL) {
        *newline = '\0';
        if (newline != accumulator->buffer) sink(accumulator->buffer, context);
        const size_t consumed = (size_t)(newline - accumulator->buffer) + 1;
        memmove(accumulator->buffer, &accumulator->buffer[consumed], accumulator->length - consumed);
        accumulator->length -= consumed;
        accumulator->buffer[accumulator->length] = '\0';
        newline = memchr(accumulator->buffer, '\n', accumulator->length);
    }
    if (accumulator->length > 0 && json_complete(accumulator->buffer, accumulator->length)) {
        sink(accumulator->buffer, context);
        cm_json_accumulator_reset(accumulator);
    }
    return true;
}
