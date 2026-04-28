# Round 18 End-to-End Test — Q2 SLO Review Prep (5 file types + pin/unpin chip strip)

> Distinct from rounds 1–17. R18 picks **three NEW behaviors** no prior
> round verified end-to-end:
> 1. `pin_thread` MCP from bot session → chip in channel header strip
> 2. Owner unpin via UI long-press / context menu
> 3. Same-emoji reaction toggle removal (Slack-style: re-add = remove)
>
> Plus the FIRST round to drive **5 file types** (sql + md + yaml + ts +
> json) and the THIRD pass at visual UX scoring (re-verifying R17's
> typing-indicator + shared-card fixes hold). Runs in isolated env (hub
> 3106 / web 5273 / `HAPI_HOME=/home/azureuser/.hapi-mine`).

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Sarah** | Site Reliability lead, channel **owner** | `sarah` |
| **Tomas** | Platform engineer | `tomas` |
| **Yuki** | Data analyst | `yuki` |

Custom channel: **`#q2-slo-review-prep`** with description
"Q2 SLO review prep — refresh queries, runbook, alerts, dashboards.
Coordinate cross-functional drilldown across 5 artifacts."
Bot named **"Beacon"**.

## Behaviors no prior round exercised end-to-end (R18 first)

1. **`pin_thread` MCP called from bot session** → chip lands in channel
   header strip (per spec §III line 110-115). R13 covered
   `spawn_scheduled_thread`'s auto-pin; R8 had pinned chips visible
   from prior setup; but no prior round end-to-end verified the bot
   manually calling `pin_thread` mid-session and seeing the chip
   appear in real time.
2. **Owner unpin via UI long-press / context menu** (spec §III line
   114 "Owner 长按 → 弹出 unpin 菜单") — chip vanishes via SSE.
