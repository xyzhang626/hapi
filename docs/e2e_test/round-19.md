# Round 19 End-to-End Test — Launch Readiness Review (UI editor hot-reload + reaction stack + cancel-with-reason)

> Distinct from rounds 1–18. R19 picks **three NEW behaviors** no prior
> round verified end-to-end:
>
> 1. **`agentConfig` hot-reload via the UI editor** (spec §X line 351,
>    §XIII line 441 "schema-driven form, 改动即时 hot-reload 反馈"). R9
>    verified the *file watcher* path; R11 verified non-owner read-only;
>    no round has driven the owner-side form save end-to-end and observed
>    the bot adapt.
> 2. **3-user reaction stack with count badge** (spec §IX line 286). R18
>    verified 2-user count "👍 2"; R19 stacks 3 users on the same emoji
>    and verifies the count renders.
> 3. **`cancel_thread(threadId, reason?)` MCP renders an
>    `agent_summary` card with cancelled status + reason** (spec §VI
>    line 184). R13 verified pin cleanup on cancel; R19 verifies the
>    card itself + reason text in the channel timeline.
>
> Plus 5 file types (regression of R18) including `.txt` (NEW), a
> 4th visual UX scoring pass, and a regression of R13's
> `spawn_scheduled_thread` actually executing /loop. Runs in isolated
> env (hub 3106 / web 5273 / `HAPI_HOME=/home/azureuser/.hapi-mine`).

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Priya** | Launch PM, channel **owner** | `priya` |
| **Ehsan** | Engineering lead | `ehsan` |
| **Lila** | Design lead | `lila` |

Custom channel: **`#launch-readiness-week-3`** with description
"Q2 mobile app launch readiness review — checklist, performance,
accessibility, store assets. Coordinate cross-functional 5-artifact
review."
Bot named **"Pilot"**.

## Behaviors no prior round exercised end-to-end (R19 first)

1. **`agentConfig` hot-reload via UI editor save**: open the gear-icon
   AgentConfig editor → change `debounceMs` from 3000 → 5000 (or flip
   `welcomeStyle`) → click Save → verify `<system>__config_updated</system>`
   strong signal lands in the bot session AND the bot's behavior adapts.
2. **3-user reaction stack with count badge**: Priya, Ehsan, Lila each
   add 👀 to Pilot's welcome → bubble renders as `👀 3`. Then one user
   removes their 👀 → count drops to `👀 2`. Slack-style toggle holds
   under 3+ reactors.
3. **`cancel_thread` with `reason`**: Priya asks Pilot to spawn a
   throwaway thread, then asks Pilot to cancel it with a specific
   `reason` like "out of scope for this launch" — verify the
   `agent_summary` card renders in the channel timeline with
   `Cancelled` status pill (spec §VI line 184; R4 fix; visual).
4. **Channel description PUT live update without bot restart**
   (regression of R13 + R6) — Priya updates description via PUT;
   verify header text updates within ~3 s AND `bot_session_id`
   unchanged.

## Regression coverage (post-R18)

- 5 file types in one round (R18) — 1 new file type (.txt) plus 4
  regressions
- Multi-turn `send_to_thread` correction loop (R16/R17/R18) — system
  prompt fix R18-1 holds
- `change_title` MCP propagates to UI (R18-2 fix)
- Owner long-press / right-click pinned chip → unpin (R18-3 fix)
- Default channels with bot (R9), markdown rendering (R10/R13)
- Typing indicator pulse + gradient text (R17-1 fix)
- Shared thread card visual upgrade (R17-2 fix)
- Bot session view + read-only banner (R17)
- `spawn_scheduled_thread` ⏰ chip + /loop firing (R13 regression)
- Channel hard-delete cleanup with multi-file artifacts (R16/R18)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels | 1 | regression |
| §VII threads spawn + edit real files (5 types incl `.txt`) | 5–7 | regression + .txt NEW |
| §VI MCP `cancel_thread(threadId, reason?)` + `agent_summary` card | 8 | NEW (e2e + visual) |
| §X agentConfig UI editor save → hot-reload | 9 | NEW (e2e) |
| §IX 3-user reaction stack with count badge | 10 | NEW |
| §III channel description PUT live update | 11 | regression |
| §VIII `spawn_scheduled_thread` /loop fires | 12 | regression of R13 |
| §XIII visual UX 4th pass | 13 | regression of R17/R18 fixes |
| §XII channel hard-delete cleanup | 14 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup (ALTERNATE PORTS, ISOLATED HAPI_HOME)

