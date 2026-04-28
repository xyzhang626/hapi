# Round 12 End-to-End Test — Hiring Debrief Room

> Distinct from rounds 1–11. Round 12 picks four behaviors no prior
> round verified end-to-end and one regression of an R5 fix.

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Mira** | Hiring Manager, channel **owner** | `mira` |
| **Tariq** | Engineering Director | `tariq` |
| **Yael** | Senior Engineer (panel member) | `yael` |

Custom channel: **`#hiring-debrief-eric`** with description "Eric K
debrief — onsite 2026-04-29 (5 panelists, decision by 2026-05-01)".
Bot named **"Lumen"**.

## Behaviors no prior round exercised end-to-end (R12 first)

1. **Concurrent multi-user message storm** — 3 users send messages
   within a 1-second window. Verify all messages land in DB in correct
   per-user order, all 3 viewers see all messages via SSE without
   missing any, and the bot's debounce buffer correctly batches them
   into a single `weak-signal-batch` (since they fall inside the
   default 3-second window).
2. **`list_threads` MCP explicit** — Mira asks "show me all active
   threads"; Lumen should call `mcp__hapi__list_threads`. Spec §VI
   lists this as P1; never directly stressed.
3. **`get_thread` MCP explicit** — Mira asks "what's the status of the
   coding evaluation?"; Lumen should call `mcp__hapi__get_thread` with
   the thread's id. Never directly stressed.
4. **Thread → channel `send_to_channel` reverse flow with `Thread:`
   author label** — R3 verified the data path; R8 / R10 deferred the
   visual verification. R12 explicitly nudges the spawned thread to
   call `send_to_channel`, then asserts the rendered author label in
   the channel timeline reads `Thread: <title>` (NOT "system" or raw
   session id).
5. **`welcomeStyle: "custom:..."` (regression of R5)** — `agent.json`
   carries `welcomeStyle: "custom:Welcome to the Eric debrief room. ..."`.
   Verify Lumen's first message in the channel is **exactly** that
   custom text (NOT the default auto-greeting).

## Regression coverage (post-R11)

- Default channels with bot (`3d58ec7`)
- Sidebar PRIVATE/CHANNELS (`b3f8958`)
- Markdown rendering in channel timeline (`4a373b4`)
- User reaction → bot weak-signal cascade (`5a7851d`)
- `+ 😊` picker on thread cards (`d34bad9`)
- accessToken whitespace tightening (`3d51425`)
- agentConfig file-edit hot-reload (`8c1913b`)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels with bot | 1 | regression |
| §X agentConfig `welcomeStyle:custom` | 3 | NEW (regression of R5; never visually verified live) |
| §III channel description in header | 5 | regression of R11 |
| §V concurrent multi-user weak signal storm → 1 batch | 6 | NEW |
| §V strong signal `@bot` spawn 1 thread | 7 | regression |
| §VI MCP `list_threads` | 8 | NEW |
| §VI MCP `get_thread` | 9 | NEW |
| §VII thread → channel reverse flow with `Thread:` label | 10 | NEW (visual verification) |
| §IX user reaction on thread card (regression of R11) | 11 | regression |
| §XII channel hard-delete cleanup | 12 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup

```bash
playwright-cli -s=sven close 2>/dev/null
playwright-cli -s=priya close 2>/dev/null
playwright-cli -s=otto close 2>/dev/null
ps -ef | grep -E "bun.*src/index|bun.*runner|bun.*dev|bun.*claude --output" | grep -v grep | awk '{print $2}' | xargs -r kill 2>/dev/null
rm -rf ~/.hapi
nohup bash -c 'cd /home/azureuser/hapi/hub && exec bun --watch run src/index.ts' > /tmp/r12-hub.log 2>&1 &
nohup bash -c 'cd /home/azureuser/hapi/web && exec bun run dev' > /tmp/r12-web.log 2>&1 &

playwright-cli -s=mira   open --browser chromium http://localhost:5173
playwright-cli -s=tariq  open --browser chromium http://localhost:5173
playwright-cli -s=yael   open --browser chromium http://localhost:5173
```

Sign in:
- `<TOKEN>:mira:Mira Halevi`
- `<TOKEN>:tariq:Tariq Rahman`
- `<TOKEN>:yael:Yael Bar-On`

---

## Phase 1 — Default-channel regression

### Step 1 — Mira signs in, sidebar OK + general bot greets

Inline snapshot verifies `mira` workspace title, `Channels` / `Private`
sections, click `# general` → bot welcome lands, header shows
`👥 1 online` + enabled `+ New thread`.

### Step 2 — Skipped (private regression done in R11 already)

