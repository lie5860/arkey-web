# Porting Arkey to another QMK keyboard

Arkey is not yet a drop-in JSON plugin for every QMK board. The Q6 Pro ANSI Knob
is the only reference target. A new keyboard requires coordinated host, profile,
firmware, test, and recovery work.

## 1. Identify the exact hardware

Collect evidence for:

- manufacturer, exact model, layout, PCB revision, and wireless/wired variant;
- upstream QMK repository, branch, target, keymap, and a pinned commit;
- MCU, flash/RAM capacity, bootloader, DFU identity, and official recovery path;
- existing USB VID/PID and Raw HID usage;
- matrix rows/columns, `g_led_config`, RGB Matrix LED count, encoder count, and
  the relationship between physical controls, matrix positions, and LED indices.

Do not change the board's VID/PID to match another device. Stop if the source,
revision, or recovery path cannot be verified.

## 2. Check capability and resource constraints

The reference bridge expects:

- QMK Raw HID with 32-byte reports (`RAW_ENABLE = yes` where required);
- RGB Matrix and a board- or keymap-level custom RGB effect;
- a hook for incoming vendor data (`raw_hid_receive` in standard QMK, or the
  board's VIA/vendor command hook when that is the established path);
- a scan/task hook for heartbeat timeout and queued control events;
- a record/encoder hook that can preserve normal input for unbound controls.

Current v2 limits are one encoder, at most 255 LEDs, a 16-byte/128-position
binding mask, up to two 10-byte effect records per frame, and a 32-byte Raw HID
report. A larger board may require a versioned protocol change across both host
and firmware; do not silently truncate data.

## 3. Create the profile

Copy `profiles/keychron-q6-pro-ansi.json` to a board-specific name and update:

- `profileId`, human name, original VID/PID, usage page/usage, and transport mode;
- matrix dimensions and LED count;
- every control ID, QMK keycode label, matrix position, LED index, bindability,
  physical unit rectangle, and normalized UI frame;
- encoder information, character map, and random-animation key set.

The layout hash is SHA-256 over canonical `controls`, `encoder`, `ledCount`, and
`matrix` JSON. Validation rejects duplicates, gaps, out-of-range positions, and
a stale hash.

## 4. Generalize the host registry and generated contract

The current release intentionally hard-codes Q6 in several places. A real port
must update them together:

- `src/profile.ts`: discover/register the new profile instead of exporting only
  `q6ProAnsi`;
- `src/runtime.ts`: remove Q6-specific profile/control assumptions;
- `scripts/generate-firmware-contract.mjs`: accept a profile/target argument;
- `firmware/qmk/arkey_generated.h`: generate a board-specific contract;
- `scripts/build-<board>.sh`: pin, verify, build, and restore the correct target;
- Swift profile loading and board presentation where the layout differs;
- profile, protocol, transport, firmware, runtime, and Swift tests.

The profile and generated firmware contract must share the same layout hash,
matrix size, LED count, effect IDs, and default atmosphere mix. Full hardware
control must fail closed when these values do not match.

## 5. Integrate the QMK module

Prefer the smallest reversible patch or a board userspace integration. The Q6
example demonstrates the required calls:

```c
if (!arkey_process_record(keycode, record)) return false;
arkey_task();
if (arkey_command(data, length)) return true;
```

It also compiles `arkey.c` and registers the `rgb_matrix_kb.inc` custom effect.
For a standard QMK board, the exact hook names may differ. Preserve the board's
existing VIA, wireless, encoder, RGB, and power-management code. Process only
valid Arkey frames and pass all other vendor commands through unchanged.

The firmware must:

- advertise capabilities and the profile hash;
- bounds-check every length, LED, matrix coordinate, enum, and revision;
- require capture mode before swallowing a key for binding;
- keep unbound keys and encoder actions normal;
- restore lighting after heartbeat loss, daemon stop, USB loss, or explicit
  restore;
- avoid full control over transports that cannot carry Raw HID.

## 6. Build safely

The board script must verify repository, commit, target metadata, MCU,
bootloader, and expected USB identity. It must refuse dirty files, install only
temporary integration files, and restore upstream state in an EXIT/INT/TERM
trap. It may create a binary and hash; it must never flash.

Add the build to the GitHub Actions firmware matrix. A source contribution must
include every file needed to reproduce the binary under the controlling QMK and
upstream licenses.

## 7. Test before declaring support

Required automated coverage:

- frame encoding/decoding, invalid lengths, capability negotiation, and ACKs;
- profile schema, layout hash, matrix/LED map, and transport matching;
- watchdog/fail-open, binding capture, ordinary-key pass-through, and reconnect;
- daemon task/action/approval flow and Swift client profile rendering;
- a real pinned firmware compile with a clean tree afterward.

Required physical coverage is the checklist in `docs/FIRMWARE.md`, adapted to
the new board and its official recovery process. A compile-only port is useful,
but it must remain labeled `compile-only` until this evidence exists.

## 8. Submit the board

Follow `CONTRIBUTING.md`. Include upstream links, exact revision, patch,
profile, generated contract, build log, firmware size, SHA-256, CI result,
recovery plan, and physical acceptance evidence. Do not submit only a binary.
