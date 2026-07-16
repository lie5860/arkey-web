# Q6 Pro example firmware provenance

- Upstream: <https://github.com/Keychron/qmk_firmware>
- Branch containing the pinned commit: `bluetooth_playground`
- Pinned commit: `618127a725a1773e85f13455602cf6f72ab4de17`
- QMK target: `keychron/q6_pro/ansi_encoder`
- Example hardware: Keychron Q6 Pro ANSI Knob, STM32L432, STM32 DFU
- Arkey change date: 2026-07-17

`keychron-q6-pro.patch` changes the upstream `q6_pro.c` and `rules.mk` files to
call the Arkey module and enable the custom RGB Matrix effect. The build script
copies the four files under `firmware/qmk/` into a clean pinned Keychron tree,
applies the patch, compiles the VIA keymap, and then restores the upstream tree.
It never flashes a keyboard.

The patch is GPL-2.0-only. The standalone Arkey module files carry MIT SPDX
headers. The combined firmware image remains subject to every applicable
upstream license. See the root `LICENSE` scope map and `LICENSES/`.
