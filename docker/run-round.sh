#!/usr/bin/env bash
# Host-side orchestrator for one autonomous E2E round.
#
# Two modes:
#
#   --mode find  (default) — agent only writes test plans + bug reports +
#     screenshots to a per-round artifact dir. /workspace inside the
#     container is the docker worktree bind-mounted READ-ONLY, so the
#     agent physically cannot modify product code (kernel returns EROFS).
#     Per-round artifact dir at /home/azureuser/hapi-rounds/round-N/
#     bind-mounts to /round-out (RW). No git worktree, no per-round
#     branch, no commits inside the container.
#
#   --mode fix  (legacy) — agent gets a fresh git worktree on its own
#     branch, modifies code, and commits. Mirrors the original R14-R17
#     workflow. Kept as an escape hatch.
#
# Usage:
#   bash docker/run-round.sh 18 "scenario hint goes here"
#   bash docker/run-round.sh 18 "..." --mode fix --base hapi-worktrees-docker
#   bash docker/run-round.sh 18 "..." --dry-run     # check setup without docker run
#   bash docker/run-round.sh 18 "..." --network host  # tunnel to LAN endpoint
#   bash docker/run-round.sh 18 "..." --prompt-file my.md   # smoke prompt override
#
# Cleanup (find-mode):
#   sudo docker stop hapi-e2e-round-18    # if still running; --rm clears it
#   sudo docker volume rm hapi-e2e-round-18-{node-modules,hapi-home,claude-home}
#   sudo rm -rf /home/azureuser/hapi-rounds/round-18    # only if you want to drop artifacts
#
# Cleanup (fix-mode):
#   sudo rm -rf /home/azureuser/hapi-worktrees-round-18
#   git -C <repo> worktree prune
#   git -C <repo> branch -D e2e/round-18

set -euo pipefail

