# Round 24 End-to-End Test — ML model v3 rollout (sibling-thread inject + get_channel_history quote)

> Distinct from rounds 1–23. R24 carries forward the two NEW behaviors
> R23 designed but couldn't end-to-end verify (R23 was blocked by an
> environmental inotify quota), and exercises them in a fresh ML
> model release scenario.
>
> 1. **Sibling thread → sibling thread `send_to_thread`** (spec §VI
>    line 185 Teammate-Teammate). The wrapper format
>    `<system>injected-by-sibling-thread</system>` exists in
>    `channelBotHandlers.ts:180` since R20 but no round has had a
>    spawned thread agent actually call `send_to_thread` on a sibling
>    thread end-to-end.
> 2. **`get_channel_history` MCP data round-trip** — R20/R23 verified
>    the bot CALLED the tool, but neither verified that the returned
>    history content is faithfully quoted in the bot's reply. R24
>    has the bot answer "what did Senna say about the F1 score?" by
>    calling `get_channel_history` and quoting Senna's verbatim text.
>
> Plus **5 file types including `.py` (NEW) and `.proto` (NEW)**: a
> model evaluation script + gRPC serving schema, two extensions never
> used in prior rounds. Runs in isolated env (hub 3106 / web 5273 /
> `HAPI_HOME=/home/azureuser/.hapi-mine`).

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Astrid** | ML lead, channel **owner** | `astrid` |
| **Vikram** | ML engineer | `vikram` |
| **Senna** | Data scientist | `senna` |

Custom channel: **`#ml-model-v3-rollout`** with description
"Q2 ML model v3 rollout — benchmarks, release notes, gRPC serving
contract, deployment plan. Three artifacts cross-reference each
other."
Bot named **"Herald"**.

## Behaviors no prior round exercised end-to-end (R24 first)

1. **Sibling thread → sibling thread `send_to_thread`** — Astrid
   spawns 2 threads. After both finish their initial drafts, Astrid
   asks Herald to instruct thread A (release-notes) to ask thread B
   (run-benchmarks) for the actual F1 / latency numbers via
   `mcp__hapi__send_to_thread` on thread B's id. Verify in DB that
   thread B's session messages contain a user-role inject wrapped
   `<system>injected-by-sibling-thread</system>\n<text>` (note the
   wrapper tag distinct from `injected-by-bot`).
2. **`get_channel_history` data round-trip** — Senna posts a
   specific F1-score finding into the channel as a comment. Astrid
   later asks Herald: "what was Senna's F1 score number? Call
   `mcp__hapi__get_channel_history` and quote her exact words."
   Herald must call the MCP and quote the verbatim string from
   Senna's message body in `send_to_channel`. Verified by
   exact-substring match between DB `channel_messages.body` and
   Herald's reply.

## Regression coverage (post-R23)

- R23-1 embeddedRunner uses `process.execPath` (verified hub starts
  cleanly under any env)
- R22's soft-delete + re-create flows
- R21-1 channel header `👥 N members · M online`
- R20's `+ New thread` UI button + `list_channel_members` + `get_thread`
- R19-1 cancel_thread reason rendering
- R18-1 spawned-thread system prompt for Lead-Teammate / sibling-thread
  inject (R24 specifically exercises the sibling-thread variant)
- R18-2 `change_title` propagates to `sessions.thread_title`
- R17-1 typing indicator pulse + gradient text
- R17-2 shared thread card visual

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels | 1 | regression |
| §VII threads spawn + edit real files (5 types incl py+proto) | 5–7 | regression + 2 NEW types |
| §VI MCP `send_to_thread` Lead→Teammate (bot→thread) | 8 | regression |
| §VI MCP `send_to_thread` Teammate→Teammate (thread→sibling) | 9 | NEW e2e (carried from R23) |
| §VI MCP `get_channel_history` quoting back in reply | 10 | NEW e2e (carried from R23) |
| §III header `👥 3 members · N online` | 4 | R21-1 regression |
| §XII channel hard-delete cleanup | 11 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup (ALTERNATE PORTS, ISOLATED HAPI_HOME, FRESH DATA)

