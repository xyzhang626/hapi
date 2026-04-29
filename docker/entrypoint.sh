#!/usr/bin/env bash
set -euo pipefail

# First-run install. Named volume mounted at /workspace/node_modules starts
# empty; subsequent starts skip the reinstall.
if [ -z "$(ls -A /workspace/node_modules 2>/dev/null || true)" ]; then
    echo "[entrypoint] /workspace/node_modules empty — running bun install"
    cd /workspace
    bun install --frozen-lockfile
fi

mkdir -p "$HAPI_HOME"
mkdir -p "$HOME/.claude"

cd /workspace

# Two operating modes:
#  1. Service mode (default): foreground `bun run dev`, container stays up
#     for interactive `docker exec` driving.
#  2. Round mode: HAPI_ROUND_PROMPT_FILE points at a markdown prompt — start
#     hub/web in background, wait for them to be ready, then run an
#     autonomous Claude Code session that consumes the prompt and drives a
#     full E2E round on its own.

if [ -z "${HAPI_ROUND_PROMPT_FILE:-}" ]; then
    echo "[entrypoint] service mode — exec bun run dev"
    exec bun run dev
fi

if [ ! -f "$HAPI_ROUND_PROMPT_FILE" ]; then
    echo "[entrypoint] HAPI_ROUND_PROMPT_FILE=$HAPI_ROUND_PROMPT_FILE does not exist" >&2
    exit 1
fi

echo "[entrypoint] round mode — prompt: $HAPI_ROUND_PROMPT_FILE"

LOG_DIR=/workspace/.round-logs
mkdir -p "$LOG_DIR"

bun run dev > "$LOG_DIR/dev.log" 2>&1 &
DEV_PID=$!
echo "[entrypoint] bun run dev started (pid=$DEV_PID), tailing $LOG_DIR/dev.log"

# Cleanly stop the dev server when this script exits, whatever the cause.
cleanup() {
    if kill -0 "$DEV_PID" 2>/dev/null; then
        echo "[entrypoint] stopping bun run dev (pid=$DEV_PID)"
        kill -TERM "$DEV_PID" 2>/dev/null || true
        wait "$DEV_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# Wait for the full stack (hub + web + embedded runner) to be ready by
# grepping the dev.log. Don't use curl `/` — the hub returns 503 for unknown
# routes which `curl -fsS` would treat as failure. The two grep markers
# below only print after the stack is fully wired:
#   - "HAPI Hub is ready"             — hub HTTP server bound + listening
#   - "EmbeddedRunner ... started"    — runner subprocess spawned + connected
# If the runner isn't ready yet, channel bots can't spawn and the round
# would fail in confusing ways further down.
echo "[entrypoint] waiting for hub + embedded runner (max 120s)…"
for i in $(seq 1 120); do
    if grep -q 'HAPI Hub is ready' "$LOG_DIR/dev.log" 2>/dev/null \
       && grep -q 'EmbeddedRunner.*started subprocess' "$LOG_DIR/dev.log" 2>/dev/null; then
        echo "[entrypoint] stack ready after ${i}s"
        break
    fi
    if [ "$i" = "120" ]; then
        echo "[entrypoint] stack did not become ready within 120s — last 80 dev.log lines:" >&2
        tail -80 "$LOG_DIR/dev.log" >&2 || true
        exit 1
    fi
    sleep 1
done

echo "[entrypoint] launching autonomous claude session"
echo "[entrypoint] full transcript will be at $LOG_DIR/claude.log"

# `claude --print` reads the prompt from stdin and runs autonomously, calling
# tools and emitting output until it stops. With the host's settings.json
# (skipDangerousModePermissionPrompt: true) bind-mounted RO, claude will not
# stop on tool prompts. `--dangerously-skip-permissions` is also passed
# explicitly as a belt-and-braces guard in case settings.json ever changes.
set +e
claude \
    --print \
    --dangerously-skip-permissions \
    < "$HAPI_ROUND_PROMPT_FILE" \
    > "$LOG_DIR/claude.log" 2>&1
CLAUDE_RC=$?
set -e

echo "[entrypoint] claude exited rc=$CLAUDE_RC"
echo "[entrypoint] git status in $PWD:"
git status --short || true
echo "[entrypoint] recent commits on $(git rev-parse --abbrev-ref HEAD):"
git log --oneline -10 || true

exit "$CLAUDE_RC"
