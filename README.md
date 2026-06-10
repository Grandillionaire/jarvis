<div align="center">

<img src="vault-template/_urfael/assets/urfael-logo.svg" width="128" alt="Urfael" />

# U R F A E L

**An old intelligence in service to one person: you.**

It listens, speaks, remembers, and acts — on the Claude Code subscription you already have.

[![macOS](https://img.shields.io/badge/macOS-Apple_Silicon_%26_Intel-1c150b?style=flat-square)](#requirements)
[![No API key to start](https://img.shields.io/badge/API_key-not_required-7a5c28?style=flat-square)](#voice)
[![License](https://img.shields.io/badge/license-MIT-9a7434?style=flat-square)](LICENSE)

</div>

Urfael is a personal AI that lives on your Mac the way a counselor lives at your elbow. A gold seeing-stone waits in the corner of your screen; speak to it and a real voice answers while the full written answer lands beside it. An always-on local brain runs the `claude` CLI on your existing Claude Code login. An Obsidian vault is its archive; a private git repo is its memory; every conversation makes it a little more yours — it distills what it learned, keeps a model of who you are, and writes down the procedures it figures out so it never has to figure them out twice.

It speaks in remarks, not read-alouds. It stays silent unless something needs you. And it ships safe: power stays off until you turn it on, after reading [SECURITY.md](SECURITY.md).

## Quickstart

```bash
git clone https://github.com/Grandillionaire/urfael.git && cd urfael   # clone anywhere — the installer records the path
./install.sh        # checks deps, fetches the local speech model, scaffolds your vault — no keys
cd app && npm start # the stone appears, bottom-right
```

Tap the stone and talk. That is a full voice assistant running on nothing but your Claude Code plan. Nicer voices, a spoken wake word (train a free custom "Urfael" keyword, or use a built-in one), and browser or desktop control are all opt-in, covered in [docs/SETUP.md](docs/SETUP.md).

**Hotkeys**   `⌘⇧U` show or hide  ·  `⌘⇧H` expand the HUD  ·  `⌘⇧T` change the look  ·  `⌘⇧Q` quit

## How it works

The Electron overlay is a thin client: the gold-on-glass HUD (Counsel · Answer · Hearth), an audio-reactive seeing-stone, four looks (`sigil`, `rune`, `ember`, `eye`). The brain is an always-on `launchd` daemon of warm `claude` sessions, so it survives the UI closing and can act on its own. It simply runs your installed `claude` CLI as a subprocess, riding your existing Claude Code login — no API key, nothing to connect: if `claude` works in your terminal, the brain works. Most turns route to Sonnet; the hard ones — code, deep reasoning — escalate to Opus. Memory is plain markdown in a private git repo, re-injected every session. Voice in and out runs locally; the hands are opt-in MCP servers.

```mermaid
flowchart LR
    you([you]) -->|local whisper| daemon
    subgraph mac[your Mac · no cloud]
      daemon["brain daemon<br/>warm claude sessions"]
      vault[("Obsidian vault<br/>archive + memory")]
      daemon <--> vault
      daemon -->|MCP| hands["browser · desktop · vision"]
    end
    daemon -->|spoken remark| tts["local TTS"] --> ear([you hear])
    daemon -->|full answer| hud["seeing-stone HUD"]
    plan[/"Claude Code subscription"/] -.-> daemon
```

## What it can do

Everything below is opt-in and guard-railed. Urfael ships without unrestricted permissions or computer-use, and you turn power on deliberately.

- **Voice.** Tap the stone or speak the wake word, then talk — it answers in a real voice over an audio-reactive orb. The spoken remark streams sentence-by-sentence (first audio the moment the first sentence lands), and if an answer takes a while it acknowledges out loud — "On it, sir." — instead of leaving silence. You can also just type into the HUD.
- **Memory that compounds.** The vault holds its knowledge; a private git repo holds what it learns. Each conversation auto-distills into durable memory, lessons from its mistakes, and a model of who you are (`USER.md`) — all re-read every session.
- **Skills.** When it figures out a multi-step procedure, it writes the recipe to `_urfael/skills/` and follows it next time instead of reasoning from scratch. Skills proven wrong get fixed or deleted — it curates itself.
- **Total recall.** Every conversation, from every surface, is archived as plain JSONL in your memory repo. "What did I say about the Berlin trip?" — it greps its own history and cites the date. `urfael sessions search <query>` from any terminal.
- **A terminal voice.** The same brain answers in your shell: `urfael "summarize my inbox"` streams the answer live; `status`, `jobs`, `reminders`, `remind`, `sessions search` manage the rest. One daemon, every surface.
- **Reminders.** "Remind me in 20 minutes" / "every morning at 8" just works — persisted in the daemon, fired as a notification, spoken aloud, and pushed to your phone, with every window closed.
- **Heartbeat (opt-in).** Every N minutes it runs your `HEARTBEAT.md` checklist — upcoming events, urgent email, slipping deadlines — and stays silent unless something genuinely needs you.
- **Calendar and email.** Read, create, and update Google and Apple Calendar plus Reminders. Drafts email, never sends.
- **Hands and eyes.** Drives the browser with Playwright, controls macOS apps, windows, and files, and sees the screen.
- **Visuals.** Ask for a chart or diagram and it makes one, in matplotlib, Mermaid, or interactive HTML.
- **Morning brief.** A spoken 8am rundown of your calendar, inbox, and open loops, with no window open.
- **Phone control.** Drive it from Telegram or Discord, owner-allowlisted — text or **voice memos** (transcribed locally on your Mac, never by a cloud STT). Remote turns are sandboxed and read-only by default — a message can read and search your vault, but can't write files, run shell, fetch the network, or touch your machine (web lookup and capture are opt-in).
- **Background jobs.** Hand off long work (autonomous coding, deep research) to detached, cancellable jobs that don't tie up the conversation and push your phone when they're done.
- **Autonomous coding.** A `/goal` loop with caps, timeouts, and kill-switches. It never pushes.

## Voice

The default tier is fully local, offline, and free. Everything above it is optional.

| Tier | Speech to text | Text to speech | Cost |
|---|---|---|---|
| Default | whisper.cpp, on-device | macOS `say` | free, offline, no key |
| Quality | `small.en` model | [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI), local | free, one extra service |
| Premium | ElevenLabs Scribe | ElevenLabs | paid, opt-in |

A wake word is optional via Picovoice — any built-in keyword works out of the box, and you can train a custom "Urfael" keyword free at console.picovoice.ai. Otherwise, tap the stone.

## Requirements

macOS, on Apple Silicon or Intel. [Claude Code](https://claude.com/claude-code) on a paid plan (Pro or Max), signed in. Node 18+. [Obsidian](https://obsidian.md) with its Local REST API plugin. One Homebrew line:

```bash
brew install ffmpeg whisper-cpp coreutils
```

The installer checks all of it and downloads the ~142 MB local speech model on first run. Sign in to Claude Code once before you start Urfael.

The brain uses Claude Code's model aliases, so it always tracks the latest models your plan supports. Opus escalation needs a **Max** plan; on **Pro**, set `URFAEL_OPUS_MODEL=sonnet` to keep everything on Sonnet (see [docs/SETUP.md](docs/SETUP.md)).

## A note on power

When you opt into full capability with `URFAEL_YOLO=1`, Urfael becomes a real agent with shell, file, and network access that also reads untrusted email and web. Run that mode in a VM or a throwaway account, and read [SECURITY.md](SECURITY.md) first.

## The name

Urfael is an original character: an old intelligence sworn to one person, woken into a machine. The name is a Sindarin-styled coinage, used for this independent project — no affiliation with any film, game, or estate is implied.

## Contributing

Issues and PRs welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Especially wanted: Linux and Windows ports, more local-voice backends, and new MCP hands.

## License

[MIT](LICENSE), provided as is, without warranty. You are responsible for how you run it.

<sub>An independent open-source project, not affiliated with, endorsed by, or sponsored by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.</sub>

<div align="center"><sub>If it's useful, a star helps others find it.</sub></div>
