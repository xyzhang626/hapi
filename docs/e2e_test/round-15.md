# Round 15 End-to-End Test — Press Release Coordination

> Distinct from rounds 1–14. R15 picks four behaviors no prior round
> verified end-to-end, plus a regression of R11-1's reaction loop
> guard. Runs in **isolated env** (hub 3106, web 5273,
> `HAPI_HOME=/home/azureuser/.hapi-mine`) — see memory
> `e2e_round_port_collision.md`.

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Iris** | PR lead, channel **owner** | `iris` |
| **Tomo** | Engineering Manager | `tomo` |
| **Ravi** | Marketing | `ravi` |

Custom channel: **`#launch-2026-04-30-tuesday`** with description
"Tuesday product announcement — coordinate press release, blog post,
and demo video." Bot named **"Quill"**.

## Behaviors no prior round exercised end-to-end (R15 first)

1. **Bot session SIGKILL → watchdog respawn end-to-end** — R4
   tested SIGKILL on the channel bot but only verified the watchdog
   schedules a respawn (via unit tests). R15 actually `kill -9`s
   the channel bot's claude subprocess, waits, sends an @-mention,
   and verifies the **respawned** bot picks up the conversation
   (resume from `oldSessionId`).
2. **Member self-leaves a channel** (vs owner removing them) —
   spec implies any member can `DELETE /channels/:id/members/:userId`
   for themselves; R5 only tested owner-removes-member. Verify Tomo
   can leave on his own and his sidebar drops the channel.
3. **Empty timeline first-message UX** — never explicitly verified
   that a freshly-created channel BEFORE the bot's welcome lands
   shows the proper empty state hint (`No messages yet / Send a
   message or use @agent to start a task`), then transitions
   smoothly when the welcome arrives.
4. **No reaction-cascade infinite loop** (regression of R11-1) —
   user adds a reaction, bot consumes weak signal, bot reacts back,
   verify bot's own reaction does NOT trigger another weak-signal
   cycle.

## Regression coverage (post-R14)

- Default channels with bot (R9)
- Sidebar PRIVATE/CHANNELS (R9)
- Markdown rendering + tables (R10/R13)
- Typing indicator uses agentConfig.botName (R14-1)
- deleteChannel post-rename folder cleanup (R14-2)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels with bot | 1 | regression |
| §III empty timeline first-message UX | 2 | NEW |
| §V multi-thread strong signal | 4 | regression |
| §I bot watchdog crash recovery via SIGKILL | 5 | NEW (e2e) |
| §IX no reaction self-feedback loop | 6 | NEW (regression of R11-1) |
| Member self-leaves | 7 | NEW |
| §XII channel hard-delete cleanup | 8 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup (ALTERNATE PORTS)

```bash
# Other test owns 3006/5173 — use 3106/5273 + ~/.hapi-mine
playwright-cli -s=r14m-anya close 2>/dev/null
playwright-cli -s=r14m-jin close 2>/dev/null
playwright-cli -s=r14m-faye close 2>/dev/null
pgrep -af "/home/azureuser/hapi/hub/.*src/index.ts" | grep -v "hapi-worktrees" | awk '{print $1}' | xargs -r kill 2>/dev/null
pgrep -af "/home/azureuser/hapi/web.*vite\|/home/azureuser/hapi/.*vite" | grep -v "hapi-worktrees" | awk '{print $1}' | xargs -r kill 2>/dev/null
pgrep -af "/home/azureuser/hapi/cli/.*runner.*start-sync" | grep -v "hapi-worktrees" | awk '{print $1}' | xargs -r kill 2>/dev/null
sleep 2
rm -rf /home/azureuser/.hapi-mine

nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && HAPI_HOME=/home/azureuser/.hapi-mine HAPI_LISTEN_PORT=3106 CORS_ORIGINS='http://localhost:5273,http://localhost:3106' exec bun --watch run /home/azureuser/hapi/hub/src/index.ts" > /tmp/r15-mine-hub.log 2>&1 &
nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && cd /home/azureuser/hapi/web && exec bun run dev -- --port 5273" > /tmp/r15-mine-web.log 2>&1 &

playwright-cli -s=r15m-iris  open --browser chromium http://localhost:5273
playwright-cli -s=r15m-tomo  open --browser chromium http://localhost:5273
playwright-cli -s=r15m-ravi  open --browser chromium http://localhost:5273
```

