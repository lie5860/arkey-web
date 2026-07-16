# Contributing to Arkey

Thanks for helping make Arkey safer and easier to adapt. Arkey is an independent,
unofficial, noncommercial public-source project; contributions must not imply
endorsement by OpenAI, Work Louder, Keychron, QMK, or another vendor.

## Before opening a change

- Use an issue to discuss a new board, wire-format change, or App Server API
  dependency before implementing it.
- Discuss every native-facing Codex Micro Lab behavior or identity change before
  implementation. Lab work has a narrower review boundary than ordinary Arkey.
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
npm pack --dry-run
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

Lab changes must additionally run the Lab Node/TypeScript tests and the acknowledged,
build-only Q6 Pro Lab compile. Never attach the resulting binary to a pull
request or commit it to the repository.

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

- Standard Arkey firmware and new board ports must preserve the board's assigned
  USB identity and must not contain native-facing Micro compatibility behavior.
- The only repository exception is the isolated Q6 Pro experiment under the
  explicitly named `codex-micro-lab` files. It may contain the minimum observed
  identity and behavior needed for local interoperability testing, but must not
  include a private SDK, copied vendor source/assets, credentials, production
  integration, commercial instructions, or any claim of authorization.
- Keep Arkey's Report ID `0x07` mapping protocol visibly separate from the
  native-facing report. Changes require a version, bounds checks, firmware and
  client tests, and an update to `docs/CODEX_MICRO_LAB.md`.
- The native Lab mapping is limited to six Agent slots, six Command slots and
  one Encoder target. `skill` and `cancel` are App Server-only; do not invent a
  mapping to the four joystick directions.
- Do not auto-flash, enter DFU, or overwrite firmware during a test or build.
- Do not replace ordinary key behavior for unbound keys.
- Do not expose Codex App Server on a network; Arkey uses local stdio only.
- Do not log or persist prompts, replies, approval payloads, access tokens, or
  microphone audio.

## Codex Micro Lab pull requests

A Lab pull request must remain inside the release-audited Lab boundary and
include all of the following:

1. A plain statement that the path is unofficial, development-only,
   noncommercial, version-sensitive, and not endorsed by OpenAI or Work Louder.
2. Source-level changes only. Firmware `.bin`, captured proprietary bundles,
   private SDKs, USB captures containing user data, and reverse-engineering
   reports are not accepted.
3. Tests for report framing, target bounds, ACK/error handling, preset/reset,
   App Server-only action skips, and the no-auto-flash build guard.
4. A real compile against the pinned Keychron commit with the explicit
   `--acknowledge-device-identity-test` flag, followed by proof that the upstream
   QMK worktree is clean.
5. Updated operational documentation and an honest `compile-only` or exact
   physical-test boundary.

Do not broaden the Lab identity to another keyboard merely because its firmware
can compile. A new target requires a separate risk and recovery proposal.

## Licensing contributions

This is a mixed-license repository. By submitting a contribution, you agree to
license it under the license already assigned to its destination:

- first-party app, host, tooling, profiles, tests, and docs: PolyForm
  Noncommercial 1.0.0;
- standalone Arkey QMK module files carrying an MIT SPDX header: MIT;
- patches or modifications to GPL-covered QMK/Keychron files: GPL-2.0-only or
  the controlling compatible upstream license.
- `firmware/qmk/codex_micro_lab.c` and `.h`: GPL-2.0-or-later as stated by their
  SPDX headers.

Retain upstream copyright and license notices and mark firmware modifications.
Only submit material you have the right to contribute. The project currently
does not use a CLA, so maintainers cannot assume a right to commercially
relicense your contribution later.

A code license does not grant any right to third-party trademarks, USB
identities, services, device certification, or commercial distribution claims.

See `LICENSE`, `LICENSES/`, `THIRD_PARTY_NOTICES.md`, and `TRADEMARKS.md`. These
notes are project policy, not legal advice.
