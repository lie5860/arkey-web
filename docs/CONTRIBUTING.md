# Contributing

Keep changes inside the narrow Web → native USB CDC → ESP32-S3 → native USB HID chain described in [ARCHITECTURE.md](ARCHITECTURE.md).

Before submitting a change:

```bash
npm ci
npm run check
```

Desktop checks require Rust stable and the current platform's Tauri prerequisites. `npm run check` runs both the existing Node/Web tests and the Rust desktop unit tests.

For firmware changes, also build with ESP-IDF 6.0.1:

```bash
npm run firmware:build
```

Report build-only and physical results separately. Never include firmware binaries, flash backups, local device paths, Codex data, screenshots containing private content, or credentials in a commit.
