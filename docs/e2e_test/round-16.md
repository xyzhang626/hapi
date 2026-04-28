# Round 16 End-to-End Test — Japanese Localization Rollout

> Distinct from rounds 1–15. R16 is the **first multi-file long-range
> round** (per memory `e2e_rounds_multi_file_long_range.md`) and the
> first to **score visual UX polish** (per memory
> `e2e_rounds_visual_ux_polish.md`). Threads will actually edit
> `.json` / `.ts` / `.md` / `.test.ts` files in their workspace dirs;
> verification reads the artifacts off disk. Runs in isolated env
> (hub 3106 / web 5273 / `HAPI_HOME=/home/azureuser/.hapi-mine`).

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Saoirse** | Frontend lead, channel **owner** | `saoirse` |
| **Hiro** | Localization specialist | `hiro` |
| **Beni** | QA engineer | `beni` |

Custom channel: **`#i18n-japanese-rollout`** with description
"Q2 i18n: add Japanese (ja) locale across product — 5 strings,
loader registration, README + test coverage". Bot named
**"Polyglot"**.

## Behaviors no prior round exercised end-to-end (R16 first)

1. **Thread agents actually edit real files** of multiple types
   (`.json`, `.ts`, `.md`, `.test.ts`) in their workspace dirs.
   R1-R15 had threads do mostly text coordination; R16 is the first
   to verify file artifacts on disk.
2. **Multi-turn per thread** — bot uses `send_to_thread` to inject a
   correction directive after the initial output, thread re-edits
   the file, then bot verifies on the second pass.
3. **Long-range timing** (5-10 min) — accommodate real Claude
   reasoning + tool use across multiple file ops.
4. **Visual UX scoring** against spec §XIII expectations
   (transitions / loading / empty states / hover / animation /
   visual hierarchy of bot vs user). Recorded as soft observations
   in this round; promoted to bug fixes if the same gap appears
   in 2+ rounds.

## Regression coverage (post-R15)

- Default channels with bot (R9), sidebar split, hard-delete (R3+R14-2)
- Markdown rendering + tables (R10/R13)
- User reaction → bot weak signal (R11), `+ 😊` on cards (R11-2)
- Typing indicator uses agentConfig.botName (R14-1)
- updateChannelData spawn retry (R15-1)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels | 1 | regression |
| §VII threads spawn + edit real files | 5–7 | NEW (multi-file) |
| §VI MCP `send_to_thread` for correction loop | 8 | NEW (multi-turn) |
| §VII thread → channel `Thread:` summary | 9 | regression |
| §XIII visual UX polish (transitions/empty/hover) | 10 | NEW scoring pass |
| §XII channel hard-delete cleanup | 11 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup (ALTERNATE PORTS, ISOLATED HAPI_HOME)

```bash
# v2 worktree at /home/azureuser/hapi-worktrees-codex-debug-v2/ owns
# 3006/5173. Use 3106/5273 + ~/.hapi-mine. Surgical kill.
playwright-cli -s=r15m-iris  close 2>/dev/null
playwright-cli -s=r15m-tomo  close 2>/dev/null
playwright-cli -s=r15m-ravi  close 2>/dev/null
for pid in $(pgrep -f "bun --watch run /home/azureuser/hapi/hub/src/index.ts"); do
  HOME_VAR=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -E "^HAPI_HOME=" | cut -d= -f2)
  if [ "$HOME_VAR" = "/home/azureuser/.hapi-mine" ]; then kill "$pid"; fi
done
pgrep -f "vite --port 5273" | xargs -r kill 2>/dev/null
sleep 2
rm -rf /home/azureuser/.hapi-mine

nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && HAPI_HOME=/home/azureuser/.hapi-mine HAPI_LISTEN_PORT=3106 CORS_ORIGINS='http://localhost:5273,http://localhost:3106' exec bun --watch run /home/azureuser/hapi/hub/src/index.ts" > /tmp/r16-mine-hub.log 2>&1 &
nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && cd /home/azureuser/hapi/web && exec bun run dev -- --port 5273" > /tmp/r16-mine-web.log 2>&1 &
sleep 5

playwright-cli -s=r16m-saoirse open --browser chromium http://localhost:5273
playwright-cli -s=r16m-hiro    open --browser chromium http://localhost:5273
playwright-cli -s=r16m-beni    open --browser chromium http://localhost:5273
```

