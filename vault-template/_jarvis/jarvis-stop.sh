#!/usr/bin/env bash
# Fully stop Jarvis: the overlay UI AND the always-on brain daemon.
set -uo pipefail
PLIST="$HOME/Library/LaunchAgents/com.jarvis.daemon.plist"

echo "Stopping Jarvis…"
# 1) stop the launchd-managed brain daemon (and stop it relaunching)
launchctl unload "$PLIST" 2>/dev/null && echo "  ✓ brain daemon unloaded"
# 2) tell any non-launchd daemon to shut down, then make sure it (and its claude children) are gone.
#    Patterns are anchored to $HOME/jarvis/app and we reap only the daemon's OWN children — so an
#    unrelated `claude` session elsewhere on the machine is never killed as collateral.
curl -s --max-time 2 --unix-socket "$HOME/.claude/jarvis/daemon.sock" -X POST http://x/shutdown >/dev/null 2>&1 || true
DPID="$(pgrep -f "$HOME/jarvis/app/daemon.js" | head -1)"
[ -n "$DPID" ] && pkill -P "$DPID" 2>/dev/null || true   # reap the daemon's claude child sessions (targeted)
pkill -f "$HOME/jarvis/app/daemon.js" 2>/dev/null || true
# 3) close the overlay (everything in jarvis/app that isn't the daemon)
ps -axo pid,command | grep -i electron | grep "jarvis/app" | grep -v daemon.js | grep -v grep | awk '{print $1}' | xargs kill 2>/dev/null || true
rm -f "$HOME/.claude/jarvis/daemon.sock"
echo "  ✓ Jarvis stopped."
