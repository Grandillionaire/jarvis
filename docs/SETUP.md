# Jarvis — Setup Guide

> Read **[../SECURITY.md](../SECURITY.md)** before enabling hands/eyes, the autonomous loop, or full permissions.

macOS only (for now). The `install.sh` at the repo root does most of this; the steps below are the detail.

## 1. Prerequisites
- **Claude Code on a paid plan (Pro or Max).** Run `claude` once and sign in *before* starting Jarvis.
  The brain just shells out to your `claude` CLI, so it runs on that subscription — there's **no API key
  and nothing to "connect."** If `claude` works in your terminal, the daemon works. (Gmail/Calendar/Drive
  connectors come from your account.)
- **Node 18+**, **uv**, **coreutils** (`brew install coreutils` → `gtimeout`), **Python 3 + matplotlib**
  (`pip3 install --user matplotlib numpy`).
- **Local voice (free, default):** `brew install ffmpeg whisper-cpp` — `say` is built in; the installer
  downloads the ~142 MB speech model. **No API key needed.**
- **Obsidian** + the **Local REST API** community plugin.
- Optional paid/extra: **ElevenLabs** (premium voice), **Picovoice** (wake word), free data APIs (Tavily, etc.).

## 2. Run the installer
```bash
./install.sh
```
It checks deps, writes `~/.claude/jarvis/{tts.env,api-keys.env}` from the examples (chmod 600), scaffolds
`~/Jarvis` from the template (with a `.claude → _jarvis` symlink), creates a private local `~/Jarvis-memory`
git repo, runs `npm install`, and writes the launchd plists (without loading them).

## 3. Configure
- **Voice (works out of the box, free & local):** the default is macOS `say` (TTS) + whisper.cpp (STT) —
  nothing to configure. In `~/.claude/jarvis/tts.env` you can set `SAY_VOICE` (run `say -v '?'` to list
  voices) or `WHISPER_MODEL=small.en` for better accuracy.
  - *Higher-quality local voice (optional):* run [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI)
    on `:8880` and set `TTS_PROVIDER=kokoro`.
  - *Premium (optional, paid):* set `TTS_PROVIDER=elevenlabs` + `STT_PROVIDER=elevenlabs` and add your
    `ELEVENLABS_API_KEY` (use a **premade** voice — premade voices don't drift).
- **Persona:** fill `{{USER_NAME}}` / `{{CITY}}` / `{{TIMEZONE}}` / `{{LANGUAGE}}` in `~/Jarvis/CLAUDE.md`.
- **Obsidian:** open `~/Jarvis` as a vault → Settings → Community plugins → enable → install *Local REST API*
  → copy its API key → register it:
  ```bash
  cd ~/Jarvis && claude mcp add -s local --transport http obsidian \
    http://127.0.0.1:27123/mcp/ --header "Authorization: Bearer <REST_KEY>"
  ```

## 4. Run it
```bash
launchctl load -w ~/Library/LaunchAgents/com.jarvis.daemon.plist   # the always-on brain
cd app && npm start                                                # the overlay UI
```
The orb appears bottom-right. Tap it to talk (or set a Picovoice key for the "Jarvis" wake word).
`⌘⇧J` show/hide · `⌘⇧H` expands the HUD · `⌘⇧T` changes the look · `⌘⇧Q` full shutdown.

Optional background jobs (opt-in): `com.jarvis.morningbrief` (8am brief), `com.jarvis.obsidian-heal`
(keeps the Obsidian connection alive).

### Models & plans
The brain uses Claude Code's model **aliases** — `sonnet` for most turns, escalating to `opus` for hard
ones (code, deep reasoning). Aliases always resolve to the latest model your plan supports, so nothing
breaks when Anthropic ships a new version. **Opus access requires a Max plan** — on **Pro**, set
`JARVIS_OPUS_MODEL=sonnet` so escalation stays on Sonnet instead of failing. You can also pin exact ids
(e.g. `JARVIS_OPUS_MODEL=claude-opus-4-8`). Set these in the daemon plist's `EnvironmentVariables`
(next to `JARVIS_YOLO`), the same place you set any other daemon env var.

## 5. Enabling hands, eyes & autonomy (opt-in — read SECURITY.md)
- **Computer-use MCPs** (browser/desktop/vision): see `config/mcp.json.example`. macOS will prompt for
  Accessibility / Automation / Screen Recording the first time the agent uses them — grant once.
- **Full permissions:** set `JARVIS_YOLO=1` (in the daemon plist's `EnvironmentVariables`, or your env).
  ⚠️ This is an unrestricted shell agent — run it in a VM / container / throwaway account.
- **Autonomous `/goal` loop:** requires an explicit `--repo` pointing at an isolated git worktree.

## Permissions Jarvis may ask macOS for
Microphone (voice), and — only if you enable computer-use — Accessibility, Automation, Screen Recording,
Calendars, Reminders. Grant them to the app/terminal hosting the agent.

## Updating / uninstalling
- Update: `git pull && cd app && npm install`.
- Uninstall: `launchctl unload` the three `com.jarvis.*` plists and delete them; remove the cloned repo (NOT your `~/Jarvis` vault — different capitalisation). Your
  `~/Jarvis` vault and `~/Jarvis-memory` are yours to keep or delete.
