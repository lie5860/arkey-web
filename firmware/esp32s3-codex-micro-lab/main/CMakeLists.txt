# SPDX-License-Identifier: GPL-2.0-or-later
idf_component_register(
  SRCS "main.c" "micro_protocol.c"
  INCLUDE_DIRS "."
  REQUIRES esp_tinyusb espressif__cjson esp_driver_uart
)
