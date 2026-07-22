# Third-party notices

Arkey Web depends on these projects, which retain their own licenses:

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

Exact Node versions are in `package-lock.json`; firmware component versions are
in `firmware/esp32s3-codex-micro-lab/dependencies.lock`.

The compatibility source contains names, USB identity values, report IDs, and
behavior labels needed to test interoperability with the current local Codex
Desktop integration. OpenAI, ChatGPT, Codex, Codex Micro, and Work Louder marks
belong to their owners.

The repository does not include Work Louder firmware/source, a private SDK,
USB captures, Codex Desktop application code, credentials, or vendor assets.
No endorsement, USB identity assignment, certification, service entitlement,
or commercial right is granted by these references.
