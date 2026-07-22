# Security policy

Report vulnerabilities through GitHub's private “Report a vulnerability” flow.
Do not put credentials, Codex content, local paths, USB serial numbers, or
firmware backups in a public issue.

## Boundary

- The Web server binds only to `127.0.0.1` and validates Host, exact Origin, and
  an HttpOnly SameSite session cookie for write requests.
- The HTTP and UART layers accept only a fixed semantic control allowlist.
- Browser snapshots contain connection state, firmware version, and sanitized
  six-slot light parameters only.
- Arkey Web does not read Codex threads, messages, account data, or credentials.
- The only persisted setting is the selected USB-UART path.
- Repository scripts build and test firmware only; they never flash, erase, or
  restore a device.

The native USB interoperability behavior is version-sensitive and unsupported.
Treat firmware writes and changes to USB identity or HID parsing as privileged
operations requiring physical recovery planning.
