# Webhook event triggers

Let an external event — a CI build finishing, a payment, a GitHub push, a monitoring alert — wake Urfael.
This is the same capability Hermes exposes as inbound webhooks, built the Urfael way: **the daemon never opens
a port**, every hook carries its own secret, and a trigger can never gain a shell, a write, or a network egress.

## How it stays inside the moat

```
  external service ──HTTPS──▶  your tunnel  ──▶  127.0.0.1:7718  ──unix socket──▶  daemon
                              (you run it)       receiver (app/hooks.js)          (the brain)
```

- **No inbound port on the daemon.** The brain is still only a `0600` unix socket. The receiver
  (`urfael hooks`) is a *separate* process that binds **127.0.0.1 only** and forwards over that socket. Nothing
  is exposed on your behalf — to accept events from the internet you point **your own** tunnel
  (`cloudflared` / `ngrok` / `ssh -R`) at the loopback port. That is an explicit, visible choice.
- **Per-hook secret.** Each hook gets a 256-bit secret, shown **once** at creation. Only its `sha256` hash is
  stored; the daemon validates the presented secret **constant-time**. A wrong secret — or a fire to a hook id
  that does not exist — returns an identical `401`, so the endpoint can't be used to enumerate hooks.
- **The action is weaker than a chat message.** A hook does one of two things:
  - `notify` — push the payload to you (notification + spoken + phone). No model runs.
  - `ask` — run the brain on the payload, but in a **no-egress** sandbox: `Read`/`Grep`/`Glob` only — **no
    `WebFetch`/`WebSearch`, no `Write`/`Edit`, no `Bash`** — with the payload framed as UNTRUSTED data, and the
    result delivered **only to you**. So a poisoned payload has no secret to read (the vault credential-deny
    holds), no network to exfiltrate to, no shell, and no third-party recipient.

## Use it

```bash
urfael hooks                              # start the loopback receiver (off until you do this)
urfael hook add "CI build" --action ask   # register a hook → prints the URL + secret ONCE
urfael hook list                          # id / action / name (never the secret)
urfael hook rm hk_xxxxxxxxxxxx            # remove it
```

`urfael hook add` prints something like:

```
✓ webhook hk_96add46b4364  action=ask · deliver=notify
  URL     http://127.0.0.1:7718/hook/hk_96add46b4364
  secret  968d5f0f…0d31   (shown once — store it)
  test:   curl -X POST -H "X-Urfael-Hook: 968d5f0f…0d31" --data 'hello' http://127.0.0.1:7718/hook/hk_96add46b4364
```

Point your service (or your tunnel) at that URL, sending the secret as the **`X-Urfael-Hook`** header (or a
`?secret=` query for senders that can't set headers). The raw request body is the payload.

- `--action notify | ask` (default `ask`).
- `--deliver notify | silent | push` (default `notify`; `push` skips speaking, `silent` logs only).
- Receiver port: `URFAEL_HOOKS_PORT` (default `7718`).

Every fire is written to the audit trail (`urfael audit`) as a `webhook` principal, so you can see exactly which
hook ran and when. Triggers are single-flight with the cron sandbox — a flood of events can't fork-bomb the brain.

## The honest edges

- The receiver is **off by default**; you start it explicitly. If you never run `urfael hooks`, no port exists.
- A hook `ask` is **single-flight** with scheduled jobs: if a cron/hook brain run is already going, a new trigger
  is accepted (`202`) but its brain run is skipped rather than queued. `notify` always delivers.
- Exposing the loopback port to the internet is **your** decision and **your** tunnel — Urfael will not do it for
  you, and the secret is the only thing standing between a public URL and a (sandboxed) brain run. Treat it like
  an API key.