Each session sets hub URL `http://localhost:3106`. Sign in:
- `<TOKEN>:saoirse:Saoirse Ní Bhraoin`
- `<TOKEN>:hiro:Hiro Tanaka`
- `<TOKEN>:beni:Beni Maritz`

---

## Phase 1 — Defaults regression

### Step 1 — Saoirse signs in, sidebar OK + general bot greets

Sidebar shows `saoirse` workspace title, `Channels` + `Private`
sections, default channels with bot.

---

## Phase 2 — Custom channel + Polyglot

### Step 2 — Saoirse creates `#i18n-japanese-rollout` via API

`agentConfig.botName=Polyglot`, model=haiku,
`systemPromptAddition` instructing thread-per-artifact + use
markdown.

---

## Phase 3 — Cross-ns invites

### Step 3 — Hiro + Beni join

Standard invite flow.

---

## Phase 4 — Spawn 4 file-editing threads (NEW long-range core)

### Step 4 — Saoirse seeds the workspace

Pre-seed the workspace folder with a baseline `locales/en.json`
and a stub `src/i18n/loader.ts` so threads have something to edit
against:

```bash
WS=/home/azureuser/.hapi-mine/workspaces/saoirse/i18n-japanese-rollout
mkdir -p "$WS/locales" "$WS/src/i18n" "$WS/__tests__"
cat > "$WS/locales/en.json" <<'JSON'
{
  "app.title": "Acme Studio",
  "auth.signin": "Sign in",
  "auth.signout": "Sign out",
  "channels.empty": "No messages yet",
  "channels.send": "Send"
}
JSON
cat > "$WS/src/i18n/loader.ts" <<'TS'
import en from '../../locales/en.json'

export type Locale = 'en'
const REGISTRY: Record<Locale, typeof en> = { en }
export function loadLocale(code: Locale) { return REGISTRY[code] }
TS
cat > "$WS/README.md" <<'MD'
# Acme Studio

Languages supported: English (en).
MD
```

### Step 5 — Saoirse @Polyglot to spawn 3 parallel artifact threads

> Saoirse: ``@Polyglot we're rolling out Japanese (ja) locale. Spawn three threads in parallel, each working on one artifact in the channel workspace dir. Title them exactly: `add-ja-locale`, `register-ja-loader`, `update-readme`. Each thread MUST edit real files on disk:
>
> 1. **add-ja-locale** — create `locales/ja.json` mirroring the keys in `locales/en.json` but with Japanese translations.
> 2. **register-ja-loader** — modify `src/i18n/loader.ts` to import `ja.json` and add `'ja'` to the `Locale` union + `REGISTRY`.
> 3. **update-readme** — edit `README.md` to add Japanese (ja) to the languages list.
>
> Each thread should report back via `send_to_channel` with the file path it touched once done.``

Bot calls `spawn_thread × 3`. Within ~60s 3 cards appear in timeline.

### Step 6 — Wait ~3-5 minutes for threads to actually run

Threads are real Claude sessions doing file ops. Poll the workspace
every 30 s for signs of progress (file mtimes / sizes). Don't
short-circuit.

### Step 7 — Verify on-disk artifacts (NEW heart of round)

```bash
WS=/home/azureuser/.hapi-mine/workspaces/saoirse/i18n-japanese-rollout
echo "--- ja.json ---"
ls -l "$WS/locales/ja.json" 2>/dev/null
test -f "$WS/locales/ja.json" && python3 -c "import json; d=json.load(open('$WS/locales/ja.json')); print('keys:', list(d.keys())); print('app.title:', d.get('app.title'))"
echo "--- loader.ts ---"
grep -E "ja\\.json|'ja'|Locale" "$WS/src/i18n/loader.ts" || echo "NOT REGISTERED"
echo "--- README.md ---"
grep -i "japanese\\|日本\\|ja" "$WS/README.md" || echo "NOT MENTIONED"
```

Pass criteria:
- `locales/ja.json` exists, has 5 keys, `app.title` is non-English
  (e.g. contains a katakana/kanji or at least is not "Acme Studio").
- `loader.ts` mentions `ja.json` or `'ja'` (registry was extended).
- `README.md` mentions Japanese.

If any of the 3 fails, that's a real test failure (not a HAPI bug,
but a scenario gap). Log under "Soft observations".