if [ $# -lt 2 ]; then
    echo "usage: $0 <round-number> <scenario-hint> [--mode find|fix] [--base <branch>] [--dry-run] [--network host] [--prompt-file <path>]" >&2
    exit 2
fi

ROUND_NUM="$1"
SCENARIO_HINT="$2"
shift 2

BASE_BRANCH="hapi-worktrees-docker"   # only used in fix-mode
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
    echo "--mode must be 'find' (default) or 'fix' (legacy)" >&2
    exit 2
fi

if ! [[ "$ROUND_NUM" =~ ^[0-9]+$ ]]; then
    echo "round-number must be a positive integer, got: $ROUND_NUM" >&2
    exit 2
fi

PRIOR=$((ROUND_NUM - 1))
PRIOR_PRIOR=$((ROUND_NUM - 2))

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
CONTAINER_NAME="hapi-e2e-round-${ROUND_NUM}"
IMG="hapi-e2e:latest"
if [ "$ROUND_MODE" = "fix" ]; then
    TEMPLATE="$REPO_ROOT/docker/round-prompt-fix.template.md"
else
    TEMPLATE="$REPO_ROOT/docker/round-prompt.template.md"
fi

# Refuse to clobber an existing container, regardless of mode.
if sudo docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "[run-round] container $CONTAINER_NAME already exists. Stop it first:" >&2
    echo "  sudo docker stop $CONTAINER_NAME" >&2
    exit 1
fi


# ----------------------------------------------------------------------------
# Mode-specific setup: artifact dir (find) vs worktree (fix)
# ----------------------------------------------------------------------------

if [ "$ROUND_MODE" = "find" ]; then
    ROUND_ARTIFACT_DIR="/home/azureuser/hapi-rounds/round-${ROUND_NUM}"
    if [ -e "$ROUND_ARTIFACT_DIR" ]; then
        echo "[run-round] artifact dir $ROUND_ARTIFACT_DIR already exists. Remove it first:" >&2
        echo "  sudo rm -rf $ROUND_ARTIFACT_DIR" >&2
        exit 1
    fi
    # All evidence (logs, screenshots, playwright-cli session yaml/log) lives
    # under round-N-evidence/, so triage can `cp -r round-N-evidence` into
    # docs/e2e_test/ in one shot and round-N.md's relative path links resolve.
    EVIDENCE_DIR_HOST="$ROUND_ARTIFACT_DIR/round-${ROUND_NUM}-evidence"
    mkdir -p "$EVIDENCE_DIR_HOST/screenshots" "$EVIDENCE_DIR_HOST/logs"
    PROMPT_FILE="$ROUND_ARTIFACT_DIR/round-prompt.md"
    BRANCH=""  # not used in find mode
    SOURCE_DIR="$REPO_ROOT"  # bind-mounted RO into container's /workspace
    WORKTREE_DIR=""
else
    # Legacy fix-mode: per-round git worktree on a fresh branch.
    GIT_COMMON_DIR="$(realpath "$(git -C "$(dirname "$0")" rev-parse --git-common-dir)")"
    WORKTREE_DIR="/home/azureuser/hapi-worktrees-round-${ROUND_NUM}"
    BRANCH="e2e/round-${ROUND_NUM}"
    if [ -e "$WORKTREE_DIR" ]; then
        echo "[run-round] worktree dir $WORKTREE_DIR already exists. Remove it first:" >&2
        echo "  git -C $REPO_ROOT worktree remove $WORKTREE_DIR" >&2
        exit 1
    fi
    if git -C "$REPO_ROOT" rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
        echo "[run-round] branch $BRANCH already exists. Delete it first:" >&2
        echo "  git -C $REPO_ROOT branch -D $BRANCH" >&2
        exit 1
    fi
    echo "[run-round] git worktree add $WORKTREE_DIR -b $BRANCH $BASE_BRANCH"
    git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" -b "$BRANCH" "$BASE_BRANCH"
    PROMPT_FILE="$WORKTREE_DIR/.round-prompt.md"
    ROUND_ARTIFACT_DIR=""
    SOURCE_DIR="$WORKTREE_DIR"  # writable, bind-mounted RW
fi


# ----------------------------------------------------------------------------
# Render prompt
# ----------------------------------------------------------------------------

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
    if [ "$ROUND_MODE" = "find" ]; then
        echo "[run-round] artifact: $ROUND_ARTIFACT_DIR"
        echo "[run-round] source:   $SOURCE_DIR (RO bind-mount)"
    else
        echo "[run-round] worktree: $WORKTREE_DIR (branch $BRANCH)"
    fi
    echo "[run-round] prompt:    $PROMPT_FILE"
    echo "[run-round] container: WOULD start as $CONTAINER_NAME"
    exit 0
fi


# ----------------------------------------------------------------------------
# Build image if missing
# ----------------------------------------------------------------------------

if ! sudo docker image inspect "$IMG" >/dev/null 2>&1; then
    echo "[run-round] building $IMG (one-time)"
    sudo docker build -t "$IMG" -f "$REPO_ROOT/docker/Dockerfile" "$REPO_ROOT/docker"
fi


# ----------------------------------------------------------------------------
# Build docker run args
# ----------------------------------------------------------------------------

RUN_ARGS=(
    -d --rm
    --name "$CONTAINER_NAME"
    -v "${CONTAINER_NAME}-node-modules":/workspace/node_modules
    -v "${CONTAINER_NAME}-hapi-home":/data
    -v "${CONTAINER_NAME}-claude-home":/home/pwuser/.claude
    -e "HAPI_ROUND_MODE=$ROUND_MODE"
)

if [ "$ROUND_MODE" = "find" ]; then
    # Source RO + per-round artifact RW. Bun's workspace install needs a
    # per-workspace node_modules dir under each workspace package; on a RO
    # /workspace those would fail. So we mount writable named volumes on
    # top of the root node_modules AND each workspace's node_modules.
    RUN_ARGS+=(
        -v "$SOURCE_DIR":/workspace:ro
        -v "$ROUND_ARTIFACT_DIR":/round-out
        -e "HAPI_ROUND_PROMPT_FILE=/round-out/round-prompt.md"
        -e "HAPI_ROUND_OUTPUT_DIR=/round-out"
        -e "HAPI_ROUND_EVIDENCE_DIR=/round-out/round-${ROUND_NUM}-evidence"
        -e "HAPI_ROUND_NUM=${ROUND_NUM}"
    )
    for ws in cli hub web shared website docs; do
        RUN_ARGS+=( -v "${CONTAINER_NAME}-${ws}-nm:/workspace/${ws}/node_modules" )
    done
else
    # Legacy fix mode: writable worktree + shared .git mount. Worktree's .git
    # file points at $GIT_COMMON_DIR/.git/worktrees/<name>; mount the common
    # git dir at the same absolute path inside container so `git` resolves it.
    RUN_ARGS+=(
        -v "$WORKTREE_DIR":/workspace
        -v "$GIT_COMMON_DIR":"$GIT_COMMON_DIR"
        -e "HAPI_ROUND_PROMPT_FILE=/workspace/.round-prompt.md"
    )
fi

if [ -f "$HOME/.claude/settings.json" ]; then
    RUN_ARGS+=( -v "$HOME/.claude/settings.json:/home/pwuser/.claude/settings.json:ro" )
else
    echo "[run-round] WARNING: $HOME/.claude/settings.json not found" >&2
fi

if [ "$NET_MODE" = "host" ]; then
    RUN_ARGS+=( --network=host )
fi

sudo docker run "${RUN_ARGS[@]}" "$IMG"


# ----------------------------------------------------------------------------
# Print follow-up commands
# ----------------------------------------------------------------------------

cat <<EOF

[run-round] container '$CONTAINER_NAME' started (mode=$ROUND_MODE).

Tail entrypoint logs:
  sudo docker logs -f $CONTAINER_NAME
EOF

if [ "$ROUND_MODE" = "find" ]; then
    cat <<EOF

Tail claude transcript (once it begins):
  tail -f $EVIDENCE_DIR_HOST/logs/claude.log

Tail hub/web dev log:
  tail -f $EVIDENCE_DIR_HOST/logs/dev.log

Inspect artifacts mid-flight (host can read directly, no docker exec needed):
  ls -la $ROUND_ARTIFACT_DIR
  cat  $ROUND_ARTIFACT_DIR/round-${ROUND_NUM}.md
  ls -la $EVIDENCE_DIR_HOST          # screenshots/ logs/ playwright-cli/

After the round completes, integrate via triage:
  bash docker/triage-rounds.sh $ROUND_NUM        # write summary to /tmp/BUGS-AGGREGATE.md
  # then host-side decisions: cp into docs/e2e_test/, fix code, commit on main branch.

Caveat: \`/workspace\` is a RO bind-mount of the docker worktree. While this
container is running, do NOT edit files under $REPO_ROOT — every save
triggers \`bun --watch\` hub-restart inside the container and (with multiple
parallel rounds) can exhaust the host's inotify quota.
EOF
else
    cat <<EOF

Tail claude transcript (once it begins):
  sudo docker exec $CONTAINER_NAME tail -f /workspace/.round-logs/claude.log

Inspect git progress mid-flight:
  git -C $WORKTREE_DIR log --oneline
  git -C $WORKTREE_DIR status --short

Worktree + branch + commits remain on disk after container exits.
EOF
fi
