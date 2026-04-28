# Round 3 End-to-End Test — Quarterly Documentation Sprint

> Distinct from rounds 1 (login-page implementation, 2 users) and 2 (production
> incident response, 3 users). Round 3 covers a **multi-page docs revision
> sprint** where a tech writer leads two engineers, the channel agent
> coordinates per-page review threads, and a daily link-checker runs on a
> scheduled thread. Designed to exercise every mvp-ux-stage-2 surface — and to
> stress the new web UIs landed at the end of round 2 (invite link, delete
> channel, pin/share thread, dialog `+ New thread`).

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Tess** | Tech Writer, channel **owner** | `tess` |
| **Oscar** | Backend Engineer | `oscar` |
| **Mira** | Mobile Engineer | `mira` |

Channel: **`#docs-sprint`**. Bot named **"Scribe"** via `agentConfig`.

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | What it proves |
| --- | --- | --- |
| §1 Auto-spawn on agentConfig save | 4 | Scribe appears within ~3 s of Save |
| §1 Embedded runner workdir | startup | `~/.hapi/workspaces/tess/docs-sprint` created |
| §2 Custom `botName` | 4 | Welcome shows "Scribe", not "Agent" |
| §2 Strong-signal alias `@Scribe` | 6, 9, 14, 18 | Bot replies via MCP |
| §3 Timeline = real-user msgs + MCP outputs | all | No bot LLM reasoning leaks |
| §3 Typing indicator | 6, 9, 14, 18 | "✨ Scribe is …" appears |
| §3 Pinned-thread chip strip | 7, 13, 16 | Auto-pin on scheduled, manual pin via UI |
| §3 "Bot session →" header link | 12 | All 3 members can navigate |
| §3 Channel settings (owner) | 15 | Save & hot-reload reflects in next reply |
| §4 Bot session read-only | 12 | Banner + transcript visible to Mira too |
| §5 Strong signal: `@mention` | 6, 9, 14, 18 | Immediate forward |
| §5 Strong signal: `+ New thread` (UI dialog from round-2 fix) | 8 | Dialog → bot spawn |
| §5 Strong signal: thread state change | passive | Bot notified when threads complete |
| §5 Strong signal: channel init | 4 | `__channel_initialized` welcome fires |
| §5 Strong signal: agentConfig update | 15 | `__config_updated` injection → adapted reply |
| §5 Weak-signal debounce | 5 | Two short chats → bot reacts (not full reply) |
| §6 MCP `send_to_channel` | 4, 6, 14, 18 | Welcome + replies |
| §6 MCP `react_to_message` | 5 | 👋 emoji bubble |
| §6 MCP `spawn_thread` | 6, 8 | Per-page review threads |
| §6 MCP `spawn_scheduled_thread` | 7 | Daily link-checker, auto-pinned, shared |
| §6 MCP `send_to_thread` | 11 | Tess directs Oscar's review thread |
| §6 MCP `pin_thread` (bot path) | 7 | Scheduled thread auto-pinned |
| §6 MCP `list_threads`/`get_thread` | 18 | Status synthesis at end |
| §7 Default visibility = private | 8 | Minimal `⏳ Active` card |
| §7 "Share to channel" toggle (UI from round-2) | 10 | Card upgrades → detailed |
| §7 Pinned thread chip render | 7, 13 | ⏰ for scheduled, 📌 for manual |
| §7 Manual pin via thread page More-actions menu (UI from round-2) | 13 | Mira pins her review thread |
| §8 Scheduled thread auto-pin + shared | 7 | Visible to all 3 |
| §9 Reaction user→bot | 14 | Mira reacts 🙏 to Scribe's reply |
| §9 Reaction user→user | 16 | Tess reacts ✅ to Oscar's edit summary |
| §9 Reaction toggle | 17 | Re-clicking removes |
| §10 AgentConfig hot-reload via UI | 15 | `[REVIEW]` prefix on next reply |
| §12 Channel deletion soft (UI from round-2) | 20 | Folder → `*-archived-{ts}`, sidebar refreshes |
| Stage-2 cross-namespace channel members | 3 | Oscar (ns=oscar) + Mira (ns=mira) join via invite link from Tess (ns=tess) |
| Round-2 fix: cross-ns user `displayName` | all | Author labels show "Oscar Reyes", "Mira Patel", "Tess Wei" — not raw userIds |
| Round-2 fix: invite-link UI flow | 3 | UI generate + UI accept |
| Round-2 fix: `+ New thread` styled dialog | 8 | Multi-line textarea, Cmd+Enter, Cancel |
| Round-2 fix: pin/share menu items | 10, 13 | Surfaced for thread sessions |
| Round-2 fix: delete-channel danger zone | 20 | Soft delete with confirm overlay |

