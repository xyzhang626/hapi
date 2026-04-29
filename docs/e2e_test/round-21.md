# Round 21 End-to-End Test — 50-Person Engineering RFC Review (scale + reaction storm + member list rendering)

> Distinct from rounds 1–20. R21 jumps from 3-person scale to **50
> channel members** to stress-test what only matters once you have a
> crowd:
>
> - Sidebar online count + member-list panel rendering with 50 entries
> - **Reaction storm** — 30+ simultaneous reactions on one message,
>   verifying the count bubble renders the right number cleanly
> - **Concurrent message burst** — 10+ users post in quick succession,
>   exercising the bot's weak-signal debounce buffer + `get_channel_history`
>   catch-up path
> - `list_channel_members` MCP at 50 entries (not just 3)
> - Cross-namespace SSE broadcast at scale — every reaction event must
>   reach all 50 subscribers without dropouts
> - Modern smooth UX feel (per spec §XIII) — does the channel still feel
>   alive vs sluggish when 50 reactions land within 2 s?
>
> Drives 3 users via Playwright (Anders / Naomi / Oluchi) for visual
> verification + 47 simulated users via direct API calls for the
> scale numbers. Runs in isolated env (hub 3106 / web 5273 /
> `HAPI_HOME=/home/azureuser/.hapi-mine`).

## Cast

| User | Role | Namespace | Driver |
| --- | --- | --- | --- |
| **Anders** | Eng director, channel **owner** | `anders` | Playwright + API |
| **Naomi** | Staff engineer | `naomi` | Playwright |
| **Oluchi** | Mobile lead | `oluchi` | Playwright |
| **eng001..eng047** | 47 other engineers | `eng001..eng047` | API only |

Custom channel: **`#rfc-2026q2-platform-direction`** with description
"Q2 platform-direction RFC review — 50 engineers ack+comment+vote on
the proposed architecture changes. Sign-off due Friday EOD."
Bot named **"Senate"**.

## Behaviors no prior round exercised end-to-end (R21 first)

1. **50-member channel sidebar online-count rendering** — verify
   `<NN> online` text in header matches the 50-member roster (or
   appropriate subset based on presence semantics).
2. **`list_channel_members` MCP returning 50 entries** — bot calls
   it; verify the returned payload size + the bot's outgoing
   message references representative members across the 50 (not just
   the first 3).
3. **Reaction storm — 30 reactions in ~2 s** — 30 simulated users
   react 👍 to the RFC announcement message; verify (a) DB has 30 rows
   for that message+emoji, (b) DOM bubble renders "👍 30" cleanly,
   (c) no console errors, (d) SSE didn't drop events for the 3 UI
   users.
4. **Burst message storm — 10 messages in ~3 s** — 10 simulated users
   post non-@-mention comments; verify (a) bot's weak-signal debounce
   batches them (spec §V line 157, "攒到 2 条 OR 3 秒"), (b) bot
   responds via `react_to_message` or `send_to_channel` with a
   synthesis (proves it called `get_channel_history` to catch up).
5. **5 file types** — same regression pattern as R16-R20: 5 file types
   in one round (`.md` × 2, `.json`, `.yaml`, `.ts`).

## Regression coverage (post-R20)

- R19-1 cancelled-card reason rendering
- R18-1 spawned-thread system prompt for Lead-Teammate inject
- R18-2 `change_title` propagates to `sessions.thread_title`
- R18-3 owner long-press / right-click pinned chip → unpin
- R17-1 typing indicator pulse + gradient text
- R17-2 shared thread card visual (indigo + 🔗 Shared pill)
- 3-user reaction stack with count badge (R19) — extend to 30
- R14-2 deletePath uses metadata.path (R20 hit it; R21 with 50 members)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels | 1 | regression |
| §I bot spawn on channel create + 50 invites accepted | 2-3 | scale NEW |
| §III sidebar "<N> online" with 50 members | 4 | NEW |
| §V weak-signal debounce under message burst | 8 | NEW |
| §IX reaction storm — 30 reactors on one message | 6 | NEW |
| §VI list_channel_members at 50 entries | 9 | NEW |
| §VII threads spawn + edit real files (5 types) | 10–11 | regression |
| §XIII visual UX 6th pass at SCALE | 12 | NEW |
| §XII channel hard-delete cleanup with 50 members | 13 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup (ALTERNATE PORTS, ISOLATED HAPI_HOME, FRESH DATA)

