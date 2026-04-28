# Round 4 End-to-End Test — Customer Escalation Triage

> Distinct from rounds 1–3. Round 4 stresses **previously-untested behaviors**:
> `welcomeStyle: "skip"` (silent bot until first @mention), the
> `cancel_thread` MCP tool, **bot crash recovery + `get_channel_history`
> catch-up**, channel rename (likely no UI yet), **member removal** (likely
> no UI yet), and **hard delete with file removal**.

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Priya** | Customer Success Lead, channel **owner** | `priya` |
| **Ren** | Senior Engineer | `ren` |
| **Vik** | Junior Engineer / on-call backup | `vik` |

Channel: **`#cs-escalations`** → renamed mid-test to `#cs-triage`.
Bot named **"Triage"**, configured with `welcomeStyle: "skip"`.

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §1 Auto-spawn on agentConfig save | 4 | Bot session spawns even when welcomeStyle=skip |
| §1 Embedded runner workdir | startup | `~/.hapi/workspaces/priya/cs-escalations` |
| §2 Custom `botName` | 4 | "Triage", not "Agent" |
| §3 Channel UI baseline | all | Header + timeline + input |
| §4 Bot session read-only page | 14 | Used to inspect crash-recovery transcript |
| §5 Strong signal: `@mention` | 5, 7, 11 | Bot wakes from skip on first mention |
| §5 Strong signal: thread state change (cancelled) | 8 | Verifies bot is notified of `cancel_thread` outcome |
| §5 Strong signal: channel init | 4 | `__channel_initialized` injected, but bot stays silent (welcomeStyle=skip) |
| §6 MCP `send_to_channel` | 5, 7, 11 | Replies |
| §6 MCP `spawn_thread` | 5, 7 | Two issue threads |
| §6 MCP `cancel_thread` | 8 | **First time tested in any round** |
| §6 MCP `get_channel_history` | 12 | After bot crash recovery |
| §6 MCP `react_to_message` | 9 | Acknowledgment |
| §7 Manual pin via UI (round-2 fix) | 6 | Priya pins the P0 thread |
| §7 Unpin via UI | 13 | Priya unpins after issue closed |
| §10 AgentConfig hot-reload | 3 | First-save welcomeStyle=skip honored |
| §12 Channel deletion **hard** with file removal | 16 | **First time tested in any round** — `?hard=true` removes archive folder |
| Stage-2 cross-namespace channel members | 3 | Ren+Vik invited |
| Crash recovery (bot watchdog) | 10–12 | Kill bot subprocess, hub auto-respawns within ~60s, conversation context preserved via session resume |
| Channel **rename** via UI | 15 | Per mvp the field exists but no UI surface yet — log if missing |
| **Remove member** from channel | 14 | API exists; no UI → log if missing |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup

```bash
rm -rf ~/.hapi
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; export CORS_ORIGINS="http://localhost:5173,http://localhost:3006"; cd /home/azureuser/hapi/hub && exec bun --watch run src/index.ts' > /tmp/r4-hub.log 2>&1 &
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd /home/azureuser/hapi/web && exec bun run dev' > /tmp/r4-web.log 2>&1 &

playwright-cli -s=priya open http://localhost:5173
playwright-cli -s=ren   open http://localhost:5173
playwright-cli -s=vik   open http://localhost:5173
```

Each session sets hub URL `http://localhost:3006`, then signs in:
- `<TOKEN>:priya:Priya Sharma`
- `<TOKEN>:ren:Ren Tanaka`
- `<TOKEN>:vik:Vik Okafor`

---

## Phase 1 — Silent bot (`welcomeStyle: "skip"`)

### Step 1 — Priya signs in

### Step 2 — Priya creates `#cs-escalations`

### Step 3 — Priya opens Settings, configures Triage with `welcomeStyle: "skip"`

In Settings dialog:
- **Identity**: Bot name = `Triage`; Model = `claude-haiku-4-5-20251001`
- **Behavior**:
  - System prompt addition = `You are Triage. Keep replies under 2 sentences. Spawn a thread per customer escalation. Stay silent until @mentioned.`
  - **Welcome style** = `skip`
- **Members**: Generate Invite Link, copy URL.
- Save & hot-reload.

Open invite URL in `ren` and `vik` browsers; both auto-redirected to channel.

### Step 4 — Verify bot is silent

