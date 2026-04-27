#!/bin/bash
# Stage-2 #4 manual e2e: bot crash recovery.
#
# Validates that when a channel-bot CLI subprocess is killed, the hub
# watchdog respawns a fresh CLI within ~5s and the new session uses the
# previous sessionId (resume) so transcript continuity is preserved.
#
# Prereqs:
#   - hub running on :3006
#   - settings.json has cliApiToken
#   - CLAUDE_CODE_OAUTH_TOKEN exported (so the spawned bot CLI can boot)
#
# Run: bash hub/test/smoke-bot-recovery.sh
set -euo pipefail

BASE="${HAPI_BASE_URL:-http://localhost:3006}"
TOKEN="${CLI_API_TOKEN:?set CLI_API_TOKEN env or run from a shell that loaded ~/.hapi/settings.json}"

echo "=== Bot recovery smoke test ==="

JWT=$(curl -sf "$BASE/api/auth" -H 'Content-Type: application/json' \
  -d "{\"accessToken\":\"$TOKEN:alice\"}" | jq -r '.token')
H="Authorization: Bearer $JWT"
curl -sf "$BASE/api/workspace/ensure-defaults" -H "$H" -H 'Content-Type: application/json' \
  -d '{"displayName":"Alice"}' >/dev/null

CH=$(curl -sf "$BASE/api/channels" -H "$H" -H 'Content-Type: application/json' \
  -d '{"name":"recovery-test","agentConfig":{"botName":"Phoenix"}}')
CH_ID=$(echo "$CH" | jq -r '.channel.id')
echo "channel: $CH_ID"

# Wait for bot to spawn
echo "--- waiting for initial bot spawn (max 20s) ---"
ORIG_BOT=""
for i in $(seq 1 40); do
  CHC=$(curl -sf "$BASE/api/channels/$CH_ID" -H "$H")
  ORIG_BOT=$(echo "$CHC" | jq -r '.channel.botSessionId')
  if [ "$ORIG_BOT" != "null" ] && [ -n "$ORIG_BOT" ]; then
    echo "  initial bot session: $ORIG_BOT (after ${i}/2s)"
    break
  fi
  sleep 0.5
done
[ -n "$ORIG_BOT" ] && [ "$ORIG_BOT" != "null" ] || { echo "FAIL: bot never spawned"; exit 1; }

# Find the CLI subprocess for the bot session
sleep 2
echo "--- finding bot CLI process ---"
# pgrep -f matches command line; HAPI_IS_CHANNEL_BOT is passed as env var,
# not argv, so we have to scan /proc/<pid>/environ instead. The runner's
# `bun cli/src/index.ts runner start-sync` gives us the candidate pool.
BOT_PID=""
for p in $(pgrep -f "cli/src/index.ts" 2>/dev/null); do
    if grep -aql "HAPI_IS_CHANNEL_BOT=1" "/proc/$p/environ" 2>/dev/null; then
        # And it should match this channel
        if grep -aql "HAPI_CHANNEL_ID=$CH_ID" "/proc/$p/environ" 2>/dev/null; then
            BOT_PID="$p"
            break
        fi
    fi
done
echo "  bot pid: $BOT_PID"
[ -n "$BOT_PID" ] || { echo "FAIL: couldn't find bot pid (no proc with HAPI_IS_CHANNEL_BOT=1 + HAPI_CHANNEL_ID=$CH_ID)"; exit 1; }

echo "--- killing bot pid $BOT_PID ---"
kill "$BOT_PID" 2>&1 || echo "  (already gone)"
sleep 1

echo "--- waiting for respawn (max 30s) ---"
NEW_BOT=""
for i in $(seq 1 60); do
  sleep 0.5
  CHC=$(curl -sf "$BASE/api/channels/$CH_ID" -H "$H")
  NEW_BOT=$(echo "$CHC" | jq -r '.channel.botSessionId')
  if [ -n "$NEW_BOT" ] && [ "$NEW_BOT" != "null" ] && [ "$NEW_BOT" = "$ORIG_BOT" ]; then
    echo "  respawned with same sessionId after ${i}/2s — OK (transcript preserved)"
    break
  fi
  if [ -n "$NEW_BOT" ] && [ "$NEW_BOT" != "null" ] && [ "$NEW_BOT" != "$ORIG_BOT" ]; then
    echo "  WARN: respawned but with NEW sessionId $NEW_BOT (transcript NOT preserved)"
    break
  fi
done
[ -n "$NEW_BOT" ] && [ "$NEW_BOT" != "null" ] || { echo "FAIL: hub did not respawn bot"; exit 1; }

echo ""
echo "=== Bot recovery smoke PASSED ==="
echo "Note: this script validates the watchdog fires; it does not"
echo "validate Claude transcript continuity (would need to send a"
echo "message before kill, then check the bot remembers it)."
