# Round 17 End-to-End Test — API v2 Orders Redesign

> Distinct from rounds 1–16. R17 picks two NEW behaviors no prior round
> verified end-to-end, plus regression of R16's multi-file long-range
> pattern, plus a **second pass** at visual UX scoring (per memory
> `e2e_rounds_visual_ux_polish.md`: escalate to real bug if same gap
> appears in 2+ rounds — R16 saw `animate-*` count = 0). Runs in
> isolated env (hub 3106 / web 5273 / `HAPI_HOME=/home/azureuser/.hapi-mine`).

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Mira** | Backend Tech Lead, channel **owner** | `mira` |
| **Felix** | Mobile platform lead | `felix` |
| **Suki** | API contract reviewer | `suki` |

Custom channel: **`#api-v2-orders-redesign`** with description
"Q2 v2 Orders endpoint redesign — pagination, filtering, status enum,
error envelope. Coordinate YAML spec + handler + tests + changelog."
Bot named **"Gateway"**.

## Behaviors no prior round exercised end-to-end (R17 first)

1. **`Bot session →` link click + read-only banner verification**
   (spec §IV) — never explicitly clicked from UI in any round; verify
   the link in channel header, the read-only banner ("View only —
   interact in #channel"), and that the input is disabled / hidden.
2. **Thread `Share to channel` toggle** (spec §VII Share 升级路径) —
   never end-to-end tested. Verify creator-only visibility of the
   toggle, that flipping private → shared upgrades the channel
   timeline card from minimal `⏳ Active` to detailed action text,
   and that the sidebar entry appears for OTHER channel members
   (was hidden before).
3. **`change_title` MCP from inside a thread session** updates the
   thread title in real time in the pinned chip strip + timeline card.

## Regression coverage (post-R16)

- Multi-file artifact edits across 3 parallel threads (R16) — yaml +
  ts + test.ts + md this round (4 types vs R16's 3)
- Multi-turn `send_to_thread` correction loop (R16)
- Default channels with bot (R9)
- Markdown rendering (R10/R13)
- Channel hard-delete cleanup with multi-file artifacts (R16)
- Typing indicator uses `agentConfig.botName` (R14-1)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels | 1 | regression |
| §VII threads spawn + edit real files | 5–7 | regression (4 file types) |
| §VI MCP `send_to_thread` correction loop | 8 | regression |
| §IV bot session view + read-only banner | 9 | NEW |
| §VII Share to channel toggle | 10 | NEW |
| §III + §XIII visual UX (`animate-*` re-check) | 11 | NEW (2nd pass — escalate if persistent) |
| §XII channel hard-delete cleanup | 12 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup (ALTERNATE PORTS, ISOLATED HAPI_HOME)

```bash
# v2 worktree at /home/azureuser/hapi-worktrees-codex-debug-v2/ owns
# 3006/5173. Use 3106/5273 + ~/.hapi-mine. Surgical kill.
playwright-cli -s=r16m-saoirse close 2>/dev/null
playwright-cli -s=r16m-hiro    close 2>/dev/null
playwright-cli -s=r16m-beni    close 2>/dev/null
for pid in $(pgrep -f "bun --watch run /home/azureuser/hapi/hub/src/index.ts"); do
  HOME_VAR=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -E "^HAPI_HOME=" | cut -d= -f2)
  if [ "$HOME_VAR" = "/home/azureuser/.hapi-mine" ]; then kill "$pid"; fi
done
pgrep -f "vite --port 5273" | xargs -r kill 2>/dev/null
sleep 2
rm -rf /home/azureuser/.hapi-mine

nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && HAPI_HOME=/home/azureuser/.hapi-mine HAPI_LISTEN_PORT=3106 CORS_ORIGINS='http://localhost:5273,http://localhost:3106' exec bun --watch run /home/azureuser/hapi/hub/src/index.ts" > /tmp/r17-mine-hub.log 2>&1 &
nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && cd /home/azureuser/hapi/web && exec bun run dev -- --port 5273" > /tmp/r17-mine-web.log 2>&1 &
sleep 5

playwright-cli -s=r17m-mira  open --browser chromium http://localhost:5273
playwright-cli -s=r17m-felix open --browser chromium http://localhost:5273
playwright-cli -s=r17m-suki  open --browser chromium http://localhost:5273
```

Each session sets hub URL `http://localhost:3106`. Sign in:
- `<TOKEN>:mira:Mira Halvorsen`
- `<TOKEN>:felix:Felix Okafor`
- `<TOKEN>:suki:Suki Tanabe`

---

## Phase 1 — Defaults regression

### Step 1 — Mira signs in, sidebar OK + general bot greets

Sidebar shows `mira` workspace title, `Channels` + `Private` sections,
default channels with bot.

---

## Phase 2 — Custom channel + Gateway

### Step 2 — Mira creates `#api-v2-orders-redesign` via API

`agentConfig.botName=Gateway`, `model=claude-haiku-4-5-20251001`,
`systemPromptAddition` instructing thread-per-artifact + tight responses
+ explicit per-thread file-edit instructions.

---

## Phase 3 — Cross-ns invites

### Step 3 — Felix + Suki join

Standard invite flow.

---

## Phase 4 — Pre-seed workspace baseline

### Step 4 — Mira seeds the workspace

```bash
WS=/home/azureuser/.hapi-mine/workspaces/mira/api-v2-orders-redesign
mkdir -p "$WS/api" "$WS/src/api" "$WS/__tests__"

cat > "$WS/api/openapi.yaml" <<'YAML'
openapi: 3.0.0
info:
  title: Acme Orders API
  version: 1.0.0
paths:
  /orders:
    get:
      summary: List orders
      responses:
        '200':
          description: OK
YAML

cat > "$WS/src/api/orders.ts" <<'TS'
import type { Request, Response } from 'express'

export async function listOrders(req: Request, res: Response) {
  res.json([])
}
TS

cat > "$WS/CHANGELOG.md" <<'MD'
# Changelog

## v1.0.0
- Initial Orders endpoint (list only).
MD
```

---

## Phase 5 — Spawn 3 file-editing threads (multi-file long-range)

### Step 5 — Mira @Gateway to spawn 3 parallel artifact threads

> Mira: ``@Gateway we are upgrading Orders to v2 with pagination, filtering by status, and a structured error envelope. Spawn three threads in parallel. Title them exactly: `define-orders-v2-yaml`, `implement-orders-v2-handler`, `update-changelog`. Each thread MUST edit real files in the channel workspace dir:
>
> 1. **define-orders-v2-yaml** — extend `api/openapi.yaml` to add `/v2/orders` GET (with `page`, `pageSize`, `status` query params; pagination response `{items, total, page, pageSize}`; status enum `pending|paid|shipped|cancelled`; error envelope schema `{error: {code, message}}`).
> 2. **implement-orders-v2-handler** — modify `src/api/orders.ts` to add `listOrdersV2` matching the YAML, AND write `src/api/orders.test.ts` with at least 2 test cases (happy path + invalid status returns 400 with error envelope).
> 3. **update-changelog** — edit `CHANGELOG.md` to add a `## v2.0.0` section listing the new endpoint + breaking-change note.
>
> Each thread should report back via `send_to_channel` with the file path it touched once done.``

Bot calls `spawn_thread × 3`. Within ~60s 3 cards appear in timeline.

### Step 6 — Wait ~3-5 minutes for threads to actually run

Threads are real Claude Haiku sessions doing file ops. Poll the
workspace every 30s for signs of progress (file mtimes / sizes).
Don't short-circuit.

### Step 7 — Verify on-disk artifacts (NEW: 4 file types)

```bash
WS=/home/azureuser/.hapi-mine/workspaces/mira/api-v2-orders-redesign
echo "--- openapi.yaml ---"
grep -E "/v2/orders|page|status|error" "$WS/api/openapi.yaml" | head -20
echo "--- orders.ts ---"
grep -E "listOrdersV2|page|pageSize|status" "$WS/src/api/orders.ts" | head -10
echo "--- orders.test.ts ---"
test -f "$WS/src/api/orders.test.ts" && grep -cE "test\(|it\(|describe\(" "$WS/src/api/orders.test.ts" || echo "MISSING"
echo "--- CHANGELOG.md ---"
grep -E "v2\.0\.0|Orders v2|breaking" "$WS/CHANGELOG.md" -i | head -5
```

Pass criteria:
- `api/openapi.yaml` mentions `/v2/orders` + pagination + status enum + error envelope.
- `src/api/orders.ts` exports `listOrdersV2` and references `page` / `pageSize` / `status`.
- `src/api/orders.test.ts` exists with ≥2 test blocks.
- `CHANGELOG.md` has v2 section with breaking-change note.

If any of the 4 fails, that's a real test failure (not a HAPI bug,
but a scenario gap). Log under "Soft observations".

---

## Phase 6 — Multi-turn correction loop (regression of R16)

### Step 8 — Gateway injects correction into define-orders-v2-yaml via send_to_thread

> Mira: `@Gateway please send_to_thread on define-orders-v2-yaml with text: "Correction — the status enum should also include 'returned'. Please add it to the YAML and report back when done."`

Bot calls `mcp__hapi__send_to_thread` with the corrected directive.
Wait ~90s for the thread agent to re-edit the YAML.

Verify on disk:

```bash
grep -E "returned" "$WS/api/openapi.yaml"
```

---

## Phase 7 — Bot session view + read-only banner (NEW)

### Step 9 — Mira clicks `Bot session →` link in channel header

From the channel header, click the bot session button. Should land on
`/sessions/<botSessionId>` route. Verify:
- Read-only banner is rendered: `View only — interact in #api-v2-orders-redesign`
  (or equivalent text per spec §IV "View only — interact in channel").
- Input is hidden or disabled (no typing into bot session).
- Transcript shows full bot reasoning (system prompt + user injects +
  assistant + tool calls + tool results — entire LLM transcript).
- Back-arrow / link navigates back to the channel.
- Verify Felix (non-owner) ALSO has access (channel members all
  read-only access per spec §IV).

If the link is missing OR the banner isn't rendered OR the input is
editable, that's a real bug — log under Bugs Found.

---

## Phase 8 — Thread Share to channel toggle (NEW)

### Step 10 — Mira opens her own private thread; clicks "Share to channel"

Pick `define-orders-v2-yaml` (private by default). Open it via the
channel timeline card. Verify (creator view):
- "Share to channel" toggle / button is visible to Mira (creator).
- Click → confirm visibility flips from `private` → `shared`.

Verify post-flip:
- Channel timeline thread card upgrades from minimal (`⏳ Active` /
  `✓ Done`) to detailed action display (per spec §VII "Card 升级显示
  详细 action").
- The sidebar entry "Active threads" lights up for **Felix** (other
  channel member who couldn't see it before private→shared).
- No timeline announcement message gets posted (per spec §VII "**不**
  发广播消息 — 避免噪音").
- Toggle can be flipped BACK (private). Verify card reverts.

If the toggle is missing or the visibility doesn't propagate via SSE,
that's a real bug.

---

## Phase 9 — Visual UX polish scoring (2nd pass — escalate if persistent)

### Step 11 — Score §XIII expectations across the run

Take screenshots / DOM evals at four moments + record observations:

1. **Mid-bot-typing during Step 5** — capture the `✨ Gateway is thinking…`
   indicator. **`getComputedStyle()` check `animation` field for `pulse`**.
   If the typing indicator does NOT have `animation: ...pulse...` (R16
   showed 0 `animate-*` classes anywhere), this is the SECOND round
   the gap appears → **promote to bug fix this round**:
   add `animate-pulse` (or equivalent CSS keyframe) to the typing
   indicator container per spec §XIII "脉动光晕".

2. **Thread cards visible** — bot avatar `borderRadius` ≈ 6px (square),
   user avatar ≈ 999px (round) — should still hold from R16.

3. **Hover affordances** — hover thread card; verify `+ 😊` reveal +
   any opacity/transform transition.

4. **Bot session page** — verify "View only" banner styling looks
   intentional (not jarring), input hidden cleanly.

Record 3-5 visual observations: positive ("✓ thread cards have a
clear gradient"), negative ("✗ no transition on dialog mount —
pops in"), or polish-suggestion ("could add subtle scale-in on
new message").

---

## Phase 10 — Cleanup

### Step 12 — Mira hard-deletes `#api-v2-orders-redesign`

Verify folder gone (including all 4 file types we wrote), no orphan
claude subprocs, defaults survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R17-1 | 9 (visual UX) | annoyance | The bot typing indicator (`✨ <name> is thinking…`) has no visible "脉动光晕" pulse animation. Only a 1.5×1.5 px dot has `animate-pulse` — far too small to see. Spec §XIII calls for "渐变文字 + 脉动光晕" (gradient text + pulsing halo). R16 already noted this as a soft observation; R17 is the second consecutive round (per memory `e2e_rounds_visual_ux_polish.md`, this graduates to a real bug). | `web/src/components/ChannelView.tsx:240` rendered `<span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse">` — invisible animation surface. | Replace with a properly visible pulsing glyph + gradient-text band: new keyframes `bot-typing-halo` (1.6 s box-shadow halo expansion) and `bot-typing-text-shimmer` (2.4 s background-position scroll over an indigo↔purple gradient with `-webkit-background-clip: text`). New CSS classes `.bot-typing-glyph` (17.6 px circle with indigo→purple gradient, halo animation) and `.bot-typing-text` (transparent text rendered through the shimmer gradient). DOM verified: `getComputedStyle(.bot-typing-glyph).animationName === "bot-typing-halo"` + `.bot-typing-text` shows shimmer with 5-stop gradient. |
| R17-2 | 10 (Share to channel) | bug | After flipping a thread's visibility from `private` → `shared` via the thread-page More-Actions menu, the channel-timeline thread card shows no visual change. Spec §VII Share 升级路径: "Card 升级显示详细 action" (card upgrades to detailed display). Other channel members can't tell from the timeline that the thread became shared — they have to open it to find out. | `ChannelView` rendered each `thread_card` from the static `body` JSON captured at insertion time, so the live `session.visibility` was never reflected. `ThreadCard` itself was visibility-blind. | (a) `ChannelView` now resolves the live session via `threadId`, merges `visibility` (and live `threadTitle`, in case the thread agent calls `change_title`) into the enriched card data. (b) `ThreadCard` now renders a distinct visual treatment when `data.visibility === 'shared'`: indigo border (`#6366f1`), indigo halo (`box-shadow: 0 0 0 1px rgba(99,102,241,0.25)`), gradient bg (`linear-gradient(135deg, indigo-tinted, secondary-bg)`), and a `🔗 Shared` pill alongside the status pill. Verified end-to-end: Mira flipped private→shared via More Actions, Felix's view immediately upgraded the card; toggle back to private reverts cleanly. |

### Coverage outcome — 2 bugs fixed + 4 NEW behaviors verified

All 12 numbered scenario steps executed. R17 picked up 2 real bugs that R1–R16 missed: (1) the typing-indicator visual gap escalated from R16's soft observation per memory rule, (2) the Share-to-channel toggle had no visual effect on the channel-timeline card.

**NEW behaviors verified end-to-end (first time)**:

- **Bot session view + read-only banner** (Step 9) — clicked the `✨ Bot session →` link in channel header, landed on `/sessions/<botSessionId>`, saw the `👁️ View only — This is the channel bot's internal transcript. Interact with it from the channel.` banner + `← Back to channel` button. `document.querySelectorAll('input, textarea').length === 0` confirms the input is hidden (not just disabled). Verified for BOTH Mira (owner) and Felix (non-owner) per spec §IV "所有 channel 成员均可只读查看".
- **Share to channel toggle, both directions** (Step 10) — opened `define-orders-v2-yaml` thread → More Actions → `🔒 Share to channel` flipped session.visibility from `private` → `shared`; menu label live-rebuilt to `👁 Unshare from channel (back to private)`; clicked again → reverted to `private`. Felix's channel timeline card visibility-upgraded/downgraded in real time without page refresh (SSE-driven).
- **Multi-file artifact edits across 4 file types** (Steps 5–7, regression of R16 + 1 type more) — `api/openapi.yaml` (yaml), `src/api/orders.ts` (ts), `src/api/orders.test.ts` (test.ts NEW), `CHANGELOG.md` (md). All four populated by their respective threads in ~2 min. YAML grew from 175 → 2306 bytes with `/v2/orders` GET, paginated `OrderPage`, status enum `pending|paid|shipped|cancelled|returned`, structured `Error` envelope. `orders.ts` exports `listOrdersV2` with full param validation + 400 error envelope return. `orders.test.ts` has 2 jest-style test cases (happy path + invalid status). `CHANGELOG.md` has v2.0.0 section with breaking-change note.
- **Multi-turn `send_to_thread` correction loop** (Step 8, regression of R16) — Mira asked Gateway to inject "add `returned` to the status enum" via `mcp__hapi__send_to_thread`. Within ~30 s the YAML was re-edited in BOTH places (query parameter enum + Order schema enum) AND the thread reported back via `send_to_channel` ("Added `returned` as a fifth value to the status enum in both the `/v2/orders` query parameter and the `Order` schema in `api/openapi.yaml`").

**Regression all hold**:
- Default channels with bot (R9), sidebar split, hard-delete cleanup (R3 + R14-2 + R16 multi-file), markdown rendering (R10-1), typing indicator now reads `agentConfig.botName` (R14-1) — `Gateway is thinking…` rendered correctly.
- Hard delete clean: workspace folder `mira/api-v2-orders-redesign/` gone, channel row gone from DB, Gateway claude subprocess (PID 855722) terminated by watchdog within ~12 s, defaults survived for all 3 namespaces.

### Visual UX notes

R17 is the **second pass** at visual UX scoring. Per memory `e2e_rounds_visual_ux_polish.md`, persistent gaps from R16 graduate to bug fixes; new gaps stay as soft observations.

**Bugs fixed this round** (visual gap escalations):
- ✓ R17-1 — typing indicator pulse: now indigo→purple 17.6 px glyph with halo box-shadow expansion + 5-stop gradient text shimmer. Verified live with `getComputedStyle()`: `animationName=bot-typing-halo, duration=1.6s, infinite` on glyph; `animationName=bot-typing-text-shimmer, duration=2.4s` on text.
- ✓ R17-2 — shared thread card: indigo gradient bg + `🔗 Shared` pill + indigo halo. Verified Felix's view rendered with `borderColor: rgb(99, 102, 241)`, `boxShadow: rgba(99, 102, 241, 0.25) 0px 0px 0px 1px`, `Shared` pill present in DOM text.

**Soft observations carried from R16 (not yet fixed)**:
- Bot/user avatar visual hierarchy still correct (square gradient vs circle) — clean pass.
- Empty-state UX still solid (R15 work).

**New soft observations (track in R18)**:
- Thread cards still have no hover affordance for "open thread" beyond the cursor change. The `+ 😊` reaction picker reveal-on-hover works, but the card itself doesn't shift/lift on hover. Polish suggestion only.
- Pinned thread chip strip wasn't exercised this round (none of the 3 threads got pinned). Consider an R18 round that pins one to verify the chip rendering.
- Bot session page transcript could use a sticky banner — currently the "👁️ View only" pill sits inline at top, easy to miss after scroll. Polish suggestion.

**This round ran on alternate ports** (hub 3106, web 5273) + isolated `HAPI_HOME=/home/azureuser/.hapi-mine` per memory `e2e_round_port_collision.md` (concurrent test owns 3006/5173).

Hub test suite: **249 / 249** (no new tests this round — fixes are CSS + small JSX prop additions, no behavior testable without DOM rendering).