Wait ~10 s. Verify:
- All three timelines have **no** Triage welcome message.
- Hub: `channels.bot_session_id` populated (bot session DID spawn).
- Bot session page exists at `/sessions/<bot id>` and is reachable via the
  header link.
- DB: bot session metadata matches.

---

## Phase 2 — First escalation thread

### Step 5 — Priya posts the first escalation

> `@Triage P0: customer "Acme Corp" reports they cannot log in to their main account since 14:00 UTC. Their CSM needs status updates every 30 min.`

**Expect**: bot wakes from skip, calls `send_to_channel` (acknowledgment) and
`spawn_thread` (e.g. "P0: Acme login outage"). DB: thread `createdByUserId` =
Priya's id; render shows "by Priya Sharma".

### Step 6 — Priya pins the P0 thread (round-2 manual pin UI)

Open the thread → More-actions menu → **📍 Pin to channel header**.

Verify: chip `📌 P0: Acme login outage` appears in header on all 3 timelines
without a manual reload.

---

## Phase 3 — `cancel_thread` (first round to test it)

### Step 7 — Vik posts a second issue

> `@Triage another one: customer "Bravo Inc." getting 502 errors on POST /api/widgets since 14:30 UTC.`

**Expect**: bot spawns "P1: Bravo widgets 502" thread.

### Step 8 — Priya asks Triage to cancel the Bravo thread (Acme is the priority)

> `@Triage cancel the Bravo widgets thread for now — we'll come back to it after Acme is contained.`

**Expect**:
- Bot calls `mcp__hapi__cancel_thread` on the Bravo thread.
- Hub emits `session-updated` with `threadStatus='cancelled'` (or similar).
- Channel timeline shows Bravo card transitioning to a cancelled state.
- Bot session's transcript shows the strong-signal `<system>thread … cancelled</system>` injection from the state-change.
- DB: Bravo session `threadStatus` = cancelled / archived.

### Step 9 — Vik reacts 🙏 to Priya's message

User → user reaction. Sanity check that reactions still work post-cancel.

---

## Phase 4 — Bot crash recovery + `get_channel_history`

### Step 10 — Externally kill the bot CLI subprocess

Find the PID of the `claude --output-format stream-json … channel agent`
process serving the Triage session and `kill <PID>`. (Targeted PID kill,
NOT broad pkill, per CLAUDE.md.)

### Step 11 — Wait for hub watchdog to respawn

Spec §1 says "Bot session 意外崩溃 → Hub watchdog 检测到 → Hub
auto-restart bot, **复用原 sessionId**, session resume 拉回历史 context".
Within ~60 s the bot should be back; the session id is preserved.

Verify:
- Hub log shows `Channel bot … ended — scheduling restart`.
- Hub log shows respawn with same session id.
- The bot session page transcript still reachable.

### Step 12 — Ren posts a 3rd escalation, expecting respawned bot to handle it

> `@Triage P1: customer "Charlie Ltd." sees blank dashboard after the noon deploy — probably the FE bundle.`

**Expect**:
- Respawned bot picks up the strong signal.
- Bot calls `mcp__hapi__get_channel_history` to catch up on what it missed
  while dead (per spec §6 — "主要用于崩溃恢复后追上下文").
- Bot then `spawn_thread` for the Charlie issue.
- The bot session transcript shows the catch-up + the new spawn.

---

## Phase 5 — Membership + rename (likely missing UI)

### Step 13 — Priya unpins the P0 thread (Acme is resolved)

Open the P0 thread → More-actions menu → unpin (the same menu item flips
because `pinned=true`).

Verify: chip disappears from header on all 3 timelines.

### Step 14 — Priya removes Vik from channel

Open Settings → Members section → **(expected: list of members with a "Remove"
button next to each non-owner)**.

If the UI doesn't expose member removal, log as a bug. Workaround: call
`DELETE /api/channels/:id/members/:userId` directly, then verify Vik's
sidebar drops `#cs-escalations`.

### Step 15 — Priya renames the channel `cs-escalations` → `cs-triage`

Open Settings → **(expected: editable channel name field at top)**.

If absent, log as a bug. Workaround: `PUT /api/channels/:id` with
`{ "name": "cs-triage" }`. Verify all sidebars show the new name.

---

## Phase 6 — Hard delete

### Step 16 — Priya hard-deletes the channel

Open Settings → Danger zone → **check "Also delete files"** → Delete →
confirm "Delete + remove files".