If a step's expectation fails, log under **Bugs Found** and continue where
possible — never insert fallbacks (per project debugging principle).

---

## Phase 0 — Setup

```bash
rm -rf ~/.hapi
cd /home/azureuser/hapi
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; export CORS_ORIGINS="http://localhost:5173,http://localhost:3006"; cd /home/azureuser/hapi/hub && exec bun --watch run src/index.ts' > /tmp/r3-hub.log 2>&1 &
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd /home/azureuser/hapi/web && exec bun run dev' > /tmp/r3-web.log 2>&1 &
```

Three persistent playwright sessions:

```bash
playwright-cli -s=tess open http://localhost:5173
playwright-cli -s=oscar open http://localhost:5173
playwright-cli -s=mira open http://localhost:5173
```

Each session sets the hub URL (`http://localhost:3006`) and signs in with
`<CLI_API_TOKEN>:<ns>:<DisplayName>`:
- Tess Wei (ns `tess`)
- Oscar Reyes (ns `oscar`)
- Mira Patel (ns `mira`)

---

## Phase 1 — Channel boot, custom botName, welcome

### Step 1 — Tess authenticates → lands on `/channels`

### Step 2 — Tess creates `#docs-sprint`

Click `+ Create Channel`, name `docs-sprint`, submit.

### Step 3 — Tess opens Settings, configures Scribe agentConfig + invites engineers

In the unified Settings dialog (round-2 changes):
- **Identity**: Bot name = `Scribe`; Model = `claude-haiku-4-5-20251001`
- **Behavior**: System prompt addition =
  > `You are Scribe, the docs-sprint coordinator. Each reply ≤ 2 sentences. Prefer spawning per-page review threads over long replies.`
- **Members**: click *Generate invite link*, copy URL.
- Save & hot-reload.

Open invite URL in `oscar` and `mira` browsers — each is auto-redirected to
`/channels/<id>` after acceptance (round-2 invite-flow fix).

**Verify**:
- Tess (ns `tess`), Oscar (ns `oscar`), Mira (ns `mira`) all see `#docs-sprint`
  in their sidebars.
- DB: `channels.bot_session_id` populated.

### Step 4 — Bot welcome

Within ~3 s of Save, all three timelines show a **Scribe** welcome message
(`authorUserId = null`, square AI avatar marker).

---

## Phase 2 — Scheduled link-checker thread

### Step 5 — Quick chatter (weak signal)

Within ~1 s of each other:
- Oscar: `joining now`
- Mira: `morning team`

**Expect**: bot uses `react_to_message` (per system-prompt rule 5 about avoiding
noise) — emoji bubble (e.g. 👋) on at least one of the two messages.

### Step 6 — Tess `@Scribe` for periodic link check (→ scheduled thread)

> `@Scribe please run a daily link checker on /docs/* and report any 404s every 6 hours`

`every X` phrasing maps to `spawn_scheduled_thread` per system-prompt rule 3.

**Verify**:
- Typing indicator above input cycles through bot states.
- A new thread card appears with title like *"Daily docs link checker"*.
- Pinned-thread chip strip in header shows `⏰ Daily docs link checker` chip.
- Hub `/api/channels/:id/sessions`: `scheduled=true`, `pinned=true`,
  `visibility="shared"`, `schedule != null`.
- Round-2 fix: chip appears **without manual page reload**.

### Step 7 — Verify all 3 members see the chip

Mira and Oscar both see the same `⏰` chip in their header.

---

## Phase 3 — Per-page review threads

### Step 8 — Tess `@Scribe` to spawn a review thread for a specific page

> `@Scribe spawn a thread to review docs/api/auth.md — it's been stale since v3.2`

**Verify**: bot calls `spawn_thread`. Thread card title is meaningful.
DB: `createdByUserId` = Tess's user id (round-2 displayName fix verifies "Tess
Wei" renders, not raw id).

### Step 9 — Oscar uses `+ New thread` dialog

Click `+ New thread` button → **styled dialog** appears (round-2 fix replaced
`window.prompt`). Fill multi-line textarea with:
> `Audit /docs/sdk/* for outdated SDK examples; flag any that reference v2 only`

