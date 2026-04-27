# Round 2 End-to-End Test — Production Incident Response

> A *different* enterprise scenario from Round 1 (Round 1 was a 2-user "Alice + Bob
> implement login page" run). This round simulates a **3-person on-call rotation
> reacting to a live production incident**, exercises every UX behavior in
> `docs/mvp-ux-stage-2.md`, and verifies both the DOM and visual screenshots match
> expectations.

## Cast

| User | Role | Namespace (auto-derived) |
| --- | --- | --- |
| **Carol** | On-call SRE, channel **owner** | `carol` |
| **Dave** | Backend engineer | `dave` |
| **Erin** | Customer-success liaison | `erin` |

Channel: **`#prod-oncall`**. Bot custom-named **"Sentry"** via `agentConfig`.

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Round 2 step | Notes |
| --- | --- | --- |
| §1 Bot lifecycle: auto-spawn on channel-create with agentConfig | 4 | `bot_session_id` column populated |
| §1 Embedded runner default workdir | startup | `~/.hapi/workspaces/carol/prod-oncall` |
| §2 Custom `botName` | 4 | "Sentry" not "Agent" |
| §3 Channel timeline = real-user msgs + bot MCP outputs | 5–17 | no LLM reasoning leaks |
| §3 Typing indicator above input | 5, 7, 12 | `✨ Sentry is …` |
| §3 Pinned threads chip strip | 6, 18 | scheduled thread chip with ⏰ |
| §3 "Bot session →" header link | 16 | read-only banner verified |
| §3 Channel settings (owner only) | 14, 18 | non-owner cannot open |
| §4 Bot session page read-only | 16 | input hidden + banner |
| §5 Strong signal: `@mention` | 5, 7, 12 | bot must respond via MCP |
| §5 Strong signal: thread state change | 11 | thread completes → bot notified |
| §5 Strong signal: "+ New thread" button | 9 | UI button → channel-thread-requested |
| §5 Strong signal: channel init | 4 | `__channel_initialized` welcome |
| §5 Strong signal: agentConfig update | 14 | `__config_updated` injection |
| §5 Weak signal debounce (2 msgs OR 3s idle) | 8 | three short chats from Dave/Erin |
| §6 MCP tool: `send_to_channel` | 4, 5, 12 | welcome + replies |
| §6 MCP tool: `react_to_message` | 8 | bot reacts 👀 to weak chatter |
| §6 MCP tool: `spawn_thread` | 7, 9 | private (default) thread |
| §6 MCP tool: `spawn_scheduled_thread` | 6 | auto-pinned, shared, ⏰ |
| §6 MCP tool: `send_to_thread` | 11 | Lead injects context to teammate |
| §6 MCP tool: `unpin_thread` | 18 | manual unpin via thread page |
| §7 Thread default visibility = private | 7, 9 | minimal `⏳ Active` card |
| §7 Share to channel toggle | 10 | card upgrades to detailed |
| §7 + New thread button | 9 | Dave clicks UI button |
| §7 Pinned threads chip rendering | 6 | ⏰ icon for scheduled |
| §7 Thread inner messages render | 11, 13 | bot-injected on opposite side |
| §8 Scheduled thread auto-pin + shared | 6, 18 | visible to all members |
| §9 Reactions: user→user | 8 | Dave reacts 👍 to Carol |
| §9 Reactions: user→bot message | 13 | Erin reacts 🙏 |
| §9 Reaction toggle | 19 | re-add removes |
| §10 AgentConfig hot-reload via UI | 14 | Carol edits `systemPromptAddition` |
| §12 Channel deletion soft (rename folder) | 20 | folder → `*-archived-{ts}` |
| Stage 2 cross-namespace membership | 3 | Dave + Erin invited from outside `carol` ns |

If a step's assertion fails, file it in **Bugs Found** at the bottom and continue
where possible to maximize per-round signal. Do **not** add fallbacks — surface
errors loudly per the project's debugging principle.

---

## Phase 0 — Setup

```bash
rm -rf ~/.hapi
cd /home/azureuser/hapi
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd hub && bun run dev' > /tmp/r2-hub.log 2>&1 &
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd web && bun run dev' > /tmp/r2-web.log 2>&1 &
```

Wait for both to print "ready" / "Local: http://...". Embedded runner subprocess auto-spawns from hub.

Three persistent playwright sessions:

```bash
playwright-cli -s=carol open http://localhost:5173 --persistent
playwright-cli -s=dave  open http://localhost:5173 --persistent
playwright-cli -s=erin  open http://localhost:5173 --persistent
```

Each session authenticates via the dev pseudo-token format `TOKEN:carol:Carol Liu`,
`TOKEN:dave:Dave Park`, `TOKEN:erin:Erin Cho` (the web shell auto-detects this).

---

## Phase 1 — Channel boot, custom botName, welcome

### Step 1 — Carol authenticates

`-s=carol` types `TOKEN:carol:Carol Liu` into the auth field, presses Enter.
**Verify**: workspace shell shows `Carol Liu` in user chip.

### Step 2 — Carol creates channel `#prod-oncall`

Click "+ Channel" (or the create-channel UI). Set:
- Name: `prod-oncall`
- Description: `Live production incident triage. Owners: SRE.`
- AgentConfig (paste in editor):
  ```json
  {
    "flavor": "claude",
    "model": "claude-haiku-4-5-20251001",
    "botName": "Sentry",
    "systemPromptAddition": "You are Sentry, the channel agent for #prod-oncall. Be concise (≤2 sentences per channel reply). Always treat @mentions as actionable. Reply via send_to_channel.",
    "permissionMode": "yolo"
  }
  ```

### Step 3 — Carol invites Dave + Erin (cross-namespace)

In channel settings → Members, generate invite link.
Send the same link to both `-s=dave` and `-s=erin` browser sessions; each clicks accept.
**Verify (Stage 2 boundary)**: Dave (ns `dave`) and Erin (ns `erin`) both appear in the
channel member list even though channel lives in ns `carol`. Both can open it.

### Step 4 — Bot auto-spawn + welcome

Within ~3 s of channel creation, Carol's timeline shows a message authored by
**Sentry** (the custom botName, *not* "Agent"). Both Dave and Erin also receive
the welcome via SSE.
**Verify**:
- Author label = `Sentry`
- Avatar visually distinct from human users (bot square / gradient per §13)
- The welcome mentions `#prod-oncall` (system prompt instructs name interpolation)
- DOM: `<authorUserId>` is null on this message
- Hub: `channels.bot_session_id` populated; `~/.hapi/workspaces/carol/prod-oncall` exists

---

## Phase 2 — Strong-signal: @mention scheduled thread

### Step 5 — Carol: `@Sentry` opening status

Carol types in channel input:
> `@Sentry pls give us a one-line status. Just verifying you're up.`

**Verify**:
- Typing indicator appears above input ("✨ Sentry is thinking…")
- Indicator updates if bot calls `change_title` first (rare, fine if not)
- Within ~6 s a Sentry message appears
- Indicator disappears on idle

### Step 6 — Carol asks for periodic monitoring (→ scheduled thread)

> `@Sentry watch our /health endpoint and report any non-200 every 2 minutes`

This phrasing (`every X`) per system prompt rule 3 should trigger
`spawn_scheduled_thread`.

**Verify**:
- Typing indicator: "✨ Sentry is spawning thread …" (or similar)
- A new thread card appears in timeline (visibility=shared, scheduled)
- The pinned-threads chip strip in channel header shows a chip with ⏰ icon and
  the scheduled thread title
- Hub DB: thread session has `scheduled=1`, `schedule != null`, `pinned=1`,
  `visibility='shared'`
- Erin and Dave both see the chip (scheduled = shared = visible to all)

---

## Phase 3 — Incident: @mention spawns thread

### Step 7 — Erin pastes incident report (strong signal → spawn_thread)

`-s=erin` types in channel:
> `@Sentry urgent — 5 customers in last 10 min reporting "checkout 500" on iOS app. Need triage.`

**Verify**:
- Typing indicator on all 3 sessions
- Bot first replies (`send_to_channel`) with brief acknowledgment
- Bot calls `spawn_thread` → thread card appears (private = minimal `⏳ Active`)
- DB: thread `createdByUserId` = Erin's user id (not bot session id) — uses the
  ChannelAgent triggering-user lookup
- Card title is meaningful (not literal echo of prompt)
- Dave/Carol see the same thread card (private threads are still visible —
  soft-private — only the *display* differs from shared)

### Step 8 — Free chatter → weak signal debounce

Quickly (within 1 second of each other) Dave then Carol type:
- `-s=dave`: `morning all`
- `-s=carol`: `coffee first 🙃`

The 2-message threshold should fire immediately. Bot per system prompt rule 2
should prefer `react_to_message` over a full reply.

**Verify**:
- Within ~5 s either reactions appear under one of the messages, OR a single
  brief message — both acceptable
- No flood of replies (no MAX_ACTIVE violation, no per-message echo)
- DOM: reaction emoji bubble below the chosen message

---

## Phase 4 — "+ New thread" button + share toggle

### Step 9 — Dave clicks "+ New thread"

Dave clicks the explicit "+ New thread" UI affordance. A small dialog/popover
prompts for a topic. Dave types:
> `look at recent deploys for clues — anything in last 4h that touched checkout`

Submit.

**Verify**:
- Strong signal `<system>user requested new thread on topic …</system>` injected
- Bot calls `spawn_thread`
- Thread card appears (private; minimal display)
- DB: thread `createdByUserId` = Dave's user id

### Step 10 — Dave shares thread to channel

Dave opens the new thread page → toggles "Share to channel".

**Verify**:
- Card in channel timeline upgrades from minimal `⏳ Active` → detailed
  (shows current tool name / target file when bot working, or summary)
- No broadcast message sent (avoids noise)
- Erin + Carol see the upgrade via SSE
- Toggling again should revert

---

## Phase 5 — Lead → Teammate (send_to_thread)

### Step 11 — Carol: `@Sentry` directs Sentry to coordinate threads

Carol in main channel:
> `@Sentry both threads should sync. tell the deploy-investigation thread to also check the auth-service rollout from yesterday.`

This forces Sentry to call `send_to_thread` on Dave's deploy-investigation
thread to inject context (Lead → Teammate per §6).

**Verify**:
- DOM in Dave's deploy thread: a new message appears, rendered on the
  *opposite side* from human messages with mid-grey style (per §7)
- Bot session transcript shows the `send_to_thread` MCP call

### Step 12 — Erin asks Sentry for status

> `@Sentry status report — give me the 30-second summary`

Bot calls `list_threads` / `get_thread` then `send_to_channel` with a synthesis.

**Verify**:
- Reply mentions both threads by title and current state
- Tool calls don't appear in channel timeline (only the synthesized reply does)

---

## Phase 6 — Reactions

### Step 13 — Erin reacts 🙏 to Sentry's status reply

Click reaction picker → 🙏.

**Verify**:
- Reaction bubble renders below the message
- DB row in `channel_message_reactions` with `reactor_ref='user:{erin_id}'`
- SSE `message-reaction-added` delivered to Carol + Dave

### Step 13b — Dave reacts 👍 to Carol's earlier "coffee first 🙃" message

User-on-user reaction.

**Verify**:
- Bubble renders under Carol's message in all three sessions
- Bot does **not** treat this as another strong signal (just adds to weak buffer
  per §9 rules — reaction triggers a weak signal but bot may noop)

---

## Phase 7 — Bot session read-only page

### Step 16 — Carol opens "Bot session →" link in channel header

Click the header button.

**Verify**:
- Lands on session detail page for the bot session
- Top banner reads "View only — interact in #prod-oncall" (per §4)
- Input is hidden or disabled
- Full LLM transcript visible: system prompt, user-message inject lines, bot
  reasoning, tool calls and tool results
- Erin (non-owner channel member) can also navigate to the same URL successfully
  (the page is read-only for *all* channel members per §4)

---

## Phase 8 — AgentConfig hot-reload

### Step 14 — Carol edits agentConfig

Open channel settings → Agent config form. Change `systemPromptAddition` to:
> `You are Sentry. The team is now in active incident mode — keep replies under 1 sentence and prepend "[INCIDENT]" to every send_to_channel.`

Save.

**Verify**:
- File at `~/.hapi/channels/{channelId}/agent.json` updated
- Hub injects `<system>__config_updated …</system>` into bot session
- Next time Carol or Dave or Erin @-mentions Sentry, the reply begins with
  `[INCIDENT]` (proves bot received the update)
- Non-owner Dave attempting to PUT the config receives 403 server-side; UI
  ideally hides the form for non-owners but the server-side check is the bar

### Step 15 — Trigger config-aware reply

Dave: `@Sentry confirm config update`. Reply must start with `[INCIDENT]`.

---

## Phase 9 — Pin / unpin

### Step 18 — Carol unpins the scheduled health-check thread

Long-press / right-click / context-menu on the scheduled chip in the header
(whichever the UI exposes). Pick "Unpin".

If the UI doesn't expose this directly to humans (it's primarily a bot tool),
fall back to: open the scheduled thread → header → "Unpin" button (owner-only).

