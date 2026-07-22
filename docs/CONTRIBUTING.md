# Contributing

Keep changes inside the narrow Web → UART → ESP32-S3 → native USB HID chain described in [ARCHITECTURE.md](ARCHITECTURE.md).

Before submitting a change:

```bash
npm ci
npm run check
```

For firmware changes, also build with ESP-IDF 6.0.1:

```bash
npm run firmware:build
```

Report build-only and physical results separately. Never include firmware binaries, flash backups, local device paths, Codex data, screenshots containing private content, or credentials in a commit.

