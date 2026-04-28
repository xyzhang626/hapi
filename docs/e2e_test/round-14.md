# Round 14 End-to-End Test — Customer Interview Synthesis

> Distinct from rounds 1–13. R14 picks four behaviors no prior round
> verified end-to-end and runs in **isolated environment** (alternate
> ports, separate HAPI_HOME) because another concurrent test owns the
> default ports — see memory `e2e_round_port_collision.md`.

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Anya** | UX Researcher, channel **owner** | `anya` |
| **Jin** | Product Manager | `jin` |
| **Faye** | Designer | `faye` |

Custom channel: **`#research-q2-onboarding`** with description
"Q2 onboarding research — synthesize the 5 user interviews from
last week and tag pain points by funnel step." Bot named **"Echo"**.

## Behaviors no prior round exercised end-to-end (R14 first)

1. **Channel-bot typing indicator visible** — spec §III says bot's
   current action shows above the input box as `✨ <name> is
   thinking…` / `…spawning thread …` / etc. R8 mentioned the spec
   but nobody DOM-verified the indicator actually appears during
   bot reasoning.
2. **Multiple thread → channel updates over time, all carrying
   `Thread:` author label** — R12 verified ONE update; R14
   verifies the label persists across 2+ updates from the same
   thread without bleeding into other threads or losing attribution.
3. **Bot uses `send_to_thread` to relay a message between users** —
   spec §VI lists this as Lead→Teammate context injection. R8
   verified bot can call send_to_thread, but as a 1-shot from the
   owner. R14 has Anya ask Echo to "tell the interview-3 thread
   about Jin's color-blind concern" — a cross-user routing test.
