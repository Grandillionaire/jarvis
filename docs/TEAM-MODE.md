# Team mode — the agent a CISO can approve

Most multi-user AI agents ask the business to *trust* them. Urfael's team mode is built the other way around: **every additional person is just another sandboxed principal forced through the same fail-closed kernel.** Adding teammates can only ever add *more-restricted* identities; it can never escalate anyone. That is what makes a multi-user agent something a security review can actually sign off on.

This is Workstream 2 of the [Improvement Plan](IMPROVEMENT-PLAN.md), and it is self-hosted, **not** a multi-tenant cloud — each org runs Urfael on its own login. (Pooling subscriptions across orgs is an explicit non-goal: it breaks the threat model and the ToS.)

## How it works

A per-channel **roster** lists allowlisted principals, each with a **role**:

```jsonc
// ~/.claude/urfael/team.json  (copy from config/team.json.example)
{
  "telegram": [
    { "id": "111", "name": "Maxim", "role": "owner" },
    { "id": "222", "name": "Sam",   "role": "member" },
    { "id": "333", "name": "Contractor", "role": "guest" }
  ]
}
```

- A sender **not in the roster is dropped** before the brain ever sees the message (fail-closed allowlist).
- The role maps to a sandbox profile, and **a role can only narrow access**:

| Role | Sandbox profile | Can do |
|---|---|---|
| `owner` / `member` | `untrusted` | read **and search** the shared vault (no shell, no write, no network egress) |
| `guest` | `guest` | read a **known path only** — **no** Grep/Glob, so it can't browse or search your notes |
| *(unknown/missing)* | `guest` | fail-closed to the most-restricted tier |

The invariant that makes this safe: **no role value — not even a forged `"owner"` — ever reaches the full-power `local` profile.** `local` is reachable *only* by an absent channel (the on-machine mic). A remote turn is always one of `untrusted` or `guest`. (Proven in `npm run security` and `app/test/lib.test.js`: every role attempt, including forged and coerced values, stays sandboxed.)

Editing `team.json` takes effect **live** — no restart. Without the file, Urfael stays single-owner via the `*_OWNER_*` ids in `bridge.env` (existing setups are unchanged).

## The audit trail

Every remote turn is attributed to its principal and logged: who, when, which channel, which sandbox profile, in/out sizes. Export it for an auditor:

```bash
urfael team            # show the roster (principals + roles per channel)
urfael audit           # the recent per-principal activity trail
urfael audit --json    # the same, machine-readable, for an SIEM / a compliance export
```

Combined with `npm run security` (the 7/7 benchmark, now including the team-mode escalation checks) and [docs/THREAT-MODEL.md](THREAT-MODEL.md), that's the package you hand a security team: *here is who can reach it, what each can do, the structural proof they can't escalate, and the log of what they did.*

## Status

Telegram is the reference multi-principal bridge (full roster + reply-to-sender). The kernel (`lib.profileFor` / `resolvePrincipal` / `buildRoster`), the daemon scoping + `/audit`, and the roster loader are channel-agnostic, so the other bridges adopt it by switching their single-owner check to `core.resolvePrincipal(channel, senderId)` — tracked as a fast-follow.
