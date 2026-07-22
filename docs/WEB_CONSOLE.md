# Localhost Web Console

The Arkey Web console provides one keyboard surface with two explicitly
selected local transports. The default needs no keyboard and uses App Server:

```text
browser on 127.0.0.1
  -> Arkey Web server
  -> Arkey Unix-socket RPC
  -> Arkey daemon
  -> codex app-server over stdio
```

The optional ESP32-S3 Hardware Lab uses a user-selected USB-UART port:

```text
browser on 127.0.0.1
  -> Arkey Web server
  -> fixed semantic serial commands
  -> ESP32-S3 native USB report 0x06
  -> ChatGPT Desktop
```

Neither mode loads a firmware build script, probes a bootloader, or writes
hardware. The serial mode does not start `codex app-server`. Full protocol,
identity, electrical, and compile-only boundaries are in
[`CODEX_MICRO_ESP32S3_LAB.md`](CODEX_MICRO_ESP32S3_LAB.md).

## Run

Requirements are Node.js 20 or newer and a local Codex CLI that supports
`app-server`.

```bash
npm ci
npm run check
npm run web
```

Open <http://127.0.0.1:4765>. The production server intentionally rejects
non-loopback hosts and is not intended for LAN deployment.

## Keyboard settings

The main screen contains only the compact virtual keyboard. Agent state is
shown by the six key lights, and command help appears on hover or keyboard
focus. The lower-left control combines the three transport/status lights with
the settings entry. It opens the panel that selects App Server or ESP32-S3
native hardware; the application never auto-falls back between them. The
following bindings and runtime paths apply only to App Server mode.

Agent 1 through 6 are fixed Arkey slots rather than six dynamically created
tasks. For each slot, the settings panel can:

- bind one unoccupied recent local thread returned by `thread/list` (CLI, VS
  Code, or App Server source), with exact current-directory matches shown first;
- start a new App Server thread in the slot;
- replace the slot's binding after checking that no turn or approval is active;
- unlink the slot without deleting the Codex thread.

Candidate thread IDs never reach browser JavaScript. The localhost server
replaces each ID with a short-lived opaque selection token. App Server has no
separate Desktop source kind, but it can expose recoverable records created by
local Codex clients under its documented source kinds. Arkey only promises
live status for subsequent turns run through its own App Server connection; it
cannot guarantee real-time mirroring of a turn already running in another
client process.

The runtime section exposes three local paths and one model preference:

- Node executable: defaults to the Node process running the Web server.
- Codex executable: uses normal CLI discovery and includes the CLI bundled in
  the macOS ChatGPT application as a fallback.
- Working directory: must be an existing readable absolute directory.
- Model: selected from the models returned by App Server.

Node and Codex paths must be absolute executable files and pass `--version`.
The launcher stores them in `~/.arkey/web-settings-v1.json` with mode `0600`.
Changing a path restarts only a daemon owned by the current Web process. If a
daemon was already running, the setting is saved for a later Web-managed start
and the existing process is not terminated.

The browser cannot repair a missing Node runtime before the Web server itself
has started. A user still needs one visible launcher command, a future packaged
launcher, or another already running Arkey client.

## Controls

The first version maps the deck controls to existing Arkey RPC actions:

| Control | App Server behavior |
| --- | --- |
| Agent 1 to 6 | Momentarily activate one fixed thread slot; the key has no latched selected state |
| New Chat | Start a new empty thread in the selected fixed slot; any old thread is only unlinked |
| Send | Open Composer on demand, then start or steer a turn in the selected slot |
| Approve and Decline | Resolve a pending binary approval |
| Fast | Toggle the model's advertised Fast service tier on or off |
| Reasoning dial | Cycle through Auto and the model's advertised reasoning efforts |
| Workflow up | Apply Plan to the next turn when supported |
| Workflow right | Review uncommitted working-tree changes |
| Workflow left | Fork the selected task |
| Workflow down | Select Fast |
| Hold to Talk | Use browser speech recognition and fill Composer |

Voice transcription never auto-sends. Browser support and microphone
permission vary by engine and operating system.

An imported thread starts as `status unknown`, not `idle`, because another
Codex client may already be running a turn that Arkey's separate App Server
connection cannot observe. Pressing an Agent key resumes and activates that
thread for Arkey without latching the key visually. Once Arkey starts a turn or
receives a status event on its connection, the key changes to the observed
idle, working, input-required, completed, or error state.

### ESP32-S3 native hardware controls

Hardware mode removes App Server session binding, Composer, browser speech
recognition, task creation, and inferred task-state labels. Agent 1–6, Fast,
Approve, Decline, Continue, PTT, Send, reasoning press/rotation, and joystick
directions send fixed native press/release events through the board. Buttons
show only their physical active depression and never latch.

The six Agent lamps use only the color, brightness, effect, and speed delivered
by the Desktop `v.oai.thstatus` request. The UI does not translate those values
back into guessed labels such as idle or working. Agent-to-session binding is
performed in ChatGPT Desktop's Codex Micro settings, exactly as it is for a
physical Codex Micro keyboard.

## Security and privacy

The server uses the following boundaries:

- listen only on `127.0.0.1`;
- exact Host and Origin checks;
- an HttpOnly, SameSite session cookie for API access;
- JSON-only POST requests with a 64 KiB body limit;
- an RPC allowlist for tasks, messages, settings, actions, and voice state;
- a content security policy that permits only same-origin assets;
- sanitized snapshots without Codex thread IDs, turn IDs, account objects,
  bindings, credentials, prompts, or responses.
- serial control through an exact control/phase allowlist; the browser cannot
  submit raw native JSON, descriptors, shell commands, or write requests;
- serial port listing that omits device serial numbers.

The Web server keeps App Server on daemon-owned stdio. It does not add a TCP or
WebSocket listener to Codex itself. In hardware mode App Server is not started.

## Known limits

- Tactile switches, physical lighting, haptics, USB/Bluetooth behavior, and
  global hardware shortcuts cannot be reproduced by a browser.
- Push to talk depends on the browser speech API and is not equivalent to a
  native desktop audio pipeline.
- Only threads created or explicitly bound to an Arkey slot are controllable.
  Arbitrary conversations in another desktop application are outside this
  boundary.
- Binary approve and decline are available. Structured approval requests need
  a dedicated schema-aware form before they can be safely completed in Web.
- Local UI actions such as opening a native terminal or changing another
  desktop application's sidebar are not mapped.
- The localhost server must already be running before its Node path setting is
  available.

These limits do not block localhost development for the task, message, state,
approval, model, reasoning, and review flows that App Server already exposes.
The ESP32-S3 main path has been smoke-tested on a YD-ESP32-23 2022-V1.3 board
with an ESP32-S3-N8R8 module. The complete control matrix, the `0.1.5`
reliability update, disconnect recovery, and long-duration dual-USB electrical
behavior still require physical acceptance testing.