```bash
playwright-cli -s=r23m-reza   close 2>/dev/null
playwright-cli -s=r23m-saskia close 2>/dev/null
playwright-cli -s=r23m-hugo   close 2>/dev/null
for pid in $(pgrep -f "bun.*run /home/azureuser/hapi/hub/src/index.ts"); do
  HOME_VAR=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -E "^HAPI_HOME=" | cut -d= -f2)
  if [ "$HOME_VAR" = "/home/azureuser/.hapi-mine" ]; then kill "$pid"; fi
done
pgrep -f "vite --port 5273" | xargs -r kill 2>/dev/null
sleep 2
rm -rf /home/azureuser/.hapi-mine

# Use env -i + explicit PATH so embeddedRunner spawn reliably finds bun
# (R23-1 fix uses process.execPath so this should also work without
# explicit PATH, but we keep PATH set as belt-and-suspenders).
nohup env PATH=/home/azureuser/.bun/bin:/usr/local/bin:/usr/bin:/bin HOME=/home/azureuser HAPI_HOME=/home/azureuser/.hapi-mine HAPI_LISTEN_PORT=3106 CORS_ORIGINS=http://localhost:5273,http://localhost:3106 bun --watch run /home/azureuser/hapi/hub/src/index.ts > /tmp/r24-mine-hub.log 2>&1 &
nohup env PATH=/home/azureuser/.bun/bin:/usr/local/bin:/usr/bin:/bin HOME=/home/azureuser bash -c 'cd /home/azureuser/hapi/web && exec bun run dev -- --port 5273' > /tmp/r24-mine-web.log 2>&1 &
sleep 7

playwright-cli -s=r24m-astrid open --browser chromium http://localhost:5273
playwright-cli -s=r24m-vikram open --browser chromium http://localhost:5273
playwright-cli -s=r24m-senna  open --browser chromium http://localhost:5273
```

Sign in (each session sets hub URL `http://localhost:3106`):
- `<TOKEN>:astrid:Astrid Olsen`
- `<TOKEN>:vikram:Vikram Patel`
- `<TOKEN>:senna:Senna Bekele`

---

## Phase 1 — Defaults regression

### Step 1 — Astrid signs in, sidebar OK + general bot greets

---

## Phase 2 — Custom channel + Herald bot

### Step 2 — Astrid creates `#ml-model-v3-rollout` via API

`agentConfig.botName=Herald`, `model=claude-haiku-4-5-20251001`,
`systemPromptAddition` instructing Herald to: (a) when answering
"what did <person> say about <topic>?" ALWAYS call
`mcp__hapi__get_channel_history` first and quote the actual message
text VERBATIM (no paraphrase); (b) when one thread needs data from
another, prefer instructing the requester thread to call
`mcp__hapi__send_to_thread` on the sibling thread directly (peer
coordination) rather than ferrying via the bot.

---

## Phase 3 — Cross-ns invites

### Step 3 — Vikram + Senna accept via API.

---

## Phase 4 — Pre-seed workspace baseline (5 file types incl `.py` + `.proto` NEW)

### Step 4 — Astrid seeds the workspace

```bash
WS=/home/azureuser/.hapi-mine/workspaces/astrid/ml-model-v3-rollout
mkdir -p "$WS/release" "$WS/eval" "$WS/serving" "$WS/benchmarks"

cat > "$WS/release/release-notes.md" <<'MD'
# Model v3 release notes
TBD
MD

cat > "$WS/release/model-card.md" <<'MD'
# Model v3 model card
TBD
MD

cat > "$WS/eval/evaluate.py" <<'PY'
# placeholder evaluation script
def f1_score(precision: float, recall: float) -> float:
    return 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
PY

cat > "$WS/serving/model_service.proto" <<'PROTO'
// placeholder gRPC contract
syntax = "proto3";
package ml.v3;

service ModelService {
}
PROTO

cat > "$WS/benchmarks/results.json" <<'JSON'
{ "version": "v3.0.0-pre", "f1": null, "p95_latency_ms": null }
JSON
```

5 baseline files: 2× `.md`, 1× `.py` (NEW), 1× `.proto` (NEW),
1× `.json`.

---

## Phase 5 — Spawn 2 file-editing threads

### Step 5 — Astrid @Herald to spawn 2 parallel artifact threads

