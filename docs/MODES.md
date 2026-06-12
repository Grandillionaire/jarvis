# Fortress vs Full mode

Urfael resolves the "secure *or* capable" tension by refusing to choose: it ships **both**, and you pick per your risk tolerance. The default is the locked-down one.

```
urfael status            # shows the current mode
urfael setup             # choose Fortress or Full (writes URFAEL_MODE)
```

| | **Fortress** (default) | **Full** (opt-in) |
|---|---|---|
| Remote (chat) turns for owner/member | read + search the vault only (`Read`/`Grep`/`Glob`) | **+ browse the web + write files** (`WebFetch`/`WebSearch`/`Write`/`Edit`) — Hermes-level reach |
| Guests | `Read` only (in both modes) | `Read` only (unchanged) |
| Unsandboxed shell (`Bash`) on a remote turn | never | **never** |
| `bypassPermissions` on a remote turn | never | **never** |
| Untrusted-data framing | yes | **yes** |
| Credential-store `permissions.deny` (`~/.claude`, `~/.ssh`, `~/.aws`) | enforced | **enforced** |
| The on-machine owner (mic/Console) | full power | full power |

**The pitch:** even Urfael's *Full* mode is more contained than Hermes's *default* — Hermes runs the host backend unsandboxed by default; Urfael's Full mode still won't give a chat message an unrestricted shell, won't bypass permissions, still frames the input as untrusted, and still hard-denies your credential files. You get Hermes-level reach without Hermes's default blast radius.

## The honest tradeoff (read this before flipping to Full)

Full mode is a real reduction in blast radius, opt-in for exactly that reason:

- A remote turn in Full mode can **reach the network** (`WebFetch`/`WebSearch`) and **write files** in the vault. So a prompt-injection hidden in something the agent reads (an email it summarizes, a web page it fetches) could, in principle, **read your vault notes and send them out** — the credential files stay denied, but your *notes* are now reachable+exfiltratable. The untrusted-data envelope mitigates this; it does not structurally prevent it the way Fortress's no-egress profile does.
- Fortress has none of this: a remote turn cannot egress, so "read a secret and POST it somewhere" has nowhere to send it.

So: **Full mode for reach and capability; Fortress when the data on the machine is sensitive and you want the no-egress guarantee.** Switch any time with `urfael setup` (or `URFAEL_MODE=full`/unset) and restart the daemon.

## What's guaranteed in BOTH modes

These are structural and verified by `npm run security` (which asserts Fortress is the default and that Full never grants a shell/bypass/unframed remote):

- No inbound network port (the brain is a unix socket).
- A remote turn is **never** the full-power `local` profile — no role and no mode reaches it; `local` needs an absent channel (the on-machine mic).
- No `bypassPermissions` and no `Bash` on a remote turn, ever.
- The credential-store deny holds.
- `URFAEL_MODE` is the **owner's** setting (the daemon's env), never something a remote sender can choose — so no chat message can put itself into Full mode.
