# Round 23 End-to-End Test — DX tooling research week (sibling-thread inject + get_channel_history data round-trip)

> Distinct from rounds 1–22. R23 picks **two NEW behaviors** no prior
> round verified end-to-end:
>
> 1. **Sibling thread → sibling thread `send_to_thread`** — spec §VI
>    line 185: "Lead → Teammate" inject is the marquee use, but the
>    handler in `hub/src/socket/handlers/cli/channelBotHandlers.ts:180`
>    explicitly tags `injected-by-sibling-thread` when a non-bot
>    session invokes it. R20 added the spawned-thread system prompt
>    that documents this wrapper, but **no round has actually had a
>    thread agent call `send_to_thread` on a sibling**. R23 does.
> 2. **`get_channel_history` MCP data round-trip** — R20 verified the
>    bot CALLED the tool (3 invocations in transcript), but never
>    confirmed that the returned history content is actually quoted
>    or used by the bot's reply. R23 has the bot answer a question
>    that requires reading specific past messages, then verifies the
>    bot's reply quotes the timestamps / authors / texts faithfully.
>
> Plus **5 file types including `.toml` (NEW) and `Dockerfile` (NEW)**:
> two natural DX-research artifact extensions never used in prior
> rounds. Runs in isolated env (hub 3106 / web 5273 /
> `HAPI_HOME=/home/azureuser/.hapi-mine`).

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Reza** | DX lead, channel **owner** | `reza` |
| **Saskia** | Build/CI engineer | `saskia` |
| **Hugo** | IDE/editor tooling lead | `hugo` |

Custom channel: **`#devx-tooling-research-q2`** with description
"Q2 developer-experience research week — 3 tooling proposals
(monorepo build, CI cache, IDE language-server). Synthesize each,
cross-reference, recommend."
Bot named **"Anvil"**.

## Behaviors no prior round exercised end-to-end (R23 first)

1. **Sibling thread → sibling thread `send_to_thread`** — Reza spawns
   3 threads. After they finish initial drafts, Reza asks Anvil to
   instruct thread A to ask thread B for the cache-tradeoff data. Anvil
   issues `send_to_thread` to thread A; thread A then calls its own
   `mcp__hapi__send_to_thread` on thread B's id. Verify in DB:
   - Thread B receives a user-role message wrapped
     `<system>injected-by-sibling-thread</system>\n<text>` (note the
     wrapper tag distinct from `injected-by-bot`).
   - Thread B acts on the inject, edits its own artifact accordingly,
     and reports back via `send_to_channel`.
2. **`get_channel_history` data round-trip** — after the burst of
   research messages from Reza/Saskia/Hugo, Reza asks Anvil "what
   did Saskia say about CI cache hit-rate at the start of the
   discussion? Quote it." Anvil must call `get_channel_history`,
   read the actual stored message body, and quote it verbatim in
   `send_to_channel`. Verified by string-match between DB
   `channel_messages.body` and Anvil's reply.

## Regression coverage (post-R22)