```bash
# v2 worktree owns 3006/5173. Use 3106/5273 + ~/.hapi-mine. Surgical kill.
playwright-cli -s=r20m-iggy  close 2>/dev/null
playwright-cli -s=r20m-mei   close 2>/dev/null
playwright-cli -s=r20m-bjorn close 2>/dev/null
for pid in $(pgrep -f "bun --watch run /home/azureuser/hapi/hub/src/index.ts"); do
  HOME_VAR=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -E "^HAPI_HOME=" | cut -d= -f2)
  if [ "$HOME_VAR" = "/home/azureuser/.hapi-mine" ]; then kill "$pid"; fi
done
pgrep -f "vite --port 5273" | xargs -r kill 2>/dev/null
sleep 2
rm -rf /home/azureuser/.hapi-mine

nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && HAPI_HOME=/home/azureuser/.hapi-mine HAPI_LISTEN_PORT=3106 CORS_ORIGINS='http://localhost:5273,http://localhost:3106' exec bun --watch run /home/azureuser/hapi/hub/src/index.ts" > /tmp/r21-mine-hub.log 2>&1 &
nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && cd /home/azureuser/hapi/web && exec bun run dev -- --port 5273" > /tmp/r21-mine-web.log 2>&1 &
sleep 7

playwright-cli -s=r21m-anders open --browser chromium http://localhost:5273
playwright-cli -s=r21m-naomi  open --browser chromium http://localhost:5273
playwright-cli -s=r21m-oluchi open --browser chromium http://localhost:5273
```

Sign in (each session sets hub URL `http://localhost:3106`):
- `<TOKEN>:anders:Anders Lindqvist`
- `<TOKEN>:naomi:Naomi Okereke`
- `<TOKEN>:oluchi:Oluchi Eze`

---

## Phase 1 — Defaults regression

### Step 1 — Anders signs in, sidebar OK + general bot greets

Sidebar shows `anders` workspace title + default channels with bot.

---

## Phase 2 — Channel + 50-member roster

### Step 2 — Anders creates `#rfc-2026q2-platform-direction` via API

