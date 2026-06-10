# Parity map — Urfael vs OpenClaw vs Hermes Agent

> The standing goal: everything they have, we have — smoother. This file is the tracked work-list,
> built from deep teardowns of both projects (June 2026). Status: ✦ better · ✓ parity · ◐ partial · ✗ missing.
> Urfael's structural advantage: the brain is the `claude` CLI, so Claude Code's whole tool surface
> (files, shell, web, MCP, subagents, skills) is inherited, not reimplemented.

## Surfaces
| Capability | OpenClaw | Hermes | Urfael |
|---|---|---|---|
| Desktop app (chat, streaming tool rows, sessions, settings) | menu-bar app | Electron+React | ✓ **Console** (chat, archive, reminders, jobs, hearth, settings) |
| CLI | `openclaw …` | TUI-first, rich | ◐ `urfael` (ask/status/jobs/reminders/sessions); no full TUI |
| Voice (wake word, PTT, barge-in, local STT/TTS) | wake word, talk mode | CLI PTT, voice memos | ✦ orb (opt-in) + Console PTT + spoken remarks, all local |
| Web dashboard | ✓ | ✓ | ✗ — planned (serve Console views over localhost) |
| Mobile nodes / canvas | iOS/Android, A2UI canvas | ✗ | ✗ — non-goal for now (phone via bridges) |
| REST API | WS gateway | OpenAI-compatible REST | ◐ unix-socket HTTP (local-only by design); OpenAI-compat shim planned |

## Channels
| | OpenClaw | Hermes | Urfael |
|---|---|---|---|
| Count | 24+ | ~21 adapters | 2 (Telegram, Discord) + notify push |
| Voice memos | ✓ | ✓ | ✓ (local whisper, never cloud) |
| Pairing/allowlist security | pairing codes | pairing codes | ✦ owner-allowlist + structural sandbox (read-only, no egress) |
| Next | — | — | ➜ Slack (socket mode), iMessage (BlueBubbles-free, chat.db), Email |

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
| Skill files | ClawHub registry | reflective phase + curator + hub | ◐ reflective distill → `_urfael/skills/`; prove-wrong → fix/delete |
| Skill registry | ✦ (and poisoned — 20% malware) | hub + trust tiers | deliberately none (security); Claude Code skills work natively |
| Periodic curator | — | ✓ (7-day cycle, usage telemetry) | ✗ — planned (fold into heartbeat: stale-skill audit) |

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
| Exec backends | local + sandboxes | 6 (Docker/SSH/Modal/…) | local only — Docker sandbox profile planned |
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
- tool activity as one-line rows, collapsed by default ✓ · Stop control during generation ✗ (needs daemon abort endpoint — planned)
- Enter/Shift+Enter, ↑ recall, ⌘1-6 views, ⌘K search ✓ · command palette ✗ (planned)
- WCAG: ≥4.5:1 body text, focus-visible rings, ≥24px targets, prefers-reduced-motion ✓
- empty states teach with suggested prompts ✓ · native menu bar with shortcuts ✗ (planned)
- 70ch reading width, dark elevation via borders not shadows ✓

## Build order (next sessions)
1. Daemon **abort endpoint** + Stop button/Esc in Console + CLI (top UX gap)
2. **Command palette** (⌘K everywhere: actions + reminders + sessions + settings)
3. Native **menu bar** + dock badge while thinking
4. **Slack + iMessage + Email** bridges (same sandbox profile)
5. **Skill curator** in heartbeat (stale audit, usage counts)
6. Web **dashboard** = Console views served on localhost (token-gated)
7. Opt-in **per-turn background review** (Hermes-style) behind a cost knob
8. **Docker sandbox** permission profile for risky work