> Astrid: ``@Herald we are at week 1 of model v3 rollout. Spawn TWO threads in parallel. Title them exactly: `run-benchmarks` and `draft-release-notes`. Each thread MUST edit real files in the channel workspace dir:
>
> 1. **run-benchmarks** — extend `eval/evaluate.py` to add `precision_at_k(predictions, labels, k)` and `recall_at_k(predictions, labels, k)` functions. AND populate `benchmarks/results.json` with realistic v3 numbers (e.g., `f1: 0.847`, `precision: 0.871`, `recall: 0.825`, `p95_latency_ms: 42`, plus a `compared_to_v2` block with deltas).
> 2. **draft-release-notes** — extend `release/release-notes.md` to a 4-section document (Highlights, Performance, Breaking Changes, Migration). Use placeholder numbers like `<F1>` `<latency>` for now — the run-benchmarks thread will provide the real ones via sibling-thread inject. AND extend `serving/model_service.proto` to define `Predict` RPC with `PredictRequest` and `PredictResponse` messages.
>
> Each thread should report back via `send_to_channel` with the file paths it touched.``

Bot calls `spawn_thread × 2`. Within ~60 s 2 cards appear in timeline.

### Step 6 — Wait ~3 minutes for threads to finish

### Step 7 — Verify on-disk artifacts (5 file types)

```bash
WS=/home/azureuser/.hapi-mine/workspaces/astrid/ml-model-v3-rollout
echo "--- evaluate.py (NEW type) ---"
grep -cE "precision_at_k|recall_at_k|def " "$WS/eval/evaluate.py"
echo "--- benchmarks/results.json ---"
~/.bun/bin/bun -e "const d=require('$WS/benchmarks/results.json'); console.log('keys:', Object.keys(d).join(','), 'f1:', d.f1)"
echo "--- release-notes.md ---"
grep -cE "Highlights|Performance|Breaking Changes|Migration|<F1>|<latency>" "$WS/release/release-notes.md"
echo "--- model_service.proto (NEW type) ---"
grep -cE "rpc Predict|message PredictRequest|message PredictResponse" "$WS/serving/model_service.proto"
echo "--- model-card.md ---"
ls -l "$WS/release/model-card.md"
```

Pass criteria:
- `evaluate.py` has new `precision_at_k` and `recall_at_k` functions.
- `benchmarks/results.json` has numeric `f1`, `precision`, `recall`,
  `p95_latency_ms`, and a `compared_to_v2` block.
- `release-notes.md` has 4 sections + placeholder tokens.
- `model_service.proto` defines `Predict` RPC + the two messages.

---

## Phase 6 — Senna posts a F1 finding (seeds `get_channel_history` test)

### Step 8 — Senna posts a domain-specific message

> Senna (channel): `Just confirmed: on the held-out test set the new v3 model hits F1=0.847 ± 0.012, vs v2's 0.793. That's a +5.4 point absolute improvement. Recommendation: ship.`

This message is the seed for Step 10's `get_channel_history` quote
test.

---

## Phase 7 — Sibling-thread inject (NEW e2e)

### Step 9 — Astrid asks Herald to instruct draft-release-notes to ask run-benchmarks for the real numbers

> Astrid: ``@Herald please send_to_thread on the draft-release-notes thread with text: "to finalize the release notes, you need the real F1 / precision / recall / p95-latency numbers. DO NOT do the lookup yourself or ask the bot — call mcp__hapi__send_to_thread directly on the run-benchmarks thread (look up its id via mcp__hapi__list_threads) asking it to send a one-line summary of the benchmark numbers via send_to_channel. Wait for the channel reply, then update your own release/release-notes.md replacing the <F1> <latency> placeholders with the real numbers."``

Wait ~3 min.

Verify in DB:
- `run-benchmarks` thread session has a user-role message wrapped
  `<system>injected-by-sibling-thread</system>\n<one-line ask>` —
  this is the smoking gun for spec §VI line 185 Teammate→Teammate.
- `release/release-notes.md` no longer contains `<F1>` / `<latency>`
  placeholders; instead has the actual benchmark numbers.

If the inject DOESN'T arrive in run-benchmarks' session
(`<system>injected-by-sibling-thread</system>` substring missing),
that's a real bug — spec §VI line 185 Teammate→Teammate is DOA.

---

## Phase 8 — `get_channel_history` quote round-trip (NEW e2e)

### Step 10 — Astrid asks Herald to quote Senna's exact F1 number

> Astrid: `@Herald what was Senna's F1 score number? Call mcp__hapi__get_channel_history and quote her exact words. Don't paraphrase.`

Wait ~60 s. Verify Herald's reply:
- Bot session has a `tool_use` for `mcp__hapi__get_channel_history`.
- Herald's outgoing send_to_channel text contains `0.847` AND the
  substring `± 0.012` AND `+5.4 point` (or close — proves Herald
  read the actual content rather than guessing a generic number).