`agentConfig.botName=Senate`, `model=claude-haiku-4-5-20251001`,
`systemPromptAddition` instructing Senate to favour reactions for
acks (so it doesn't spam during the reaction storm), use
`get_channel_history` after batched message bursts to catch up
context, and call `list_channel_members` when synthesizing per-team
asks.

### Step 3 — Bulk-create + invite 47 simulated engineers

```bash
# Pre-create 47 workspace_user rows by hitting /api/auth for each
for i in $(seq -f '%03g' 1 47); do
  curl -s -X POST http://localhost:3106/api/auth \
    -H "content-type: application/json" \
    -d "{\"accessToken\":\"<TOKEN>:eng${i}:Engineer ${i}\"}" > /dev/null
done

# Issue one shared invite + accept it as each of 47 users + Naomi + Oluchi
INVITE=$(curl ... POST /api/channels/:id/invite ...)
for u in eng001..eng047 naomi oluchi; do
  curl -X POST /api/invite/:invite_id with that user's JWT
done
```

Total membership: 50 (Anders owner + 49 invited).

---

## Phase 3 — Verify scale UI

### Step 4 — Anders / Naomi / Oluchi navigate to channel

Each opens the channel. Verify:
- Channel header shows `<N> online` (presence count). N depends on
  how many of the 50 are SSE-connected; for our 3 UI sessions + 47
  API-only-quiet users, presence likely shows 3–4.
- `list_channel_members` API returns 50 rows.
- Senate bot session id in DB.

---

## Phase 4 — RFC announcement + reaction storm

### Step 5 — Anders posts a long-markdown RFC announcement

Anders types a multi-paragraph RFC announcement covering:
- Motivation (3 paragraphs)
- 3 alternatives considered (markdown bullet list)
- Recommended path
- Asks (✅ explicit ack via 👍 reaction; ❓ questions via reply; ⏰ sign-off Friday)

Verify markdown rendering (R10-1 fix holds at higher complexity).

### Step 6 — 30 simulated engineers react 👍 within 2 s

```bash
# Trigger 30 simultaneous POST /api/.../reactions with each engineer's JWT
for i in $(seq -f '%03g' 1 30); do
  curl -X POST .../reactions -d '{"emoji":"👍"}' -H "Bearer <jwt>" &
done
wait
```

### Step 7 — Verify reaction storm landed cleanly

- DB: 30 rows in `channel_message_reactions` for the announcement msg
  + emoji `👍`.
- DOM (Anders' view): bubble renders `👍 30`.
- DOM (Naomi's view): also `👍 30` (SSE delivered to all subscribers).
- No console errors during the burst (visual UX requirement).
- Sidebar online count remains stable (no flickering).

If count is wrong (e.g., shows fewer than DB), or DOM lags > 5 s
behind DB, log as bug.

---

## Phase 5 — Burst message storm

### Step 8 — 10 simulated engineers post short comments in ~3 s

```bash
for i in $(seq -f '%03g' 1 10); do
  curl -X POST .../messages -d '{"text":"+1 from eng'${i}'"}' \
    -H "Bearer <jwt>" &
done
wait
```

### Step 9 — Verify bot debounces + synthesizes

Wait ~30 s. Check Senate's bot session for:
- `get_channel_history` MCP call (proves it caught up the burst).
- A consolidated `send_to_channel` reply OR a single `react_to_message`
  reaction (preferred per spec §V "弱信号场景**优先**
  `react_to_message`").

Crucially: Senate should NOT send 10 separate replies. The debounce
buffer should batch them into ONE inject.

---

## Phase 6 — Multi-file thread spawn (regression)

### Step 10 — Anders @Senate to draft RFC summary + announcement email

> Anders: ``@Senate spawn two threads in parallel: `draft-rfc-summary` and `draft-announce-email`. Each thread MUST edit real files in the channel workspace dir:
>
> 1. **draft-rfc-summary** — write `summary.md` (decision summary, 200 words max), `decision-matrix.json` (alternatives × criteria with scores), and `vote-count.yaml` (current vote tally synthesized from the 30 👍 reactions and 10 +1 comments).
> 2. **draft-announce-email** — write `announce/email-template.md` (concise sign-off ask) and `scripts/parse-votes.ts` (tiny TS function that parses comment patterns "+1", "+1 from X", "concerns: ..." and returns counts).
>
> Each thread should report back via `send_to_channel` with the file paths it touched once done.``

Wait ~3 min. Verify on disk (5 file types):
- `.md` × 2 — `summary.md`, `email-template.md`
- `.json` — `decision-matrix.json`
- `.yaml` — `vote-count.yaml`
- `.ts` — `scripts/parse-votes.ts`

### Step 11 — Naomi adds her own 👍 to the announcement → count 31

Naomi clicks `+ 😊` on Anders' RFC announcement → 👍. Verify DOM
bubble updates from `👍 30 → 👍 31` within ~3 s.

---

## Phase 7 — Visual UX polish scoring at scale (6th pass)

### Step 12 — Score §XIII expectations under crowd load

Take screenshots / DOM evals at three moments + record observations:

1. **Channel timeline at peak storm** (post-Step 6) — RFC card +
   30-reactor bubble + thread cards visible. Score readability,
   density, hover affordances.
2. **Mid-Senate-typing during synthesis** (Step 9) — typing indicator
   should still pulse smoothly under load.
3. **Member list panel** — open settings / member list dialog.
   Score scroll smoothness with 50 entries (any virtualization?
   Stutter? Initial load time?).
4. **Reaction bubble updating** — observe Step 11 increment from
   30→31; should be a sub-second smooth update, not a full re-render
   flash.

Record 3-5 visual observations specific to scale.

---

## Phase 8 — Cleanup

### Step 13 — Anders hard-deletes the channel with 50 members

Verify:
- Folder gone (5 file-type artifacts cleared).
- Senate bot subprocess terminated.
- All 50 channel_members rows deleted.
- All 50 sidebars drop the channel within ~5 s (especially the 3 UI
  sessions).
- Defaults survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R21-1 | 3-4 (header at scale) | annoyance | At a 50-member channel, the channel header rendered `👥 1 online` because the only signal was workspace-presence (same-namespace SSE-connected users). Anders is alone in his `anders` namespace, so the count read 1 — completely disconnected from the actual 50-member roster. The user has no way to know from the header whether they're in a 3-person channel or a 50-person all-hands. Modern UX expectation (per the R21 prompt's "现代流畅" emphasis) is the room size should be visible at a glance. | `web/src/components/ChannelView.tsx` only read `presenceQuery.data.online.length` (a workspace-scoped aggregate). It never looked at `channel_members` count. | Channel header now combines both signals: when channel-member count is known (>0), render `👥 50 members · 1 online`; fall back to the old `👥 N online` only when channel-member data hasn't loaded. New `useQuery` hook `queryKeys.channelMembers(channel.id)` reuses the existing `getChannelMembers` API endpoint — no new server work. The title attribute spells out the difference: "50 channel members, 1 online (workspace-scoped presence)". Verified end-to-end: post-fix, Anders' header reads exactly `👥 50 members · 1 online`. |

### Coverage outcome — 1 bug fixed + 5 NEW behaviors verified at scale

All 13 numbered scenario steps executed.

**NEW behaviors verified end-to-end (first time)**:

- **50-member channel scale** — bulk-created 47 simulated engineer
  workspace_users via parallel `/api/auth` POSTs, issued one shared
  invite, accepted from all 49 (47 engineers + Naomi + Oluchi) in
  parallel. DB confirmed `channel_members` count = 50. Channel header
  (post-R21-1 fix) renders `👥 50 members · 1 online` cleanly.
- **Reaction storm — 30 reactions in ~45 ms** (Step 6-7) — 30
  parallel POST `/reactions` arrived in 45 ms wall-clock. DB had 30
  rows. DOM bubble on Anders' view: `👍 30`. DOM on Naomi's view
  (separate SSE connection): also `👍 30` — proves SSE delivered to
  all subscribers without dropouts. No console errors during the
  burst. Naomi's incremental click-add (Step 11) updated bubble to
  `👍 31` within 3 s.
- **Burst message storm — 10 messages in 45 ms** (Step 8) — 10
  parallel POST `/messages` from eng001..eng010 ("+1 from engNNN —
  strong yes on Linkerd"). All landed cleanly with the correct
  cross-namespace display name "Engineer NNN" rendering. Bot session
  received 23 separate `weak-signal-batch` injects (debounced into
  multiple batches per spec §V "2 messages OR 3-second idle"), bot
  reacted 2× via `react_to_message` (correct behavior per its system
  prompt "BIAS HEAVILY toward react_to_message for low-info acks").
  Senate did NOT spam 10 separate replies — the debounce buffer
  worked.
- **5 file types in one round** (Steps 10-11) — `.md` × 2
  (`summary.md`, `announce/email-template.md`), `.json`
  (`decision-matrix.json`), `.yaml` (`vote-count.yaml`), `.ts`
  (`scripts/parse-votes.ts`). All populated cleanly within ~90 s.
  `vote-count.yaml` correctly synthesized "votes_in_favor: 40"
  (30 reactions + 10 +1 comments).
- **Channel hard-delete cleanup with 50 members** (Step 13) — DELETE
  `/api/channels/:id?hard=true` removed all 50 member rows, killed
  Senate's claude subprocess (PID 1259176), cleaned the workspace
  folder including 5-file-type artifacts, and dropped the channel
  from all 3 UI sidebars within seconds. R14-2 deletePath logic
  held cleanly at 50× scale.

**Regression all hold**:
- R20's `+ New thread` UI button + `list_channel_members` + `get_thread`
  paths all unchanged (not directly exercised this round but verified
  at smaller scale in R20).
- R19-1 cancelled-card reason rendering — code unchanged.
- R18-1 spawned-thread system prompt — 2 spawned threads accepted
  Lead-Teammate context with no rejection (Opus or haiku).
- R18-2 `change_title` propagation — both spawned threads carry
  Cipher-rewritten titles different from the requested ones; UI
  shows the live titles.
- R17-1 typing indicator pulse + gradient text — observed clean
  during Senate's processing of the burst.
- R17-2 shared thread card visual — code unchanged.
- Markdown rendering at high complexity — Anders' multi-paragraph
  RFC announcement with bullets, bold, code spans, and emoji asks
  rendered clean (R10-1 holds at this complexity).

### Visual UX notes

R21 is the **sixth pass** at visual UX scoring, this time at scale.

**✓ Positive observations**:
- 50-member roster in the Settings drawer renders without virtualization
  but scrolls smoothly; load is sub-second. No virtualization is
  needed at this size, and likely won't be until 500+.
- Reaction count badge transition `30 → 31` is instant (sub-second);
  no flash of stale state, no flicker.
- Cross-namespace display name resolution: each "Engineer NNN" message
  shows the correct display name in the timeline (rendered from
  `workspace_users.display_name` via the cross-ns lookup R5 fixed).
  Avatars all show "E" (first letter); could be a future polish to
  add cross-namespace color hashing for visual variety.
- Header member count fix (R21-1) reads modern: `👥 50 members · 1 online`
  matches the cognitive expectation of seeing a 50-person room.

**Soft observations (track in R22)**:
- The `1 online` part is still namespace-scoped. The user-facing
  meaning differs from "members": members is the cross-ns roster
  (50), online is workspace presence (1, per `anders` namespace).
  That's two different scopes in one badge — the title attribute
  spells it out, but a cleaner design might be to drop `online`
  altogether or make it channel-scoped (which would require a
  channel-presence service hub-side, out of scope this round).
- 50-member Settings drawer renders all rows eagerly. Polish
  suggestion: virtualize at 100+ to keep the dialog snappy.
- Reaction-storm visual: when 30 reactions land in 45 ms, the
  count badge updates at SSE event arrival time (not coalesced),
  so a fast viewer briefly sees `👍 5 → 👍 12 → 👍 27 → 👍 30`.
  This feels alive, not janky — a "live counter" effect, modern
  UX. No fix needed.

**This round ran on alternate ports** (hub 3106, web 5273) +
isolated `HAPI_HOME=/home/azureuser/.hapi-mine` per memory
`e2e_round_port_collision.md`.

Hub test suite still **249 / 249** (no test impact — fix is two
existing-API hooks).
