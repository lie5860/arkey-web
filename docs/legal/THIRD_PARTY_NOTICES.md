# Upstream and third-party notices

Arkey Web is a derivative of [shuhari04/arkey](https://github.com/shuhari04/arkey). The repository retains the upstream Git history and required notice:

> Copyright 2026 shuhari04.

The original Arkey project established the Codex Micro Lab research path used here, including the current experimental native HID compatibility model, fixed control semantics, and six-slot status behavior. This fork ports that work from the upstream QMK/Keychron implementation to an ESP32-S3 firmware and adds a Web/USB-UART control path. Upstream files and derived portions remain subject to the upstream path-specific license terms and their SPDX headers; see the [upstream license](https://github.com/shuhari04/arkey/blob/main/LICENSE) and this repository's root [`LICENSE`](../../LICENSE).

Arkey Web also depends on these projects, which retain their own licenses:

| Component | Version | License | Source |
| --- | --- | --- | --- |
| React / React DOM | lockfile version | MIT | <https://github.com/facebook/react> |
| Phosphor Icons | `2.1.10` | MIT | <https://github.com/phosphor-icons/react> |
| serialport | `13.0.0` | MIT | <https://github.com/serialport/node-serialport> |
| TypeScript | lockfile version, development only | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| Vite | lockfile version, development only | MIT | <https://github.com/vitejs/vite> |
| ESP-IDF | `6.0.1`, build toolchain | Apache-2.0 and component-level licenses | <https://github.com/espressif/esp-idf> |
| Espressif esp_tinyusb | `2.2.1` | Apache-2.0 | <https://components.espressif.com/components/espressif/esp_tinyusb> |
| TinyUSB | transitive through esp_tinyusb | MIT | <https://github.com/hathach/tinyusb> |
| Espressif cJSON component | `1.7.19~2` | MIT | <https://components.espressif.com/components/espressif/cjson> |

Exact Node versions are in `package-lock.json`; firmware component versions are in `firmware/esp32s3-codex-micro-lab/dependencies.lock`.

The compatibility source contains names, USB identity values, report IDs, and behavior labels needed to test interoperability with the current local Codex Desktop integration. OpenAI, ChatGPT, Codex, Codex Micro, Work Louder, and Arkey marks belong to their respective owners.

The repository does not include Work Louder firmware/source, a private SDK, USB captures, Codex Desktop application code, credentials, or vendor assets. No endorsement, USB identity assignment, certification, service entitlement, or commercial right is granted by these references.

