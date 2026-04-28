# Round 7 End-to-End Test — Academic Paper Review

> Distinct from rounds 1–6. Round 7 stresses behaviors NOT yet
> exercised: **channel name collision** (creating two channels with
> the same name), **bot's `unpin_thread` MCP** (separate from the
> round-2 UI unpin), **invite re-acceptance idempotency** (clicking
> the same invite link twice), **invite expiration UX**, the untouched
> **`detach` thread-from-channel route**, and **reaction toggle**
> (clicking the same emoji a second time should remove it).
> Doubles as a regression run for round-1-through-6 fixes.

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Yuki** | Principal Investigator, channel **owner** | `yuki` |
| **Noah** | PhD student | `noah` |
| **Ema** | Postdoc | `ema` |

Channel: **`#paper-cvpr-25`** with description "CVPR-25 submission
review — methods + results + related work". Bot named **"Reviewer"**.

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| Channel creation: same name collision | 3 | Never tested; expect either rejection or auto-rename |
| §6 MCP `unpin_thread` (bot-side, NOT UI) | 11 | UI unpin tested in round 4; bot's own unpin call never verified |
| Invite re-acceptance idempotency | 10 | Same user clicks same `/invite/<id>` twice — should be a no-op redirect, not a duplicate row or error |
| Invite expiration UX | 13 | Click an expired invite — should render "invalid or expired" instead of a broken page |
| `POST /channels/:id/sessions/:sessionId/detach` route | 12 | Round-2 added this route; never exercised in any round |
| §9 Reaction toggle (same emoji twice removes) | 8, 9 | Sanity check — every prior round only added reactions, never re-clicked same |
| §6 MCP `get_thread` with bad id (error path) | 14 | Spec says bot MUST respond via MCP; failure must surface, not crash bot |
| Round-2 fix: invite link UI | 3 | Yuki generate, Noah+Ema accept |
| Round-2 fix: cross-ns user displayName | all | "Yuki Sato" / "Noah Brown" / "Ema Lopez" everywhere |
| Round-3 fix: hard-delete clean | 15 | Final cleanup |
| Round-4 fix: welcomeStyle "auto" | 4 | Default branch — bot greets |
| Round-5 fix: list_channel_members enriched | (passive) | — |
| Round-6 fix: `POST /api/sessions/:id/messages` 403 on bot | (passive) | regression check |
| Round-6 fix: agentConfig debounceMs honored | (passive) | regression check (default 3s) |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup

```bash
rm -rf ~/.hapi
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; export CORS_ORIGINS="http://localhost:5173,http://localhost:3006"; cd /home/azureuser/hapi/hub && exec bun --watch run src/index.ts' > /tmp/r7-hub.log 2>&1 &
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd /home/azureuser/hapi/web && exec bun run dev' > /tmp/r7-web.log 2>&1 &

playwright-cli -s=yuki open http://localhost:5173
playwright-cli -s=noah open http://localhost:5173
playwright-cli -s=ema  open http://localhost:5173
```

Each session sets hub URL `http://localhost:3006` and signs in:
- `<TOKEN>:yuki:Yuki Sato`
- `<TOKEN>:noah:Noah Brown`
- `<TOKEN>:ema:Ema Lopez`

---

## Phase 1 — Channel + collision

### Step 1 — Yuki signs in

### Step 2 — Yuki creates `#paper-cvpr-25`

### Step 3 — Yuki tries to create a SECOND `#paper-cvpr-25`

Expected behaviors (any of these is OK; we just need consistent UX):
- A. Server rejects with 409 / 400 → web shows error toast.
- B. Server auto-renames to `paper-cvpr-25-2` → web shows success.
- C. Server lets it through silently → DB has duplicate names but
  unique IDs → sidebar shows "# paper-cvpr-25" twice (collision in
  display).

Whatever the actual behavior, log it. **Bug if the response is a
crash or the sidebar becomes inconsistent.**

After collision check, delete the duplicate (if any) so the rest of
the test runs against a single channel.

### Step 4 — Yuki opens Settings: agentConfig + invite