3. **Same-emoji toggle removal** (spec §IX line 286: "再加一次 = 移除
   Slack 风格 toggle") — user clicks 👍, then clicks 👍 again →
   reaction removed. Verified by reaction-count diff.
4. **5 file types in a single round** (`.sql` + `.md` + `.yaml` + `.ts`
   + `.json`) — expansion of R16/R17 multi-file long-range pattern.
5. **`change_title` MCP** updates the timeline card live + chip text in
   pinned strip (spec §VI tool list) — R17 plumbed `liveTitle` into
   `ThreadCard` but no round had a thread agent actually call
   `mcp__hapi__change_title` and verify the channel-side label flips.

## Regression coverage (post-R17)

- Multi-file artifact edits + multi-turn correction (R16/R17)
- Bot session view + read-only banner (R17)
- Share to channel toggle private↔shared (R17)
- Typing indicator pulse + gradient text (R17-1 fix)
- Shared thread card visual upgrade (R17-2 fix)
- Default channels with bot (R9)
- Markdown rendering + tables (R10/R13)
- Channel hard-delete cleanup with multi-file artifacts (R16)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels | 1 | regression |
| §VII threads spawn + edit real files (5 types) | 5–7 | NEW (5 types) |
| §VI MCP `pin_thread` from bot session | 8 | NEW |
| §III pinned chip strip live | 8 | NEW |
| §VI MCP `send_to_thread` correction | 9 | regression |
| §VI MCP `change_title` live update | 9 | NEW (e2e) |
| §III owner UI unpin | 10 | NEW |
| §IX reaction same-emoji toggle removal | 11 | NEW |
| §XIII visual UX 3rd pass | 12 | regression of R17-1 + R17-2 |
| §XII channel hard-delete cleanup | 13 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup (ALTERNATE PORTS, ISOLATED HAPI_HOME)

```bash
# v2 worktree at /home/azureuser/hapi-worktrees-codex-debug-v2/ owns
# 3006/5173. Use 3106/5273 + ~/.hapi-mine. Surgical kill.
playwright-cli -s=r17m-mira  close 2>/dev/null
playwright-cli -s=r17m-felix close 2>/dev/null
playwright-cli -s=r17m-suki  close 2>/dev/null
for pid in $(pgrep -f "bun --watch run /home/azureuser/hapi/hub/src/index.ts"); do
  HOME_VAR=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -E "^HAPI_HOME=" | cut -d= -f2)
  if [ "$HOME_VAR" = "/home/azureuser/.hapi-mine" ]; then kill "$pid"; fi
done
pgrep -f "vite --port 5273" | xargs -r kill 2>/dev/null
sleep 2
rm -rf /home/azureuser/.hapi-mine

nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && HAPI_HOME=/home/azureuser/.hapi-mine HAPI_LISTEN_PORT=3106 CORS_ORIGINS='http://localhost:5273,http://localhost:3106' exec bun --watch run /home/azureuser/hapi/hub/src/index.ts" > /tmp/r18-mine-hub.log 2>&1 &
nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && cd /home/azureuser/hapi/web && exec bun run dev -- --port 5273" > /tmp/r18-mine-web.log 2>&1 &
sleep 5

playwright-cli -s=r18m-sarah open --browser chromium http://localhost:5273
playwright-cli -s=r18m-tomas open --browser chromium http://localhost:5273
playwright-cli -s=r18m-yuki  open --browser chromium http://localhost:5273
```

Each session sets hub URL `http://localhost:3106`. Sign in:
- `<TOKEN>:sarah:Sarah Penrose`
- `<TOKEN>:tomas:Tomáš Bartoš`
- `<TOKEN>:yuki:Yuki Sasaki`

---

## Phase 1 — Defaults regression

### Step 1 — Sarah signs in, sidebar OK + general bot greets

Sidebar shows `sarah` workspace title, `Channels` + `Private` sections.

---

## Phase 2 — Custom channel + Beacon bot

### Step 2 — Sarah creates `#q2-slo-review-prep` via API

`agentConfig.botName=Beacon`, `model=claude-haiku-4-5-20251001`,
`systemPromptAddition` instructing bot to be concise and to favour
`pin_thread` for review-critical artifacts.

---

## Phase 3 — Cross-ns invites

### Step 3 — Tomas + Yuki accept invite via API.

---

## Phase 4 — Pre-seed workspace baseline (5 file types)

### Step 4 — Sarah seeds the workspace

```bash
WS=/home/azureuser/.hapi-mine/workspaces/sarah/q2-slo-review-prep
mkdir -p "$WS/queries" "$WS/runbooks" "$WS/alerts" "$WS/scripts" "$WS/dashboards"

cat > "$WS/queries/slo_baseline.sql" <<'SQL'
-- Q1 baseline SLO query
SELECT count(*) FROM requests WHERE status_code >= 500;
SQL

cat > "$WS/runbooks/availability.md" <<'MD'
# Availability runbook

When availability drops below 99.9%, …
MD

cat > "$WS/alerts/slo.yaml" <<'YAML'
alerts:
  - name: availability_below_target
    threshold: 0.999
YAML

cat > "$WS/scripts/compute_slo.ts" <<'TS'
export function computeAvailability(success: number, total: number) {
  return success / total
}
TS

cat > "$WS/dashboards/overview.json" <<'JSON'
{ "title": "SLO overview", "panels": [] }
JSON
```

---

## Phase 5 — Spawn 4 file-editing threads (5 file types across them)

### Step 5 — Sarah @Beacon to spawn 4 parallel artifact threads

> Sarah: ``@Beacon we are prepping the Q2 SLO review. Spawn four threads in parallel. Title them exactly: `update-slo-queries`, `revise-availability-runbook`, `tune-alert-thresholds`, `extend-slo-script`. Each thread MUST edit real files in the channel workspace dir:
>
> 1. **update-slo-queries** — edit `queries/slo_baseline.sql` AND add a new `queries/slo_p99_latency.sql` for p99 latency over 1h windows.
> 2. **revise-availability-runbook** — edit `runbooks/availability.md` to add a triage decision tree (markdown table + ordered list) AND update `dashboards/overview.json` to add a `availability` panel object.
> 3. **tune-alert-thresholds** — edit `alerts/slo.yaml` to add `latency_p99_breach` (threshold 250ms over 5m) and `error_rate_breach` (threshold 0.5% over 5m) alerts.
> 4. **extend-slo-script** — edit `scripts/compute_slo.ts` to add `computeP99Latency(samples: number[])` and `computeErrorRate(errors: number, total: number)` exports + write a sibling `scripts/compute_slo.test.ts` with at least 3 test cases.
>
> Once `update-slo-queries` is done, **call `pin_thread` on it** — that artifact is the headline of the review. Each thread should report back via `send_to_channel` with the file path it touched.``

Bot calls `spawn_thread × 4`. Within ~60 s 4 cards appear in timeline.

### Step 6 — Wait ~3-5 minutes for threads to edit files

Threads are real Claude Haiku sessions. Poll workspace every 30 s.

### Step 7 — Verify on-disk artifacts (5 file types)

```bash
WS=/home/azureuser/.hapi-mine/workspaces/sarah/q2-slo-review-prep
echo "--- SQL ---"
ls -l "$WS/queries/" && grep -l "p99\|latency" "$WS/queries/"*.sql || echo "MISSING p99 query"
echo "--- markdown ---"
grep -E "decision tree|triage|table" "$WS/runbooks/availability.md" -i | head -3
echo "--- yaml alerts ---"
grep -E "latency_p99_breach|error_rate_breach" "$WS/alerts/slo.yaml" || echo "MISSING alerts"
echo "--- TS script + tests ---"
grep -E "computeP99Latency|computeErrorRate" "$WS/scripts/compute_slo.ts" || echo "MISSING script exports"
test -f "$WS/scripts/compute_slo.test.ts" && grep -cE "test\(|it\(|describe\(" "$WS/scripts/compute_slo.test.ts" || echo "MISSING tests"
echo "--- JSON dashboard ---"
~/.bun/bin/bun -e "const d = require('$WS/dashboards/overview.json'); console.log('panels:', d.panels?.length || 0); console.log('has availability:', JSON.stringify(d.panels).includes('availability'));"
```

Pass criteria:
- 5 file types ALL touched: `.sql` (2 files), `.md`, `.yaml`, `.ts` (2 files), `.json`
- `slo_p99_latency.sql` exists and mentions p99 / latency.
- `runbooks/availability.md` contains decision tree language (table or ordered list).
- `alerts/slo.yaml` has both `latency_p99_breach` and `error_rate_breach`.
- `compute_slo.ts` exports `computeP99Latency` and `computeErrorRate`.
- `compute_slo.test.ts` exists with ≥3 test blocks.
- `dashboards/overview.json` panels array contains an `availability` panel.

---

## Phase 6 — Pin a non-scheduled thread via MCP (NEW)

### Step 8 — Verify Beacon called `pin_thread` on `update-slo-queries`

The Step 5 prompt explicitly told Beacon to call `pin_thread` on
`update-slo-queries` once it's done. Verify:

```bash
~/.bun/bin/bun -e "
import { Database } from 'bun:sqlite'
const db = new Database('/home/azureuser/.hapi-mine/hapi.db', { readonly: true })
const ts = db.query(\"SELECT id, thread_title, pinned FROM sessions WHERE channel_id = ? AND is_channel_bot = 0\").all('<channel id>')
ts.forEach(t => console.log(t.id.slice(0,8), t.thread_title, 'pinned=', t.pinned))
"
```

Then snapshot Sarah's view of channel header — there should be a chip
with the thread title and a 📌 (or equivalent pinned indicator) per
spec §III line 110-115 + §XIII line 440 ("scheduled thread chip 带个小⏰,
普通 pinned 带个📌"). Verify chip is **clickable** (navigates to thread)
and **owner long-press → unpin menu** appears.

If `pin_thread` MCP wasn't called by Beacon (omit-quirk), explicitly
ask: "@Beacon please pin update-slo-queries now."

---

## Phase 7 — Multi-turn `change_title` + correction loop (NEW e2e)

### Step 9 — Beacon injects correction + asks thread to rename itself

> Sarah: `@Beacon please send_to_thread on update-slo-queries with text: "Correction — also include a 7-day window variant in slo_p99_latency.sql, AND call mcp__hapi__change_title to rename yourself to 'slo-queries-v2' to reflect the bigger scope."`

Bot calls `mcp__hapi__send_to_thread`. Wait ~90 s. Verify on disk that
the SQL has `7 day` or `INTERVAL 7 DAY` mentioned, AND verify in DB:

```bash
~/.bun/bin/bun -e "
import { Database } from 'bun:sqlite'
const db = new Database('/home/azureuser/.hapi-mine/hapi.db', { readonly: true })
const t = db.query(\"SELECT id, thread_title FROM sessions WHERE id = ?\").get('<update-slo-queries thread id>')
console.log(t.thread_title)
"
```

Should print `slo-queries-v2` (or similar — exact rename).

Verify in Sarah's UI:
- Channel timeline thread card shows new title `slo-queries-v2`.
- Pinned chip in header shows new title.

This proves the R17 `liveTitle` plumbing works AND the pinned chip
re-renders on `change_title` SSE event.

---

## Phase 8 — Owner UI unpin (NEW)

### Step 10 — Sarah long-presses (or right-clicks) the pinned chip → unpin

Find the pinned thread chip in channel header. Long-press / right-click
to surface the unpin menu. Click "Unpin". Verify:

- Chip disappears from header strip within ~2 s.
- DB: `sessions.pinned` flips back to 0.
- SSE event `thread-unpinned` was fired (from R13's tracking).
- Tomas's view (non-owner) ALSO sees the chip removed.

If unpin UI is missing entirely, that's a bug — log under Bugs Found.

---

## Phase 9 — Reaction same-emoji toggle (NEW)

### Step 11 — Yuki reacts 👍 then re-clicks 👍 → reaction removed

Click `+ 😊` on Beacon's welcome message → 👍. Wait 1 s. Verify reaction
shows in DB + DOM. Then click the **same** 👍 reaction bubble → should
remove (Slack-style toggle per spec §IX). Verify:

- DB: `channel_message_reactions` row gone.
- DOM: reaction bubble for 👍 disappears from message.
- SSE event `message-reaction-removed` fired.

Then add 👍 + 👀 + 🙏 (3 different emojis from Yuki) — verify all 3
display as separate bubbles with count `1` each. Then Tomas adds 👍 —
verify 👍 bubble updates to count `2`.

---

## Phase 10 — Visual UX polish scoring (3rd pass)

### Step 12 — Re-verify R17 fixes hold + score new aspects

1. **Typing indicator** mid-bot-typing — `getComputedStyle()` confirms
   `.bot-typing-glyph { animationName: bot-typing-halo }` and
   `.bot-typing-text { animationName: bot-typing-text-shimmer }`.
   R17-1 fix should hold.
2. **Shared thread card visual** — flip one of the threads to shared,
   verify Tomas's view shows indigo gradient + 🔗 Shared pill (R17-2
   fix).
3. **Pinned thread chip strip** — verify chip has 📌 prefix or
   distinct styling from regular thread cards. Score against spec
   §XIII line 440.
4. **Reaction bubble row** — score per spec §XIII "Reaction: bubble
   底部贴一行,数字小号灰字" — verify bubbles render at message bottom,
   counts in small grey font.

Record 3-5 visual observations.

---

## Phase 11 — Cleanup

### Step 13 — Sarah hard-deletes `#q2-slo-review-prep`

Verify folder gone (including all 5 file types we wrote), bot
subprocess terminated, defaults survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R18-1 | 7 (multi-turn `send_to_thread`) | bug | Thread agent (Opus 4.7) refused the `<system>injected-by-bot</system>` Lead-Teammate inject as a "prompt injection attempt" — verbatim: "tagged `<system>injected-by-bot</system>` in user-message position, which isn't how the harness delivers system reminders (those come via `<system-reminder>`). I'm flagging it instead of acting on it." Multi-turn correction loop broke entirely on the first attempt. R16's haiku-flavored thread tolerated the wrapper; Opus 4.7 doesn't. Spec §VI defines `send_to_thread` as Lead-Teammate inject; without explicit guidance the thread can't tell legitimate coordination from malicious wrapper. | Spawned threads (`botSpawnThread` in `hub/src/sync/syncEngine.ts`) get the default Claude Code system prompt, with NO documentation of the `<system>injected-by-{bot,sibling-thread}</system>` Lead-Teammate convention. Security-aware models default to refusing wrapped messages. | Hub composes a thread-specific system-prompt addition (`buildSpawnedThreadSystemPromptAddition` in `syncEngine.ts`) explicitly explaining: (a) you are a HAPI thread agent for #channel, working as `threadTitle`, spawned by botName; (b) `<system>injected-by-bot</system>` and `<system>injected-by-sibling-thread</system>` are LEGITIMATE Lead-Teammate coordination per spec §VI, NOT prompt-injection attempts; (c) channel-aware MCP tools are available (`send_to_channel`, `react_to_message`, `change_title`, `send_to_thread`); (d) cannot spawn/pin threads — bot-only. Passed via `customSystemPrompt` extras → runner appends as `--append-system-prompt`. Verified end-to-end on a fresh thread: inject "add measurement window + error budget" was accepted and applied to disk; second inject "rename via change_title" also applied. R16 was lucky with Haiku's permissive default. |
| R18-2 | 9 (`change_title` propagation) | bug | Thread agent successfully called `mcp__hapi__change_title` (response stored in DB as `metadata.summary.text`), but `sessions.thread_title` did NOT update. The R17 `liveTitle` plumbing in `ChannelView` reads `threadSession.threadTitle` — so the channel timeline thread card and pinned chip strip kept the original title forever. The "live rename" promise of `change_title` was DOA on the channel side. | `cli/src/claude/utils/startHappyServer.ts`'s `change_title` handler emits a `summary` message into the Claude session stream; that lands in `metadata.summary.text` via the runner's `update-metadata` socket event. The handler in `hub/src/socket/handlers/cli/sessionHandlers.ts` stores the metadata but never propagates `summary.text` → `sessions.thread_title`. | Two-part fix: (a) new `setSessionThreadTitle(db, sessionId, namespace, threadTitle)` in `hub/src/store/sessions.ts` (and exposed via `SessionStore`), guarded `WHERE channel_id IS NOT NULL AND thread_title != @new`. (b) `handleUpdateMetadata` now reads `metadata.summary.text` post-update and best-effort calls `setSessionThreadTitle`. Verified end-to-end: bot `send_to_thread` → "rename to slo-targets-r18-verified" → DB `thread_title` updated to `slo-targets-r18-verified` AND DOM thread card text matches (no manual refresh needed). |
| R18-3 | 10 (owner UI unpin) | bug | Spec §III line 114: "Owner 长按 → 弹出 unpin 菜单" — long-press / right-click on a pinned chip should expose an unpin menu for the channel owner. The chip in `ChannelView.tsx` had only `onClick={() => onOpenThread(s.id)}` — no contextmenu, no long-press. Owner had no in-header path to unpin; the only unpin surface was buried in the thread page's More-Actions menu. | The pinned chip strip was rendered with a bare `<button>` and a single click handler — no integration with the existing `useLongPress` hook (which is used by `SessionList` and `terminal.tsx`). | New `PinnedThreadChip` component in `ChannelView.tsx` wires `useLongPress` (500 ms default + right-click `onContextMenu` already supported). On long-press / right-click (owner only), a small popup menu renders with `📍 Unpin from header`. Click → `api.setThreadPinned(s.id, false)` → SSE `thread-unpinned` event → chip vanishes from header strip across all members' views. Non-owners get a normal click handler (no menu — they shouldn't be able to unpin). Closes on outside click / Escape. Verified end-to-end with right-click `MouseEvent('contextmenu')` dispatch: menu rendered, click "Unpin" flipped DB `pinned=0`, chip removed from DOM. |

### Coverage outcome — 3 bugs fixed + 4 NEW behaviors verified

All 13 numbered scenario steps executed. R18 picked up 3 real bugs across distinct subsystems: (1) thread-agent system prompt missing inject convention, (2) `change_title` not propagating to channel-side rendering, (3) owner UI unpin missing entirely.

**NEW behaviors verified end-to-end (first time)**:

- **`pin_thread` MCP from bot session** (Step 8) — Beacon needed an explicit second @-mention to actually call the MCP (omit-quirk noted in many prior rounds). Once called, `sessions.pinned=1` and the chip rendered as "📌 update-slo-queries" in the channel header strip per spec §III line 110-115 + §XIII line 440.
- **Multi-turn `change_title` MCP** (Step 9) — after R18-2 fix, the thread agent's `change_title` call propagates from `metadata.summary.text` → `sessions.thread_title` → DOM thread card and pinned chip text within ~2s. Verified rename "verify-slo-targets" → "slo-targets-final" → "slo-targets-r18-verified" all visible in Sarah's UI live.
- **Owner UI unpin via long-press / right-click** (Step 10, R18-3 fix) — right-click "📌 update-slo-queries" chip → "📍 Unpin from header" menu appeared → click → `pinned=0`, chip removed.
- **Same-emoji reaction toggle removal** (Step 11) — Yuki added 👍, then re-clicked same 👍 bubble → DB row removed (Slack-style toggle per spec §IX line 286). Multi-emoji counts also rendered correctly: after Tomas added 👍 too, bubble showed "👍 2" with the count badge.
- **5 file types in one round** (Steps 5-7) — `.sql` × 2 (`slo_baseline.sql`, `slo_p99_latency.sql`) + `.md` (`runbooks/availability.md` with markdown table + ordered list decision tree) + `.yaml` (3 alerts: availability, latency_p99_breach, error_rate_breach) + `.ts` × 2 (`compute_slo.ts` with `computeP99Latency` + `computeErrorRate`, `compute_slo.test.ts` with 8 assertions) + `.json` (`dashboards/overview.json` with availability panel including thresholds). All artifacts verified clean on disk in ~30s.

**Regression all hold**:
- R17-1 typing-indicator pulse + gradient text — verified via `getComputedStyle()`: `.bot-typing-glyph { animationName: bot-typing-halo, duration: 1.6s, infinite }` and `.bot-typing-text { animationName: bot-typing-text-shimmer }`.
- Default channels with bot (R9), markdown rendering (R10/R13), hard-delete cleanup (R3 + R14-2 + R16): workspace folder gone (5 file types), Beacon claude subprocess (PID 940559) terminated within 12s, defaults survived for all 3 namespaces.
- Multi-file artifact pattern (R16/R17) extended to 5 file types this round.

### Visual UX notes

R18 is the **third pass** at visual UX scoring. R17 fixes (typing indicator + shared card) hold cleanly. New surface this round: pinned chip strip styling and contextual menu polish.

**✓ Positive observations**:
- Pinned chip renders with 📌 prefix per spec §XIII line 440. Scheduled threads (none this round) would render with ⏰ instead.
- Reaction bubbles render at message bottom with count badges ("👍 2"), small grey font (`text-xs`) per spec §XIII "Reaction: bubble 底部贴一行,数字小号灰字".
- New `📍 Unpin from header` menu has a subtle `animate-menu-pop` (0.18 s ease-out scale-in) — matches existing menu polish in the project.
- R17-1 typing indicator (indigo→purple gradient glyph + halo + shimmer text) consistently renders during bot processing — feels alive.

**Soft observations (not bugs this round)**:
- Pinned chip strip has no transition on chip mount/unmount — a chip just appears or vanishes. Polish suggestion: fade-in / scale-in on mount, fade-out on unmount.
- Reaction bubble click → API call → re-render is sub-second but there's no optimistic-update → the bubble briefly shows old state. Sub-pixel polish.

**This round ran on alternate ports** (hub 3106, web 5273) + isolated `HAPI_HOME=/home/azureuser/.hapi-mine` per memory `e2e_round_port_collision.md`.

Hub test suite still **249 / 249** (existing tests pass; new fixes add behavior not directly testable without DOM/integration; covered by this E2E round instead).
