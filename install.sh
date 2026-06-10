#!/usr/bin/env bash
# Urfael installer (macOS). Idempotent: scaffolds what's missing, never overwrites your vault or secrets,
# and enables NOTHING risky automatically. Read SECURITY.md first.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JDIR="$HOME/.claude/urfael"
VAULT="$HOME/Urfael"
MEM="$HOME/Urfael-memory"
LA="$HOME/Library/LaunchAgents"

say(){ printf '%s\n' "$1"; }
ok(){ printf '  ✓ %s\n' "$1"; }
warn(){ printf '  ⚠ %s\n' "$1"; }

[ "$(uname)" = "Darwin" ] || { say "✗ Urfael is macOS-only for now."; exit 1; }
say "── Urfael install ───────────────────────────────"

# 1) dependency check (report, don't auto-install heavy things)
say "Checking dependencies…"
for c in claude node npm; do command -v "$c" >/dev/null && ok "$c" || warn "$c MISSING — install it (claude: https://claude.com/claude-code)"; done
command -v uv >/dev/null && ok "uv" || warn "uv missing — https://docs.astral.sh/uv (needed for some MCP servers)"
{ command -v gtimeout >/dev/null || command -v timeout >/dev/null; } && ok "timeout/gtimeout" || warn "gtimeout missing — 'brew install coreutils' (needed for the autonomous loop)"
python3 -c 'import matplotlib' 2>/dev/null && ok "matplotlib" || warn "matplotlib missing — 'pip3 install --user matplotlib numpy' (for charts)"
# local, API-free voice deps
ok "say (macOS TTS, built-in)"
command -v ffmpeg >/dev/null && ok "ffmpeg" || warn "ffmpeg missing — 'brew install ffmpeg' (local voice needs it)"
command -v whisper-server >/dev/null && ok "whisper-cpp (local STT)" || warn "whisper-cpp missing — 'brew install whisper-cpp' (free local speech-to-text)"

# 2) config dir + secret templates (never overwrite an existing real file)
mkdir -p "$JDIR"
# fetch the local whisper model (~142MB, one time) so voice works out of the box — no API key needed.
# Pinned SHA-256 so a tampered/changed upstream artifact is rejected (fail-closed).
MODELDIR="$JDIR/models"; mkdir -p "$MODELDIR"
WHISPER_SHA256="a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
if [ -f "$MODELDIR/ggml-base.en.bin" ]; then ok "whisper model present"; else
  warn "downloading whisper base.en model (~142MB, one time)…"
  if curl -fsSL -o "$MODELDIR/ggml-base.en.bin" \
       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin; then
    if echo "$WHISPER_SHA256  $MODELDIR/ggml-base.en.bin" | shasum -a 256 -c - >/dev/null 2>&1; then
      ok "local STT model ready (checksum verified)"
    else
      rm -f "$MODELDIR/ggml-base.en.bin"
      warn "model checksum MISMATCH — deleted for safety. Re-run, or set STT_PROVIDER=elevenlabs"
    fi
  else
    warn "model download failed — re-run, or set STT_PROVIDER=elevenlabs"
  fi
fi
for f in tts.env api-keys.env bridge.env; do
  if [ -f "$JDIR/$f" ]; then ok "$f already exists (kept)"; else cp "$REPO/config/$f.example" "$JDIR/$f"; chmod 600 "$JDIR/$f"; ok "wrote $JDIR/$f (add your keys)"; fi
done

# 3) scaffold the vault from the template (never overwrite an existing vault)
if [ -e "$VAULT" ]; then ok "$VAULT already exists (kept — not overwritten)"; else
  cp -R "$REPO/vault-template" "$VAULT"
  rm -rf "$VAULT/memory"                                        # memory lives in ~/Urfael-memory (step 4), not the vault
  ( cd "$VAULT" && [ -L .claude ] || ln -s _urfael .claude )   # Claude Code reads commands/hooks via .claude
  chmod +x "$VAULT"/_urfael/*.sh 2>/dev/null
  ok "scaffolded $VAULT (fill the {{PLACEHOLDERS}} in CLAUDE.md)"
fi

# 4) local, private memory repo (never public)
if [ -d "$MEM/.git" ]; then ok "$MEM already exists"; else
  mkdir -p "$MEM"; cp "$REPO/vault-template/memory/"*.md "$MEM/"
  ( cd "$MEM" && git init -q && git add -A && git commit -q -m "init: Urfael memory" 2>/dev/null )
  ok "created private local memory repo at $MEM"
fi

# 5) record where the repo lives — plists get the literal path baked in; vault scripts read this file.
#    (No canonical ~/urfael: on macOS the filesystem is case-INsensitive, so ~/urfael would collide
#    with the ~/Urfael vault. Clone the repo anywhere; everything resolves through this.)
printf '%s' "$REPO" > "$JDIR/repo"; ok "repo path recorded ($REPO)"

# 6) app deps + the `urfael` terminal command
if [ -d "$REPO/app/node_modules" ]; then ok "app deps installed"; else ( cd "$REPO/app" && npm install --silent ) && ok "npm install (app)"; fi
BINDIR="$(dirname "$(command -v node || echo /opt/homebrew/bin/node)")"
if [ -w "$BINDIR" ]; then ln -sfn "$REPO/app/cli.js" "$BINDIR/urfael" && chmod +x "$REPO/app/cli.js" && ok "linked \`urfael\` CLI into $BINDIR"
else warn "can't write $BINDIR — run: npm link --prefix \"$REPO/app\" (or alias urfael=\"node $REPO/app/cli.js\")"; fi

# 7) launchd plists — fill placeholders, but DO NOT auto-load (you choose what runs in the background)
NODE="$(command -v node || echo /opt/homebrew/bin/node)"
mkdir -p "$LA"
for t in "$REPO"/config/launchagents/*.plist.template; do
  out="$LA/$(basename "${t%.template}")"
  sed -e "s|{{HOME}}|$HOME|g" -e "s|{{NODE}}|$NODE|g" -e "s|{{REPO}}|$REPO|g" "$t" > "$out"
done
ok "wrote launchd plists to $LA (not loaded)"

cat <<NEXT

── Next steps ───────────────────────────────────
1. Voice works out of the box — FREE & local (macOS \`say\` + whisper.cpp), no API key needed.
   Optional: edit "$JDIR/tts.env" for a higher-quality local voice (Kokoro) or to add an ElevenLabs key.
2. Open ~/Urfael as a vault in Obsidian → enable community plugins → install "Local REST API",
   then register it:  cd ~/Urfael && claude mcp add -s local --transport http obsidian \\
      http://127.0.0.1:27123/mcp/ --header "Authorization: Bearer <your REST key>"
3. Fill the {{USER_NAME}} / {{CITY}} / {{TIMEZONE}} / {{LANGUAGE}} placeholders in ~/Urfael/CLAUDE.md
4. Start the brain + UI:
      launchctl load -w "$LA/com.urfael.daemon.plist"      # the always-on brain
      cd "$REPO/app" && npm start                          # the overlay UI
   (optional, opt-in:  launchctl load -w the morningbrief / obsidian-heal plists)
5. ⚠️  Hands/eyes, the autonomous loop, and full permissions are OFF by default.
   Read SECURITY.md, then opt in (URFAEL_YOLO=1 in a sandbox; uncomment MCPs in config/mcp.json.example).

Done. Talk to Urfael: tap the orb (or set a Picovoice key — see WAKE_KEYWORD in tts.env for the wake word).
NEXT