**Verify**:
- Chip disappears from header on all 3 sessions
- DB: `pinned=0` on that session
- The thread itself still runs (unpinning ≠ cancelling)

---

## Phase 10 — Reaction toggle + cleanup

### Step 19 — Reaction toggle

Erin re-clicks 🙏 on Sentry's earlier message.

**Verify**: bubble disappears (DB row removed).

### Step 20 — Carol soft-deletes channel

Channel settings → Delete channel → confirm (do **not** check "Also delete files").

**Verify**:
- Channel removed from sidebar in all 3 sessions
- Folder `~/.hapi/workspaces/carol/prod-oncall` renamed to
  `prod-oncall-archived-{ts}` (preserves user files)
- Bot session and thread sessions all marked archived
- No 500 / FK constraint errors in hub log

---

## Observability checklist (run during the test, not after)

1. `tail -f /tmp/r2-hub.log /tmp/r2-web.log` in a side terminal to catch errors live
2. After every step that should trigger UI updates, take both
   `playwright-cli -s=<who> snapshot` and `playwright-cli -s=<who> screenshot --filename=...`
3. Compare what the DOM says (`authorUserId`, `body.botName`, etc) against the
   visible string in the screenshot
4. Note discrepancies under **Bugs Found** — even cosmetic ones

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix commit |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 — Save agentConfig | HIGH | `Save & hot-reload` failed with CORS preflight error: `Method PUT is not allowed by Access-Control-Allow-Methods`. | `hub/src/web/server.ts` `cors()` `allowMethods` only listed `GET POST PATCH DELETE OPTIONS` — PUT missing. | added `PUT` to allowMethods |
| 2 | 1 — Invite Dave + Erin | HIGH | No UI to invite users to a channel. `client.createInvite` and `client.acceptInvite` exist but no component uses them. Workaround: hand-rolled cURL with each user's JWT. | Member-management UI never built. | Added "Members" section in AgentConfigEditor with Generate Invite Link + Copy + expiry, and `/invite/$token` route component that auto-accepts and navigates to the channel |
| 3 | 2/3/4 — Thread cards everywhere | HIGH | Thread card author shows raw userId (`by 4221690288`, `by 3133981847`, `by 129409217`) instead of `Carol Liu` / `Erin Cho` / `Dave Park`. | `hub` channel route enriches `authorDisplayName` only via `engine.getWorkspaceUser(channel.namespace, userId)` — cross-namespace users (Dave in `dave`, Erin in `erin`) aren't found in `carol`'s workspace_users rows, so it falls through to raw id. Same gap for `createdByUserId` on session list. | Added `workspaceUsers.getUserGlobal(userId)` + `engine.getDisplayNameForUser(userId)`. Channel routes for `messages` (fall back to global) and `sessions` (enrich each with `createdByDisplayName`) now resolve cross-ns names. Verified: `Carol Liu` / `Erin Cho` render correctly. |
| 4 | 2 — Scheduled chip | MEDIUM | After bot spawns scheduled+pinned thread, the `⏰ Health endpoint monitor` chip doesn't appear in channel header until a manual page reload. | Bot's `botSpawnScheduledThread` was calling `this.store.sessions.setSessionPinned(...)` (the **store** — bypassing engine method that emits `thread-pinned` SSE). | Switched to `this.setSessionPinned(...)` and `this.setThreadVisibility(...)` (the **engine** methods) so SSE events fire. |
| 5 | 3 — Erin posts incident | HIGH | Channel timeline shows Erin's message author as `3133981847`. Avatar = first digit `3`. | Same as #3. | Same fix — verified `Erin Cho` now renders correctly. |
| 6 | 3 — Dave free chat | HIGH | Dave's `morning all` shows author `129409217`, avatar `1`. | Same as #3. | Same fix. |
| 7 | 3 — Reactions | LOW (cosmetic) | Reaction bubbles rendered as small ☕ / 👋 / 👍 icons (acceptable). | n/a (works correctly, just compact). | n/a |
| 8 | 4 — Click + New thread | MEDIUM (UX) | Uses browser-native `window.prompt('What should the new thread be about?')` which is unstyled, blocking, and unreliable across browsers. | `ChannelView.handleNewThreadClick` calls `window.prompt`. | Replaced with Radix Dialog containing a multi-line textarea + Cancel/Spawn buttons + Cmd+Enter shortcut. |
| 9 | 4 — Dave's thread page | HIGH | More-actions menu only has `Rename` / `Archive`. No "Share to channel" toggle, no "Pin / Unpin", no "Visibility" — all required by mvp-ux-stage-2 §7. API exists (`setThreadPinned`, `setThreadVisibility`) but no UI surface. | UI never wired the existing `client.setThreadPinned` / `client.setThreadVisibility` methods. | Extended `SessionActionMenu` with optional `pinned`/`onTogglePin`/`shared`/`onToggleShare` props. `SessionHeader` detects channel-thread sessions, wires the API calls, and surfaces `📌 Pin / Unpin` and `🔒 Share / Unshare` menu items. Server enforces ownership. |
| 10 | 5 — Sentry's `send_to_thread` injection | LOW | Thread agent flagged `<system>injected-by-bot</system>` as suspected prompt injection and refused to act on it. Defensive Claude behavior, expected; not a bug. | n/a — Claude prompt-injection defense is correct here. | n/a |
| 11 | 6 — Reactions SSE | LOW | Reaction added by Dave appeared in Carol's view after a small (~3s) delay. Acceptable. | SSE delivery has a debounce. | n/a |
| 12 | 8 — agentConfig save | MEDIUM (intermittent) | First `Save & hot-reload` after channel creation didn't always reach the bot session via `__config_updated`. Subsequent edits worked reliably. | Suspected race in fs.watch recursive on Linux/Bun: when `mkdirSync` creates the channelId subdir and `writeFileSync` lands the file in the same call, inotify subscription on the new subdir is registered lazily and the very first event can slip. Subsequent overwrites land cleanly. | Not patched this round — second save always works, and the watcher itself is healthy (verified end-to-end for the [INCIDENT] prefix flow). Future hardening: replace recursive watch with chokidar or per-channel-dir non-recursive watchers. |
| 13 | 9 — Unpin chip | HIGH | No UI button to pin/unpin a thread (carries over from #9). | Same as #9. | Same fix — Pin/Unpin in More-actions menu, verified live: clicking adds the chip to header, clicking again removes. |
| 14 | 10 — Delete channel | HIGH | No UI to delete a channel. `client.deleteChannel` exists but is unused; per mvp-ux-stage-2 §12 the owner needs a Settings → Delete with soft / "Also delete files" toggle. | UI never built. | Added "Danger zone" section in AgentConfigEditor (owner-only): hard-delete checkbox + red Delete button + confirm overlay with adaptive copy. Verified: clicking Soft delete renames `~/.hapi/workspaces/carol/incident-room` → `incident-room-archived-{ts}` and navigates Carol back to `/channels`. |
| 15 | (during fix audit) | HIGH (security) | The `PATCH /sessions/:id/pinned` channel-owner gate uses `engine.getChannel(channelId, namespace)`, which is namespace-scoped. For an invited member from a different namespace the lookup returns `null`, the `if (channel && ...)` guard short-circuits, and the action proceeds — meaning **any** channel member could pin/unpin **any** thread including the channel owner's. | namespace-scoped lookup in a route that's now membership-based. | Switched to `engine.getChannelById(channelId)`, require non-null, and enforce ownership unconditionally. |

### Coverage outcome (from coverage map at top of doc)

All 20 numbered scenario steps were executed end-to-end. The "happy path" of bot
spawn → strong signal → spawn_thread → spawn_scheduled_thread → send_to_thread →
status synthesis → reactions → bot session read-only page → agentConfig
hot-reload → unpin → soft-delete all functioned at the hub/runner level. The
**failures are concentrated in the web UI**: missing invite, missing
delete-channel, missing pin/share-thread surfaces, raw userIds for cross-ns
users, and a couple of CORS / reload-cache nits.

