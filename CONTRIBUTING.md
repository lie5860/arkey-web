# Contributing to Arkey

Thanks for helping make Arkey safer and easier to adapt. Arkey is an independent,
unofficial public-source project; contributions must not imply endorsement by
OpenAI, Keychron, QMK, or another vendor.

## Before opening a change

- Use an issue to discuss a new board, wire-format change, or App Server API
  dependency before implementing it.
- Keep pull requests focused. Do not mix product research, pricing notes,
  generated reports, session handoffs, or unrelated UI experiments into code.
- Read `AGENTS.md` if an agent will write or review the change. The submitter is
  responsible for reviewing agent-generated code and confirming its origin.

## Development setup

```bash
git clone https://github.com/shuhari04/arkey.git
cd arkey
npm ci
npm run check
./scripts/check-codex-app-server.sh
swift test --package-path apps/ArkeyMac
```

Build the application with `./scripts/build-macos-app.sh`. The script creates
and ad-hoc signs `build/Arkey.app`; it does not install or publish anything.

## Pull-request requirements

Every pull request should explain:

- the user-visible problem and intended behavior;
- files and interfaces changed;
- tests run and their results;
- privacy, compatibility, and rollback implications;
- hardware tested, if any. Say `compile-only` when no physical device was used.

Run at least:

```bash
npm run check
swift test --package-path apps/ArkeyMac
```

UI changes should include a release build. App Server changes should include a
schema check against the installed Codex CLI. Firmware changes must compile in a
clean pinned QMK tree and leave that tree clean afterward.

## New keyboard support

A board pull request must include all of these items in one reviewable series:

1. Exact model, layout, PCB revision, MCU, bootloader, existing VID/PID, and QMK
   target, with links to upstream evidence.
2. A pinned QMK repository and commit plus the license/provenance record.
3. A complete profile: matrix, LED indices, physical geometry, encoder mapping,
   Raw HID usage, and layout hash.
4. A reversible patch or userspace integration and a build-only script that
   never flashes.
5. Host registration, generated contract, tests, CI, recovery steps, binary
   size, and SHA-256.
6. Physical acceptance results for input, layers, encoder, RGB, VIA, USB
   reconnect, watchdog/fail-open, Bluetooth fallback where applicable, and
   recovery firmware. Until then the board remains `compile-only`.

Binary-only firmware contributions are not accepted.

## Safety and interoperability rules

- Do not add private protocols, private SDKs, copied descriptors, or another
  device's USB identity.
- Do not auto-flash, enter DFU, or overwrite firmware during a test or build.
- Do not replace ordinary key behavior for unbound keys.
- Do not expose Codex App Server on a network; Arkey uses local stdio only.
- Do not log or persist prompts, replies, approval payloads, access tokens, or
  microphone audio.

## Licensing contributions

This is a mixed-license repository. By submitting a contribution, you agree to
license it under the license already assigned to its destination:

- first-party app, host, tooling, profiles, tests, and docs: PolyForm
  Noncommercial 1.0.0;
- standalone Arkey QMK module files carrying an MIT SPDX header: MIT;
- patches or modifications to GPL-covered QMK/Keychron files: GPL-2.0-only or
  the controlling compatible upstream license.

Retain upstream copyright and license notices and mark firmware modifications.
Only submit material you have the right to contribute. The project currently
does not use a CLA, so maintainers cannot assume a right to commercially
relicense your contribution later.

See `LICENSE`, `LICENSES/`, `THIRD_PARTY_NOTICES.md`, and `TRADEMARKS.md`. These
notes are project policy, not legal advice.