Cmd+Enter to submit.

**Verify**:
- Dialog dismisses, thread card appears in timeline.
- DB: `createdByUserId` = Oscar's user id; render as "Oscar Reyes".

### Step 10 — Oscar shares his thread to channel (round-2 share UI)

Open Oscar's thread → More-actions menu → **🔒 Share to channel** (round-2
menu item).

**Verify**:
- Toggle calls `setThreadVisibility(threadId, 'shared')`.
- DB: `visibility=shared` on Oscar's thread.
- Channel timeline thread-card upgrade visible to Tess + Mira.

### Step 11 — Tess `@Scribe` for Lead → Teammate coordination (`send_to_thread`)

> `@Scribe tell oscar's SDK audit thread to also check the iOS SDK README under docs/sdk/ios/`

**Verify**: in Oscar's thread, a new bot-injected user message appears
referencing iOS SDK / README.

---

## Phase 4 — Bot session inspection + agentConfig hot-reload

### Step 12 — Mira opens "Bot session →" header link

Verify:
- Lands on bot session detail page.
- Banner reads "View only — interact in channel".
- Input is hidden / disabled.
- Transcript shows MCP tool calls (`send_to_channel`, `spawn_thread`,
  `spawn_scheduled_thread`, `send_to_thread`) and the `<system>__channel_…</system>`
  injection lines.

### Step 13 — Mira pins her review thread (round-2 manual pin UI)

Mira navigates to one of the bot-spawned per-page threads (any thread Mira
opens has the More-actions menu). Click **📍 Pin to channel header**.

**Verify**:
- API call succeeds.
- Pinned chip strip in channel header now shows two chips: `⏰ Daily docs
  link checker` + `📌 <Mira's thread title>`.
- All 3 members see both chips.

> If Mira hits a 403 (per round-2 fix #15, only channel **owner** can
> pin/unpin), substitute Tess for the pin action and document the
> finding under Bugs.

### Step 14 — Mira `@Scribe` asks for a status snapshot

> `@Scribe what's the status of the docs sprint so far?`

Bot calls `list_threads` + per-thread `get_thread` → synthesizes a brief reply.

### Step 15 — Tess hot-reloads the agentConfig

Open Settings, change *System prompt addition* to:
> `You are Scribe (review-mode). Prepend [REVIEW] to every send_to_channel call. Keep replies ≤ 1 sentence.`

Save & hot-reload.

### Step 16 — Tess re-pings to verify config-aware reply

> `@Scribe ack new mode`

**Verify**: Scribe's reply starts with `[REVIEW]`.

---

## Phase 5 — Reactions

### Step 17 — Tess reacts ✅ to Scribe's status reply (user → bot)

Click `+😊` on Scribe's status message → pick ✅.

**Verify**: bubble appears in all 3 timelines.

### Step 18 — Mira reacts 🙏 to Tess's earlier message (user → user)

Same picker on Tess's `@Scribe` summary message.

**Verify**: bubble appears in all 3 timelines via SSE; bot does NOT spam
another reply (reactions only feed the weak-signal buffer per §9).

### Step 19 — Tess removes her ✅ (toggle)

Click ✅ again. Bubble disappears.

---

## Phase 6 — Cleanup

### Step 20 — Tess soft-deletes the channel (round-2 danger-zone UI)

Settings → Danger zone → leave "Also delete files" unchecked → click
**Delete channel** → confirm "Soft delete".

**Verify**:
- All 3 sidebars drop `#docs-sprint`.
- Folder `~/.hapi/workspaces/tess/docs-sprint` renamed to
  `docs-sprint-archived-{ts}`.
- Tess navigates to `/channels`.
- Hub log shows no FK / 500 errors during cleanup.

---

## Observability checklist (run during execution, not after)

- `tail -f /tmp/r3-hub.log` in a side terminal.
- After every step that should mutate UI, take both `playwright-cli -s=<who>
  snapshot` (DOM) and `playwright-cli -s=<who> screenshot --filename=...`
  (visual). Diff the two — DOM-only checks miss visual regressions and
  vice versa.