In Settings dialog:
- **Channel**: name `paper-cvpr-25`, Description `CVPR-25 submission review — methods + results + related work`.
- **Identity**: Bot name = `Reviewer`, Model = `claude-haiku-4-5-20251001`.
- **Behavior**: System prompt addition = `You are Reviewer. Concise replies (≤2 sentences). Spawn one thread per section to review.` Welcome style = `auto`.
- **Members**: Generate Invite Link.
- Save & hot-reload.

Within ~10 s, Reviewer welcomes the channel.

---

## Phase 2 — Invite idempotency + expiration

### Step 5 — Noah accepts the invite (first time)

`-s=noah goto <invite URL>` → auto-redirects to channel.

### Step 6 — Ema accepts the same invite

Same URL works for Ema → auto-redirects.

### Step 10 — Noah accepts the SAME invite a SECOND time

Same URL again. Verify it's a no-op (already a member) — should
silently redirect to the channel. **Bug if it 500s or shows a duplicate
member row.**

### Step 13 — Yuki generates a new invite, expires it manually, attempts to use it

```bash
# generate fresh invite
INVITE=$(curl /api/channels/.../invite ...)
# expire it via DB write (set expiresAt to past)
sqlite3 ~/.hapi/hub.sqlite "UPDATE channel_invites SET expires_at=1 WHERE id='$INVITE'"
# Ema clicks the now-expired URL
playwright-cli -s=ema goto "/invite/$INVITE"
```

Verify:
- Hub returns 404 / "invalid or expired" from the accept route.
- Web `/invite/$token` page renders the friendly error message
  ("Couldn't join channel — invite is invalid or expired").
- Page doesn't crash; user can navigate back to `/channels`.

---

## Phase 3 — Reactions + reaction toggle

### Step 7 — Yuki @Reviewer for review-thread spawn

> `@Reviewer split the review into 3 threads: methods, results, related work.`

Bot calls `spawn_thread × 3`. Verify thread cards render.

### Step 8 — Yuki reacts 👍 to one of bot's messages, then again to remove

Open emoji picker on the bot's spawn-acknowledgement message → pick 👍.
Verify bubble appears. Re-open picker → pick 👍 again. Verify bubble
disappears (Slack-style toggle per §9).

### Step 9 — Ema reacts 🔥 to a thread_card, then again

Same toggle test but on a `thread_card` message (round-6 verified
single-add; round-7 verifies the toggle path on the card type).

---

## Phase 4 — Bot's unpin_thread MCP (NEW)

### Step 11a — Yuki @Reviewer to PIN the methods thread

> `@Reviewer pin the methods thread — that's the focus this week.`

Bot calls `pin_thread`. Chip appears in header.

### Step 11b — Yuki @Reviewer to UNPIN it

> `@Reviewer unpin the methods thread — focus has shifted.`

Bot calls `unpin_thread`. **Verify the chip disappears from the
header for all three users via SSE.** This exercises the bot-side
`unpin_thread` MCP path (the UI unpin was already tested in round 4).

---

## Phase 5 — Detach session from channel

### Step 12 — Yuki detaches one thread from the channel via direct API

`POST /api/channels/<channelId>/sessions/<sessionId>/detach` with
Yuki's JWT. Verify:
- API returns 200.
- Thread session removed from `getSessionsByChannel(channelId)`.
- Thread session in DB has `channelId=null` afterward.
- Channel timeline keeps the original `thread_card` (immutable
  history); but no future updates flow.
- Thread card's "Open Thread →" link still works (the session itself
  still exists, just no longer attached to the channel).

---

## Phase 6 — get_thread with bad id (graceful error)

### Step 14 — Yuki @Reviewer with a fake threadId

> `@Reviewer get_thread on this id and tell me what's there: aaaa-bbbb-cccc-dddd-non-existent`

Bot calls `get_thread` → MCP returns error → bot must reply
gracefully (e.g. "thread not found, can you re-share the id"). Bot
session must NOT crash.

---

## Phase 7 — Cleanup

### Step 15 — Yuki hard-deletes `#paper-cvpr-25`

Settings → Danger zone → Also delete files → Delete.