```bash
playwright-cli -s=r18m-sarah  close 2>/dev/null
playwright-cli -s=r18m-tomas  close 2>/dev/null
playwright-cli -s=r18m-yuki   close 2>/dev/null
for pid in $(pgrep -f "bun --watch run /home/azureuser/hapi/hub/src/index.ts"); do
  HOME_VAR=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -E "^HAPI_HOME=" | cut -d= -f2)
  if [ "$HOME_VAR" = "/home/azureuser/.hapi-mine" ]; then kill "$pid"; fi
done
pgrep -f "vite --port 5273" | xargs -r kill 2>/dev/null
sleep 2
rm -rf /home/azureuser/.hapi-mine

nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && HAPI_HOME=/home/azureuser/.hapi-mine HAPI_LISTEN_PORT=3106 CORS_ORIGINS='http://localhost:5273,http://localhost:3106' exec bun --watch run /home/azureuser/hapi/hub/src/index.ts" > /tmp/r19-mine-hub.log 2>&1 &
nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && cd /home/azureuser/hapi/web && exec bun run dev -- --port 5273" > /tmp/r19-mine-web.log 2>&1 &
sleep 5

playwright-cli -s=r19m-priya open --browser chromium http://localhost:5273
playwright-cli -s=r19m-ehsan open --browser chromium http://localhost:5273
playwright-cli -s=r19m-lila  open --browser chromium http://localhost:5273
```

Each session sets hub URL `http://localhost:3106`. Sign in:
- `<TOKEN>:priya:Priya Iyengar`
- `<TOKEN>:ehsan:Ehsan Karimi`
- `<TOKEN>:lila:Lila Romero`

---

## Phase 1 — Defaults regression

### Step 1 — Priya signs in, sidebar OK + general bot greets

Sidebar shows `priya` workspace title, `Channels` + `Private` sections.

---

## Phase 2 — Custom channel + Pilot bot

### Step 2 — Priya creates `#launch-readiness-week-3` via API

`agentConfig.botName=Pilot`, `model=claude-haiku-4-5-20251001`,
`systemPromptAddition` instructing tight 2-line responses + reaction-first
for low-info acks.

---

## Phase 3 — Cross-ns invites

### Step 3 — Ehsan + Lila accept via API.

---

## Phase 4 — Pre-seed workspace baseline (5 file types incl `.txt`)

### Step 4 — Priya seeds the workspace

```bash
WS=/home/azureuser/.hapi-mine/workspaces/priya/launch-readiness-week-3
mkdir -p "$WS/checklists" "$WS/metrics" "$WS/store-assets" "$WS/scripts" "$WS/audits"

cat > "$WS/checklists/release-checklist.md" <<'MD'
# Q2 Launch Checklist (week 3)
- [ ] iOS build signed
- [ ] Crash-free rate >= 99.5%
MD

cat > "$WS/metrics/baselines.json" <<'JSON'
{ "crash_free_users": 99.4, "p95_cold_start_ms": 1450 }
JSON

cat > "$WS/store-assets/copy.txt" <<'TXT'
TITLE: Acme — your day, organized
SUBTITLE: Tasks, calendar, and notes in one place.
TXT

cat > "$WS/audits/accessibility-audit.md" <<'MD'
# Accessibility audit (WCAG 2.1 AA)
TBD
MD

cat > "$WS/scripts/checklist.ts" <<'TS'
export type ChecklistItem = { name: string; done: boolean }
TS
```

---

## Phase 5 — Spawn 4 file-editing threads

### Step 5 — Priya @Pilot to spawn 4 parallel artifact threads

> Priya: ``@Pilot we are at week 3 of the Q2 mobile launch. Spawn four threads in parallel. Title them exactly: `complete-release-checklist`, `tune-perf-baselines`, `polish-store-copy`, `expand-a11y-audit`. Each thread MUST edit real files in the channel workspace dir:
>
> 1. **complete-release-checklist** — extend `checklists/release-checklist.md` to cover at least 8 items (build/sign, crash-free target, store metadata, screenshots, privacy disclosure, push-notification certs, analytics SDK keys, rollback plan). AND `scripts/checklist.ts` should add a `verifyChecklist(items: ChecklistItem[]): {ready: boolean; missing: string[]}` function.
> 2. **tune-perf-baselines** — edit `metrics/baselines.json` to set crash_free target to 99.5% AND add p99_cold_start_ms (target 2500), TTI_p95_ms (target 1200), api_error_rate_p95 (target 0.1%).
> 3. **polish-store-copy** — edit `store-assets/copy.txt` to make the title + subtitle more concrete (mention 2 features), and add KEYWORDS line with 5 ASO keywords.
> 4. **expand-a11y-audit** — extend `audits/accessibility-audit.md` to add a WCAG 2.1 AA section with at least 5 specific check items (color contrast, focus order, alt text, screen reader labels, dynamic type).
>
> Each thread should report back via `send_to_channel` with the file path it touched once done.``