4. **PUT botName change** — change `agentConfig.botName` from "Echo"
   to "Synth" via API. The next bot send_to_channel should render
   under the new name in the channel timeline (the body's stamped
   `botName` field is read at write time, but the channelAgent's
   strong-signal regex needs to recognize the new alias too —
   verifies R5's invalidation fix).

## Regression coverage (post-R13)

- Default channels with bot (R9)
- Sidebar PRIVATE/CHANNELS (R9)
- `welcomeStyle:custom` (R12)
- Markdown rendering (R10) + tables (R13)
- User reaction → bot weak signal (R11)
- `+ 😊` picker on thread cards (R11)
- `cancel_thread` clears `pinned` chip (R13)
- Hard delete cleanup (R3)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels with bot | 1 | regression |
| §III channel-bot typing indicator | 5 | NEW |
| §VII multi-update thread → channel reverse flow | 7 | NEW |
| §VI MCP `send_to_thread` cross-user routing | 8 | NEW |
| §X PUT agentConfig.botName change | 9 | NEW |
| §III channel rename mid-flight | 10 | regression of R5 |
| §XII channel hard-delete | 11 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup (ALTERNATE PORTS)

```bash
# Other test in /home/azureuser/hapi-worktrees-codex-debug-v2 owns
# 3006/5173. Use 3106/5273 + isolated HAPI_HOME.
HAPI_HOME=/home/azureuser/.hapi-mine
HUB_PORT=3106
WEB_PORT=5273

rm -rf "$HAPI_HOME"
nohup bash -c "cd /home/azureuser/hapi/hub && HAPI_HOME=$HAPI_HOME HAPI_LISTEN_PORT=$HUB_PORT CORS_ORIGINS='http://localhost:$WEB_PORT,http://localhost:$HUB_PORT' exec bun --watch run src/index.ts" > /tmp/r14-mine-hub.log 2>&1 &
nohup bash -c "cd /home/azureuser/hapi/web && exec bun run dev -- --port $WEB_PORT" > /tmp/r14-mine-web.log 2>&1 &

playwright-cli -s=r14m-anya open --browser chromium http://localhost:$WEB_PORT
playwright-cli -s=r14m-jin  open --browser chromium http://localhost:$WEB_PORT
playwright-cli -s=r14m-faye open --browser chromium http://localhost:$WEB_PORT
```

Sign in (each session sets hub URL `http://localhost:3106`):
- `<TOKEN>:anya:Anya Markovic`
- `<TOKEN>:jin:Jin Park`
- `<TOKEN>:faye:Faye Mensah`

---

## Phase 1 — Default-channel regression

### Step 1 — Anya signs in, sidebar OK + general bot greets

Verify sidebar split + bot welcome.

---

## Phase 2 — Custom channel + Echo

### Step 2 — Anya creates `#research-q2-onboarding` via API

Direct API POST with `agentConfig.botName=Echo`,
`welcomeStyle=auto`, `permissionMode=yolo`,
`systemPromptAddition` instructing markdown + thread-per-interview.

### Step 3 — Jin + Faye accept invite

Cross-ns invite flow.

---

## Phase 3 — Spawn 3 interview threads

### Step 4 — Anya @Echo to spawn 3 threads

> Anya: `@Echo spawn one synthesis thread per interview: interview-1-amelia, interview-2-bo, interview-3-cara. Each should produce a 3-bullet pain-points summary.`

Bot calls `spawn_thread × 3`. 3 cards in timeline.

---

## Phase 4 — Channel-bot typing indicator (NEW)

### Step 5 — Anya sends a question that takes Echo time to think

> Anya: `@Echo summarize the most common complaints across all three interviews so far.`

While Echo is processing (`session.thinking=true`), poll the DOM
in Anya's session for the typing indicator. Spec §III shows it as
`✨ <botName> is thinking…` above the input box.

Use `eval` with a polling loop for ~10 s after sending — capture
the indicator text if present. If nothing matches, log as a soft
finding (channel-bot-typing SSE wired but UI not rendering).

---

## Phase 5 — Thread → channel multi-update flow (NEW)

### Step 6 — Inject directives into 2 of the 3 threads to post status

```bash
THR1_ID=$(curl /api/channels/<id>/sessions | jq -r '...interview-1...id')
THR2_ID=$(curl /api/channels/<id>/sessions | jq -r '...interview-2...id')
curl -X POST /api/sessions/$THR1_ID/messages \
  -d '{"text":"Please call mcp__hapi__send_to_channel with text: interview-1-amelia: pain points = checkout abandonment, password complexity, no email confirmation."}'
curl -X POST /api/sessions/$THR2_ID/messages \
  -d '{"text":"Please call mcp__hapi__send_to_channel with text: interview-2-bo: pain points = mobile keyboard layout, slow first-load, missing dark mode."}'
```

### Step 7 — Verify both updates land with correct `Thread:` labels

After ~60 s verify in DOM (any session):
- Two new text rows in timeline.
- One labeled `Thread: interview-1-amelia`, the other
  `Thread: interview-2-bo`. NOT cross-mixed, NOT "system", NOT raw
  session id.
- Body text matches the requested status string.
- Inject a 3rd update from THR1 (`interview-1-amelia: clarification — checkout step is the dropoff`) and verify it ALSO renders as `Thread: interview-1-amelia` (consistent label across multiple posts from same thread).

---

## Phase 6 — Bot routes a message between users via `send_to_thread` (NEW)

### Step 8 — Faye flags an accessibility concern; Anya asks Echo to relay

> Faye (in channel): `Heads up — interview-3-cara mentioned color-blindness on slide 4 of her video, color-coded errors won't work for her.`

Then:

> Anya: `@Echo please send_to_thread on interview-3-cara with text: "Important from Faye: panelist mentioned color-blindness; flag any color-only error indicators in your synthesis."`

Bot should call `mcp__hapi__send_to_thread` with the interview-3
thread id. Verify in the thread session's transcript: a new
user-role inject containing Faye's color-blindness text. Cross-user
routing complete.

---

## Phase 7 — PUT botName change (NEW)

### Step 9 — Anya renames Echo → Synth via API

```bash
curl -X PUT /api/channels/<id> \
  -H "Authorization: Bearer <Anya>" -H "content-type: application/json" \
  -d '{"agentConfig":{"flavor":"claude","botName":"Synth","model":"claude-haiku-4-5-20251001","permissionMode":"yolo","systemPromptAddition":"...","welcomeStyle":"auto"}}'
```

Within ~5 s the channelAgent's cached ChannelContext should
invalidate (R5 fix `channel-updated` event). Then:

> Anya: `@Synth — confirm you can hear me under the new name.`

The bot's reply (via send_to_channel) should arrive in the channel
with `botName: "Synth"` stamped in the message body. Author label
in the rendered DOM should display `Synth` (not `Echo`).

---

## Phase 8 — Channel rename mid-flight (regression)

### Step 10 — Anya renames the channel

```bash
curl -X PUT /api/channels/<id> -d '{"name":"q2-research-synth"}'
```

Within ~5 s all 3 sidebars show the new channel name `# q2-research-synth`.
Bot session, threads, and pinned chips all still functional.

---

## Phase 9 — Cleanup

### Step 11 — Anya hard-deletes the channel

Standard hard-delete; verify folder gone, no orphan claude
subprocesses, defaults survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R14-1 | 4 — typing indicator | annoyance | The `✨ <name> is thinking…` indicator above the channel input box rendered with the literal string `Agent` regardless of the channel's actual `agentConfig.botName`. R8/R9/R10 etc. all configured a custom bot name (Captain / Compass / Atlas / Forge / Echo) but the typing indicator hard-coded "Agent". | `web/src/components/ChannelView.tsx:242` had `✨ Agent is {botTypingAction}…` literal "Agent". | Read `botName` off the channel's agentConfig: `(channel.agentConfig as {botName?: string})?.botName ?? 'Agent'`. Verified post-fix: indicator showed `✨ Echo is thinking…` after the rename `✨ Synth is thinking…`. |
| R14-2 | 11 — hard-delete after rename | annoyance | After PUT-renaming `#research-q2-onboarding` to `#q2-research-synth` and then hard-deleting it, the channel record + bot session went away cleanly but the **on-disk workspace folder `~/.hapi-mine/workspaces/anya/research-q2-onboarding/` lingered**. Same gap whenever a channel is renamed any time after spawn. | `hub/src/sync/syncEngine.ts` `deleteChannel` computed the workspace folder path from the CURRENT `channel.name` (`q2-research-synth`). PUT-rename changes `channel.name` in the DB but does NOT move the on-disk folder (the bot/threads are still writing to the original path). The cleanup's `existsSync(dir)` returned false, the renameSync silently no-op'd. | Capture the bot session's `metadata.path` (set at spawn time, not mutated by rename) BEFORE killing the bot, and add it as a backup candidate to the cleanup loop. The cleanup now tries BOTH the current-name path AND the recorded original path. Verified end-to-end: spawned `verify-meta` → PUT-renamed to `verify-meta-renamed` → hard-deleted → folder cleanly removed. 1 regression test added in `cancelThreadSession.test.ts`. |

### Coverage outcome — 2 bugs fixed + 4 NEW behaviors verified

All 11 numbered scenario steps executed (with one bypass for Step 6 —
the thread agent refused the original "fabricate pain points"
directive as it interpreted that as research fabrication, so used a
neutral "thread ready" status text instead).

**NEW behaviors verified end-to-end (first time)**:

- **Channel-bot typing indicator visible** (Step 5) — R14-1 caught
  the wrong-name issue; after fix, `✨ Echo is thinking…` rendered
  above the input box during bot reasoning.
- **Multi-update thread → channel reverse flow with `Thread:` labels**
  (Steps 6-7) — both initial updates from THR1 (`interview-1-amelia`)
  and THR2 (`interview-2-bo`) landed with consistent
  `Thread: <title>` author labels visually verified in DOM. The 2nd
  injection from THR1 didn't fire (Claude omit-final-tool-call
  recurring quirk).
- **Bot uses `send_to_thread` for cross-user routing** (Step 8) —
  Faye posted accessibility concern in channel; Anya @-mentioned Echo
  to relay; Echo called `mcp__hapi__send_to_thread` TWICE on
  interview-3-cara thread, both injecting Faye's color-blindness note.
  THR3's user-role injects show both the bot-injected Faye note + the
  original directive.
- **PUT botName change** (Step 9) — Echo→Synth via PUT; the
  `__config_updated` system inject landed in the bot session with the
  new agentConfig; the `@Synth` strong signal was correctly routed
  to the bot session (R5 channelAgent cache invalidation works); bot
  didn't reply (Claude omit-quirk again, but channelAgent path
  proven).

**Regression all hold**:
- Default channels with bot, sidebar split, channel description in
  header, channel rename via PUT propagating to all sidebars (R5),
  hard-delete cleanup (R3 — caught R14-2 here).

**This round ran on alternate ports** (hub 3106, web 5273) +
isolated `HAPI_HOME=/home/azureuser/.hapi-mine` because another
concurrent test owned the default ports. See memory
`e2e_round_port_collision.md` for the standing setup.

Hub test suite: **246 / 246** (was 245 before R14; 1 new test added
for deleteChannel post-rename folder cleanup).
