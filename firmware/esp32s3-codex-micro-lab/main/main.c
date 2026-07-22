/* SPDX-License-Identifier: GPL-2.0-or-later */
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "micro_protocol.h"
#include "tinyusb.h"
#include "tinyusb_default_config.h"
#include "class/hid/hid_device.h"

#define CM_USB_VID 0x303A
#define CM_USB_PID 0x8360
#define CM_USB_BCD_DEVICE 0x0100
#define CM_FIRMWARE_VERSION "0.1.5-arkey-esp32s3-lab"
#define CM_UART_LINE_SIZE 384
#define CM_HID_QUEUE_DEPTH 16
#define CM_HID_JSON_SIZE 512
#define CM_UART_TX_QUEUE_DEPTH 32

typedef struct {
    char json[CM_HID_JSON_SIZE];
} cm_hid_message_t;

typedef struct {
    char line[CM_UART_LINE_SIZE];
} cm_uart_message_t;

static const char *TAG = "arkey_micro_lab";
static QueueHandle_t hid_queue;
static QueueHandle_t uart_tx_queue;
static SemaphoreHandle_t hid_report_complete;
static cm_json_accumulator_t host_accumulator;
static cm_input_replay_cache_t input_replay_cache;
static volatile bool usb_mounted;
static volatile bool desktop_connected;

static const uint8_t hid_report_descriptor[] = {
    0x06, 0x00, 0xFF,
    0x09, 0x61,
    0xA1, 0x01,
    0x85, CM_REPORT_ID,
    0x09, 0x62,
    0x15, 0x00,
    0x26, 0xFF, 0x00,
    0x95, 0x3F,
    0x75, 0x08,
    0x81, 0x02,
    0x09, 0x63,
    0x15, 0x00,
    0x26, 0xFF, 0x00,
    0x95, 0x3F,
    0x75, 0x08,
    0x91, 0x82,
    0xC0,
};

static const tusb_desc_device_t device_descriptor = {
    .bLength = sizeof(tusb_desc_device_t),
    .bDescriptorType = TUSB_DESC_DEVICE,
    .bcdUSB = 0x0200,
    .bDeviceClass = 0x00,
    .bDeviceSubClass = 0x00,
    .bDeviceProtocol = 0x00,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor = CM_USB_VID,
    .idProduct = CM_USB_PID,
    .bcdDevice = CM_USB_BCD_DEVICE,
    .iManufacturer = 0x01,
    .iProduct = 0x02,
    .iSerialNumber = 0x00,
    .bNumConfigurations = 0x01,
};

static const char *hid_string_descriptor[] = {
    (char[]){0x09, 0x04},
    "Work Louder",
    "Arkey Codex Micro Lab",
    "Codex Micro RPC",
};

enum {
    ITF_NUM_HID,
    ITF_NUM_TOTAL,
};

#define CM_CONFIG_TOTAL_LENGTH (TUD_CONFIG_DESC_LEN + TUD_HID_INOUT_DESC_LEN)

static const uint8_t hid_configuration_descriptor[] = {
    TUD_CONFIG_DESCRIPTOR(1, ITF_NUM_TOTAL, 0, CM_CONFIG_TOTAL_LENGTH, TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 100),
    TUD_HID_INOUT_DESCRIPTOR(ITF_NUM_HID, 3, HID_ITF_PROTOCOL_NONE, sizeof(hid_report_descriptor), 0x01, 0x81, CM_REPORT_SIZE, 1),
};

static bool uart_queue_object(cJSON *object, bool priority) {
    if (object == NULL || uart_tx_queue == NULL) return false;
    char *encoded = cJSON_PrintUnformatted(object);
    if (encoded == NULL) return false;
    cm_uart_message_t message = {0};
    const size_t length = strlen(encoded);
    bool queued = false;
    if (length < sizeof(message.line)) {
        memcpy(message.line, encoded, length + 1);
        const TickType_t wait = priority ? portMAX_DELAY : 0;
        const BaseType_t result = priority
            ? xQueueSendToFront(uart_tx_queue, &message, wait)
            : xQueueSendToBack(uart_tx_queue, &message, wait);
        queued = result == pdTRUE;
    }
    cJSON_free(encoded);
    return queued;
}

static void uart_tx_task(void *context) {
    (void)context;
    cm_uart_message_t message;
    while (true) {
        if (xQueueReceive(uart_tx_queue, &message, portMAX_DELAY) == pdTRUE) {
            printf("%s\n", message.line);
            fflush(stdout);
        }
    }
}