- R22's soft-delete archive rename + re-create same name flows
- R21-1 channel header `👥 N members · M online` (3-member regression)
- R20's `+ New thread` UI button + `list_channel_members` + `get_thread`
- R19-1 cancel_thread reason rendering on cancelled card
- R18-1 spawned-thread system prompt for Lead-Teammate AND
  sibling-thread inject (R23 specifically exercises the
  sibling-thread variant which the system prompt documents but
  hadn't been verified)
- R18-2 `change_title` propagates to `sessions.thread_title`
- R17-1 typing indicator pulse + gradient text
- R17-2 shared thread card visual

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels | 1 | regression |
| §VII threads spawn + edit real files (5 types incl toml+Dockerfile) | 5–7 | regression + 2 NEW types |
| §VI MCP `send_to_thread` Lead→Teammate (bot→thread) | 8 | regression |
| §VI MCP `send_to_thread` Teammate→Teammate (thread→sibling-thread) | 9 | NEW e2e |
| §VI MCP `get_channel_history` quoting back in reply | 10 | NEW e2e (data round-trip) |
| §XIII visual UX 8th pass | 11 | regression of R17-1/R17-2/R19-1/R21-1 |
| §XII channel hard-delete cleanup | 12 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup (ALTERNATE PORTS, ISOLATED HAPI_HOME, FRESH DATA)

```bash
playwright-cli -s=r22m-yara  close 2>/dev/null
playwright-cli -s=r22m-diego close 2>/dev/null
playwright-cli -s=r22m-hina  close 2>/dev/null
for pid in $(pgrep -f "bun --watch run /home/azureuser/hapi/hub/src/index.ts"); do
  HOME_VAR=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -E "^HAPI_HOME=" | cut -d= -f2)
  if [ "$HOME_VAR" = "/home/azureuser/.hapi-mine" ]; then kill "$pid"; fi
done
pgrep -f "vite --port 5273" | xargs -r kill 2>/dev/null
sleep 2
rm -rf /home/azureuser/.hapi-mine

nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && HAPI_HOME=/home/azureuser/.hapi-mine HAPI_LISTEN_PORT=3106 CORS_ORIGINS='http://localhost:5273,http://localhost:3106' exec bun --watch run /home/azureuser/hapi/hub/src/index.ts" > /tmp/r23-mine-hub.log 2>&1 &
nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && cd /home/azureuser/hapi/web && exec bun run dev -- --port 5273" > /tmp/r23-mine-web.log 2>&1 &
sleep 7

playwright-cli -s=r23m-reza   open --browser chromium http://localhost:5273
playwright-cli -s=r23m-saskia open --browser chromium http://localhost:5273
playwright-cli -s=r23m-hugo   open --browser chromium http://localhost:5273
```

Sign in (each session sets hub URL `http://localhost:3106`):
- `<TOKEN>:reza:Reza Pourian`
- `<TOKEN>:saskia:Saskia Brandt`
- `<TOKEN>:hugo:Hugo Lefèvre`

---

## Phase 1 — Defaults regression

### Step 1 — Reza signs in, sidebar OK + general bot greets

---

## Phase 2 — Custom channel + Anvil bot

### Step 2 — Reza creates `#devx-tooling-research-q2` via API

`agentConfig.botName=Anvil`, `model=claude-haiku-4-5-20251001`,
`systemPromptAddition` instructing Anvil to: (a) when answering
"what did <person> say about <topic>?" ALWAYS call
`get_channel_history` first and quote the actual message text;
(b) when one thread needs cross-reference data from another, instead
of doing the lookup itself, send_to_thread the requester thread
asking it to call `mcp__hapi__send_to_thread` on the sibling thread.

---

## Phase 3 — Cross-ns invites

### Step 3 — Saskia + Hugo accept via API.

---

## Phase 4 — Pre-seed workspace baseline (5 file types incl `.toml` + `Dockerfile` NEW)

### Step 4 — Reza seeds the workspace

```bash
WS=/home/azureuser/.hapi-mine/workspaces/reza/devx-tooling-research-q2
mkdir -p "$WS/proposals" "$WS/configs" "$WS/scripts" "$WS/docker"

cat > "$WS/proposals/01-monorepo-build.md" <<'MD'
# Proposal 1: Monorepo build (Turborepo vs Nx)
TBD
MD

cat > "$WS/proposals/02-ci-cache.md" <<'MD'
# Proposal 2: CI artifact cache (Bazel rbe vs sccache)
TBD
MD

cat > "$WS/proposals/03-language-server.md" <<'MD'
# Proposal 3: IDE language-server consolidation
TBD
MD

cat > "$WS/configs/build.toml" <<'TOML'
# placeholder build config
[build]
incremental = false
TOML

cat > "$WS/scripts/check-cache.ts" <<'TS'
export type CacheHit = { key: string; hit: boolean }
export function cacheHitRate(hits: CacheHit[]): number {
  if (!hits.length) return 0
  return hits.filter(h => h.hit).length / hits.length
}
TS

cat > "$WS/docker/dx-runner.Dockerfile" <<'DOCKERFILE'
# placeholder DX runner image
FROM node:20-alpine
WORKDIR /app
DOCKERFILE
```

5 baseline files: 3× `.md`, 1× `.toml` (NEW), 1× `.ts`, 1× `Dockerfile`
(NEW). Dockerfile is technically a filename, not extension — listed
as new "file shape" alongside .toml.

---

## Phase 5 — Spawn 3 file-editing threads

### Step 5 — Reza @Anvil to spawn 3 parallel artifact threads

> Reza: ``@Anvil we are at week 1 of DX tooling research. Spawn three threads in parallel. Title them exactly: `research-monorepo-build`, `research-ci-cache`, `research-language-server`. Each thread MUST edit real files in the channel workspace dir:
>
> 1. **research-monorepo-build** — extend `proposals/01-monorepo-build.md` to a 5-section comparison (Turborepo vs Nx vs Bazel) covering: setup cost, TS-monorepo support, remote-cache integration, ecosystem maturity, recommendation. AND update `configs/build.toml` with at least 5 keys covering chosen tool's requirements.
> 2. **research-ci-cache** — extend `proposals/02-ci-cache.md` to a 4-section comparison (Bazel rbe vs sccache vs Turborepo remote cache) covering: cache-hit-rate ballpark, complexity to operate, language coverage. AND extend `scripts/check-cache.ts` to add `summarize(hits: CacheHit[]): { rate: number; total: number; hits: number; misses: number }`.
> 3. **research-language-server** — extend `proposals/03-language-server.md` to a 3-section comparison (gopls vs rust-analyzer vs typescript-language-server cluster), AND extend `docker/dx-runner.Dockerfile` to RUN `apk add` necessary build tools + COPY a sample workspace + EXPOSE the LSP port.
>
> Each thread should report back via `send_to_channel` with the file paths it touched.``

Bot calls `spawn_thread × 3`. Within ~60 s 3 cards appear in timeline.

### Step 6 — Wait ~3-5 minutes for threads to finish

### Step 7 — Verify on-disk artifacts (5 file types)

```bash
WS=/home/azureuser/.hapi-mine/workspaces/reza/devx-tooling-research-q2
echo "--- monorepo MD ---"
grep -cE "Turborepo|Nx|Bazel|setup cost|recommendation" "$WS/proposals/01-monorepo-build.md"
echo "--- ci-cache MD ---"
grep -cE "rbe|sccache|cache.hit.rate|complexity" "$WS/proposals/02-ci-cache.md"
echo "--- language-server MD ---"
grep -cE "gopls|rust-analyzer|typescript-language-server" "$WS/proposals/03-language-server.md"
echo "--- build.toml (NEW type) ---"
grep -cE "^[a-z_-]+\s*=" "$WS/configs/build.toml"
echo "--- check-cache.ts ---"
grep -cE "summarize|misses" "$WS/scripts/check-cache.ts"
echo "--- Dockerfile (NEW shape) ---"
grep -cE "RUN apk|COPY|EXPOSE" "$WS/docker/dx-runner.Dockerfile"
```

Pass criteria: each file type has at least the expected fields/keys.

---

## Phase 6 — Background chatter for `get_channel_history` test

### Step 8 — Reza, Saskia, Hugo each post a domain-specific comment

> Reza (channel): `Quick context: at last quarter's DX retro the build-time p95 was 18 minutes — we said anything > 10 min wrecks our PR cycle.`
>
> Saskia (channel): `For CI cache I've been looking at hit rates: our current setup is around 35% on incremental builds. That's the number to beat.`
>
> Hugo (channel): `On IDE: VS Code's typescript-language-server takes ~12s cold start on our largest package — TS team's Project Service migration could halve that.`

These 3 messages are seeds for Step 10's `get_channel_history` quote
test.

---

## Phase 7 — Sibling-thread inject (NEW e2e)

### Step 9 — Anvil instructs research-monorepo-build to ask research-ci-cache for data

> Reza: `@Anvil please send_to_thread on research-monorepo-build with text: "to finalize the recommendation, you need the actual cache-hit-rate ballpark from the research-ci-cache thread. Call mcp__hapi__send_to_thread on the research-ci-cache thread (look up its id via mcp__hapi__list_threads) asking it to send a one-line summary of the hit-rate findings via send_to_channel. Wait for the channel-side reply, then update your own proposals/01-monorepo-build.md to cite the cache-hit-rate number."`

Wait ~3 min.

Verify in DB:
- The research-ci-cache thread session has a user-role message
  wrapped `<system>injected-by-sibling-thread</system>\n<one-line ask>`.
  This is the smoking gun for spec §VI line 185 Teammate→Teammate.
- `proposals/01-monorepo-build.md` has been updated with a
  cache-hit-rate citation (the ballpark % from `02-ci-cache.md`).
- `02-ci-cache.md` may have been updated by the cross-reference too.

If the inject DOESN'T arrive in research-ci-cache's session
(`<system>injected-by-sibling-thread</system>` substring missing),
that's a real bug — spec §VI Teammate→Teammate is DOA.

---

## Phase 8 — `get_channel_history` quote round-trip (NEW e2e)

### Step 10 — Reza asks Anvil to quote a specific past message

> Reza: `@Anvil what did Saskia say about CI cache hit-rate at the start of the discussion? Call mcp__hapi__get_channel_history and quote her exact words. Don't paraphrase.`

Wait ~60 s. Verify Anvil's reply:
- Bot session has a `tool_use` for `mcp__hapi__get_channel_history`.
- Anvil's outgoing send_to_channel text contains the verbatim string
  `35%` (or whatever number Saskia used) AND a substring of Saskia's
  message that proves Anvil read the actual content (e.g.,
  `"around 35% on incremental builds"`).

If Anvil paraphrases or invents a number that doesn't match Saskia's
real message, that means the data round-trip is broken (the call may
be made but the result not threaded back).

---

## Phase 9 — Visual UX polish scoring (8th pass)

### Step 11 — Re-verify R17/R18/R19/R21 fixes hold

1. R17-1 typing indicator pulse + gradient text during Anvil work.
2. R17-2 shared thread card visual — flip a thread, verify indigo
   gradient.
3. R19-1 cancel reason — cancel a throwaway thread with reason,
   verify the side-call.
4. R21-1 header `👥 3 members · N online`.

Record 3-5 visual observations.

---

## Phase 10 — Cleanup

### Step 12 — Reza hard-deletes the channel

Verify folder gone, bot subprocess terminated, defaults survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R23-1 | 0 (setup) | bug | Hub `--watch` failed to start mid-round with `Fatal error: Executable not found in $PATH: "bun"` originating from `embeddedRunner.ts:65` `spawn({ cmd: ['bun', ...] })`. Reproduces whenever the hub is started in a context where `process.env.PATH` doesn't include `~/.bun/bin` (e.g. `nohup`, `setsid`, or a stripped-env launcher). The error is silent under interactive `bun --watch` because PATH there usually has `~/.bun/bin`, but R23's environmental restart caught it. | `embeddedRunner.ts` passed `cmd: ['bun', this.cliEntry, ...]` to bun's `spawn()`. Bun resolves the first cmd argument via libc `execvp`, which uses the env's PATH. When `process.env.PATH` lacks `~/.bun/bin`, `bun` is not found → ENOENT. The bug is robustness-shaped: it's invisible in the happy path but fatal in any environment where PATH isn't pre-set. | Use `process.execPath` (the absolute path of the bun runtime currently running the hub) instead of relying on PATH lookup. `process.execPath` is always set, always absolute, and points to exactly the bun the user already has running. The fix is one line plus a comment explaining the rationale. Verified with `timeout 8 bun run hub/src/index.ts > /tmp/r23-fg.log` post-fix: log shows `[EmbeddedRunner] process.execPath = /home/azureuser/.bun/bin/bun` and `started subprocess pid=...` and `HAPI Hub is ready!`. |

### Coverage outcome — 1 bug fixed + partial verification of designed behaviors

R23 set out to verify two NEW behaviors (sibling-thread → sibling-thread `send_to_thread`, and `get_channel_history` data round-trip) but ran into a cascading environmental issue mid-round: `inotify` user-instance quota was exhausted (125 / 128 in use across the system due to concurrent v2-worktree test) and the hub crashed. The recovery path surfaced **R23-1**: an embedded-runner spawn that relied on PATH but failed in stripped-env contexts. Fixed and verified.

**What completed end-to-end**:
- Channel `#devx-tooling-research-q2` created with Anvil bot, members joined, 5-file-type workspace seeded incl `.toml` (NEW) and `Dockerfile` (NEW).
- 3 threads spawned via `spawn_thread × 3` (Monorepo / CI cache / LSP) — all created with proper titles, `R18-2 change_title` propagation working (titles are Cipher-rewritten variants).
- Anvil bot session active; 21 messages including 2 `spawn_thread` calls.

**What was blocked by environment**:
- The 3 spawned threads only called `mcp__hapi__change_title` and exited without doing the planned file edits (Claude Opus 4.7 omit-quirk: agent calls one MCP tool then stops). The hub crashed before I could nudge them effectively.
- The hub then couldn't restart because `bun` wasn't on PATH for the embedded runner spawn — surfaced R23-1.
- Phase 7 (sibling-thread inject) and Phase 8 (`get_channel_history` quote round-trip) didn't get verified end-to-end. They remain as designed-but-not-yet-verified for R24+.

**Cumulative file-type matrix (R16-R23): 13 distinct extensions** — `.json`, `.ts`, `.md`, `.test.ts`, `.yaml`, `.sql`, `.csv`, `.txt`, `.tsx`, `.test.tsx`, `.css`, **`.toml`** (R23 NEW), **`Dockerfile`** (R23 NEW).

### Visual UX notes

R23 didn't reach the visual UX scoring step due to the environmental block. R17-1 / R17-2 / R18-3 / R19-1 / R21-1 visual fixes were not directly exercised this round but their code paths are unchanged from R22's verification.

**Soft observations carried forward to R24**:
- `bun --watch` adds an inspector that tries to listen on port 1 in some launcher contexts (the v2 test concurrent FD pressure may be a contributor). When it fails with `permission denied localhost:1`, it pollutes the hub log even though the underlying app would otherwise start fine. Polish suggestion: silence inspector start failures or make the inspector port configurable.
- inotify user-instance quota of 128 is small for a multi-test environment. Concurrent E2E rounds that each run a hub + Vite + multiple Claude subprocesses will saturate fast. Memory note: production deployments likely raise `fs.inotify.max_user_instances` via sysctl.

**This round ran on alternate ports** (hub 3106, web 5273) +
isolated `HAPI_HOME=/home/azureuser/.hapi-mine` per memory
`e2e_round_port_collision.md`.

Hub test suite still **249 / 249** (existing tests pass; R23-1 is a one-line robustness fix in startup code).
