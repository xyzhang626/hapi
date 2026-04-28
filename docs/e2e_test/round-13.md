# Round 13 End-to-End Test — Chaos Engineering Game Day

> Distinct from rounds 1–12. Round 13 picks five behaviors no prior
> round verified end-to-end and one regression of an R5 fix.

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Olek** | SRE Lead, channel **owner** | `olek` |
| **Maya** | Service owner — Payments team | `maya` |
| **Kenji** | DevOps engineer | `kenji` |

Custom channel: **`#gameday-2026-q2`** with description "Q2 chaos
exercise — 2026-04-28 — payments service degradation drill". Bot
named **"Watchdog"**.

## Behaviors no prior round exercised end-to-end (R13 first)

1. **`spawn_scheduled_thread` actually fires on its schedule** — R3
   uncovered the fs.watch fs nested-event bug; R6/R9 verified the
   create + chip but never waited for the scheduled thread to
   actually execute its `/loop` once. R13 schedules every-1-min,
   waits ≥ 2 min, asserts the loop fired and posted output back.
2. **`cancel_thread` cancels the scheduled thread** mid-schedule —
   R4 cancelled a regular thread; nobody has cancelled a *scheduled*
   thread that's been firing on a cron. Verify the chip's status
   icon flips from `⏰` to cancelled, and the next scheduled firing
   does NOT happen.
3. **`change_title` MCP visible in bot session page header** — every
   prior round saw the bot's `mcp__hapi__change_title` call in
   transcripts but nobody verified the bot session page's `<title>`
   or session.metadata.summary updates. Spec implies the bot's title
   IS its summary line.
4. **Markdown table rendering in channel timeline** — R10 added the
   markdown renderer; R11 verified bold/lists/code-blocks; nobody
   tested the **table** path. Spec §XIII calls out tables in markdown
   helpers; the `StandaloneMarkdown` component has table/th/td custom
   components.
5. **Settings PUT with description-only update** — partial update path
   (PUT /api/channels/:id with only `description`, no name or
   agentConfig). Never verified that the cache invalidates correctly
   and the new description shows in the header.

## Regression coverage (post-R12)

- Default channels with bot (R9)
- Sidebar PRIVATE/CHANNELS split (R9)
- `welcomeStyle:custom` (R12 + R5)
- Markdown rendering (R10)
- User reaction → bot weak signal (R11)
- `+ 😊` picker on thread cards (R11)
- Pinned `⏰` chip for scheduled threads (R9)
- Channel rename via PUT (R5)
- Hard delete cleanup (R3)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels with bot | 1 | regression |
| §III channel description in header | 4 | regression of R11 |
| §V strong signal `@bot` spawn 1 thread (warm-up) | 5 | regression |
| §VIII spawn_scheduled_thread actually fires its /loop | 6 | NEW |
| §III pinned `⏰` chip + scheduled state icon | 6 | NEW (visual) |
| §VI MCP `cancel_thread` of a scheduled thread | 7 | NEW |
| §VI MCP `change_title` visible in bot session page | 8 | NEW |
| §XIII markdown table rendering | 9 | NEW |
| §X channel description-only partial update | 10 | NEW |
| §XII channel hard-delete cleanup | 11 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup

```bash
playwright-cli -s=mira close 2>/dev/null
playwright-cli -s=tariq close 2>/dev/null
playwright-cli -s=yael close 2>/dev/null
ps -ef | grep -E "bun.*src/index|bun.*runner|bun.*dev|bun.*claude --output" | grep -v grep | awk '{print $2}' | xargs -r kill 2>/dev/null
rm -rf ~/.hapi
nohup bash -c 'cd /home/azureuser/hapi/hub && exec bun --watch run src/index.ts' > /tmp/r13-hub.log 2>&1 &
nohup bash -c 'cd /home/azureuser/hapi/web && exec bun run dev' > /tmp/r13-web.log 2>&1 &

playwright-cli -s=olek   open --browser chromium http://localhost:5173
playwright-cli -s=maya   open --browser chromium http://localhost:5173
playwright-cli -s=kenji  open --browser chromium http://localhost:5173
```

Sign in:
- `<TOKEN>:olek:Olek Volkov`
- `<TOKEN>:maya:Maya Iyengar`
- `<TOKEN>:kenji:Kenji Ito`