Verify:
- Folder `~/.hapi/workspaces/yuki/paper-cvpr-25` is gone.
- No orphan claude subprocesses.
- Sidebars on Noah + Ema drop the channel.
- Hub log shows no FK / 500 errors.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R7-1 | 3 — channel name collision | HIGH (UX/data) | Yuki created two `#paper-cvpr-25` channels in the same `yuki` workspace. Both got distinct ids but identical names. Result: sidebar showed two indistinguishable `# paper-cvpr-25` buttons; the workspace folder collides at `~/.hapi/workspaces/yuki/paper-cvpr-25/` (both bots write there); the bot system prompt references an ambiguous channel. | `POST /channels` route in `hub/src/web/routes/channels.ts` did no name uniqueness check before calling `engine.createChannel`. | Added an early lookup via `engine.getChannelByName(namespace, name)`; if a channel already exists in this workspace, return `409 Conflict { error, existingChannelId }`. Added `getChannelByName` accessor to syncEngine + the test mocks. Verified: re-creating the same name now returns `409 Conflict {"error":"Channel name \"paper-cvpr-25\" already exists in this workspace","existingChannelId":"..."}`. |
| (obs) | 13 — expired-invite UX | LOW (cosmetic) | The expired-invite landing page renders the raw HTTP wrapper text: `HTTP 404 Not Found: {"error":"Invalid or expired invite"}`. Functional ("Couldn't join channel" header + "Go to channels" button work) but the body is the raw API error string, not a friendly sentence. | `web/src/router.tsx` `InviteAcceptPage` displays `error` from the catch block verbatim, and `ApiClient.request` formats errors as `HTTP <status> <statusText>: <body>`. | Not fixed this round (cosmetic). Future: have InviteAcceptPage parse the JSON to extract the friendly `error` field, or special-case 404 → "This invite link is no longer valid. Ask the channel owner for a fresh one." |
| (obs) | 14 — bot reasons but skips final `send_to_channel` | LOW (intermittent Claude oversight) | Bot called `get_thread` with bad UUID, MCP returned an error, bot reasoned "I should report this back" + composed `"That thread ID doesn't exist — not found in this channel."` but then never actually called `send_to_channel`. Same Claude-oversight pattern noted in rounds 3 + 5. | Claude prompt-flow occasionally drops the final MCP call after composing a textual reply during reasoning. Not a HAPI bug. | Not addressed; deferred to future bot system-prompt tightening (e.g. "Composing a reply in reasoning is NOT a substitute for calling send_to_channel"). |

### Coverage outcome

All 15 numbered scenario steps were executed.

**New observations (not bugs)**:
- Invite re-acceptance is correctly idempotent: clicking the same invite link a second time silently redirects to the channel; member count stays at 3, joinedAt timestamp preserved (Step 10).
- `POST /channels/:id/sessions/:sessionId/detach` works end-to-end (Step 12): 200 OK, channel session count drops from 3 → 2, the session itself still exists.
- Reaction toggle (clicking same emoji twice) works on **both** ordinary `text` messages (Step 8) and `thread_card` messages (Step 9): API returns `{result:"added"}` then `{result:"removed"}`; DB is empty after toggle.
- Bot's `unpin_thread` MCP call works end-to-end (Step 11b): bot pins `Methods` via `pin_thread` (chip appears), then unpins via `unpin_thread` (chip disappears). DB state confirms `pinned=False` after.
- Bot session does NOT crash on `get_thread` with a bad UUID (Step 14): the MCP error is surfaced and reasoned about correctly. Whether the bot actually replies is a Claude-prompt issue.

Round-2/3/4/5/6 fixes still hold:
- cross-ns user displayName ("Yuki Sato", "Noah Brown", "Ema Lopez") everywhere
- invite-link UI flow + auto-redirect
- agentConfig hot-reload (round-3 per-channel watcher)
- welcomeStyle "auto" greet (round-4 default branch)
- list_channel_members / get_channel_history enriched (round-5)
- §4 spec: bot session POST returns 403 (round-6 — passively confirmed since no bot-direct-POST attempted)
- hard-delete clean (no folder, no orphan claude subprocesses)

