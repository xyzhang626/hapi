# Round 5 End-to-End Test — Sprint Kickoff with Cross-Channel Multitasking

> Distinct from rounds 1–4. Round 5 stresses behaviors NOT yet exercised:
> `welcomeStyle: "custom:..."` (the third branch never tested), the
> **non-owner read-only Settings dialog**, the bot's
> `list_channel_members` MCP call so it can address users by name, the
> **thread agent → channel `send_to_channel` reverse flow** (a thread
> reporting back to its parent channel), botName mid-flight rename
> idempotence (old bot messages keep their original author label), and
> the multi-pinned chip strip layout. Doubles as a regression run for
> the round-1-through-4 web fixes.

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Aisha** | Engineering Manager, channel **owner** | `aisha` |
| **Liam** | Senior Engineer | `liam` |
| **Maya** | PM | `maya` |

Channel: **`#sprint-37`** with description "Two-week sprint, focus area:
Auth + Billing". Bot named **"Plot"** initially, mid-flight renamed to
**"Captain"**. Welcome style = `custom:Welcome to Sprint 37 planning.
Drop tasks I can coordinate.`

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §10 `welcomeStyle: "custom:{text}"` (3rd branch) | 4 | round 4 only tested `skip` and `auto` |
| §3 Channel description rendered in header | 2, 13 | round 4 set it; round 5 also verifies live SSE update |
| §3 Pinned chip strip with **multiple** chips | 5, 7 | bot pins 2 of 3 spawned threads — overflow scroll behavior |
| §6 MCP `list_channel_members` | 11 | bot uses this tool to address each member by name |
| §6 MCP `pin_thread` (separate from spawn_scheduled auto-pin) | 5 | bot pins existing threads as a follow-up MCP call |
| §6 Thread MCP `send_to_channel` (reverse flow) | 6 | a thread agent reports progress *into the parent channel* |
| §7 Thread `change_title` updating session title mid-flight | 6 | thread agent renames its own session via MCP |
| §10 AgentConfig hot-reload — `botName` change | 12 | mid-flight rename Plot → Captain; verify next reply uses Captain but old Plot messages keep their label |
| §3 Settings dialog read-only for non-owner | 9, 10 | Maya sees Settings but no Save buttons / no Remove / no Delete |
| §1 Cross-channel state (#general + #sprint-37) | 6, 7 | Maya posts in #general then back to #sprint-37 — typing indicator + unread coherent |
| §12 Hard delete (round 4 regression) | 16 | folder gone, channel removed from all sidebars |
| Member removed mid-session graceful UX | 14, 15 | Maya is removed; her current view of #sprint-37 must degrade gracefully (channel disappears or redirect, not white-screen) |
| Round-2 fix: cross-ns user displayName | all | "Aisha Hassan" / "Liam O'Connor" / "Maya Singh" everywhere |
| Round-2 fix: invite link UI | 3 | Aisha generate, Liam+Maya `/invite/$token` accept |
| Round-2 fix: pin/share thread menu items | 5, 10 | manual pin via menu after spawn |
| Round-3 fix: agentConfig watcher fires | 12 | botName change propagates without restart |
| Round-3 fix: delete kills thread subprocesses (no ghost folder) | 16 | hard-delete leaves nothing on disk |
| Round-4 fix: welcomeStyle | 4 | custom variant works, not just skip |
| Round-4 fix: cancelled card → "Cancelled" badge | (not in this run; covered by round 4) | — |
| Round-4 fix: SIGKILL crash recovery | (not in this run; covered by round 4) | — |
| Round-4 fix: channel rename + description in Settings | 2, 13 | description set at create time + live edit |
| Round-4 fix: member-remove UI | 14 | Aisha removes Maya |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup

```bash
rm -rf ~/.hapi
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; export CORS_ORIGINS="http://localhost:5173,http://localhost:3006"; cd /home/azureuser/hapi/hub && exec bun --watch run src/index.ts' > /tmp/r5-hub.log 2>&1 &
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd /home/azureuser/hapi/web && exec bun run dev' > /tmp/r5-web.log 2>&1 &

playwright-cli -s=aisha open http://localhost:5173
playwright-cli -s=liam  open http://localhost:5173
playwright-cli -s=maya  open http://localhost:5173
```

Each session sets hub URL `http://localhost:3006` and signs in:
- `<TOKEN>:aisha:Aisha Hassan`
- `<TOKEN>:liam:Liam O'Connor`
- `<TOKEN>:maya:Maya Singh`

---

## Phase 1 — Channel + custom welcome

### Step 1 — Aisha signs in, lands on `/channels`

### Step 2 — Aisha creates `#sprint-37` and adds description via Settings

Click `+ Create Channel`, type `sprint-37`, submit. Then open Settings,
fill the **Channel** section (round-4 fix):
- Channel name: `sprint-37` (unchanged)
- Description: `Two-week sprint, focus area: Auth + Billing`

Click **Save channel meta**. Verify the description renders in the
channel header beside the name (e.g. `# sprint-37 — Two-week sprint…`).

### Step 3 — Aisha configures Plot agentConfig with custom welcome + invites

In the same Settings dialog, scroll to:
- **Identity**: Bot name = `Plot`; Model = `claude-haiku-4-5-20251001`
- **Behavior**:
  - System prompt addition = `You are Plot, the sprint-37 coordinator. Concise replies (≤2 sentences). Spawn one thread per track. Use list_channel_members when asked who's on the team.`
  - Welcome style = `custom:Welcome to Sprint 37 planning. Drop tasks I can coordinate.`
- **Members**: Generate Invite Link, copy URL.
- Save & hot-reload.

Open invite URL in `liam` and `maya` → both auto-redirected to channel.

### Step 4 — Verify the **custom** welcome message text

Within ~10 s, Plot should post **exactly**:
> `Welcome to Sprint 37 planning. Drop tasks I can coordinate.`

(Or a very-close paraphrase — the system prompt instructs the model to
"post exactly this greeting".) The literal phrase "Sprint 37 planning"
must appear; this is the round-4 fix's `custom:` branch.

---

## Phase 2 — Multi-thread spawn with separate `pin_thread`

### Step 5 — Aisha kicks off three tracks at once

> `@Plot kick off the sprint with 3 tracks: 1) auth refresh-token rotation, 2) billing webhook retry, 3) docs cleanup. Spawn one thread per track and pin tracks 1+2 since they're priority.`

Bot should:
- `spawn_thread` × 3 (auth, billing, docs)
- `pin_thread` × 2 (auth, billing) — the spec's separate MCP tool, not
  via `spawn_scheduled_thread`'s auto-pin

Verify:
- Three thread cards in the timeline, all `Active` with author "Aisha Hassan".
- Channel header shows **two `📌` chips**, one per pinned track.
- DB: auth + billing sessions have `pinned=true`; docs has `pinned=false`.
- Multi-chip layout: chips wrap or scroll horizontally cleanly (no overflow
  off-screen, no chip text truncation that hides the title).

---

## Phase 3 — Thread → Channel reverse flow

### Step 6 — Liam opens the auth thread, posts a question into it

Liam navigates to `Open Thread →` for the auth thread. In the thread's
own input, type:
> `quick check — does our session store have a TTL field already, or does this need migration first?`

The thread agent responds inside the thread (normal flow).

After ~30 s the thread agent should also call `mcp__hapi__send_to_channel`
to surface a brief progress note to the parent channel — e.g. `📍 auth
thread: investigating session store TTL` — proving the thread → channel
reverse flow works.

(The thread agent's system prompt for non-scheduled threads doesn't
*require* periodic reports, but a Claude session may choose to use
`send_to_channel` if asked or finds a milestone. Soft-verify; if no
proactive report appears, manually nudge it via Aisha @-mentioning
Plot to ask the thread to report.)

---

## Phase 4 — Cross-channel + non-owner Settings

### Step 7 — Maya navigates away to `#general` and posts something

Maya clicks `# general` in the sidebar, posts `quick aside: maintenance
window 9pm tonight`. Verify state:
- `#sprint-37` still in sidebar with no error.
- Maya navigates back to `#sprint-37` — full timeline reloads, pinned
  chips still rendered.

### Step 8 — Aisha @Plot for status

> `@Plot status report — what's in flight?`

Bot should call `list_threads` + synthesize. Reply ≤ 2 sentences.

### Step 9 — Maya opens Settings (read-only view test)

Maya clicks ⚙ Settings. Verify:
- Dialog opens with all sections visible.
- "View only — only the channel owner can edit these settings." banner at top.
- **No Save buttons** anywhere (Save channel meta, Save & hot-reload, etc.).
- **No Remove buttons** in the member list (round-4 fix: `canEdit && !isOwner && !isMe`).
- **No Danger zone** section (round-4 fix: section is in `{canEdit && (...)}` block).

### Step 10 — Maya tries to pin a non-owner forbidden action

Maya navigates to the docs thread, opens More-actions menu, clicks
**📍 Pin to channel header**.

Verify:
- API returns 403 (round-2 security fix #15).
- Inline error toast renders: `HTTP 403 Forbidden: {"error":"Only channel owner can pin/unpin threads"}` (round-2 fix #15).

---

## Phase 5 — `list_channel_members` + reaction

### Step 11 — Aisha asks Plot to greet the team

> `@Plot welcome the team by name — list each member and what role they likely play in this sprint.`

Bot should call `list_channel_members` then `send_to_channel` with a
short greeting that mentions "Aisha", "Liam", "Maya" by name (proving
the MCP tool returned enriched data — not raw userIds).

### Step 12 — Liam reacts 🚀 to Plot's team greeting

Open emoji picker on the greeting, click 🚀. Verify bubble appears for
all three viewers via SSE.

---

## Phase 6 — botName mid-flight rename

### Step 13 — Aisha hot-reloads agentConfig: botName Plot → Captain + new description

Settings → Identity → Bot name = `Captain`. Save & hot-reload. While
in Settings also update Description = `Two-week sprint, scope locked,
code freeze Friday`. Save channel meta.

### Step 14 — Aisha pings the renamed bot

> `@Captain what's our team doing right now?`

Bot replies — verify:
- New reply author label says **"Captain"**.
- Old welcome message still renders as **"Plot"** (the message body
  carries the botName at write time per stage-2 §3 architecture; renames
  are not retroactive).
- Channel header shows updated description: `# sprint-37 — Two-week sprint, scope locked, code freeze Friday`.

---

## Phase 7 — Member removed mid-session

### Step 15 — Aisha removes Maya from the channel

Settings → Members → Remove on Maya. Confirm the dialog.

Verify:
- Maya disappears from the member list immediately for Aisha.
- Maya's sidebar drops `#sprint-37` (SSE `channel-member-removed`).
- Maya's *current view* — she's on `#sprint-37` — must degrade
  gracefully: either redirect to `/channels` index or show a
  "channel no longer available" placeholder. NOT white screen / crash.

### Step 16 — Aisha hard-deletes the channel

Settings → Danger zone → check "Also delete files" → Delete → confirm
"Delete + remove files".

Verify:
- Folder `~/.hapi/workspaces/aisha/sprint-37` gone (no archive).
- Sidebars on Aisha + Liam drop `#sprint-37`.
- No orphan claude subprocesses (round-3 fix).
- No FK / 500 errors in hub log.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R5-1 | 11 — `list_channel_members` | HIGH | Bot's MCP `list_channel_members` returned raw user-ids for cross-namespace members. Bot's reply: "**Aisha Hassan** (Owner) … **Members 2296578145 & 2319884210** — Likely engineers". Same gap surfaced for `get_channel_history` on inspection. | Both `channel-bot:list-channel-members` and `channel-bot:get-channel-history` socket handlers in `hub/src/socket/handlers/cli/channelBotHandlers.ts` enriched authors with `store.workspaceUsers.getUser(ctx.namespace, m.userId)` — namespace-scoped, so for invited members in other namespaces the lookup returned null and fell back to raw id. Same root cause as round-2 BUG #3 / round-4 BUG #R4-4 for the REST endpoints, but the MCP handlers were untouched. | Fall back to `getUserGlobal(m.userId)` when the namespace-scoped lookup misses. Verified: bot's next reply read "Team roster confirmed: **Aisha Hassan** (owner), **Liam OConnor**, **Maya Singh**." |
| R5-2 | 14/15 — Maya removed mid-thread | MEDIUM (UX) | Maya was removed via `DELETE /channels/:id/members/:userId` while she was on the docs thread page. Server correctly returned 403 to subsequent API calls, but her UI continued rendering the cached transcript indefinitely. Sidebar dropped the channel but the now-stale page stayed put. | The SSE `channel-member-removed` handler in `web/src/hooks/useSSE.ts` only invalidated `queryKeys.channels` and `queryKeys.channelMembers(channelId)` — it didn't notice when **the current user** was the removed one and so never navigated her away from the inaccessible page. | Pass `currentUserId` into `useSSE` (via a ref to avoid stale closures). When `event.type === 'channel-member-removed' && event.userId === currentUserId`, also invalidate `channelMessages` + `channelSessions` for that channel and, if the user is currently on a `/channels/<channelId>` or any `/sessions/...` route, `window.location.replace('/channels')`. Verified: Maya was on `/sessions/043e3196-...`; after Aisha's DELETE her browser auto-redirected to `/channels`. |
| R5-3 | 13/14 — Plot → Captain rename | MEDIUM | After hot-reloading `botName: "Plot" → "Captain"`, the bot received `@Captain` messages as **weak signals** (debounced batch) instead of strong-signal mentions. The bot then `react_to_message`'d (low-info ack) instead of replying. Reply was missing for ~30 s + a follow-up `@Captain take 2` message. | `hub/src/sync/channelAgent.ts` caches `ChannelContext { botName }` per channel id and only invalidates on bot session id change (crash recovery). agentConfig hot-reloads that change `botName` did not invalidate the cache, so the strong-signal regex `@<botName>` kept matching the OLD name. | Subscribe to `channel-updated` events in `channelAgent.handleEvent` and call `invalidateChannelContext(channelId)`. Verified: after rename + invalidation, `@Captain` was treated as a strong-signal mention and the bot replied with a normal `send_to_channel`. Old "Plot" messages still render with their original author label (per stage-2 §3 — botName is stamped at write time, not retroactive). |

### Coverage outcome

All 16 numbered scenario steps were executed. The `welcomeStyle: "custom:..."`
branch (round-4 fix's third arm) was verified end-to-end for the first time —
Plot posted exactly the configured greeting. The non-owner read-only Settings
view (round-4) holds: Maya saw all sections but no Save buttons / no Remove
buttons / no Danger zone. Multi-pinned chip strip rendered cleanly with two
chips side by side. Bot's mid-flight rename (Plot → Captain) is now reflected
in both the strong-signal regex (R5-3) and in the next outgoing message label,
while old messages keep their original "Plot" stamp.

Round-2/3/4 fixes still hold:
- cross-ns user displayName ("Aisha Hassan", "Liam OConnor", "Maya Singh")
- invite-link UI flow + auto-redirect to channel
- styled `+ New thread` dialog (not used this round; covered by previous)
- Pin/Share menu items on thread pages with 403 inline toast for non-owner
- agentConfig hot-reload (per-channel watcher) including `botName` changes
- Channel rename + description edit propagating to header live
- Hard delete clean: no `*-archived-{ts}/` folder left, no orphan claude
  subprocesses
- Member removal works via UI

### Soft observation (no fix this round)

The thread agent on the `Auth` thread got stuck in `AskUserQuestion` mode
asking Liam for repo path / greenfield options instead of proactively
investigating. This is a Claude prompt-flow quirk (the thread system prompt
doesn't direct the agent to use the existing workspace), not a HAPI bug. The
mvp-ux-stage-2 doesn't dictate thread-agent prompt content beyond the
scheduled-thread template (§8). Future hardening would be to give non-scheduled
thread sessions their own purposeful system prompt rather than the default.