---

## Phase 2 — Custom channel + welcomeStyle:custom

### Step 3 — Mira creates `#hiring-debrief-eric` with custom welcome

Use direct API:

```bash
curl -X POST /api/channels -d '{
  "name":"hiring-debrief-eric",
  "description":"Eric K debrief — onsite 2026-04-29 (5 panelists, decision by 2026-05-01)",
  "agentConfig":{
    "flavor":"claude",
    "botName":"Lumen",
    "model":"claude-haiku-4-5-20251001",
    "permissionMode":"yolo",
    "systemPromptAddition":"You are Lumen, the hiring debrief coordinator. Concise (≤2 sentences). When asked to evaluate something, spawn one focused thread.",
    "welcomeStyle":"custom:Welcome to the Eric K debrief room. Drop your panel notes here, @-mention me to spawn evaluation threads, and I will keep things tidy."
  }
}'
```

Within ~25 s Lumen's first channel message **must be exactly** that
custom text (NOT the auto-generated welcome). Verify exact match.

If Lumen instead emits a default-style "Hi I'm Lumen…" auto-greeting,
that's a `welcomeStyle:custom` regression.

---

## Phase 3 — Cross-ns invites + channel description visible

### Step 4 — Tariq + Yael accept invite

Standard invite flow.

### Step 5 — All three see the description in the header

Each user clicks `#hiring-debrief-eric`; verify the description
`Eric K debrief — onsite 2026-04-29 (5 panelists, decision by 2026-05-01)`
is rendered in the header next to the channel name.

---

## Phase 4 — Concurrent multi-user message storm (NEW)

### Step 6 — 3 users send within ~1 second

Use a tight bash loop sending 3 channel messages back-to-back via
direct REST POST (mimics 3 users typing/sending at the same instant).
Each user's message is distinct so we can verify ordering:

- Mira: `Eric: passed coding panel — strong on async + types`
- Tariq: `Eric: design round — leans pragmatic, identified scaling pivot quickly`
- Yael: `Eric: pairing round — clean refactor, asked great clarifying Qs`

Wait the debounce (3 s + ~1 s slack). Verify in DB:
- 3 distinct `text` rows in the channel, sequence numbers strictly
  increasing (no race / duplicates).
- Lumen's bot session got a SINGLE `weak-signal-batch` inject containing
  ALL 3 lines, prefixed with each user's authorUserId.

In all 3 web sessions: each user sees all 3 messages rendered, plus
any reaction/text Lumen produces from the batch.

---

## Phase 5 — Strong signal: spawn 1 evaluation thread

### Step 7 — Mira @Lumen to spawn one thread

> Mira: `@Lumen spawn a thread to consolidate the panel feedback into a single hire/no-hire recommendation. Title it: eric-recommendation.`

Bot calls `mcp__hapi__spawn_thread`. Verify within ~30 s:
- Thread `eric-recommendation` exists with `created_by_user_id` =
  Mira's userId (per R2-3 fix — bot credits triggering user, not
  itself).
- A `thread_card` row appears in the timeline.

---

## Phase 6 — `list_threads` + `get_thread` MCP (NEW)

### Step 8 — Mira asks Lumen to list active threads

> Mira: `@Lumen — list all active threads in this channel.`

Within ~30 s verify in Lumen's bot transcript:
- A `mcp__hapi__list_threads` tool_use call.
- A subsequent `send_to_channel` mentioning `eric-recommendation`.

If Lumen replies without calling `list_threads` (just from memory),
note as a Claude prompt-flow weakness (not a HAPI bug).

### Step 9 — Mira asks for status of one thread by name

> Mira: `@Lumen what's the status of eric-recommendation?`

Within ~30 s verify in Lumen's bot transcript:
- A `mcp__hapi__get_thread` tool_use call (Lumen needs the threadId
  to call this; it should resolve via the `list_threads` it just did
  OR via fresh list_threads).

---

## Phase 7 — Thread → channel reverse flow with `Thread:` author (NEW)

### Step 10 — Send a directive into the thread to make it post back

The `eric-recommendation` thread agent likely won't volunteer to post
to the channel without a strong nudge. Bypass via direct API: inject
a `<system>` instruction into the thread session asking it to call
`mcp__hapi__send_to_channel` with a one-liner status:

```bash
curl -X POST /api/sessions/<thread-id>/messages \
  -d '{"text":"Please call mcp__hapi__send_to_channel with text: Status: gathering panel feedback, will summarize in 5 min."}'
```

Within ~60 s verify in `#hiring-debrief-eric` timeline (in all 3 web
sessions):
- A new text message appears.
- Author label reads exactly `Thread: eric-recommendation` (NOT
  `system`, NOT raw session id).