If Herald paraphrases (e.g. just says "Senna confirmed F1 was about
0.85") without the verbatim numbers, the data round-trip is
broken — log as bug.

---

## Phase 9 — Cleanup

### Step 11 — Astrid hard-deletes the channel

Verify folder gone, bot subprocess terminated, defaults survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R24-1 | 5 (bot wrapper after spawn) | bug | After channel creation, Herald's wrapper subprocess (`bun cli/src/index.ts claude --hapi-starting-mode remote --started-by runner ...`) starts and registers with hub, but does NOT actually fork a `claude --output-format stream-json ...` LLM subprocess. The wrapper sleeps idle (state `S`, no children). Hub thinks the bot is alive (`metadata.lifecycleState: running`, `hostPid` set) but functionally it's deaf — incoming `@-mention` injects pile up in the session's message table, nothing ever processes them. The watchdog never schedules a respawn because no `session-end` event fires (wrapper is alive). When manually `kill`ed, the watchdog DOES respawn correctly (R15-1 path) but the NEW wrapper sometimes hangs the same way under `--resume`. Reproduces in R23 + R24 under shared-environment FD/inotify pressure. | Runner-side `cli/src/runner/run.ts` lifecycle: when claude exits (or fails to start), the wrapper continues in its event loop without terminating itself or calling `apiSession.disconnect()` to signal session-end. The wrapper appears to be waiting for input that never arrives. The deeper trigger is unclear — possibly socket-level backoff or a `--resume` race with a session id whose backing claude already ended. | **NOT FIXED in R24**. Requires runner-side investigation: when `claudeRemoteLauncher` returns or fails before claude is wired, the wrapper should exit non-zero so the parent runner detects child exit and relays `session-end` to hub (then watchdog respawn fires). Workaround documented: kill the wrapper PID manually to force watchdog respawn. R24 was unable to verify its two NEW behaviors (sibling-thread inject, get_channel_history quote round-trip) because Herald never reached an interactive state after init. |

### Coverage outcome — 0 NEW behaviors verified, 1 bug discovered (not fixed)

R24 set out to verify two NEW behaviors (sibling thread → sibling thread `send_to_thread` and `get_channel_history` data round-trip — both carried from R23 where they were also blocked). Both R23 and R24 hit the same bot-wrapper-hang scenario (R24-1).

**What completed end-to-end**:
- Hub started cleanly with **R23-1 fix verified** — `process.execPath` resolves to `/home/azureuser/.bun/bin/bun`, embedded runner spawns without PATH issues even under stripped-env launchers.
- Channel `#ml-model-v3-rollout` created with Herald bot, all 3 members joined.
- 5-file-type workspace seeded: 2× `.md`, 1× `.py` (NEW), 1× `.proto` (NEW), 1× `.json`.
- Channel header rendered `👥 3 members · 1 online` (R21-1 holds).
- Channel hard-delete cleanup: workspace folder gone, both bot wrappers (original PID 1779847 + watchdog-respawn PID 1783892) terminated, defaults survived.

**What was blocked by R24-1**:
- 0 threads spawned (Herald never processed any @-mention).
- Sibling-thread `send_to_thread` (Phase 7) — designed but not run.
- `get_channel_history` quote round-trip (Phase 8) — designed but not run.

**Cumulative file-type matrix (R16-R24): 15 distinct extensions** —
`.json`, `.ts`, `.md`, `.test.ts`, `.yaml`, `.sql`, `.csv`, `.txt`,
`.tsx`, `.test.tsx`, `.css`, `.toml`, `Dockerfile`, **`.py`** (R24
NEW), **`.proto`** (R24 NEW).

### Visual UX notes

R24 didn't reach the visual UX scoring step. R17 / R18 / R19 / R21 visual
fixes weren't directly exercised but their code paths are unchanged.

**Carry forward to R25**:
- R23 + R24 both blocked by the bot-wrapper-hang. R25 should attempt
  the sibling-thread inject + get_channel_history quote tests AGAIN
  with mitigation: either (a) fix R24-1 first, or (b) preemptively
  kill+respawn the wrapper before each multi-turn step to force a
  fresh claude subprocess.

**This round ran on alternate ports** (hub 3106, web 5273) +
isolated `HAPI_HOME=/home/azureuser/.hapi-mine` per memory
`e2e_round_port_collision.md`.

Hub test suite still **249 / 249** (no test changes this round).