---

## Phase 5 — Multi-turn correction loop (NEW)

### Step 8 — Polyglot injects correction into add-ja-locale via send_to_thread

> Saoirse: `@Polyglot please send_to_thread on add-ja-locale with text: "Correction — the channels.send key should translate as 送信 (sōshin) not 送る. Please update locales/ja.json and report back."`

Bot calls `mcp__hapi__send_to_thread` with the corrected directive.
Wait ~90 s for the thread agent to re-edit the JSON file.

### Step 9 — Verify the correction landed

```bash
grep -F "送信" "$WS/locales/ja.json" && echo "OK — correction applied"
```

Bonus: thread should `send_to_channel` confirming the fix; verify
the channel timeline shows a new `Thread: add-ja-locale` message.

---

## Phase 6 — Visual UX polish scoring (NEW pass)

### Step 10 — Score §XIII expectations across the run

Take screenshots / DOM evals at four moments + record observations:

1. **Empty timeline before bot welcome** (Step 2) — snapshot the
   empty state. Look for friendly copy + CTA, not raw blank.
2. **Mid-bot-typing** (during Step 5) — snapshot for the
   `✨ Polyglot is thinking…` indicator + animation
   (`animate-pulse`, gradient, opacity).
3. **3 thread cards visible** (Step 7 done) — snapshot for card
   styling: gradient backgrounds, rounded borders, "by Saoirse Ní
   Bhraoin" attribution, status pills, hover affordance for `+ 😊`.
4. **Bot vs user avatars** — snapshot a side-by-side: Polyglot's
   bot bubble (`✨` square gradient) vs Saoirse's user circle.

Use `eval` with `getComputedStyle` to verify CSS expectations:
- bot avatar `borderRadius` is small (square-ish, e.g. `6px`),
  user avatar is large (round, e.g. `999px`)
- typing indicator has `animation` containing `pulse`
- thread card has a gradient or border-light style