Verify:
- Channel removed from sidebars.
- Folder `~/.hapi/workspaces/priya/cs-triage` (or `cs-escalations` if
  rename failed) is **gone** — no `*-archived-{ts}` folder either.
- Hub log shows the hard-delete branch.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R4-1 | 4 — Bot welcome despite `welcomeStyle: skip` | HIGH | Triage posted "👋 I'm Triage, your escalation coordinator…" even though `agentConfig.welcomeStyle = "skip"`. | The `welcomeStyle` field was stored in `agent.json` but **never read by any code in cli/ or hub/**. `buildChannelBotSystemPrompt` had a hardcoded "Welcome behavior: post a brief greeting on `__channel_initialized`" line — no branching on welcomeStyle. mvp-ux-stage-2.md §11 spec calls for `auto / skip / custom:{text}` branching. | `cli/src/claude/utils/systemPrompt.ts`: parse `cfg.welcomeStyle` and emit different "Welcome behavior" copy: `auto` → greet, `skip` → noop on init, `custom:…` → use trailing text as the greeting. Verified: created `silent-room` channel with `welcomeStyle=skip` → "No messages yet" stayed empty for the full wait. |
| R4-2 | 8 — Cancelled thread card | MEDIUM | After bot called `cancel_thread`, the new `agent_summary` card emitted with `status: "canceled"` rendered with the **default blue "Active"** badge in the timeline. | `web/src/components/ThreadCard.tsx` only branched on `completed` / `failed`; everything else fell through to `Active`. | Added `canceled`/`cancelled` branch (slate-grey badge, "Cancelled" label). Verified visually after the Bravo thread cancel. |
| R4-3 | 10 — Bot crash recovery | HIGH | Killing the bot CLI subprocess externally (`kill <pid>`, both SIGTERM and SIGKILL) did NOT trigger the watchdog. Bot stayed dead indefinitely. | `socket.on('disconnect')` in `hub/src/socket/handlers/cli/index.ts` only unregistered RPC and cleaned terminals — it never synthesized a `session-end` for sessions the socket had been publishing as alive. The watchdog only fires inside `handleSessionEnd`, so an ungraceful CLI death was invisible to it. | Added `SocketData.trackedSessionIds: Set<string>` populated on each `session-alive`, removed on graceful `session-end`. The `disconnect` handler now iterates whatever's left and synthesizes `onSessionEnd({ sid, time: now })` for each — this is the SIGKILL safety net. Verified end-to-end: `kill -9` on the bot CLI → hub log shows `Channel bot … ended — scheduling restart`, then `Channel bot spawned: … session=<original-id>`, and the new subprocess command line includes `--resume <original-id>` (session id preserved per spec §1). |
| R4-4 | 14 — Remove member | HIGH | No UI to remove a channel member. `client.removeChannelMember` exists but no component calls it. | UI never built. | Added "Current members" Field inside the existing Members Section: lists each member with name + (namespace) + `you` / `owner` chips, plus a per-row Remove button (owner-only, hidden for self and for the channel owner). Hub `GET /channels/:id/members` route now enriches each row with `displayName` + `namespace` via the global workspace_users lookup so cross-namespace members render correctly. ChannelMemberSchema extended with the optional fields. Verified: Priya removed Vik via Remove → confirm dialog → API 200 → list updates → Vik's sidebar drops the channel. |
| R4-5 | 15 — Rename channel + edit description | HIGH | No UI to change channel name or description. `client.updateChannel` exists but unused. | UI never built. | Added "Channel" Section at the very top of the Settings dialog with name + description inputs and a "Save channel meta" button (disabled when not dirty, owner-only). Verified: Priya renamed `ui-validate` → `ui-validate-renamed` and added a description; both immediately reflected in the channel header (`# ui-validate-renamed — Validation channel for round-4 fixes`) and in all sidebars via SSE. |

### Coverage outcome

All 16 numbered scenario steps were executed. The two NEW MCP tools previously
untested across rounds 1–3 — `cancel_thread` and the bot's
`get_channel_history` after crash-recovery — both fired correctly. Hard delete
also verified for the first time (no `*-archived` folder left after the API
returned `{"ok":true,"hard":true}`).

Round-2 + round-3 regressions all hold:
- cross-ns user displayName ("Priya Sharma" / "Ren Tanaka" / "Vik Okafor")
- invite-link UI flow
- styled `+ New thread` dialog
- Pin/Share menu items on thread pages
- Danger-zone delete
- agentConfig hot-reload (per-channel watcher)
- ghost-folder-free delete

