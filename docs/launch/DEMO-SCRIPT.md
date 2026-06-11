# Demo recording script

The one asset I can't generate for you: a real screen recording. It's also the single highest-leverage
thing for a launch — a 30–45s GIF at the top of the README converts far better than any paragraph. Here's
the exact shot list so the recording is tight. Record at 1280×800, then convert to a GIF or short mp4.

> Tools: macOS screen recording (⇧⌘5) or [asciinema](https://asciinema.org) for the terminal-only cuts.
> Convert with `ffmpeg` (you already have it) or `gifski` for a crisp GIF.

## Cut 1 — the hook: it resists attacks (terminal, ~12s)

The strongest opening isn't the UI — it's the proof. Record the benchmark:

```bash
npm run security
```

Let it scroll the `✓ RESISTED` lines and land on **`7/7 real-world attack classes resisted · 33/33 checks`**.
This is the money shot. Nobody else in the category can show this.

## Cut 2 — talk to it (Console, ~15s)

1. `cd app && npm start` (have it already open to skip the launch).
2. Tap the mic, say: *"What's on my plate today?"* — show the spoken reply streaming + the written answer
   landing with live tool activity in the sidebar.
3. Type a follow-up to show it's keyboard-first too.

## Cut 3 — it's proactive + everywhere (~12s)

1. `urfael cron add "summarize my unread mail" --daily-at 08:00` — show the confirmation.
2. Quick `⌘K` command palette flash.
3. (Optional) a phone shot: the same conversation in the token-gated dashboard PWA over a tunnel.

## Cut 4 — close on the identity (~4s)

The gold rune logo on the dark Console, the empty-state runes. Hold for a beat. Cut.

---

## After recording

1. Save as `docs/media/demo.gif` (aim < 8 MB — trim, drop to ~12 fps, cap width at 960).
   ```bash
   # mp4 -> high-quality gif
   ffmpeg -i demo.mp4 -vf "fps=12,scale=960:-1:flags=lanczos,palettegen" palette.png
   ffmpeg -i demo.mp4 -i palette.png -vf "fps=12,scale=960:-1:flags=lanczos,paletteuse" docs/media/demo.gif
   ```
2. Drop it at the very top of the README, above the current static screenshot:
   `<img src="docs/media/demo.gif" width="820" alt="Urfael in 30 seconds" />`
3. Use Cut 1 (the benchmark) as the GIF in the Show HN post and on social — the security proof is the wedge.

## Why this order

Lead with the benchmark, not the pretty UI. Every competitor has a pretty UI; none has a 12-second clip of
their agent *resisting the attacks that owned the others*. That clip is the reason someone shares it.
