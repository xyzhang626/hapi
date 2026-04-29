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

# Where the agent's evidence lives. In find-mode HAPI_ROUND_EVIDENCE_DIR
# is set to /round-out/round-N-evidence — a single subtree containing
# logs/, screenshots/, and (after rename) playwright-cli/, all referenced
# from bug reports as `round-N-evidence/<sub>/<file>`. Fix-mode falls back
# to the legacy `<workspace>/.round-logs` flat layout.
if [ -n "${HAPI_ROUND_EVIDENCE_DIR:-}" ]; then
    LOG_DIR="$HAPI_ROUND_EVIDENCE_DIR/logs"
else
    LOG_DIR="${HAPI_ROUND_OUTPUT_DIR:-/workspace}/.round-logs"
fi
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

# In find-mode, cd into the evidence dir before launching claude. claude
# inherits this cwd, and so does every Bash tool invocation. playwright-cli
# auto-creates `$CWD/.playwright-cli/` for its session yaml + console log;
# putting cwd at the evidence dir keeps those next to logs/ and screenshots/.
# In fix-mode (no evidence dir), fall back to /workspace (the writable
# worktree), and to /round-out if only HAPI_ROUND_OUTPUT_DIR is set.
if [ -n "${HAPI_ROUND_EVIDENCE_DIR:-}" ]; then
    cd "$HAPI_ROUND_EVIDENCE_DIR"
elif [ -n "${HAPI_ROUND_OUTPUT_DIR:-}" ]; then
    cd "$HAPI_ROUND_OUTPUT_DIR"
fi

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

# playwright-cli's session metadata + console logs land in $CWD/.playwright-cli
# (i.e. the evidence dir's hidden subdir). Rename to a non-hidden name so
# triage `cp -r round-N-evidence/...` doesn't silently skip dotfiles and so
# bug reports can reference `round-N-evidence/playwright-cli/...` paths.
if [ -n "${HAPI_ROUND_EVIDENCE_DIR:-}" ] && [ -d "$HAPI_ROUND_EVIDENCE_DIR/.playwright-cli" ]; then
    mv "$HAPI_ROUND_EVIDENCE_DIR/.playwright-cli" "$HAPI_ROUND_EVIDENCE_DIR/playwright-cli"
    echo "[entrypoint] renamed .playwright-cli → playwright-cli for clean triage cp"
fi

# Post-run inspection. In fix-mode the worktree has a real branch; show
# git state. In find-mode /workspace is RO and there's no per-round
# branch — list artifacts in the output dir instead.
if [ -n "${HAPI_ROUND_OUTPUT_DIR:-}" ]; then
    echo "[entrypoint] artifacts in $HAPI_ROUND_OUTPUT_DIR:"
    ls -la "$HAPI_ROUND_OUTPUT_DIR" 2>/dev/null || true
    if [ -n "${HAPI_ROUND_EVIDENCE_DIR:-}" ]; then
        echo "[entrypoint] evidence subtree:"
        ls -la "$HAPI_ROUND_EVIDENCE_DIR" 2>/dev/null || true
    fi
else
    echo "[entrypoint] git status in $PWD:"
    git status --short || true
    echo "[entrypoint] recent commits on $(git rev-parse --abbrev-ref HEAD):"
    git log --oneline -10 || true
fi

exit "$CLAUDE_RC"
