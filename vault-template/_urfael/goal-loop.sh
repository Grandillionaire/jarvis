#!/usr/bin/env bash
# goal-loop.sh — guardrailed autonomous coding loop for Urfael (wraps Claude Code).
#
# SAFETY (the user's hard rule: kill-switches, not just exit traps):
#   • requires a git repo (so you can `git reset --hard`)
#   • caps iterations AND wall-clock time
#   • `timeout` SIGKILLs a hung turn — exit traps don't fire on hung subprocesses
#   • no-progress circuit breaker (git state unchanged N turns → abort)
#   • needs a real completion signal (GOAL_COMPLETE marker + optional --check command)
#   • prints everything; logs to .urfael-goal.log; never auto-merges, never auto-pushes
# Run it in a git worktree or container, not your only copy. Supervise the first run.
#
# DOCKER SANDBOX (optional, opt-in): --sandbox docker (or URFAEL_SANDBOX=docker) runs each claude turn
# inside a throwaway `docker run --rm` instead of on the host — the --repo dir is bind-mounted rw at /work,
# the host is otherwise untouched, --network none by default (use --sandbox docker-net to allow network),
# no host env leaks; ONLY the claude auth files (not the whole ~/.claude) are staged read-only + CLAUDE vars, capped to --memory 2g
# --pids-limit 512. ALL the guardrails above still apply (git repo on the host, iter/wall/turn caps,
# stale circuit-breaker, never push). Off by default — without the flag behavior is identical to before.
set -uo pipefail

GOAL=""; REPO=""; MAX_ITERS=15; MAX_MINS=120; TURN_TIMEOUT=900; CHECK=""; MODEL="sonnet"; STALE_LIMIT=3
SANDBOX="${URFAEL_SANDBOX:-}"   # ''=host (default), 'docker'=isolated no-net, 'docker-net'=isolated w/ network
usage(){ echo 'Usage: goal-loop.sh "<goal>" [--repo DIR] [--max-iters N] [--max-mins M] [--turn-timeout S] [--check "cmd"] [--model NAME] [--sandbox docker|docker-net]'; }
while [ $# -gt 0 ]; do case "$1" in
  --repo) REPO="$2"; shift 2;; --max-iters) MAX_ITERS="$2"; shift 2;; --max-mins) MAX_MINS="$2"; shift 2;;
  --turn-timeout) TURN_TIMEOUT="$2"; shift 2;; --check) CHECK="$2"; shift 2;; --model) MODEL="$2"; shift 2;;
  --sandbox) SANDBOX="$2"; shift 2;;
  -h|--help) usage; exit 0;; *) if [ -z "$GOAL" ]; then GOAL="$1"; else echo "unknown arg: $1"; usage; exit 1; fi; shift;; esac; done

[ -n "$GOAL" ] || { echo "✗ no goal given."; usage; exit 1; }
# SECURITY (M6): never default to the current dir. Require an explicit --repo pointing at an ISOLATED git
# worktree/container so a runaway loop can't touch your real work. Bypass mode is opt-in (URFAEL_YOLO=1).
[ -n "$REPO" ] || { echo "✗ no --repo given. Point this at an ISOLATED git worktree/container, not your live checkout."; usage; exit 1; }
[ -d "$REPO/.git" ] || { echo "✗ $REPO is not a git repo (need one so you can reset). Aborting."; exit 1; }
command -v claude >/dev/null || { echo "✗ claude not found."; exit 1; }
TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"   # macOS coreutils installs as gtimeout
[ -n "$TIMEOUT_BIN" ] || { echo "✗ no 'timeout'/'gtimeout' (brew install coreutils) — needed for the hung-turn watchdog. Aborting."; exit 1; }
CLAUDE_BIN="$(command -v claude)"; LOG="$REPO/.urfael-goal.log"; : > "$LOG"

