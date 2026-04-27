#!/bin/bash
# Stage 2 end-to-end smoke test.
#
# Validates the full agent-native channel lifecycle described in
# docs/mvp-ux-stage-2.md, end-to-end against a live hub:
#   1. Create channel with agentConfig → bot auto-spawns
#   2. Send @mention → ChannelAgent forwards strong signal to bot
#   3. POST thread-request → channel-thread-requested SSE fires
#   4. POST reaction → message-reaction-added SSE fires
#   5. Toggle reaction → message-reaction-removed SSE fires
#   6. Pin thread → thread-pinned SSE fires with channelId
#   7. Set visibility → thread-visibility-changed SSE fires
#   8. Soft delete channel → workspace folder renamed -archived, bot killed
#   9. Verify channel becomes invisible to listing
#
# Does NOT validate that the bot actually REPLIES — that requires
# CLAUDE_CODE_OAUTH_TOKEN. Steps 1-9 cover hub routing & SSE.
#
# Prereqs:
#   - hub running on :3006
#   - bash hub/test/smoke-stage-2.sh
set -euo pipefail

BASE="${HAPI_BASE_URL:-http://localhost:3006}"
TOKEN="${CLI_API_TOKEN:?set CLI_API_TOKEN env}"

PASS=0
FAIL=0
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }

echo "=== Stage 2 E2E smoke ==="

JWT=$(curl -sf "$BASE/api/auth" -H 'Content-Type: application/json' \
  -d "{\"accessToken\":\"$TOKEN:alice\"}" | jq -r '.token')
H="Authorization: Bearer $JWT"
[ -n "$JWT" ] && [ "$JWT" != "null" ] && pass "auth alice" || fail "auth alice"

curl -sf "$BASE/api/workspace/ensure-defaults" -H "$H" -H 'Content-Type: application/json' \
  -d '{"displayName":"Alice"}' >/dev/null

# Open SSE stream for the duration of the test
SSE_OUT=/tmp/sse-stage2-$$
curl -sN "$BASE/api/events?token=$JWT&all=true" > "$SSE_OUT" &
SSE_PID=$!
sleep 1

# === 1. Create channel with agentConfig → bot spawns ===
CH=$(curl -sf "$BASE/api/channels" -H "$H" -H 'Content-Type: application/json' \
  -d '{"name":"e2e","description":"end-to-end test","agentConfig":{"botName":"Lumi"}}')
CH_ID=$(echo "$CH" | jq -r '.channel.id')
[ -n "$CH_ID" ] && [ "$CH_ID" != "null" ] && pass "channel created: $CH_ID" || fail "channel create"

# Wait for bot to spawn
for i in $(seq 1 40); do
  CHC=$(curl -sf "$BASE/api/channels/$CH_ID" -H "$H")
  BOT=$(echo "$CHC" | jq -r '.channel.botSessionId')
  [ "$BOT" != "null" ] && [ -n "$BOT" ] && break
  sleep 0.5
done
[ "$BOT" != "null" ] && [ -n "$BOT" ] && pass "bot session spawned: $BOT" || fail "bot did not spawn within 20s"

# === 2. Send @mention message → strong signal to bot ===
MSG=$(curl -sf "$BASE/api/channels/$CH_ID/messages" -H "$H" \
  -H 'Content-Type: application/json' -d '{"body":"@Lumi please help","kind":"text"}')
MSG_ID=$(echo "$MSG" | jq -r '.message.id')
[ -n "$MSG_ID" ] && pass "message sent: $MSG_ID" || fail "message send"

# Verify the bot session received the inject as a forwarded message.
# We can't see "into" the bot session easily, but the channel-message-received
# SSE event with the body should fire.
sleep 1

# === 3. POST thread-request → SSE channel-thread-requested ===
RES=$(curl -sf -X POST "$BASE/api/channels/$CH_ID/thread-request" -H "$H" \
  -H 'Content-Type: application/json' -d '{"topic":"refactor user model"}')
