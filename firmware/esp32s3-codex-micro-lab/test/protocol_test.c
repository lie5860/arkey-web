/* SPDX-License-Identifier: GPL-2.0-or-later */
#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "micro_protocol.h"

typedef struct {
    uint8_t reports[8][CM_REPORT_SIZE];
    size_t count;
} report_capture_t;

typedef struct {
    char messages[4][256];
    size_t count;
} json_capture_t;

static bool capture_report(const uint8_t report[CM_REPORT_SIZE], void *context) {
    report_capture_t *capture = context;
    assert(capture->count < 8);
    memcpy(capture->reports[capture->count++], report, CM_REPORT_SIZE);
    return true;
}

static void capture_json(const char *json, void *context) {
    json_capture_t *capture = context;
    assert(capture->count < 4);
    snprintf(capture->messages[capture->count++], sizeof(capture->messages[0]), "%s", json);
}

static void test_agent_press_release(void) {
    char messages[CM_MAX_EVENT_MESSAGES][CM_EVENT_MESSAGE_SIZE] = {{0}};
    assert(cm_control_from_name("agent-2") == CM_CONTROL_AGENT_2);
    assert(cm_build_control_messages(CM_CONTROL_AGENT_2, CM_PHASE_TAP, messages) == 2);
    assert(strcmp(messages[0], "{\"method\":\"v.oai.hid\",\"params\":{\"k\":\"AG01\",\"act\":1,\"ag\":1}}") == 0);
    assert(strcmp(messages[1], "{\"method\":\"v.oai.hid\",\"params\":{\"k\":\"AG01\",\"act\":0,\"ag\":1}}") == 0);
}

static void test_native_controls(void) {
    char messages[CM_MAX_EVENT_MESSAGES][CM_EVENT_MESSAGE_SIZE] = {{0}};
    assert(cm_build_control_messages(CM_CONTROL_APPROVE, CM_PHASE_DOWN, messages) == 1);
    assert(strstr(messages[0], "\"k\":\"ACT07\"") != NULL);
    assert(cm_build_control_messages(CM_CONTROL_ENCODER_CCW, CM_PHASE_TAP, messages) == 1);
    assert(strstr(messages[0], "\"k\":\"ENC_CC\"") != NULL);
    assert(cm_build_control_messages(CM_CONTROL_JOYSTICK_LEFT, CM_PHASE_UP, messages) == 1);
    assert(strcmp(messages[0], "{\"method\":\"v.oai.rad\",\"params\":{\"a\":180,\"d\":0}}") == 0);
}

static void test_framing_and_accumulation(void) {
    const char *json = "{\"id\":7,\"method\":\"sys.version\",\"params\":{\"padding\":\"abcdefghijklmnopqrstuvwxyz0123456789\"}}";
    report_capture_t reports = {0};
    assert(cm_frame_json(json, capture_report, &reports));
    assert(reports.count == 2);
    for (size_t i = 0; i < reports.count; i++) {
        assert(reports.reports[i][0] == CM_REPORT_ID);
        assert(reports.reports[i][1] == CM_RPC_CHANNEL);
        assert(reports.reports[i][2] <= CM_REPORT_PAYLOAD_SIZE);
    }

    cm_json_accumulator_t accumulator;
    cm_json_accumulator_reset(&accumulator);
    json_capture_t decoded = {0};
    for (size_t i = 0; i < reports.count; i++) {
        assert(cm_json_accumulator_append(&accumulator, reports.reports[i], capture_json, &decoded));
    }
    assert(decoded.count == 1);
    assert(strcmp(decoded.messages[0], json) == 0);
}

static void test_input_replay_cache(void) {
    cm_input_replay_cache_t cache;
    cm_input_replay_cache_reset(&cache);

    assert(cm_input_replay_lookup(&cache, 42, CM_CONTROL_AGENT_1, CM_PHASE_DOWN) == CM_INPUT_REPLAY_NEW);
    cm_input_replay_record(&cache, 42, CM_CONTROL_AGENT_1, CM_PHASE_DOWN);
    assert(cm_input_replay_lookup(&cache, 42, CM_CONTROL_AGENT_1, CM_PHASE_DOWN) == CM_INPUT_REPLAY_DUPLICATE);
    assert(cm_input_replay_lookup(&cache, 42, CM_CONTROL_AGENT_2, CM_PHASE_DOWN) == CM_INPUT_REPLAY_CONFLICT);

    for (uint32_t sequence = 100; sequence < 100 + CM_INPUT_REPLAY_CAPACITY; sequence++) {
        cm_input_replay_record(&cache, sequence, CM_CONTROL_FAST, CM_PHASE_TAP);
    }
    assert(cm_input_replay_lookup(&cache, 42, CM_CONTROL_AGENT_1, CM_PHASE_DOWN) == CM_INPUT_REPLAY_NEW);
}

int main(void) {
    test_agent_press_release();
    test_native_controls();
    test_framing_and_accumulation();
    test_input_replay_cache();
    puts("ESP32-S3 Codex Micro protocol tests passed");
    return 0;
}