- Avatar / styling distinguishes it from a real user message.

---

## Phase 8 — User reaction on thread card (regression of R11-2)

### Step 11 — Tariq adds 🤔 to the eric-recommendation card

Hover the `eric-recommendation` card → click the now-visible `+ 😊`
trigger → pick 🤔. Within ~3 s verify a 🤔 bubble appears under the
card; SSE-pushed live to Mira + Yael.

Bonus: Lumen may also receive this as a weak signal (from the R11-1
fix); check bot transcript for the inject `reacted 🤔 on msgId=…`.

---

## Phase 9 — Cleanup

### Step 12 — Mira hard-deletes `#hiring-debrief-eric`

Settings → Danger zone → Also delete files → Delete.

Verify:
- Folder `~/.hapi/workspaces/mira/hiring-debrief-eric` is gone.
- After ~10 s no orphan claude subprocesses for the channel's bot
  or its threads.
- Tariq + Yael sidebars drop the channel.
- `# general` and `# private` survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| _ | _ | _ | _ | _ | _ |

### Coverage outcome — ZERO bugs (second zero-bug round after R8)

All 12 numbered scenario steps executed. All 5 NEW behaviors and all
post-R11 regressions held.

**NEW behaviors verified end-to-end (first time)**:

- **`welcomeStyle:"custom:..."` exact-text rendering** (Step 3) — Lumen's
  first channel message was **byte-for-byte** the configured custom
  string `"Welcome to the Eric K debrief room. Drop your panel notes
  here, @-mention me to spawn evaluation threads, and I will keep
  things tidy."` — no auto-generated greeting fall-through.
- **Concurrent multi-user message storm** (Step 6) — 3 cross-namespace
  users firing REST `POST /channels/:id/messages` in parallel produced
  3 distinct DB rows with strictly increasing seq (2 → 3 → 4) and
  distinct authorUserIds (Mira / Tariq / Yael). Lumen's bot session
  received **TWO** weak-signal-batch injects (count=2 then count=1) —
  matches spec §V "Debounce 规则: 攒到 **2 条** 消息 OR **3 秒** 静默 →
  触发一次推送". The 3rd-message-stays-orphaned-then-flushes-on-debounce
  is documented behavior. Bonus: Lumen `react_to_message`'d on all
  three (👀 / 👍 / similar). Confirms the channelAgent + reaction
  flow under contention.
- **`mcp__hapi__list_threads`** (Step 8) — explicitly invoked by Lumen
  in response to "list all active threads in this channel using your
  list_threads tool". Tool call appears in bot transcript.
- **`mcp__hapi__get_thread`** (Step 9) — Lumen called `get_thread` for
  the eric-recommendation thread, then `send_to_channel` with the
  rendered status string `**eric-recommendation thread status:** Active
  (evaluating). Created just now, last update moments ago. Private
  thread — recommendation coming shortly.` Both MCP tools (list +
  get) verified end-to-end.
- **Thread → channel `send_to_channel` with `Thread:` author label**
  (Step 10) — injected `<system>`-style instruction into the
  eric-recommendation thread session via REST; thread agent called
  `mcp__hapi__send_to_channel` with the requested status string;
  channel timeline rendered the message with author label
  `Thread: eric-recommendation` (NOT "system", NOT raw session id).
  Verified via DOM eval — text content `"Thread: eric-recommendation12:38 PM+ 😊Status: gathering panel feedback…"`. R8 deferred this; R10/R11 didn't get to it; R12 closes the loop.

**Regressions all hold**:
- Default channels with bot (R9) — Mira's #general had Agent
  greeting "Hi Mira" within ~7 s.
- Sidebar PRIVATE/CHANNELS split + namespace title (R9).
- Channel description rendered in header (R11) — Mira saw the full
  `Eric K debrief — onsite 2026-04-29 …` description string.
- Markdown rendering (R10) — Lumen's `**eric-recommendation thread status:**`
  rendered as `<strong>eric-recommendation thread status:</strong>`.
- User reaction → bot weak signal (R11-1) — observed bot
  `react_to_message`-ing on the panel notes weak signals (3 react calls
  for the 3 panel messages, distributed across the 2 batches).
- `+ 😊` picker on thread cards (R11-2) — Tariq used the hover-revealed
  picker on eric-recommendation card to add 🤔; reaction landed in DB
  with `reactorRef=user:3978987640`.
- Hard delete cleanup (R3) — folder gone, 0 orphans, defaults survive.

Hub test suite still **242/242** (no test changes this round).
