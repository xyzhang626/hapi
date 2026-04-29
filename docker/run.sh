#!/usr/bin/env bash
# Host-side helper to build (once) and start a single isolated HAPI E2E
# container. Each invocation with a new NAME gets its own ~/.hapi, its own
# Claude session state, and its own host port mapping.
#
# Usage:
#   bash docker/run.sh                  # default name 'hapi-e2e'
#   bash docker/run.sh hapi-e2e-r13     # custom name
#   bash docker/run.sh hapi-e2e-r13 host  # use --network=host fallback
#
# Note: this script uses `sudo docker` because the invoking user is in the
# `lxd` group, not the `docker` group.

set -euo pipefail

NAME="${1:-hapi-e2e}"
NET_MODE="${2:-bridge}"
IMG="hapi-e2e:latest"

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

# Build if missing
if ! sudo docker image inspect "$IMG" >/dev/null 2>&1; then
    echo "[run.sh] building $IMG (one-time)"
    sudo docker build -t "$IMG" -f "$REPO_ROOT/docker/Dockerfile" "$REPO_ROOT/docker"
fi

# Reject collision early so we don't silently leak two containers
if sudo docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    echo "[run.sh] container '$NAME' already exists. Stop it first:"
    echo "  sudo docker stop $NAME    # --rm cleans it"
    exit 1
fi

# Build run args
RUN_ARGS=(
    -d --rm
    --name "$NAME"
    -v "$REPO_ROOT":/workspace
    -v "${NAME}-node-modules":/workspace/node_modules
    -v "${NAME}-hapi-home":/data
    -v "${NAME}-claude-home":/home/pwuser/.claude
)

# Bind-mount Anthropic credentials (settings.json) RO if present.
if [ -f "$HOME/.claude/settings.json" ]; then
    RUN_ARGS+=( -v "$HOME/.claude/settings.json:/home/pwuser/.claude/settings.json:ro" )
else
    echo "[run.sh] WARNING: $HOME/.claude/settings.json not found — Claude CLI inside container will lack credentials."
fi

if [ "$NET_MODE" = "host" ]; then
    RUN_ARGS+=( --network=host )
    echo "[run.sh] using --network=host (single container only — port collision otherwise)"
else
    RUN_ARGS+=( -p 3006:3006 -p 5173:5173 )
fi

sudo docker run "${RUN_ARGS[@]}" "$IMG"

cat <<EOF

[run.sh] container '$NAME' started.

Tail logs:
  sudo docker logs -f $NAME

Drop into container shell:
  sudo docker exec -it $NAME bash

Inside the container, drive playwright-cli the same way as the round
scripts (URL is now container-local):
  playwright-cli -s=alice open --browser chromium http://localhost:5173

From the host browser (bridge mode only):
  http://localhost:5173

Wipe per-container state for a fresh round:
  sudo docker stop $NAME
  sudo docker volume rm ${NAME}-hapi-home ${NAME}-claude-home
EOF
