# Parity map — Urfael vs OpenClaw vs Hermes Agent

> The standing goal: everything they have, we have — smoother. This file is the tracked work-list,
> built from deep teardowns of both projects (June 2026). Status: ✦ better · ✓ parity · ◐ partial · ✗ missing.
> Urfael's structural advantage: the brain is the `claude` CLI, so Claude Code's whole tool surface
> (files, shell, web, MCP, subagents, skills) is inherited, not reimplemented.

## Surfaces
| Capability | OpenClaw | Hermes | Urfael |
|---|---|---|---|
| Desktop app (chat, streaming tool rows, sessions, settings) | menu-bar app | Electron+React | ✓ **Console** (chat, archive, reminders, jobs, hearth, settings) |
| CLI | `openclaw …` | TUI-first, rich | ✓ `urfael` (ask/status/jobs/reminders/sessions/stop/dashboard; Ctrl+C abort); no full-screen TUI |
| Voice (wake word, PTT, barge-in, local STT/TTS) | wake word, talk mode | CLI PTT, voice memos | ✦ orb (opt-in) + Console PTT + spoken remarks, all local |
| Web dashboard | ✓ | ✓ | ✦ token-gated localhost dashboard (127.0.0.1-only, constant-time token, no path serving — hardened past both) |
| Mobile nodes / canvas | iOS/Android, A2UI canvas | ✗ | ✗ — non-goal for now (phone via bridges) |
| REST API | WS gateway | OpenAI-compatible REST | ◐ unix-socket HTTP (local-only by design); OpenAI-compat shim planned |

## Channels
| | OpenClaw | Hermes | Urfael |
|---|---|---|---|
| Count | 24+ | ~21 adapters | 4 (Telegram, Discord, Slack, iMessage) + notify push |
| Voice memos | ✓ | ✓ | ✓ (local whisper, never cloud) |
| Pairing/allowlist security | pairing codes | pairing codes | ✦ owner-allowlist + structural sandbox (read-only, no egress) |
| Next | — | — | ➜ Email; (Slack socket-mode + iMessage chat.db now shipped) |

## Memory & recall
| | OpenClaw | Hermes | Urfael |
|---|---|---|---|
| Curated memory file(s) | MEMORY.md + daily notes | MEMORY.md (2.2k cap) + USER.md | ✦ MEMORY/USER/LESSONS/WORKFLOW, no hard cap, git-versioned |
| Session search | memory_search (vector+kw) | FTS5 SQLite | ✓ JSONL archive + grep (brain + CLI + Console search) |
| Consolidation | "dreaming" pass | post-turn background review | ✓ end-of-conversation distill (cheaper; per-turn review planned as opt-in) |
| User modeling | — | Honcho dialectic | ◐ USER.md auto-curated (no per-turn dialectic) |

## Skills & self-improvement
| | OpenClaw | Hermes | Urfael |
|---|---|---|---|
| Skill files | ClawHub registry | reflective phase + curator + hub | ✓ reflective distill + opt-in per-turn review (URFAEL_REVIEW) → `_urfael/skills/`; prove-wrong → fix/delete |
| Skill registry | ✦ (and poisoned — 20% malware) | hub + trust tiers | deliberately none (security); Claude Code skills work natively |
| Periodic curator | — | ✓ (7-day cycle, usage telemetry) | ✓ opt-in N-day curator (URFAEL_CURATOR_DAYS): consolidate/fix/delete stale skills, cadence survives restarts |

## Proactivity & scheduling
| | OpenClaw | Hermes | Urfael |
|---|---|---|---|
| Heartbeat (main-session checklist, silence contract) | ✦ invented it | ✗ | ✓ HEARTBEAT.md + HEARTBEAT_OK + active hours + busy-backoff |
| Cron / NL scheduling | ✓ | ✓ rich (chaining, no-agent scripts) | ✓ reminders (NL via brain, repeats); ➜ job-chaining, [SILENT] |
| Event triggers (webhooks, email push) | ✓ | ✓ | ✗ — planned (daemon webhook endpoint, gated) |

## Agents & execution
| | OpenClaw | Hermes | Urfael |
|---|---|---|---|
| Subagents | sessions_* tools | delegate_task + orchestrator depth | ✓ inherited (Claude Code Agent tool) |
| Background jobs | ✓ | ✓ | ✓ detached, cancellable, phone-push |
| Goal loop | — | /goal Ralph-loop | ✦ guard-railed goal-loop (caps, kill-switches, never pushes) |
| Exec backends | local + sandboxes | 6 (Docker/SSH/Modal/…) | local + Docker-isolated goal-loop (--sandbox docker[-net], --network none, staged auth only, caps) |
| Code-exec RPC | — | execute_code w/ tool RPC | ✓ inherited (Bash + scripts) |

## Model layer
| | OpenClaw | Hermes | Urfael |
|---|---|---|---|
| Providers | many | 300+ via portals | Claude only — **by design** (flat-rate subscription, zero keys) |
| Routing | fallback chains | manual + aux models | ✓ sticky Sonnet↔Opus escalation; env overrides |
| Usage visibility | ✓ | /usage + quotas | ✓ tokens/turn telemetry, Hearth, CLI status |

## Security (our moat — keep it)
| | OpenClaw | Hermes | Urfael |
|---|---|---|---|
| Track record | CVE-2026-25253, 20-40k exposed gateways, poisoned registry | clean but lightly audited | ✦ no network port (unix socket 0600), fail-closed profiles, nonce envelopes, read-only remote default |

## UX bar (from the 2026 HIG/NN-G research — applies to every surface)
- pin-to-bottom streaming with jump-to-latest; never fight the reader's scroll ✓
- tool activity as one-line rows, collapsed by default ✓ · Stop control during generation ✓ (POST /abort: Console Stop+Esc, ⌘., orb barge, CLI Ctrl+C/stop)
- Enter/Shift+Enter, ↑ recall, ⌘1-6 views ✓ · ⌘K/⌘P command palette ✓ (fuzzy, focus-trapped) · ⌘F archive search
- WCAG: ≥4.5:1 body text, focus-visible rings, ≥24px targets, prefers-reduced-motion ✓
- empty states teach with suggested prompts ✓ · native menu bar with full accelerators ✓ · dock badge while thinking ✓
- 70ch reading width, dark elevation via borders not shadows ✓

## Build order
DONE (workflow 1+2, adversarially reviewed): abort/stop everywhere · ⌘K command palette ·
native menu bar + dock badge · Slack + iMessage bridges · Docker-isolated goal-loop ·
token-gated localhost dashboard · skill curator (URFAEL_CURATOR_DAYS) · per-turn review (URFAEL_REVIEW).

NEXT:
1. Email bridge (IMAP idle + draft-only send), same sandbox profile
2. Full-screen TUI mode for the CLI (Hermes parity on the terminal)
3. Usage/cost dashboard panel + per-skill usage counts feeding the curator
4. Opt-in vector recall over the session archive (currently grep; fine at personal scale)
5. Menu-bar tray icon (quick toggle, status) as a third lightweight surface
