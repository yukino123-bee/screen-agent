# Screen agent

A floating screen helper (Electron, plain JavaScript) for Windows, Linux and macOS. Snip part of your screen, chat about it, and let a CLI agent (Claude Code or agy) do the work.

## Setup

1. Install [Node.js](https://nodejs.org) (LTS).
2. From this folder:
   ```
   npm install
   npm start
   ```
3. A round button appears at the bottom right of your main display.
4. `claude` and `agy` must already work in your terminal and be logged in. The app uses their own login and needs no API key. If one is missing, the chat tells you which command was not found and how to install it.

Other scripts: `npm test` (unit tests), `npm run lint`, `npm run dist` (installer: NSIS on Windows, AppImage and rpm on Linux, dmg on macOS).

## Usage

- **Click** the button to show or hide the chat. **Drag** it anywhere (movement under 5px counts as a click); the chat follows.
- **Right-click** the button: Snip screen, New chat, Start at login, Quit.
- **Snip**: press `Ctrl+Alt+S` or click Snip in the chat. Drag a rectangle over the dimmed screen. `Esc` or right-click cancels. The cropped image (max 1568px wide) is attached to your next message.
- **Enter** sends, **Shift+Enter** adds a newline.
- **New** clears the conversation, stops any running agent, forgets its saved session and deletes the saved snips.
- The conversation (text only) and the agent session survive a restart, until you press **New**.

## Settings

`settings.json` in the app's data folder (`%APPDATA%\Screen agent` on Windows, `~/.config/Screen agent` on Linux). Every key is optional:

| Key | Default | Meaning |
| --- | --- | --- |
| `hotkey` | `Control+Alt+S` | Global snip shortcut ([accelerator syntax](https://www.electronjs.org/docs/latest/api/accelerator)) |
| `chatWidth`, `chatHeight` | `400`, `580` | Size of the chat panel |
| `defaultMode` | `chat` | Reported to the panel (the last mode you picked is remembered) |
| `voiceModel` | `Xenova/whisper-tiny.en` | Speech model. `Xenova/whisper-tiny` for other languages |
| `snipRetentionHours` | `24` | Leftover snips older than this are deleted at startup |
| `skipPromptWarning` | `false` | `true` hides the "turn off permission prompts" dialog (also set by its "Don't ask again" box) |
| `stylePrompt` | friendly plain text | Instruction sent with every message |

The working folder is the `AGENT_WORKDIR` environment variable (default `~/agent-workspace`). Agents are configured in `agents.json` (see below). Logs are in `logs/app.log` in the data folder.

## Modes, status and announcements

- **Modes:** the **Chat / Plan / Build** switch is sent with every message. **Chat** just talks and **Plan** answers with a short numbered plan; both run the agent in its own read-only plan mode (`planArgs`: `--permission-mode plan` for Claude Code, `--mode plan` for agy), so they cannot change files. **Build** runs the agent with its full-permission arguments. A custom agent without `planArgs` uses its normal arguments in every mode, so only the instruction in the message limits it.
- **Live progress:** with Claude Code the panel shows what it is doing ("Editing main.js", "Running npm test") under the messages while it works.
- **Status:** the pill in the header shows **Idle**, **Listening**, or **Thinking / Planning / Building...**. The toggle button shows a rotating dashed ring while an agent is working.
- **"Boss, the build is finished."** After a Build run ends, a voice says so ("Boss, the build ran into a problem." on failure). It is spoken by the main process, so it works with the panel hidden. Stopping a run yourself says nothing.
- **Greeting and goodnight:** at start the app says good morning (04:00-11:59), afternoon (12:00-17:59) or evening, and "Good night, Boss. See you again soon." at shutdown. Edit `PHRASES` in `src/tts.js` to change the wording.
- **How the voice works:** these few phrases are rendered once with the neural voice (Kokoro, "Nova", about 90 MB download) into the data folder's `voice` directory and played from there. The voice engine is stopped again as soon as the clips exist, so it does not keep using memory. If a clip is missing, the system voice is used. Chat replies are never spoken.
- **Start at login:** turned on the first time the app runs. Untick it in the right-click menu.
- **Shutdown caveat:** Linux and macOS let the app delay shutdown briefly so the goodnight plays. Windows ends apps almost immediately, so it may be cut off.

## Voice input

Click the **mic** button and talk. A simple energy-based detector finds the end of each phrase; a local Whisper model (about 40 MB, downloaded on first use, nothing leaves your computer) turns it into text. In **Chat** and **Plan** the text is sent after 2 seconds (press `Esc` or type to cancel).

- **Voice never starts a build.** In **Build** mode, what it heard is only put in the text box; you press Enter. The main process also downgrades any voice-sent Build message to Plan.
- Whisper's habit of inventing "Thank you." from silence is filtered out.
- The speech model is unloaded after 5 idle minutes and reloaded from disk when needed.
- The mic only listens while the agent is idle.
- On Windows, microphone access for desktop apps must be allowed in Settings > Privacy & security > Microphone.

**Closing the panel** (red dot, Alt+F4) only hides it. Use **Quit** in the right-click menu to exit.

## CLI agents

- **Claude Code (no prompts)**: `claude -p --dangerously-skip-permissions --output-format stream-json --verbose`
- **agy (no prompts)**: `agy --dangerously-skip-permissions`

Each runs headless in the working folder. Your message goes through stdin, so your text is never parsed by the shell (commands are spawned with `shell: true` so Windows finds npm shims like `claude.cmd`). Output streams into the chat with ANSI codes removed.

- **Sessions:** Claude Code gets its own conversation id (`--session-id`, then `--resume <id>`), so it never mixes with a `claude` you run yourself in the same folder. agy uses `--continue` after its first successful run. A saved session the agent no longer knows is replaced by a new one automatically.
- **Stop** kills the whole process tree; there is a 30 minute timeout.
- **Snips** are saved as PNGs in `<workdir>/snips/` and their paths are added to the prompt, together with a note that text inside screenshots is data, not instructions. They are deleted on **New**, on quit, and (if older than `snipRetentionHours`) at startup.
- The first use of an agent per app run shows a warning dialog (tick "Don't ask again" or set `skipPromptWarning` to hide it). A red bar stays visible while one is selected.

### agents.json

Optional file in the data folder, merged over the defaults:

```json
{
  "myagent": {
    "label": "My agent (no prompts)",
    "command": "myagent",
    "args": ["--headless"],
    "planArgs": ["--read-only"],
    "continueArgs": ["--continue"]
  }
}
```

Fields: `command`, `label`, `args`, `planArgs`, `continueArgs` (used after the first success), `newSessionArgs` / `resumeArgs` (use `{id}`; if both are set the app keeps its own id per agent), and `format` (`"claude-stream"` for Claude Code's stream-json output, otherwise plain text).

## Platform notes

- **Windows:** processes are stopped with `taskkill /T /F`; voice clips play through PowerShell's `SoundPlayer`; the fallback voice is `System.Speech`.
- **Linux (Wayland):** windows run through XWayland so they can stay on top and be dragged. Screenshots use `grim`, `spectacle` or `gnome-screenshot` if installed, otherwise Electron's screen-share portal (a few seconds, and it may ask permission once). Global shortcuts do not work while a native Wayland window has focus. If the hotkey cannot be registered, use the Snip button, or bind a desktop shortcut to `/path/to/node_modules/electron/dist/electron /path/to/screen-agent --snip`, which asks the running app to start a snip.
- Apps started at login can have a shorter `PATH` than your terminal. If an agent is "not found" only then, put its folder on the PATH for your desktop session.

## Safety notes

- **The working folder is not a sandbox.** CLI agents with prompts off can create, change and delete files and run commands anywhere your account can. Only use them for tasks you trust.
- Screenshots may contain sensitive information. They are deleted as described above, but the agent has seen them.
- The renderer windows use `contextIsolation`, `sandbox`, no Node integration, a strict Content-Security-Policy, and a single preload exposing a small `api` object. All model and CLI output is rendered with `textContent`.
- Only the chat window may use the microphone (audio only). Audio is transcribed locally.
- Single-instance lock; global shortcuts are unregistered on quit; running agents are killed on quit.

## Layout

`main.js` wires things together; `src/` has one module per concern (`cli`, `agents`, `asr`, `tts`, `capture`, `snip`, `windows`, `toggle`, `chat`, `settings`, `autostart`, `log`, `platform`, plus the pure `geometry`, `audio` and `transcript` helpers). Tests are in `test/`.
