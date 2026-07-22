# Instructions for coding agents

This repository intentionally contains only the ESP32-S3 Codex Micro hardware lab, its localhost Web control surface, and the temporary Node serial bridge.

## Boundaries

- Do not add QMK, Keychron firmware, Codex App Server, a Swift macOS client, Virtual Lab, CI, session management, or message/composer features.
- Do not expose Codex thread IDs, turn IDs, messages, credentials, account data, or USB serial numbers to Web.
- The UART protocol is a fixed semantic allowlist. Never add raw USB/HID forwarding from Web.
- Never flash, erase, or restore hardware automatically. A write requires recovery preflight and a fresh explicit confirmation immediately before the command.
- Do not claim a build is hardware-verified.
- Keep generated firmware, backups, diagnostic or private screenshots, logs, `node_modules`, `dist`, and `build` out of Git. Sanitized screenshots created explicitly for README documentation are allowed under `docs/assets/`.

## Required checks

```bash
npm ci
npm run check
npm run firmware:build
```

Firmware builds require ESP-IDF 6.0.1 and the explicit identity-test acknowledgement already embedded in the npm script. The script must remain compile-only.

If a future Rust launcher is added, it must replace both the fixed WebView window and the serial bridge before Node can be removed.