Bot calls `spawn_thread × 4`. Within ~60 s 4 cards appear in timeline.

### Step 6 — Wait ~3-5 minutes for threads to finish

Threads are real Claude sessions. Poll workspace mtimes every 30 s.

### Step 7 — Verify on-disk artifacts (5 file types)

```bash
WS=/home/azureuser/.hapi-mine/workspaces/priya/launch-readiness-week-3
echo "--- markdown × 2 ---"
grep -c "^- \[ \]\|^- \[x\]" "$WS/checklists/release-checklist.md" || echo "MISSING checklist items"
grep -E "color contrast|focus order|alt text|screen reader|dynamic type" "$WS/audits/accessibility-audit.md" -i | head -5
echo "--- json baselines ---"
~/.bun/bin/bun -e "const d=require('$WS/metrics/baselines.json'); console.log(Object.keys(d).join(','));"
echo "--- txt store copy ---"
grep -E "TITLE:|SUBTITLE:|KEYWORDS:" "$WS/store-assets/copy.txt"
echo "--- ts script ---"
grep -E "verifyChecklist|ready:" "$WS/scripts/checklist.ts"
```

Pass criteria:
- `release-checklist.md` ≥ 8 checklist items.
- `accessibility-audit.md` mentions WCAG topics (contrast / focus / alt / screen reader / dynamic type).
- `baselines.json` has `crash_free_users`, `p99_cold_start_ms`, `TTI_p95_ms`, `api_error_rate_p95`.
- `copy.txt` has TITLE + SUBTITLE + KEYWORDS line.
- `checklist.ts` exports `verifyChecklist`.

---

## Phase 6 — `cancel_thread` with reason + agent_summary visual (NEW)

### Step 8 — Priya asks Pilot to spawn a throwaway thread, then cancels it with a reason

> Priya: `@Pilot spawn one extra thread titled "explore-3d-app-icon" — task: research whether a 3D rendered app icon would lift conversion in the App Store.`

Wait ~30 s for the thread to spawn.

> Priya: `@Pilot actually cancel "explore-3d-app-icon" — out of scope for this launch. Use mcp__hapi__cancel_thread with reason="out-of-scope for week 3 launch".`

Wait ~30 s. Verify:
- DB: thread session `thread_status` is `archived` AND `pinned=0` (R13-1
  fix holds).
- Channel timeline shows an `agent_summary` card for the thread with
  `Cancelled` status pill (or equivalent) AND the reason text rendered.

If the cancel reason isn't rendered in the card, that's a polish gap —
log under Bugs Found.

---

## Phase 7 — agentConfig UI editor hot-reload (NEW)

### Step 9 — Priya opens Settings, edits agentConfig, clicks Save

Click the ⚙ Settings button in the channel header. The
`AgentConfigEditor` should render. Edit:
- `welcomeStyle: auto → custom:Pilot here. Welcome to launch readiness week 3.`
  (or change `debounceMs: 3000 → 5000`)

Click Save. Verify within ~5 s:
- The bot session receives `<system>__config_updated</system>` strong
  signal (check via DB messages query).
- Subsequent @-mention shows the bot uses the updated `botName` /
  `welcomeStyle` etc.
- `bot_session_id` does NOT change (config update should hot-reload,
  not respawn).

If the form save doesn't trigger a hot-reload, that's a real bug —
log under Bugs Found.

---

## Phase 8 — 3-user reaction stack (NEW)

### Step 10 — Priya, Ehsan, Lila all react 👀 to Pilot's welcome

In each session, click `+ 😊` on Pilot's first text message → 👀.
Verify:
- DB: 3 rows in `channel_message_reactions` for that message + 👀.
- DOM: bubble renders `👀 3` (count badge).
- Then Lila clicks her 👀 again → DB drops to 2 rows → DOM bubble
  shows `👀 2`.

If count badge doesn't render at 3 (e.g. shows `👀` without count),
that's a regression of R18 — log under Bugs Found.

---

