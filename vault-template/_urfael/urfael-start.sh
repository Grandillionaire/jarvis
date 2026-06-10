#!/usr/bin/env bash
# Start Urfael: load the always-on brain daemon + open the overlay UI.
# macOS uses launchd (launchctl); Linux uses systemd --user (urfael-daemon).
set -uo pipefail
PLIST="$HOME/Library/LaunchAgents/com.urfael.daemon.plist"
REPO_DIR="$(cat "$HOME/.claude/urfael/repo" 2>/dev/null || echo "$HOME/urfael-src")"
OVERLAY="$REPO_DIR/app"
case "$(uname -s)" in Darwin) OS=mac;; Linux) OS=linux;; *) OS=other;; esac

echo "Starting Urfael…"
if [ "$OS" = linux ]; then
  systemctl --user start urfael-daemon 2>/dev/null && echo "  ✓ brain daemon started (systemd --user)"
else
  launchctl load -w "$PLIST" 2>/dev/null && echo "  ✓ brain daemon loaded (launchd)"
fi
for i in $(seq 1 15); do [ -S "$HOME/.claude/urfael/daemon.sock" ] && { echo "  ✓ brain online"; break; }; sleep 1; done
( cd "$OVERLAY" && npm start >/tmp/urfael.log 2>&1 & ) && echo "  ✓ overlay opening"
echo "  Urfael is up. Say “Urfael” or tap the orb."