static void bridge_emit_state(void) {
    cJSON *event = cJSON_CreateObject();
    if (event == NULL) return;
    cJSON_AddStringToObject(event, "event", "bridge");
    cJSON_AddBoolToObject(event, "usbMounted", usb_mounted);
    cJSON_AddBoolToObject(event, "desktopConnected", desktop_connected);
    (void)uart_queue_object(event, false);
    cJSON_Delete(event);
}

static void bridge_emit_ack(uint32_t sequence, bool ok, const char *error_code) {
    cJSON *event = cJSON_CreateObject();
    if (event == NULL) return;
    cJSON_AddStringToObject(event, "event", "ack");
    cJSON_AddNumberToObject(event, "sequence", sequence);
    cJSON_AddBoolToObject(event, "ok", ok);
    if (error_code != NULL) cJSON_AddStringToObject(event, "error", error_code);
    (void)uart_queue_object(event, true);
    cJSON_Delete(event);
}

static bool queue_hid_json(const char *json) {
    if (json == NULL || hid_queue == NULL || strlen(json) >= CM_HID_JSON_SIZE) return false;
    cm_hid_message_t message = {0};
    memcpy(message.json, json, strlen(json) + 1);
    return xQueueSend(hid_queue, &message, pdMS_TO_TICKS(250)) == pdTRUE;
}