---

## Phase 1 — Default-channel regression

### Step 1 — Olek signs in, sidebar OK + general bot greets

Inline-snapshot verifies sidebar layout (`olek` workspace title,
Channels/Private split), click `# general`, bot welcome lands.

---

## Phase 2 — Custom channel + Watchdog

### Step 2 — Olek creates `#gameday-2026-q2` via API

Direct API POST with `agentConfig.botName=Watchdog`,
`welcomeStyle=auto`, `permissionMode=yolo`,
`systemPromptAddition` instructing markdown + scheduled threads on
demand.

### Step 3 — Maya + Kenji accept invite

Standard invite flow; verify 3-member roster.

### Step 4 — All see channel description in header (regression)

`Q2 chaos exercise — 2026-04-28 — payments service degradation drill`
visible next to `# gameday-2026-q2` in all 3 sessions.

---

## Phase 3 — Warm-up thread (regression)

### Step 5 — Olek @Watchdog spawn payment-degradation-runbook thread

> Olek: `@Watchdog spawn one thread to write the payment-degradation runbook for today's drill. Title it: payment-degradation-runbook.`

Bot calls `spawn_thread`. Card appears in timeline.

---

## Phase 4 — Scheduled thread fires (NEW)

### Step 6 — Olek asks Watchdog for a recurring health monitor

> Olek: `@Watchdog set up a recurring monitor that runs every 1 minute to check the simulated payment service status. Title it payment-status-watch.`

Bot calls `spawn_scheduled_thread` with cron `*/1 * * * *` or
similar 1-min schedule.

Within ~30 s verify in DB: scheduled=True, pinned=True,
visibility=shared, schedule string set. Header shows `⏰
payment-status-watch` chip.

**Then wait ~120 s** for at least one /loop firing inside the
scheduled thread. Verify the thread session has assistant output
beyond just the initial setup — specifically a tool call or text
output timestamped > schedule start.

If the scheduled thread NEVER produces a second turn within ~150s,
that's a real spec-§VIII gap (R3 originally found a related fs.watch
bug; this catches whether the /loop actually executes).

---

## Phase 5 — Cancel scheduled thread (NEW)

### Step 7 — Olek cancels payment-status-watch

> Olek: `@Watchdog cancel the payment-status-watch — drill is starting, no more polling.`

Bot calls `cancel_thread` for that thread id. Verify within ~30 s:
- `agent_summary` "Cancelled" card appears in timeline.
- Pinned `⏰` chip is removed from the header (or its status changes).
- DB: thread `threadStatus='archived'` (or 'cancelled').
- After waiting another ~90 s: NO new /loop output appears in the
  cancelled thread session.

---

## Phase 6 — `change_title` MCP visible (NEW)

### Step 8 — Olek tells Watchdog to change its session title

> Olek: `@Watchdog please change your session title to "Watchdog — Q2 Game Day Drill — payments" using your change_title tool.`

Within ~30 s verify in Watchdog's bot session page (open via
"Bot session →" link):
- Page header / breadcrumb / title shows the new title text
  (NOT the default auto-generated title).
- DB: `sessions.metadata.summary.text` (or however the CLI stores
  the title) reflects the new title for the bot session.

---

## Phase 7 — Markdown table rendering (NEW)

### Step 9 — Send a markdown table from Olek

```bash
curl -X POST /api/channels/:id/messages -d '{"body":{"text":"Drill schedule:\n\n| Time | Action | Owner |\n|------|--------|-------|\n| 14:00 | Inject latency on /charge | Maya |\n| 14:15 | Inject 5xx on /refund | Kenji |\n| 14:30 | Recovery + retro | Olek |"}}'
```

Within ~3 s in any session's UI verify:
- A `<table class="aui-md-table ...">` element exists in the DOM.
- 3 `<td>` cells per data row with the actual values.
- Headers `Time / Action / Owner` rendered as `<th>` (semantic).

If the table renders as raw `|`-separated text (no `<table>`), the
markdown plugin path for tables is broken. R10 added GFM support; this
verifies it actually works.

---

## Phase 8 — Description-only PUT (NEW)

### Step 10 — Olek updates description without touching name/agentConfig