# SANDBOX: validate (whitelist only), and if docker mode require docker present. Each turn runs in a throwaway
# container with the host repo bind-mounted rw; --network none unless docker-net. We build the prefix once.
DOCKER_PREFIX=()
case "$SANDBOX" in
  "") ;;   # host mode — default, unchanged
  docker|docker-net)
    command -v docker >/dev/null || { echo "✗ --sandbox $SANDBOX needs docker, but 'docker' was not found. Install Docker or drop --sandbox. Aborting."; exit 1; }
    REPO_ABS="$(cd "$REPO" && pwd)"   # docker -v needs an absolute host path
    DOCKER_NET="none"; [ "$SANDBOX" = "docker-net" ] && DOCKER_NET="bridge"
    DOCKER_IMAGE="${URFAEL_SANDBOX_IMAGE:-node:20-slim}"   # image must have the claude CLI on PATH (or be built to)
    # SECURITY: NEVER mount the whole ~/.claude — it also holds urfael/bridge.env, api-keys.env, tts.env and
    # the session archive. The sandboxed agent has Bash, so a whole-tree mount would let a runaway/injected
    # turn read (and, in docker-net, exfiltrate) every secret. Stage ONLY the auth artifacts the CLI needs.
    AUTH_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/urfael-auth.XXXXXX")"; chmod 700 "$AUTH_STAGE"
    for a in .credentials.json settings.json settings.local.json; do
      [ -f "$HOME/.claude/$a" ] && cp "$HOME/.claude/$a" "$AUTH_STAGE/$a"
    done
    trap 'rm -rf "$AUTH_STAGE"' EXIT
    # NOTE: container runs as root (fine on macOS Docker Desktop — ownership maps to the host user). On a Linux
    # host add --user "$(id -u):$(id -g)" with a writable HOME if root-owned /work files are a problem.
    DOCKER_PREFIX=(docker run --rm --network "$DOCKER_NET" --memory 2g --pids-limit 512
      -v "$REPO_ABS":/work -w /work -v "$AUTH_STAGE":/root/.claude:ro
      -e HOME=/root -e CLAUDE_CODE_USE_BEDROCK -e CLAUDE_CODE_USE_VERTEX -e ANTHROPIC_API_KEY
      -e ANTHROPIC_AUTH_TOKEN -e ANTHROPIC_BASE_URL -e ANTHROPIC_MODEL "$DOCKER_IMAGE")
    ;;
  *) echo "✗ unknown --sandbox '$SANDBOX' (allowed: docker | docker-net). Aborting."; exit 1;;
esac

cat <<BANNER
── Urfael goal-loop ──────────────────────────────────
  goal:       $GOAL
  repo:       $REPO
  caps:       $MAX_ITERS iters · ${MAX_MINS}m wall · ${TURN_TIMEOUT}s/turn · stop after $STALE_LIMIT stale
  completion: GOAL_COMPLETE marker${CHECK:+ + check: $CHECK}
  model:      $MODEL   (perm mode: ${URFAEL_YOLO:+bypassPermissions}${URFAEL_YOLO:-acceptEdits} — supervise; isolated worktree/container)
  sandbox:    ${SANDBOX:-host (no container)}${SANDBOX:+ — claude turns run in docker run --rm (net: ${DOCKER_NET}, mem 2g, pids 512)}
──────────────────────────────────────────────────────
BANNER

START=$(date +%s); cd "$REPO" || exit 1; prev=""; stale=0; errs=0; sid=""; DONE=""; MARKER="URFAEL-GOAL-DONE"
parse_field(){ printf '%s' "$1" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('$2',''))
except Exception: print('')"; }

# Pre-flight: if a verify command is given and already passes, the goal's done — don't burn a turn.
if [ -n "$CHECK" ] && bash -c "$CHECK" >>"$LOG" 2>&1; then echo "✅ goal already satisfied (verify passes)."; exit 0; fi

