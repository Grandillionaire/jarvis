#!/usr/bin/env bash
# Fully stop Urfael: the overlay UI AND the always-on brain daemon.
# macOS uses launchd (launchctl); Linux uses systemd --user (urfael-daemon).
set -uo pipefail
PLIST="$HOME/Library/LaunchAgents/com.urfael.daemon.plist"
case "$(uname -s)" in Darwin) OS=mac;; Linux) OS=linux;; *) OS=other;; esac

echo "Stopping Urfael…"
# 1) stop the service-managed brain daemon (and stop it relaunching)
if [ "$OS" = linux ]; then
  systemctl --user stop urfael-daemon 2>/dev/null && echo "  ✓ brain daemon stopped (systemd --user)"
else
  launchctl unload "$PLIST" 2>/dev/null && echo "  ✓ brain daemon unloaded"
fi
# 2) tell any non-launchd daemon to shut down, then make sure it (and its claude children) are gone.
#    Patterns are anchored to the recorded repo path and we reap only the daemon's OWN children — so an
#    unrelated `claude` session elsewhere on the machine is never killed as collateral.
curl -s --max-time 2 --unix-socket "$HOME/.claude/urfael/daemon.sock" -X POST http://x/shutdown >/dev/null 2>&1 || true
REPO_DIR="$(cat "$HOME/.claude/urfael/repo" 2>/dev/null || echo "$HOME/urfael-src")"
DPID="$(pgrep -f "$REPO_DIR/app/daemon.js" | head -1)"
[ -n "$DPID" ] && pkill -P "$DPID" 2>/dev/null || true   # reap the daemon's claude child sessions (targeted)
pkill -f "$REPO_DIR/app/daemon.js" 2>/dev/null || true
# 3) close the overlay (everything in urfael/app that isn't the daemon)
ps -axo pid,command | grep -i electron | grep "$REPO_DIR/app" | grep -v daemon.js | grep -v grep | awk '{print $1}' | xargs kill 2>/dev/null || true
rm -f "$HOME/.claude/urfael/daemon.sock"
echo "  ✓ Urfael stopped."