static bool send_tinyusb_report(const uint8_t report[CM_REPORT_SIZE], void *context) {
    (void)context;
    for (unsigned attempt = 0; attempt < 200; attempt++) {
        if (!usb_mounted) return false;
        if (tud_hid_n_ready(0)) {
            while (xSemaphoreTake(hid_report_complete, 0) == pdTRUE) {}
            if (!tud_hid_n_report(0, CM_REPORT_ID, &report[1], CM_REPORT_SIZE - 1)) return false;
            return xSemaphoreTake(hid_report_complete, pdMS_TO_TICKS(250)) == pdTRUE;
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
    return false;
}

static void hid_tx_task(void *context) {
    (void)context;
    cm_hid_message_t message;
    while (true) {
        if (xQueueReceive(hid_queue, &message, portMAX_DELAY) == pdTRUE) {
            if (!cm_frame_json(message.json, send_tinyusb_report, NULL)) {
                ESP_LOGW(TAG, "USB HID response could not be sent");
            }
        }
    }
}

static void add_number_if_present(cJSON *destination, const cJSON *source, const char *name) {
    const cJSON *value = cJSON_GetObjectItemCaseSensitive(source, name);
    if (cJSON_IsNumber(value)) cJSON_AddNumberToObject(destination, name, value->valuedouble);
}

static void bridge_emit_slot_status(const cJSON *params) {
    cJSON *event = cJSON_CreateObject();
    cJSON *slots = cJSON_CreateArray();
    if (event == NULL || slots == NULL) {
        cJSON_Delete(event);
        cJSON_Delete(slots);
        return;
    }
    cJSON_AddStringToObject(event, "event", "slot_status");
    cJSON_AddItemToObject(event, "slots", slots);
    if (cJSON_IsArray(params)) {
        const cJSON *item = NULL;
        cJSON_ArrayForEach(item, params) {
            const cJSON *identifier = cJSON_GetObjectItemCaseSensitive(item, "id");
            if (!cJSON_IsObject(item) || !cJSON_IsNumber(identifier) || identifier->valueint < 0 || identifier->valueint > 5) continue;
            cJSON *slot = cJSON_CreateObject();
            if (slot == NULL) continue;
            cJSON_AddNumberToObject(slot, "slot", identifier->valueint);
            add_number_if_present(slot, item, "c");
            add_number_if_present(slot, item, "b");
            add_number_if_present(slot, item, "e");
            add_number_if_present(slot, item, "s");
            cJSON_AddItemToArray(slots, slot);
        }
    }
    (void)uart_queue_object(event, false);
    cJSON_Delete(event);
}

static void bridge_emit_rgb_configuration(void) {
    cJSON *event = cJSON_CreateObject();
    if (event == NULL) return;
    cJSON_AddStringToObject(event, "event", "rgb_config");
    (void)uart_queue_object(event, false);
    cJSON_Delete(event);
}

static cJSON *response_with_id(const cJSON *request) {
    cJSON *response = cJSON_CreateObject();
    const cJSON *identifier = cJSON_GetObjectItemCaseSensitive(request, "id");
    if (response != NULL && identifier != NULL) {
        cJSON *copy = cJSON_Duplicate(identifier, true);
        if (copy != NULL) cJSON_AddItemToObject(response, "id", copy);
    }
    return response;
}

static void handle_host_json(const char *json, void *context) {
    (void)context;
    cJSON *request = cJSON_Parse(json);
    if (request == NULL) return;
    const cJSON *method_item = cJSON_GetObjectItemCaseSensitive(request, "method");
    if (!cJSON_IsString(method_item) || method_item->valuestring == NULL) {
        cJSON_Delete(request);
        return;
    }

    const bool first_handshake = !desktop_connected;
    desktop_connected = true;
    cJSON *response = response_with_id(request);
    if (response == NULL) {
        cJSON_Delete(request);
        return;
    }
    const char *method = method_item->valuestring;
    if (strcmp(method, "sys.version") == 0) {
        cJSON *result = cJSON_CreateObject();
        cJSON_AddStringToObject(result, "version", CM_FIRMWARE_VERSION);
        cJSON_AddItemToObject(response, "result", result);
    } else if (strcmp(method, "device.status") == 0) {
        cJSON *result = cJSON_CreateObject();
        cJSON_AddStringToObject(result, "version", CM_FIRMWARE_VERSION);
        cJSON_AddNumberToObject(result, "profile_index", 0);
        cJSON_AddNumberToObject(result, "layer_index", 0);
        cJSON_AddNumberToObject(result, "battery", 100);
        cJSON_AddBoolToObject(result, "is_charging", true);
        cJSON_AddItemToObject(response, "result", result);
    } else {
        cJSON_AddBoolToObject(response, "result", true);
        if (strcmp(method, "v.oai.thstatus") == 0) {
            bridge_emit_slot_status(cJSON_GetObjectItemCaseSensitive(request, "params"));
        } else if (strcmp(method, "v.oai.rgbcfg") == 0) {
            bridge_emit_rgb_configuration();
        }
    }

    char *encoded = cJSON_PrintUnformatted(response);
    if (encoded != NULL) {
        if (!queue_hid_json(encoded)) ESP_LOGW(TAG, "USB HID response queue is full");
        cJSON_free(encoded);
    }
    if (first_handshake) bridge_emit_state();
    cJSON_Delete(response);
    cJSON_Delete(request);
}

static void handle_uart_command(const char *line) {
    cJSON *request = cJSON_Parse(line);
    if (request == NULL) return;
    const cJSON *command = cJSON_GetObjectItemCaseSensitive(request, "command");
    const cJSON *sequence = cJSON_GetObjectItemCaseSensitive(request, "sequence");
    if (!cJSON_IsString(command) || command->valuestring == NULL || !cJSON_IsNumber(sequence) ||
        sequence->valuedouble < 0 || sequence->valuedouble > 0x7FFFFFFE ||
        (double)(uint32_t)sequence->valuedouble != sequence->valuedouble) {
        cJSON_Delete(request);
        return;
    }
    const uint32_t sequence_number = (uint32_t)sequence->valuedouble;
    if (strcmp(command->valuestring, "hello") == 0) {
        bridge_emit_ack(sequence_number, true, NULL);
        bridge_emit_state();
        cJSON_Delete(request);
        return;
    }
    if (strcmp(command->valuestring, "input") != 0) {
        bridge_emit_ack(sequence_number, false, "unsupported_command");
        cJSON_Delete(request);
        return;
    }
    const cJSON *control_name = cJSON_GetObjectItemCaseSensitive(request, "control");
    const cJSON *phase_name = cJSON_GetObjectItemCaseSensitive(request, "phase");
    cm_phase_t phase;
    const cm_control_t control = cJSON_IsString(control_name) ? cm_control_from_name(control_name->valuestring) : CM_CONTROL_INVALID;
    if (control == CM_CONTROL_INVALID || !cJSON_IsString(phase_name) || !cm_phase_from_name(phase_name->valuestring, &phase)) {
        bridge_emit_ack(sequence_number, false, "invalid_input");
        cJSON_Delete(request);
        return;
    }
    if (!usb_mounted || !desktop_connected) {
        bridge_emit_ack(sequence_number, false, "desktop_not_connected");
        cJSON_Delete(request);
        return;
    }

    const cm_input_replay_result_t replay = cm_input_replay_lookup(&input_replay_cache, sequence_number, control, phase);
    if (replay == CM_INPUT_REPLAY_DUPLICATE) {
        bridge_emit_ack(sequence_number, true, NULL);
        cJSON_Delete(request);
        return;
    }
    if (replay == CM_INPUT_REPLAY_CONFLICT) {
        bridge_emit_ack(sequence_number, false, "sequence_conflict");
        cJSON_Delete(request);
        return;
    }

    char messages[CM_MAX_EVENT_MESSAGES][CM_EVENT_MESSAGE_SIZE] = {{0}};
    const size_t count = cm_build_control_messages(control, phase, messages);
    bool queued = count > 0;
    for (size_t i = 0; i < count && queued; i++) queued = queue_hid_json(messages[i]);
    if (queued) cm_input_replay_record(&input_replay_cache, sequence_number, control, phase);
    bridge_emit_ack(sequence_number, queued, queued ? NULL : "queue_full");
    cJSON_Delete(request);
}

static void uart_rx_task(void *context) {
    (void)context;
    char line[CM_UART_LINE_SIZE];
    while (true) {
        if (fgets(line, sizeof(line), stdin) != NULL) {
            handle_uart_command(line);
        } else {
            clearerr(stdin);
            vTaskDelay(pdMS_TO_TICKS(10));
        }
    }
}

uint8_t const *tud_hid_descriptor_report_cb(uint8_t instance) {
    (void)instance;
    return hid_report_descriptor;
}

uint16_t tud_hid_get_report_cb(uint8_t instance, uint8_t report_id, hid_report_type_t report_type, uint8_t *buffer, uint16_t requested_length) {
    (void)instance;
    (void)report_id;
    (void)report_type;
    (void)buffer;
    (void)requested_length;
    return 0;
}

void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id, hid_report_type_t report_type, uint8_t const *buffer, uint16_t buffer_size) {
    (void)instance;
    if (report_type != HID_REPORT_TYPE_OUTPUT || buffer == NULL) return;
    uint8_t report[CM_REPORT_SIZE] = {0};
    if (buffer_size == CM_REPORT_SIZE && buffer[0] == CM_REPORT_ID) {
        memcpy(report, buffer, CM_REPORT_SIZE);
    } else if (buffer_size == CM_REPORT_SIZE - 1 && report_id == CM_REPORT_ID) {
        report[0] = report_id;
        memcpy(&report[1], buffer, CM_REPORT_SIZE - 1);
    } else {
        return;
    }
    (void)cm_json_accumulator_append(&host_accumulator, report, handle_host_json, NULL);
}

void tud_hid_report_complete_cb(uint8_t instance, uint8_t const *report, uint16_t length) {
    (void)instance;
    (void)report;
    (void)length;
    if (hid_report_complete != NULL) xSemaphoreGive(hid_report_complete);
}

static void tinyusb_event_handler(tinyusb_event_t *event, void *arg) {
    (void)arg;
    if (event == NULL) return;
    if (event->id == TINYUSB_EVENT_ATTACHED) {
        usb_mounted = true;
        bridge_emit_state();
        return;
    }
    if (event->id == TINYUSB_EVENT_DETACHED) {
        usb_mounted = false;
        desktop_connected = false;
        cm_json_accumulator_reset(&host_accumulator);
        if (hid_queue != NULL) xQueueReset(hid_queue);
        bridge_emit_state();
    }
}

void app_main(void) {
    setvbuf(stdin, NULL, _IONBF, 0);
    setvbuf(stdout, NULL, _IONBF, 0);
    cm_json_accumulator_reset(&host_accumulator);
    cm_input_replay_cache_reset(&input_replay_cache);
    hid_queue = xQueueCreate(CM_HID_QUEUE_DEPTH, sizeof(cm_hid_message_t));
    uart_tx_queue = xQueueCreate(CM_UART_TX_QUEUE_DEPTH, sizeof(cm_uart_message_t));
    hid_report_complete = xSemaphoreCreateBinary();
    if (hid_queue == NULL || uart_tx_queue == NULL || hid_report_complete == NULL) {
        ESP_LOGE(TAG, "Unable to allocate bridge queues");
        return;
    }
    if (xTaskCreate(uart_tx_task, "micro_uart_tx", 4096, NULL, 7, NULL) != pdPASS ||
        xTaskCreate(hid_tx_task, "micro_hid_tx", 4096, NULL, 6, NULL) != pdPASS ||
        xTaskCreate(uart_rx_task, "micro_uart_rx", 4096, NULL, 5, NULL) != pdPASS) {
        ESP_LOGE(TAG, "Unable to start bridge tasks");
        return;
    }

    tinyusb_config_t tusb_config = TINYUSB_DEFAULT_CONFIG(tinyusb_event_handler);
    tusb_config.descriptor.device = &device_descriptor;
    tusb_config.descriptor.string = hid_string_descriptor;
    tusb_config.descriptor.string_count = sizeof(hid_string_descriptor) / sizeof(hid_string_descriptor[0]);
    tusb_config.descriptor.full_speed_config = hid_configuration_descriptor;
    ESP_ERROR_CHECK(tinyusb_driver_install(&tusb_config));
    usb_mounted = tud_mounted();
    bridge_emit_state();
    ESP_LOGI(TAG, "ESP32-S3 Codex Micro Lab bridge ready (UART 115200, compile-only lab image)");
}