for (( i=1; i<=MAX_ITERS; i++ )); do
  now=$(date +%s); (( (now-START)/60 >= MAX_MINS )) && { echo "⏰ wall-clock cap (${MAX_MINS}m) hit. Stopping."; break; }
  echo "── iteration $i/$MAX_ITERS · $(( (now-START)/60 ))m elapsed ──"
  PROMPT="Work toward this goal in this repo: ${GOAL}
Make concrete, committed progress this turn. When the goal is fully achieved and verified${CHECK:+ (so '$CHECK' passes)}, end your reply with a line containing only: ${MARKER}. If you are blocked or it is unsafe to proceed, explain why and stop."
  PERM="${URFAEL_YOLO:+bypassPermissions}"; PERM="${PERM:-acceptEdits}"; FLAGS=(--model "$MODEL" --permission-mode "$PERM" --output-format json)
  [ -n "$sid" ] && FLAGS+=(--resume "$sid")     # pin OUR session so a stray claude in this dir can't be hijacked
  # host: run the claude binary directly. docker: same args, but inside a throwaway container (claude on its PATH).
  if [ -n "$SANDBOX" ]; then TURN_CMD=("${DOCKER_PREFIX[@]}" claude); else TURN_CMD=("$CLAUDE_BIN"); fi
  out=$("$TIMEOUT_BIN" -k 10 "$TURN_TIMEOUT" "${TURN_CMD[@]}" -p "$PROMPT" "${FLAGS[@]}" 2>>"$LOG"); rc=$?
  if [ $rc -eq 124 ]; then echo "⏰ turn $i exceeded ${TURN_TIMEOUT}s — killed. Continuing."; errs=0
  elif [ $rc -ne 0 ]; then errs=$((errs+1)); echo "⚠️ claude exited $rc (error $errs/2).";
    (( errs >= 2 )) && { echo "🛑 claude failing repeatedly — stopping (check $LOG: API key / quota / crash)."; break; }
    continue
  else errs=0; fi

  text=$(parse_field "$out" result)
  [ -z "$sid" ] && sid=$(parse_field "$out" session_id)
  printf '\n===== iter %s =====\n%s\n' "$i" "$text" >> "$LOG"
  printf '%s\n' "$text" | tail -4

  # Completion: the verify command is the source of truth; the marker only counts (as last line) if no check given.
  if [ -n "$CHECK" ]; then
    if bash -c "$CHECK" >>"$LOG" 2>&1; then echo "✅ verify command passes — done."; DONE=1; break; fi
  else
    last=$(printf '%s' "$text" | grep -v '^[[:space:]]*$' | tail -1)
    [ "$last" = "$MARKER" ] && { echo "✅ completion marker (no verify command given)."; DONE=1; break; }
  fi

  state="$(git rev-parse HEAD 2>/dev/null)$(git status --porcelain 2>/dev/null | shasum | awk '{print $1}')"
  if [ "$state" = "$prev" ]; then stale=$((stale+1)); else stale=0; fi; prev="$state"
  (( stale >= STALE_LIMIT )) && { echo "🛑 no git progress for $STALE_LIMIT turns — circuit breaker. Stopping."; break; }
done

echo "──────────────────────────────────────────────────────"
if [ -n "$DONE" ]; then echo "Result: COMPLETED after $i iters. Review:  git -C \"$REPO\" diff"; OUTCOME="completed ✅"
else echo "Result: STOPPED (not confirmed complete) after $i iters. Review $LOG and:  git -C \"$REPO\" diff"; OUTCOME="stopped (needs you) ⚠️"; fi
echo "Nothing was pushed or merged — that's yours to do."
# phone push (best-effort; silent no-op if no bridge.env / node)
REPO_DIR="$(cat "$HOME/.claude/urfael/repo" 2>/dev/null || echo "$HOME/urfael-src")"
NOTIFY="$REPO_DIR/app/bridge/notify.js"
[ -f "$NOTIFY" ] && command -v node >/dev/null 2>&1 && node "$NOTIFY" "Goal $OUTCOME after $i iters: $GOAL" >/dev/null 2>&1 || true
