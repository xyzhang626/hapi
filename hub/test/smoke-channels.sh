#!/bin/bash
# Smoke test for channel API endpoints
# Start hub first: bun run dev:hub
# Then run: bash hub/test/smoke-channels.sh
set -euo pipefail

BASE="${HAPI_BASE_URL:-http://localhost:3006}"
TOKEN="${CLI_API_TOKEN:?Set CLI_API_TOKEN}"

echo "=== Smoke Test: Channel API ==="
echo "Base: $BASE"
echo ""

# Login to get JWT
echo "--- 1. Login ---"
JWT=$(curl -sf "$BASE/api/auth" \
  -H 'Content-Type: application/json' \
  -d "{\"accessToken\":\"$TOKEN:alice\"}" | jq -r '.token')
[ -n "$JWT" ] && [ "$JWT" != "null" ] || { echo "FAIL: Login failed"; exit 1; }
echo "OK: Got JWT"
H="Authorization: Bearer $JWT"

# Ensure workspace defaults
echo "--- 2. Ensure workspace defaults ---"
DEFAULTS=$(curl -sf "$BASE/api/channels/workspace/ensure-defaults" \
  -H "$H" -H 'Content-Type: application/json' \
  -d '{"displayName":"Alice"}')
PERSONAL_ID=$(echo "$DEFAULTS" | jq -r '.personalChannel.id')
GENERAL_ID=$(echo "$DEFAULTS" | jq -r '.generalChannel.id')
echo "OK: personal=$PERSONAL_ID general=$GENERAL_ID"

# List channels
echo "--- 3. List channels ---"
CHANNELS=$(curl -sf "$BASE/api/channels" -H "$H")
COUNT=$(echo "$CHANNELS" | jq '.channels | length')
echo "OK: $COUNT channels"

# Create custom channel
echo "--- 4. Create channel ---"
CH=$(curl -sf "$BASE/api/channels" -H "$H" \
  -H 'Content-Type: application/json' \
  -d '{"name":"frontend","description":"Frontend dev"}')
CH_ID=$(echo "$CH" | jq -r '.channel.id')
echo "OK: Created channel $CH_ID"

# Get channel
echo "--- 5. Get channel ---"
CH_DETAIL=$(curl -sf "$BASE/api/channels/$CH_ID" -H "$H")
CH_NAME=$(echo "$CH_DETAIL" | jq -r '.channel.name')
[ "$CH_NAME" = "frontend" ] || { echo "FAIL: Expected name 'frontend', got '$CH_NAME'"; exit 1; }
echo "OK: Channel name = $CH_NAME"

# Send message
echo "--- 6. Send message ---"
MSG=$(curl -sf "$BASE/api/channels/$CH_ID/messages" -H "$H" \
  -H 'Content-Type: application/json' \
  -d '{"body":"hello team","kind":"text"}')
MSG_SEQ=$(echo "$MSG" | jq '.message.seq')
echo "OK: Message seq = $MSG_SEQ"

# Get messages
echo "--- 7. Get messages ---"
MSGS=$(curl -sf "$BASE/api/channels/$CH_ID/messages?limit=10" -H "$H")
MSG_COUNT=$(echo "$MSGS" | jq '.messages | length')
echo "OK: $MSG_COUNT messages"

# List members
echo "--- 8. List members ---"
MEMBERS=$(curl -sf "$BASE/api/channels/$CH_ID/members" -H "$H")
MEMBER_COUNT=$(echo "$MEMBERS" | jq '.members | length')
echo "OK: $MEMBER_COUNT members"

# Create invite
echo "--- 9. Create invite ---"
INVITE=$(curl -sf "$BASE/api/channels/$CH_ID/invite" -H "$H" -X POST)
INVITE_ID=$(echo "$INVITE" | jq -r '.invite.id')
echo "OK: Invite $INVITE_ID"

# Create thread
echo "--- 10. Create thread ---"
THREAD=$(curl -sf "$BASE/api/channels/$CH_ID/sessions" -H "$H" \
  -H 'Content-Type: application/json' \
  -d '{"threadTitle":"Implement login page"}')
THREAD_ID=$(echo "$THREAD" | jq -r '.session.id')
echo "OK: Thread $THREAD_ID"

# List sessions in channel
echo "--- 11. List channel sessions ---"
SESSIONS=$(curl -sf "$BASE/api/channels/$CH_ID/sessions" -H "$H")
SESSION_COUNT=$(echo "$SESSIONS" | jq '.sessions | length')
echo "OK: $SESSION_COUNT sessions"

# Get presence
echo "--- 12. Get presence ---"
PRESENCE=$(curl -sf "$BASE/api/channels/workspace/presence" -H "$H")
echo "OK: Presence response received"

# Delete channel
echo "--- 13. Delete channel ---"
DEL=$(curl -sf "$BASE/api/channels/$CH_ID" -H "$H" -X DELETE)
DEL_OK=$(echo "$DEL" | jq -r '.ok')
[ "$DEL_OK" = "true" ] || { echo "FAIL: Delete failed"; exit 1; }
echo "OK: Channel deleted"

# Verify channel is gone
echo "--- 14. Verify deletion ---"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/channels/$CH_ID" -H "$H")
[ "$HTTP_STATUS" = "404" ] || { echo "FAIL: Expected 404, got $HTTP_STATUS"; exit 1; }
echo "OK: Channel returns 404"

echo ""
echo "=== ALL SMOKE TESTS PASSED ==="
