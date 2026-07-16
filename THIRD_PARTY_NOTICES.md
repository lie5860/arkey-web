# Third-party notices

Arkey fetches or depends on the following third-party projects. They are not
relicensed under PolyForm Noncommercial.

| Component | Pinned version | License | Source |
| --- | --- | --- | --- |
| DynamicNotchKit | `cd0b3e52d537db115ad3a9d89601f20e0bee8d27` | MIT | <https://github.com/MrKai77/DynamicNotchKit> |
| node-hid | lockfile version | MIT OR X11 | <https://github.com/node-hid/node-hid> |
| TypeScript | lockfile version, development only | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| Keychron QMK firmware | `618127a725a1773e85f13455602cf6f72ab4de17` | GPL-2.0-only and other file-level licenses | <https://github.com/Keychron/qmk_firmware> |
| QMK Firmware | inherited by the Keychron fork | GPL-2.0 and other file-level licenses | <https://github.com/qmk/qmk_firmware> |

Transitive Node dependencies and exact versions are recorded in
`package-lock.json`. Swift dependencies and revisions are recorded in
`apps/ArkeyMac/Package.resolved`. When distributing a built application or
firmware binary, include all applicable upstream notices and corresponding
source as required by those licenses.