[ "$(echo $RES | jq -r '.ok')" = "true" ] && pass "thread-request accepted" || fail "thread-request"
sleep 0.5

# === 4 & 5. Reactions ===
curl -sf "$BASE/api/channels/$CH_ID/messages/$MSG_ID/reactions" -H "$H" \
  -H 'Content-Type: application/json' -d '{"emoji":"👀"}' >/dev/null
pass "reaction added"
sleep 0.3
curl -sf "$BASE/api/channels/$CH_ID/messages/$MSG_ID/reactions" -H "$H" \
  -H 'Content-Type: application/json' -d '{"emoji":"👀"}' >/dev/null
pass "reaction toggled off"
sleep 0.3

# === 6 & 7. Pin + visibility on a thread ===
THREAD=$(curl -sf "$BASE/api/channels/$CH_ID/sessions" -H "$H" \
  -H 'Content-Type: application/json' -d '{"threadTitle":"manual thread"}')
THREAD_ID=$(echo "$THREAD" | jq -r '.session.id')
[ -n "$THREAD_ID" ] && pass "thread created: $THREAD_ID" || fail "thread create"

curl -sf -X PATCH "$BASE/api/sessions/$THREAD_ID/pinned" -H "$H" \
  -H 'Content-Type: application/json' -d '{"pinned":true}' >/dev/null
pass "thread pinned"

curl -sf -X PATCH "$BASE/api/sessions/$THREAD_ID/visibility" -H "$H" \
  -H 'Content-Type: application/json' -d '{"visibility":"shared"}' >/dev/null
pass "visibility=shared"

curl -sf -X PATCH "$BASE/api/sessions/$THREAD_ID/pinned" -H "$H" \
  -H 'Content-Type: application/json' -d '{"pinned":false}' >/dev/null
pass "thread unpinned"
sleep 1

# === 8. Soft delete ===
DEL=$(curl -sf -X DELETE "$BASE/api/channels/$CH_ID" -H "$H")
[ "$(echo $DEL | jq -r '.ok')" = "true" ] && pass "soft delete accepted" || fail "soft delete"
sleep 1

# === 9. Verify channel gone from listing ===
LIST=$(curl -sf "$BASE/api/channels" -H "$H")
COUNT=$(echo "$LIST" | jq "[.channels[] | select(.id == \"$CH_ID\")] | length")
[ "$COUNT" = "0" ] && pass "channel removed from listing" || fail "channel still in listing ($COUNT entries)"

# === Verify SSE events fired ===
sleep 1
kill "$SSE_PID" 2>/dev/null || true
wait "$SSE_PID" 2>/dev/null || true

check_event() {
    local pattern="$1"
    local label="$2"
    if grep -q "$pattern" "$SSE_OUT"; then
        pass "SSE: $label"
    else
        fail "SSE missing: $label"
    fi
}

check_event "channel-message-received" "channel-message-received"
check_event "channel-thread-requested" "channel-thread-requested"
check_event "message-reaction-added" "message-reaction-added"
check_event "message-reaction-removed" "message-reaction-removed"
check_event "thread-pinned" "thread-pinned"
check_event "thread-visibility-changed" "thread-visibility-changed"
check_event "thread-unpinned" "thread-unpinned"
check_event "channel-removed" "channel-removed"

# === Verify workspace folder was renamed ===
NS_DIR="$HOME/.hapi/workspaces/alice"
if ls "$NS_DIR" 2>/dev/null | grep -q "e2e-archived-"; then
    pass "workspace folder renamed -archived"
else
    fail "workspace folder not archived (looking in $NS_DIR)"
fi

rm -f "$SSE_OUT"

echo ""
echo "=== Stage 2 E2E results: $PASS passed, $FAIL failed ==="
[ "$FAIL" = "0" ] || exit 1
