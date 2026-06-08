#!/usr/bin/env bash
# Start Jarvis: load the always-on brain daemon (launchd) + open the overlay UI.
set -uo pipefail
PLIST="$HOME/Library/LaunchAgents/com.jarvis.daemon.plist"
OVERLAY="$HOME/jarvis/app"

echo "Starting Jarvis…"
launchctl load -w "$PLIST" 2>/dev/null && echo "  ✓ brain daemon loaded (launchd)"
for i in $(seq 1 15); do [ -S "$HOME/.claude/jarvis/daemon.sock" ] && { echo "  ✓ brain online"; break; }; sleep 1; done
( cd "$OVERLAY" && npm start >/tmp/jarvis.log 2>&1 & ) && echo "  ✓ overlay opening"
echo "  Jarvis is up. Say “Jarvis” or tap the orb."
