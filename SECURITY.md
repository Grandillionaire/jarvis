# Security — read this before you run Jarvis

Jarvis runs an **LLM agent (Claude Code) with access to your shell, files, network, and — if you
enable them — your browser, desktop, email, and calendar.** That power is the point, and also the
risk. Treat this the way you'd treat handing someone remote access to your Mac.

## The threat model in one breath
The agent **reads untrusted content** — emails, web pages, calendar invites — and can **take actions**
(run commands, write files, send/draft, control apps). A malicious email or web page can therefore
attempt **prompt injection**: hiding instructions that try to make the agent do something harmful.
This is an open, unsolved problem for all tool-using agents. Jarvis mitigates it (untrusted-data
framing, scoped permissions, a memory-write allowlist) but **cannot eliminate it.**

## Safe defaults (what ships)
- **`bypassPermissions` is OFF by default.** The agent runs in `acceptEdits` mode (auto-applies file
  edits; other risky tools are gated). Full unrestricted shell is **opt-in** via `JARVIS_YOLO=1`.
- **The memory-distill pass never uses bypass** — it's scoped to writing your memory files + git only.
- **Computer-use MCP servers (browser, desktop, vision) are NOT enabled by default.** You add them
  deliberately (see `config/mcp.json.example`).
- **The autonomous `/goal` loop requires an explicit `--repo`** pointing at an isolated git worktree —
  it will not run against your current directory. It has hard caps (iterations, wall-clock, hung-turn
  kill, no-progress breaker) and never pushes.
- **The brain's local socket is `chmod 600`** (owner-only).

## If you enable full power (`JARVIS_YOLO=1`) — do this
1. **Run it in a dedicated VM, container, or throwaway macOS user account** — never your primary machine.
2. **Use a throwaway / scoped Claude and Google account**, not your main one.
3. Keep the computer-use MCPs and the autonomous loop **off** unless you specifically need them.
4. Watch the HUD / `~/.claude/jarvis/jarvis.log`. A `WARN … JARVIS_YOLO active` line is logged on start.

## Secrets — where they live, never commit them
**By default Jarvis uses no API keys at all** — voice is fully local (macOS `say` + whisper.cpp), so a
fresh install ships with an empty, secret-free `tts.env`. The files below only hold keys if you opt into
paid upgrades. They are **gitignored**; they live outside this repo and must never be committed or synced:
- `~/.claude/jarvis/tts.env` — only if you add ElevenLabs (voice) or Picovoice (wake word) keys
- `~/.claude/jarvis/api-keys.env` — Tavily / news / finance keys
- `~/.claude.json` — your Obsidian Local REST API key (written by `claude mcp add`)
- `~/.claude/.mcp.json` — any other MCP server credentials you add
If a key ever appears in a chat, log, screenshot, or commit, **rotate it.**

## Reporting a vulnerability
Open a private security advisory on this repo (**Security → Report a vulnerability**). Please don't
file public issues for security problems.