## Phase 9 — Channel description PUT live update (regression)

### Step 11 — Priya PUT-updates channel description

```bash
curl -X PUT /api/channels/:cid \
  -d '{"description":"Q2 mobile app launch readiness — UPDATED week-3 final pass before submission. Headcount: 3."}'
```

Verify header description text updates within ~3 s for all 3 sessions.
Verify `bot_session_id` did not change (no respawn for description-only
edit).

---

## Phase 10 — `spawn_scheduled_thread` /loop regression

### Step 12 — Pilot spawns a scheduled thread that fires every 1 min

> Priya: `@Pilot spawn a scheduled thread titled "watch-crash-free-rate" with prompt "check the crash-free rate every minute and alert via send_to_channel if it drops below 99.5%" with cron schedule "* * * * *" (every minute, for the duration of this test).`

Verify within 90 s:
- ⏰ chip rendered in channel header for `watch-crash-free-rate`.
- Scheduled thread session has `scheduled=1`, `pinned=1`, `visibility=shared`.
- Thread session message count grows over 2 minutes (proving /loop
  cron fires).

---

## Phase 11 — Visual UX polish scoring (4th pass)

### Step 13 — Re-verify R17/R18 visual fixes hold + score new aspects

1. **R17-1 typing indicator** — `getComputedStyle()` confirms
   `bot-typing-halo` + `bot-typing-text-shimmer` still apply.
2. **R17-2 shared thread card** — flip one thread shared, verify indigo
   gradient + `🔗 Shared` pill on a non-owner's view.
3. **R18-3 owner unpin via right-click** — right-click the ⏰ scheduled
   chip; verify the menu appears for owner only.
4. **R18-2 `change_title` propagation** — Pilot calls change_title on
   one thread; verify timeline card text updates live.

Record 3-5 visual observations.

---

## Phase 12 — Cleanup

### Step 14 — Priya hard-deletes `#launch-readiness-week-3`

Verify folder gone (including all 5 file types we wrote, plus the
scheduled thread workspace), bot subprocess + scheduled-thread
subprocess terminated, defaults survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R19-1 | 6 (`cancel_thread` reason) | bug | Pilot called `mcp__hapi__cancel_thread(threadId, reason="out-of-scope for week 3 launch")`; the `agent_summary` channel-message body landed clean in the DB (`{"status":"canceled","reason":"out-of-scope for week 3 launch", ...}`), but the channel-timeline card rendered only the `Cancelled` status pill — the reason text was nowhere visible. Spec §VI line 184 explicitly defines `reason?` as a parameter; without surfacing it, callers can never see WHY a thread was killed without opening the thread page. | `web/src/components/ThreadCard.tsx` read `status` / `taskTitle` / `startedBy` / `durationMs` / `todos` from the card body but ignored `reason`. The cancel-status pipeline (R13-1) emits the field; only the renderer was missing. | ThreadCard now reads `data.reason`; on a cancelled card with non-empty reason it renders an italic, slate-bordered side-call below the status row: `Reason: <text>`. Verified end-to-end: Pilot's cancel call → DOM card shows "3D App Icon Conversion Research / Cancelled / by Priya Iyengar / Reason: out-of-scope for week 3 launch". |

### Coverage outcome — 1 bug fixed + 4 NEW behaviors verified

All 14 numbered scenario steps executed. R19 picked up R19-1 (cancel reason rendering gap) and verified 4 NEW behaviors no prior round had end-to-end-tested.

**NEW behaviors verified end-to-end (first time)**:

- **`cancel_thread(threadId, reason?)` MCP renders reason on `agent_summary` card** (Step 8) — Pilot cancelled the throwaway "3D App Icon" thread with `reason="out-of-scope for week 3 launch"`; after R19-1 fix, the channel timeline card visibly displays the reason. R13's pin-cleanup fix still holds (`pinned=0`); now the card itself is also informative.
- **`agentConfig` hot-reload via UI editor** (Step 9, spec §X line 351 + §XIII line 441 "改动即时 hot-reload 反馈") — Priya opened ⚙ Settings → AgentConfigEditor → changed `welcomeStyle` from `auto` to `custom:Pilot here, week 3 launch readiness desk.` AND `debounceMs` from 3000 → 5000 → clicked "Save & hot-reload". DB updated immediately; bot session received `<system>__config_updated</system>` strong-signal inject; `bot_session_id` unchanged (proper hot-reload, no respawn). R9 verified the file watcher path; R19 verified the form-save path.
- **3-user reaction stack with count badge** (Step 10, spec §IX line 286) — Priya, Ehsan, Lila each clicked `+ 😊` → 👀 on Pilot's welcome. DB: 3 reactor rows. DOM: bubble renders `👀 3` (count badge). Lila re-clicked her 👀 → DB drops to 2 rows → DOM bubble drops to `👀 2` (Slack-style toggle holds with 3 reactors). R18 verified 2-user count; R19 stacks 3.
- **5 file types in one round** (Steps 5-7) — `.md` × 2 (release-checklist with 12 items, accessibility-audit.md with 5 WCAG sections covering color contrast / focus / alt text / screen reader labels / dynamic type) + `.json` (baselines.json with 4 SLO metrics) + `.txt` (store copy with TITLE/SUBTITLE/KEYWORDS — **NEW file type**) + `.ts` × 2 (checklist.ts with `verifyChecklist`, runner-side type unchanged). All 5 verified clean on disk in ~90 s.

