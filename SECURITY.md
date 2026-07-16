# Security policy

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** flow in the Security tab. Do not
open a public issue for a vulnerability involving command execution, local
socket access, credentials, approval handling, HID parsing, or firmware writes.

Include the affected commit, macOS/Node/Codex versions, keyboard and firmware
revision if relevant, reproduction steps, and expected impact. Do not include
access tokens, private prompts, or unrelated user data.

## Supported code

Security fixes target the current `main` branch. This development project does
not promise long-term support for older builds or compatibility with every
Codex CLI version.

## Security boundary

- Arkey starts Codex App Server locally over newline-delimited JSON on stdio. It
  does not expose App Server on TCP or a public network.
- The daemon socket and state are stored below `~/.arkey`; bindings, task IDs,
  titles, and settings may be persisted, but prompt/reply bodies and microphone
  audio are not intentionally persisted by Arkey.
- Codex authentication remains owned by the locally installed Codex CLI. Arkey
  does not copy or manage Codex access tokens.
- Firmware scripts build only. No repository script automatically flashes a
  device or enters a bootloader.
- The QMK bridge accepts only Arkey frames on the keyboard's existing Raw HID
  interface and restores ordinary lighting after loss of heartbeat.

OpenAI/Codex service-side storage and privacy behavior is governed separately
by the service and account configuration; Arkey makes no claim about it.
