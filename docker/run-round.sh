#!/usr/bin/env bash
# Host-side orchestrator for one autonomous E2E round.
#
# Given a round number + scenario hint, this script:
#   1. Creates a fresh git worktree at /home/azureuser/hapi-worktrees-round-N
#      on a new branch e2e/round-N (off main).
#   2. Renders docker/round-prompt.template.md into <worktree>/.round-prompt.md
#      with placeholder substitution.
#   3. Boots a container named hapi-e2e-round-N with that worktree
#      bind-mounted at /workspace and the prompt at /round-prompt.md.
#   4. Container's entrypoint (round mode) waits for hub/web ready and then
#      runs an autonomous `claude --print` session that drives the round and
#      commits to the branch.
#
# Usage:
#   bash docker/run-round.sh 14 "scenario hint goes here"
#   bash docker/run-round.sh 14 "scenario hint" --base main
#   bash docker/run-round.sh 14 "scenario hint" --dry-run     # check setup without docker run
#
# To inspect / clean up afterwards:
#   sudo docker logs -f hapi-e2e-round-14
#   git -C /home/azureuser/hapi-worktrees-round-14 log --oneline
#   sudo docker stop hapi-e2e-round-14   # --rm removes container; volumes persist
#   git worktree remove /home/azureuser/hapi-worktrees-round-14
#   git branch -D e2e/round-14

set -euo pipefail

if [ $# -lt 2 ]; then
    echo "usage: $0 <round-number> <scenario-hint> [--mode find|fix] [--base <branch>] [--dry-run] [--network host] [--prompt-file <path>]" >&2
    exit 2
fi

ROUND_NUM="$1"
SCENARIO_HINT="$2"
shift 2

BASE_BRANCH="main"
NET_MODE="bridge"
DRY_RUN=0
PROMPT_OVERRIDE=""
ROUND_MODE="find"
while [ $# -gt 0 ]; do
    case "$1" in
        --mode)         ROUND_MODE="$2"; shift 2 ;;
        --base)         BASE_BRANCH="$2"; shift 2 ;;
        --network)      NET_MODE="$2"; shift 2 ;;
        --prompt-file)  PROMPT_OVERRIDE="$2"; shift 2 ;;
        --dry-run)      DRY_RUN=1; shift ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

if [ "$ROUND_MODE" != "find" ] && [ "$ROUND_MODE" != "fix" ]; then
    echo "--mode must be 'find' (default, agent only writes test reports) or 'fix' (legacy: agent also fixes code)" >&2
    exit 2
fi

# Sanity check round number
if ! [[ "$ROUND_NUM" =~ ^[0-9]+$ ]]; then
    echo "round-number must be a positive integer, got: $ROUND_NUM" >&2
    exit 2
fi

PRIOR=$((ROUND_NUM - 1))
PRIOR_PRIOR=$((ROUND_NUM - 2))

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
# The shared git dir is where ALL worktrees (including our new round one)
# resolve metadata to. In a multi-worktree setup, the "main" repo lives in
# /home/azureuser/hapi while this docker worktree is at
# /home/azureuser/hapi-worktrees-docker — git-common-dir points at
# /home/azureuser/hapi/.git regardless of which worktree we're in.
GIT_COMMON_DIR="$(git -C "$(dirname "$0")" rev-parse --git-common-dir)"
GIT_COMMON_DIR="$(realpath "$GIT_COMMON_DIR")"
WORKTREE_DIR="/home/azureuser/hapi-worktrees-round-${ROUND_NUM}"
BRANCH="e2e/round-${ROUND_NUM}"
CONTAINER_NAME="hapi-e2e-round-${ROUND_NUM}"
IMG="hapi-e2e:latest"
if [ "$ROUND_MODE" = "fix" ]; then
    TEMPLATE="$REPO_ROOT/docker/round-prompt-fix.template.md"
else
    TEMPLATE="$REPO_ROOT/docker/round-prompt.template.md"
fi

# Refuse to overwrite existing state — better to fail loud than silently
# clobber a half-finished round.
if [ -e "$WORKTREE_DIR" ]; then
    echo "[run-round] worktree dir $WORKTREE_DIR already exists. Remove it first:" >&2
    echo "  git -C $REPO_ROOT worktree remove $WORKTREE_DIR  # or --force" >&2
    exit 1
fi
if git -C "$REPO_ROOT" rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
    echo "[run-round] branch $BRANCH already exists. Delete it first:" >&2
    echo "  git -C $REPO_ROOT branch -D $BRANCH" >&2
    exit 1
fi
if sudo docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "[run-round] container $CONTAINER_NAME already exists. Stop it first:" >&2
    echo "  sudo docker stop $CONTAINER_NAME" >&2
    exit 1
fi