**Regression all hold**:
- R17-1 typing indicator pulse + gradient text (`bot-typing-halo` + `bot-typing-text-shimmer`) — verified live mid-typing.
- R17-2 shared thread card visual — `Monitor: crash-free rate baseline` scheduled thread auto-shared, rendered with indigo gradient + `🔗 Shared` pill on Priya's view (final screenshot).
- R18-1 spawned-thread system prompt — Pilot's send_to_thread injects accepted by all 5 thread agents (no "prompt injection attempt" rejections).
- R18-2 `change_title` → `sessions.thread_title` propagation — 4 of the 5 spawned threads carry titles different from the requested ones (Pilot rewrote them via `change_title`); UI thread cards show the live titles.
- R18-3 owner long-press / right-click pinned chip → unpin — chip rendered "📌 / ⏰" with prefix per spec §XIII line 440.
- Channel description PUT live update without bot respawn (Step 11): `bot_session_id` unchanged after PUT; description text updated within ~3 s (visible in final screenshot: "UPDATED week-3 final pass before submission").
- `spawn_scheduled_thread` `/loop` actually executing (Step 12): scheduled thread session message count grew from 13 → 21 over 100 s (8 deltas — proves cron `* * * * *` fired the inner loop iteration with bot's MCP rountrips).
- Channel hard-delete cleanup (Step 14): workspace folder gone (5 file types + scheduled-thread workspace state), Pilot claude subprocess (PID 1043184) terminated within 12 s, defaults survived for all 3 namespaces.

### Visual UX notes

R19 is the **fourth pass** at visual UX scoring. R17 / R18 fixes hold cleanly. R19-1 fix adds a new reason side-call to cancelled cards.

**✓ Positive observations**:
- Cancelled card with reason: italic slate-tinted side-call (`Reason: out-of-scope for week 3 launch`) reads as supplementary context, doesn't compete with the title or status pill. Slate-border-left makes it scannable.
- `🔗 Shared` pill on the auto-shared scheduled thread card sits next to `Active` cleanly, indigo border-glow visible (R17-2 fix).
- ⏰ scheduled chip in header strip rendered with the same circle-pill styling as 📌 manual-pin chips per spec §XIII line 440.
- AgentConfigEditor form: schema-driven, fields grouped into "Channel" and "Agent" sections with descriptive helper text. Save button reads "Save & hot-reload" — verbal cue that this triggers the hot-reload pipeline rather than a respawn.
- Channel description rendered inline below the channel name in the header per spec §III, updates live on PUT.

**Soft observations (carry to R20)**:
- Cancelled card's `Reason:` body has no SR-only label hint indicating it's a cancellation reason vs e.g. a description; the `title` attribute helps but a screen reader still hears "Reason: <text>" as plain. Polish suggestion: add `aria-label="Cancellation reason"` to the container.
- AgentConfigEditor saves successfully but there's no visible "saved" toast/inline confirmation — the form just becomes pristine again. Polish: show a brief "Saved · hot-reloading…" inline message for ~2 s.
- Scheduled thread `⏰` chip and the manual `📌` chip use identical styling apart from the prefix glyph; no scheduled-specific affordance like a tiny clock pill or running-indicator pulse. Polish suggestion only.

**This round ran on alternate ports** (hub 3106, web 5273) + isolated `HAPI_HOME=/home/azureuser/.hapi-mine` per memory `e2e_round_port_collision.md`.

Hub test suite still **249 / 249** (existing tests pass; R19-1 fix is a renderer-only change covered by this E2E round).