- Note discrepancies under **Bugs Found** with severity.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R3-1 | 4 — Mira `@Scribe` for status; later Tess `@Scribe say hi` | LOW (intermittent) | Bot reasoned through the answer ("Three threads active: …" / "[REVIEW] Hey there!") but never called `send_to_channel` — last MCP call was `Noop` after `list_threads` instead. Reply silently dropped. | Claude oversight: after a query tool (`list_threads` / config-update reasoning) the model sometimes "thinks" the response is sent and emits Noop. Not a HAPI plumbing bug — verified strong-signal forwarding still works (other replies came back fine). Could be hardened by tightening the bot system prompt (e.g. `Noop is only legal if you have NO content to share — not as a substitute for send_to_channel after composing one`). | **Not fixed this round** (prompt/model behavior tweak, out of scope; system surfaces the failure cleanly). |
| R3-2 | 8 — agentConfig hot-reload | HIGH | After Tess saved an updated `systemPromptAddition` via the UI Settings dialog, the bot's next reply did NOT reflect the new rule. Same for direct external `echo > agent.json`. The watcher never fired for nested files. | **Bun `fs.watch({ recursive: true })` on Linux silently misses file events inside subdirectories** — only fires for events in the *immediate* watched directory and for new subdir creation itself. AgentConfigStore was relying on recursive watching of `~/.hapi/channels/`, so any change inside `<channelId>/agent.json` was dropped. Reproduced in isolation with a 10-line bun script. | Refactored AgentConfigStore: kept the parent recursive watcher (catches new `<channelId>/` subdir creation events) but added a `Map<channelId, FSWatcher>` of per-channel **non-recursive** watchers, attached via `addChannelWatcher(channelId)` from both `write()` and `startWatching()` (which also `rehydrateChannelWatchers()` walks existing subdirs at boot). Verified end-to-end: external file edit → `__config_updated` fires → bot adopts `[HOT]` prefix on next reply. |
| R3-3 | 20 — Soft delete leaves ghost folder | HIGH | After `Soft delete`, `~/.hapi/workspaces/tess/docs-sprint-archived-{ts}/` appears as expected, but a freshly re-created `~/.hapi/workspaces/tess/docs-sprint/` also appears with `.claude/` inside it. The "soft delete renames the folder" guarantee is broken. | `deleteChannel` killed the bot CLI subprocess but only marked thread sessions `status='archived'` in the DB. The thread CLI subprocesses kept running and called `mkdirSync(workspaceDir, { recursive: true })` when checkpointing, re-creating the freshly-renamed folder. | Added best-effort `rpcGateway.killSession(s.id)` for non-bot sessions in `deleteChannel`. Verified: re-deleting `validation-test` left only `validation-test-archived-…/` with no ghost (checked at +5s and +11s). Also confirmed no orphan `claude --output-format` subprocesses remain. |
| (obs) | 11 — `send_to_thread` UUID typo | n/a | Bot transcript shows MCP `Send To Thread` with `threadId: cdc1b511-…-21524316f99c`; Oscar's actual id is `…-21504316f99c` (one digit off). MCP returned an error and bot pivoted to `send_to_channel`. | Claude misread/typo'd the UUID. The system error path (MCP rejects unknown threadId, bot recovers) worked correctly. Not a bug. | n/a |
| (obs) | 11 — bot used `send_to_channel` instead of `send_to_thread` | n/a | Tess asked "tell oscar's SDK audit thread to also check…"; Scribe replied in the channel "@Oscar: also audit…" instead of injecting into the thread. | Bot judgment call — both are valid responses to a "tell oscar" instruction. Not a bug. | n/a |

### Coverage outcome

All 20 numbered scenario steps were executed end-to-end. The two real bugs
(R3-2, R3-3) were both **post-round-2 regressions** in the sense that they
weren't exercised by the round-1/round-2 scripts — round 1 didn't use
agentConfig hot-reload, and round-2's delete happened on a channel whose
threads had already gone idle by the time the user clicked Delete. Round 3
hit them by virtue of (a) editing the agentConfig several times mid-test and
(b) running the scheduled-thread + per-page review threads simultaneously up
through the delete moment.

R3-1 is a Claude behavior quirk (intermittent silent Noop after a query tool)
and is not addressed here — would need either a system-prompt tightening or
a runner-side "post-strong-signal must produce visible output" guard.

Verified working from round-2 fixes: cross-namespace user displayName
("Tess Wei", "Oscar Reyes", "Mira Patel" everywhere), invite-link UI flow,
styled `+ New thread` dialog, Pin/Share menu items on thread pages,
Danger-zone delete with confirm overlay, channel-owner-only pin gate
returning a visible 403 toast on Mira's pin attempt.