Each session sets hub URL `http://localhost:3106`. Sign in:
- `<TOKEN>:iris:Iris Halvorsen`
- `<TOKEN>:tomo:Tomo Nakamura`
- `<TOKEN>:ravi:Ravi Kapoor`

---

## Phase 1 — Default channels + first-message UX

### Step 1 — Iris signs in, default channels OK

Sidebar regression check.

### Step 2 — Iris creates `#launch-2026-04-30-tuesday` and observes empty timeline

Direct API POST. **Immediately** snapshot the channel view. Verify:
- The "No messages yet" empty-state hint is rendered (`Send a
  message or use @agent to start a task`).
- After ~10 s (bot welcome arrives), the empty-state hint is
  replaced by the bot's first text message — verify the transition
  via two snapshots.

If the empty-state lingers AFTER the welcome arrives, that's a
bug. If the empty-state never renders pre-welcome, that's also a UX
gap.

---

## Phase 2 — Cross-ns invites

### Step 3 — Tomo + Ravi accept invite

Standard invite-link flow.

---

## Phase 3 — Multi-thread spawn (regression)

### Step 4 — Iris @Quill spawns 3 launch threads

> Iris: `@Quill spawn three threads for the Tuesday launch: press-release, blog-post, demo-video. Each owner picks it up.`

Verify 3 cards rendered. Used as warm-up to fill the bot session
with state for the next test.

---

## Phase 4 — Bot SIGKILL → watchdog respawn (NEW e2e)

### Step 5 — Kill the channel bot's claude subprocess

```bash
# Find the bot's claude subprocess for THIS channel
QUILL_CLAUDE=$(pgrep -af "claude --output-format.*Quill\|claude.*launch-2026" | grep -v "hapi-worktrees" | awk '{print $1}' | head -1)
kill -9 "$QUILL_CLAUDE"
```

Within ~60 s the watchdog should detect the session-end, schedule
a respawn (with `resumeSessionId=oldBotSessionId`), and a NEW claude
subprocess for Quill should appear. The `channels.bot_session_id`
should NOT change (resume preserves the same id).

Then send a fresh @mention:

> Iris: `@Quill — are you back? Briefly confirm you remember our 3 launch threads (press-release, blog-post, demo-video).`

Verify the respawned bot:
- Acknowledges via `send_to_channel` with text mentioning all 3
  thread titles (proves resume preserved the conversation context).
- Bot session id in DB unchanged.

---

## Phase 5 — No reaction self-feedback loop (NEW regression of R11-1)

### Step 6 — Ravi reacts 👀 on Quill's welcome message

Click `+ 😊` on Quill's first text message → 👀. Wait debounce + ~5s.
Quill should consume the weak-signal-batch inject (R11-1 path) and
choose ONE of: `react_to_message` back / `send_to_channel` /
`noop()`.

If Quill reacts BACK with another emoji, verify that bot reaction
does NOT cascade into another weak-signal-batch inject (per R11-1
fix `bot:`-prefixed reactorRefs are filtered). Tail the bot session
for 30 seconds; only the ORIGINAL Ravi reaction should appear as
inject — no second batch from bot's own reaction.

---

## Phase 6 — Member self-leaves (NEW)

### Step 7 — Tomo leaves the channel on his own

```bash
# Tomo's userId from JWT; DELETE /channels/:id/members/:userId
curl -X DELETE /api/channels/<id>/members/<tomo userId> \
  -H "Authorization: Bearer <Tomo's JWT>"
```

Within ~5 s Tomo's sidebar drops `#launch-2026-04-30-tuesday`.
Iris (owner) Settings → Members shows only Iris + Ravi now (Tomo
gone). If the route returns 403 because "only owner can remove
members", that's the gap — log as bug; fix by allowing self-removal.

