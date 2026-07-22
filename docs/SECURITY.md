# Security policy

Report vulnerabilities through GitHub's private “Report a vulnerability” flow. Do not put credentials, Codex content, local paths, USB serial numbers, or firmware backups in a public issue.

## Boundary

- Both local servers bind only to `127.0.0.1`; neither listens on LAN interfaces.
- Tauri uses a random OS-assigned port and single-use 256-bit bootstrap tokens to establish port-scoped-name HttpOnly SameSite sessions. All desktop static resources and APIs require a valid session, and writes also require the exact random localhost Origin.
- The Tauri WebView can navigate only within its random localhost Origin and receives no Tauri IPC permissions. Native dragging, like the other window operations, goes through the authenticated localhost API.
- Only the desktop session can ask Rust to open a browser, toggle the native always-on-top state, or exit the App. A generated browser session shares the same semantic API and serial bridge, but cannot control the Tauri window or mint more browser sessions.
- The browser/Node server validates Host, exact Origin, and an HttpOnly SameSite session cookie for write requests.
- The HTTP and UART layers accept only a fixed semantic control allowlist.
- Browser snapshots contain connection state, firmware version, and sanitized six-slot light parameters only.
- Arkey Web does not read Codex threads, messages, account data, or credentials.
- The only persisted settings are the selected USB-UART path, the desktop always-on-top preference, and a boolean preference for focusing Codex before input. macOS retains the Accessibility grant; Arkey does not store it.
- Repository scripts build and test firmware only; they never flash, erase, or restore a device.

The native USB interoperability behavior is version-sensitive and unsupported. Treat firmware writes and changes to USB identity or HID parsing as privileged operations requiring physical recovery planning.

Loopback authentication prevents unrelated websites and ordinary browsers from using the desktop API. It is not an operating-system sandbox: malware already running as the same user with permission to inspect process memory, debug the WebView, or inject into the process is outside this HTTP security boundary.