```bash
curl -X PUT /api/channels/:id -H "Authorization: Bearer ..." -H "content-type: application/json" \
  -d '{"description":"Q2 chaos exercise — 2026-04-28 — drill IN PROGRESS"}'
```

Within ~3 s all 3 sessions reload header (SSE `channel-updated`
should fire). Verify new description text rendered, name unchanged,
bot session id unchanged (no spurious bot respawn).

---

## Phase 9 — Cleanup

### Step 11 — Olek hard-deletes `#gameday-2026-q2`

Verify folder gone, no orphan claude subprocesses, defaults survive,
Maya + Kenji sidebars drop the channel.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R13-1 | 5 — cancel scheduled | annoyance | Olek asks Watchdog to cancel `payment-status-watch`. The thread DB row goes `threadStatus='archived'` and an `agent_summary` "canceled" card lands in the timeline correctly. **But the `⏰ payment-status-watch` chip stays in the channel header**, pointing to a dead thread. Same gap for any pinned regular thread that's later cancelled. | `hub/src/sync/syncEngine.ts` `cancelThreadSession` set `threadStatus='archived'` + best-effort killSession + emitted summary card, but **never cleared the `pinned` flag**. The `setSessionPinned` it would call also emits the `thread-unpinned` SSE event so the chip strip would drop it live. | Inside `cancelThreadSession`, after the `setThreadStatus('archived')` call, check if the session was pinned and call `this.setSessionPinned(threadId, namespace, false)` — emits the SSE `thread-unpinned` event so all viewers drop the stale chip. Verified end-to-end: spawned a new `health-ping` scheduled thread, cancelled it, chip disappeared within ~3 s; the OLD `payment-status-watch` chip (cancelled BEFORE the fix landed) lingers as a control. 3 regression tests added in `cancelThreadSession.test.ts`. |

### Coverage outcome — 1 real bug fixed + 5 NEW behaviors verified

All 11 numbered scenario steps executed.

**NEW behaviors verified end-to-end (first time)**:

- **`spawn_scheduled_thread` actually fires** (Step 6) — Olek asked
  Watchdog to monitor the simulated payment service every 1 minute.
  Watchdog called `spawn_scheduled_thread` (cron `*/1 * * * *`,
  pinned, shared, ⏰ chip). After waiting 130 s, the scheduled
  thread session's message count went from 19 → 50 (delta 31)
  with multiple `/loop` iterations: `Bash` checks → `mcp__hapi__get_channel_history`
  catch-up → `mcp__hapi__send_to_channel` baseline status delivered
  to channel timeline → multiple "Staying silent" decisions on
  subsequent ticks (no change). R3 / R6 / R9 only verified setup;
  R13 first to confirm the inner `/loop` actually runs and the
  thread→channel reverse path works periodically.
- **`cancel_thread` of a scheduled thread** (Step 7) — caught R13-1.
  After fix: chip drops, status archived, no further /loop output.
- **`change_title` MCP visible in bot session page** (Step 8) — Olek
  asked Watchdog to rename its session; bot called `mcp__hapi__change_title`;
  bot session's `metadata.summary.text` updated to exactly the
  requested string `Watchdog — Q2 Game Day Drill — payments`; the
  bot session page header rendered the new title (DOM-verified).
- **Markdown table rendering** (Step 9) — sent a markdown table from
  Olek; rendered DOM has `<table class="aui-md-table w-full border-collapse">`
  containing 3 `<th class="aui-md-th ...">` headers (Time / Action /
  Owner) and 9 `<td>` data cells. The remark-gfm + StandaloneMarkdown
  table component path works.
- **Description-only PUT** (Step 10) — `PUT /api/channels/:id` with
  ONLY `{"description":"..."}` (no name, no agentConfig) — bot
  session id stayed the same (no spurious bot respawn since
  `updateChannelData`'s "agentConfig added" guard correctly skips
  when only description changed); new description rendered live in
  the channel header in all viewers.

**Regressions all hold**:
- Default channels with bot, sidebar split, markdown rendering, ⏰ chip
  for scheduled threads, hard-delete cleanup.

Hub test suite: **245 / 245** (was 242 before R13; 3 new tests added
for cancelThreadSession behavior).