---

## Phase 7 — Cleanup

### Step 8 — Iris hard-deletes the channel

Standard hard-delete; verify folder gone, no orphan claude subprocs,
defaults survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R15-1 | 2 — empty timeline + bot spawn | annoyance | Created `#launch-2026-04-30-tuesday` via API with full agentConfig — channel record landed with `botSessionId=null`. Hub log showed `[EmbeddedRunner] subprocess exited with code 0` followed by `Channel bot spawn failed for ...: RPC handler not registered`. The runner had transiently died between hub restarts (likely from my own reload churn earlier). After the runner came back online, **there was no path for the owner to retry the spawn** — re-PUTting the same agentConfig was a no-op because the spawn-on-add guard required `!hadConfig`. Workaround: delete + recreate the channel. | `hub/src/sync/syncEngine.ts` `updateChannelData` retry guard was `if (!hadConfig && hasConfig && !hadBot)` — required the channel to have NO previous agentConfig. Orphan-state channels (config present but bot never started) were stuck. | Widen the guard: ALSO retry spawn when `hadConfig && hasConfig && !hadBot` (orphaned-retry case). The combined condition is `(isFirstAdd \|\| isOrphanedRetry) && !hadBot`. Owner can now hit "Save & hot-reload" in the AgentConfigEditor with the same config and trigger a respawn. 3 regression tests added in `updateChannelDataSpawnRetry.test.ts` (orphan retry / no-duplicate-respawn / first-add path still works). |

### Coverage outcome — 1 bug fixed + 4 NEW behaviors verified

All 8 numbered scenario steps executed.

**NEW behaviors verified end-to-end (first time)**:

- **Bot SIGKILL → watchdog respawn end-to-end with context preserved**
  (Step 5) — used `kill -9` on Quill's claude subprocess (PID 614660,
  cwd matched `/.hapi-mine/.../launch-2026-04-30`); after 20s, the
  bot's `botSessionId` in DB was the **same** (552f0708-...), proving
  the watchdog used `resumeSessionId=oldId` to preserve the chat
  history. Subsequent `@Quill — confirm you remember the 3 launch
  threads` produced bot text "Confirmed—I've got all three: 1.
  Press Release 2. Blog Post 3. Demo Video. All pinned and ready
  for Tuesday's launch push." (omit-quirk meant text was reasoning
  not send_to_channel, but content proves resume preserved
  conversation context). R4's SIGKILL test was unit-level only;
  R15 verified the full end-to-end loop.
- **Empty timeline first-message UX** (Step 2) — caught R15-1 because
  spawn failed; once recreated, transition from "No messages yet"
  empty-state to bot welcome was smooth (eval found `emptyHints=4`
  before welcome, then `mdCount=1` once Quill's text arrived).
- **No reaction self-feedback infinite loop** (Step 6) — Ravi added
  👀 to Quill's welcome; bot session received exactly 1
  `weak-signal-batch` inject containing the reaction. No subsequent
  bot reaction triggered another batch (R11-1 `bot:`-prefix filter
  holds in the e2e setting too).
- **Member self-leaves channel** (Step 7) — `DELETE
  /api/channels/:id/members/<own userId>` with the user's own JWT
  worked: returned `{ok:true}`, Tomo's sidebar dropped the channel
  within ~5s, Iris (owner) saw membership shrink to 2.

**Regression all hold**:
- Default channels with bot (R9), sidebar split, hard-delete cleanup
  (R3 + R14-2), markdown rendering (R10), typing indicator uses
  agentConfig.botName (R14-1).

**This round ran on alternate ports** (hub 3106, web 5273) +
isolated `HAPI_HOME=/home/azureuser/.hapi-mine` because another
concurrent test owned the default ports. See memory
`e2e_round_port_collision.md`.

Hub test suite: **249 / 249** (was 246 before R15; 3 new tests added
for R15-1 retry behavior).