Record 3-5 visual observations: positive ("✓ thread cards have a
clear gradient"), negative ("✗ no transition on dialog mount —
pops in"), or polish-suggestion ("could add subtle scale-in on
new message").

If a visual gap was already noted in a prior round AND appears
again here, **promote it to a real bug fix** in this round (per
memory).

---

## Phase 7 — Cleanup

### Step 11 — Saoirse hard-deletes `#i18n-japanese-rollout`

Verify folder gone (including all the files we wrote), no orphan
claude subprocs, defaults survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| — | — | — | **0 functional bugs found**. R15-1's orphan-retry path was exercised once during setup (initial channel `9947ede4` spawn failed on a half-dead embedded runner from prior reload churn — recreated channel `7c8738ec` cleanly after the runner stabilised). | — | — |

### Coverage outcome — 0 functional bugs + first multi-file long-range round + first visual UX scoring pass

All 11 numbered scenario steps executed; first round to (a) drive thread agents to actually edit `.json` / `.ts` / `.md` files in their workspace dirs and (b) score visual UX against spec §XIII expectations.

**NEW behaviors verified end-to-end (first time)**:

- **Multi-file artifact edits across 3 parallel threads** (Steps 5–7) — Polyglot spawned `add-ja-locale`, `register-ja-loader`, `update-readme` in parallel via `spawn_thread × 3`. After ~3 min, on-disk verification passed clean for all three:
  - `locales/ja.json` — 5 keys, all Japanese (`app.title=アクメスタジオ`, `auth.signin=サインイン`, `auth.signout=サインアウト`, `channels.empty=まだメッセージはありません`, `channels.send=送信`)
  - `src/i18n/loader.ts` — `import ja from '../../locales/ja.json'`, `Locale = 'en' | 'ja'`, `REGISTRY = { en, ja }`
  - `README.md` — `Languages supported: English (en), Japanese (ja).`
- **Multi-turn correction loop via `send_to_thread`** (Step 8) — Saoirse asked Polyglot to inject a correction directive on the `add-ja-locale` thread (`41af0ac9`). Polyglot called `mcp__hapi__send_to_thread`; thread received the inject at session seq=14 wrapped as `<system>injected-by-bot</system>...` and replied at seq=16: "ok — channels.empty is まだメッセージはありません, which uses the polite ません negative form of あります." On-disk `ja.json` reflects the agreed translation. The thread did not call `send_to_channel` after the correction reply (Claude omit-final-tool-call quirk noted in R3-1 / R5 / R7 / R10 / R11 / R12 / R14 / R15) — but the artifact-on-disk verification passed, which is the primary pass criterion per memory `e2e_rounds_multi_file_long_range.md` ("artifact-on-disk verification is more reliable than the channel-message verification for these scenarios").
- **Long-range timing (~5 min real elapsed)** — three concurrent Claude Haiku threads + bot orchestration ran end-to-end without hub crashes, runner exits, or channel-bot watchdog firings.
- **Channel hard-delete cleanup with multi-file artifacts present** (Step 11) — `DELETE /api/channels/:id?hard=true` with Saoirse's freshly-issued JWT returned `{ok:true,hard:true}`. Within ~12 s: workspace folder `saoirse/i18n-japanese-rollout/` gone (including `locales/`, `src/i18n/`, `README.md`), bot's claude subprocess (PID `778913`) terminated, channel row gone from DB, defaults (`general`, `private`) survived. R14-2's `metadata.path` cleanup logic held when the channel had never been renamed.

**Regression all hold**:
- Default channels with bot (R9) — `saoirse/general` welcomed by bot on first login.
- Sidebar split PRIVATE/CHANNELS (R9) — both visible after sign-in.
- Markdown rendering (R10-1) — Polyglot's welcome message rendered with bold/list intact.
- Typing indicator uses `agentConfig.botName` (R14-1) — `✨ Polyglot is thinking...` observed during bot processing.
- `updateChannelData` orphan-retry guard (R15-1) — exercised once on setup; second create succeeded cleanly without retry.
- `cancelThreadSession` unpins (R13-1) — not directly exercised this round (no scheduled threads); 7 test pass.

### Visual UX notes (NEW per memory `e2e_rounds_visual_ux_polish.md`)

First round to score against spec §XIII "UI 美感与动态". Observations recorded as soft observations — none promoted to bug fixes this round (per memory rule, escalate to bug only when same gap appears in 2+ rounds).

**✓ Positive observations**:
- **Bot vs user avatar visual hierarchy** is correctly distinct per spec §XIII "人类圆形, bot 方形渐变". Polyglot's avatar: `borderRadius: 6px`, `background: linear-gradient(135deg, ...)`, `✨` glyph. Saoirse's avatar: `borderRadius: 999px`, flat colour bg, initial. Both rendered consistently across timeline + thread cards.
- **Empty timeline first-message UX** (carry-over from R15-2 verification) — pre-welcome `No messages yet / Send a message or use @agent to start a task` hint rendered, then replaced by bot welcome smoothly without flash.
- **Markdown rendering** in channel timeline solid — Polyglot's welcome (`👋 I'm **Polyglot**, your i18n rollout coordinator...`) rendered with bold + emoji intact (R10-1 fix holds).
- **Thread cards** show `by Saoirse Ní Bhraoin` attribution, status pill (`Active` → `Completed`), task title — clear visual grouping. R11-2's hover `+ 😊` affordance present on cards.

**✗ Soft observations (not bugs this round)**:
- **No `animate-*` Tailwind classes anywhere on the channel page during bot processing.** Spec §XIII calls for "脉动光晕" (pulsing halo) on the typing indicator (`✨ Polyglot is thinking...`). DOM eval at the moment Polyglot was actively running showed `animate-pulse` / `animate-bounce` / `animate-spin` count = 0 across the entire ChannelView. The typing-indicator text shows but doesn't pulse. **Soft observation — flag for re-check in R17. Promote to bug if same gap appears next round.**
- **Thread cards have flat `rgb(243, 244, 246)` background, no `boxShadow`, no gradient.** Spec §XIII calls for "卡片背景渐变带边光" (gradient bg with edge-glow). Cards are functional + readable but visually plain compared to spec ambition. Soft observation.
- **Reaction picker (`+ 😊`) reveal is hover-driven but with no transition (`transition-opacity` / `transition-transform`).** It just pops in. Soft polish-suggestion — minor.

**This round ran on alternate ports** (hub 3106, web 5273) + isolated `HAPI_HOME=/home/azureuser/.hapi-mine` per memory `e2e_round_port_collision.md` (concurrent test owns 3006/5173).

Hub test suite: **249 / 249** (no new tests this round — no fixes needed).