# Create the worktree on a brand-new branch off the chosen base.
echo "[run-round] git worktree add $WORKTREE_DIR -b $BRANCH $BASE_BRANCH"
git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" -b "$BRANCH" "$BASE_BRANCH"

# Render the prompt template into the worktree itself so it travels with the
# branch (visible in git status) and is readable by Claude inside the
# container at a stable path. --prompt-file overrides the template (useful
# for smoke testing the plumbing without a full 90m round).
PROMPT_FILE="$WORKTREE_DIR/.round-prompt.md"
if [ -n "$PROMPT_OVERRIDE" ]; then
    if [ ! -f "$PROMPT_OVERRIDE" ]; then
        echo "[run-round] --prompt-file $PROMPT_OVERRIDE does not exist" >&2
        exit 1
    fi
    cp "$PROMPT_OVERRIDE" "$PROMPT_FILE"
    echo "[run-round] prompt copied from $PROMPT_OVERRIDE → $PROMPT_FILE"
else
    sed \
        -e "s|{{ROUND_NUM}}|${ROUND_NUM}|g" \
        -e "s|{{PRIOR_ROUND}}|${PRIOR}|g" \
        -e "s|{{PRIOR_PRIOR_ROUND}}|${PRIOR_PRIOR}|g" \
        -e "s|{{BRANCH}}|${BRANCH}|g" \
        -e "s|{{SCENARIO_HINT}}|${SCENARIO_HINT//|/\\|}|g" \
        "$TEMPLATE" > "$PROMPT_FILE"
    echo "[run-round] prompt rendered to $PROMPT_FILE"
fi

if [ "$DRY_RUN" = "1" ]; then
    echo "[run-round] --dry-run: stopping before docker run."
    echo "[run-round] worktree:   $WORKTREE_DIR (branch $BRANCH)"
    echo "[run-round] prompt:     $PROMPT_FILE"
    echo "[run-round] container:  WOULD start as $CONTAINER_NAME"
    exit 0
fi

# Build image if missing
if ! sudo docker image inspect "$IMG" >/dev/null 2>&1; then
    echo "[run-round] building $IMG (one-time)"
    sudo docker build -t "$IMG" -f "$REPO_ROOT/docker/Dockerfile" "$REPO_ROOT/docker"
fi

RUN_ARGS=(
    -d --rm
    --name "$CONTAINER_NAME"
    -v "$WORKTREE_DIR":/workspace
    -v "${CONTAINER_NAME}-node-modules":/workspace/node_modules
    -v "${CONTAINER_NAME}-hapi-home":/data
    -v "${CONTAINER_NAME}-claude-home":/home/pwuser/.claude
    -e "HAPI_ROUND_PROMPT_FILE=/workspace/.round-prompt.md"
    -e "HAPI_ROUND_MODE=$ROUND_MODE"
)

if [ -f "$HOME/.claude/settings.json" ]; then
    RUN_ARGS+=( -v "$HOME/.claude/settings.json:/home/pwuser/.claude/settings.json:ro" )
else
    echo "[run-round] WARNING: $HOME/.claude/settings.json not found" >&2
fi

# The worktree's `.git` is a file whose contents look like
# `gitdir: /home/azureuser/hapi/.git/worktrees/round-N`. For `git` inside
# the container to resolve that, we mount the SHARED git dir
# ($GIT_COMMON_DIR — the real repo, not our worktree's .git pointer) at
# the *exact same absolute path* on both host and container, RW. Multiple
# parallel rounds write to different `.git/worktrees/<name>/` subdirs and
# to the shared content-addressable `.git/objects/` — safe by git's design.
RUN_ARGS+=(
    -v "$GIT_COMMON_DIR":"$GIT_COMMON_DIR"
)

# Bridge networking (no host port mapping — we don't need to peek at the UI
# from the host for autonomous rounds, and skipping ports is what makes
# parallel rounds collision-free). If the round needs LAN access (e.g. to
# reach the user's self-hosted Anthropic endpoint), use --network host.
if [ "$NET_MODE" = "host" ]; then
    RUN_ARGS+=( --network=host )
fi

sudo docker run "${RUN_ARGS[@]}" "$IMG"

cat <<EOF

[run-round] container '$CONTAINER_NAME' started in round mode (mode=$ROUND_MODE).

Tail entrypoint + claude logs:
  sudo docker logs -f $CONTAINER_NAME

Tail just the claude transcript (once it begins):
  sudo docker exec $CONTAINER_NAME tail -f /workspace/.round-logs/claude.log

Tail hub/web dev log:
  sudo docker exec $CONTAINER_NAME tail -f /workspace/.round-logs/dev.log

Inspect git progress mid-flight:
  git -C $WORKTREE_DIR log --oneline
  git -C $WORKTREE_DIR status --short

Container is in --rm mode — when claude exits, container disappears.
Worktree + branch + commits remain on disk.
EOF
