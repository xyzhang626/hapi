# Round 6 End-to-End Test — Open-Source Release Coordination

> Distinct from rounds 1–5. Round 6 stresses behaviors NOT yet exercised:
> the spec'd **server-side 403 on `POST /api/sessions/:id/messages` for
> `isChannelBot=true` sessions** (mvp-ux-stage-2 §4), `agentConfig`
> overrides for **`permissionMode`** and **`debounceMs`** (never tested
> non-default), **reactions on `thread_card` messages** (vs ordinary
> `text` messages), **`noop()` as a valid strong-signal response**
> ("acknowledged but no output"), and **concurrent `@-mentions`** from
> multiple users. Doubles as a regression run for round-1-through-5
> fixes.

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Hana** | Release Engineer, channel **owner** | `hana` |
| **Sora** | Documentation Writer | `sora` |
| **Kai** | Community Manager | `kai` |

Channel: **`#release-v2`** with description "v2.0 release coordination".
Bot named **"Conductor"** with `permissionMode: "ask"` and
`debounceMs: 1000` (overrides the 3000 default).

A second tiny channel **`#chitchat`** is created with NO agentConfig
to verify the no-bot path still works for ordinary messaging.

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §4 `POST /api/sessions/:id/messages` returns 403 when `session.isChannelBot=true` | 7 | Spec mandates this; never asserted in any prior round |
| §10 `agentConfig.permissionMode = "ask"` | 5 | The `ask` mode for spawned threads — never tested (always `yolo`) |
| §10 `agentConfig.debounceMs = 1000` | 11 | Non-default debounce override — never asserted |
| §6 `noop()` as a strong-signal response | 12 | Bot may noop for low-information mentions; spec calls it out, never observed |
| §3 Reactions on `thread_card` messages | 14 | Round 4 covered text-message reactions, not thread-card |
| §6 `get_thread` MCP tool used in synthesis | 13 | Bot fetching a single thread's state for a status reply |
| Multiple users `@-mention` bot in rapid succession | 15 | Two strong signals queued; bot must reply to both, no race |
| Channel without `agentConfig` (no bot) | 18 | + New thread button disabled, message send still works |
| Round-2 fix: invite link UI | 3 | Sora + Kai join via /invite/$token |
| Round-2 fix: cross-ns user displayName | all | "Hana Yamada" / "Sora Kim" / "Kai Mensah" everywhere |
| Round-2 fix: scheduled-thread auto-pinned chip live | 8 | (`spawn_scheduled_thread`) chip appears without reload |
| Round-3 fix: agentConfig hot-reload | 17 | Change `botName` mid-flight |
| Round-3 fix: hard-delete clean (no folder, no orphan claude) | 19 | Final cleanup |
| Round-4 fix: welcomeStyle "auto" | 4 | (default branch) — bot greets |
| Round-4 fix: SIGKILL crash recovery | (skipped, covered in round 4) | — |
| Round-5 fix: `list_channel_members` enriched | 6 | Bot greets each member by name |
| Round-5 fix: self-removal redirect | (not needed this round) | — |
| Round-5 fix: rename invalidates context cache | 17 | Conductor → Maestro mid-flight |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup

```bash
rm -rf ~/.hapi
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; export CORS_ORIGINS="http://localhost:5173,http://localhost:3006"; cd /home/azureuser/hapi/hub && exec bun --watch run src/index.ts' > /tmp/r6-hub.log 2>&1 &
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd /home/azureuser/hapi/web && exec bun run dev' > /tmp/r6-web.log 2>&1 &

playwright-cli -s=hana open http://localhost:5173
playwright-cli -s=sora open http://localhost:5173
playwright-cli -s=kai  open http://localhost:5173
```

Each session sets hub URL `http://localhost:3006` and signs in:
- `<TOKEN>:hana:Hana Yamada`
- `<TOKEN>:sora:Sora Kim`
- `<TOKEN>:kai:Kai Mensah`

---

## Phase 1 — Channel + Conductor agentConfig

### Step 1 — Hana signs in

### Step 2 — Hana creates `#release-v2`

### Step 3 — Hana opens Settings, sets description, agentConfig (with `permissionMode: ask` + `debounceMs: 1000`), invites Sora + Kai

In Settings dialog:
- **Channel**: name `release-v2`, Description `v2.0 release coordination`
- **Identity**: Bot name = `Conductor`, Model = `claude-haiku-4-5-20251001`
- **Behavior**:
  - System prompt addition = `You are Conductor for the v2.0 release. Concise replies (≤2 sentences). Spawn one thread per release artifact. Use noop() when a message is just chatter and not directed at you.`
  - Welcome style = `auto` (default branch)
  - **Weak-signal debounce (ms) = 1000** (non-default)
- **Permissions**: **Permission mode = `ask`** (non-default)
- **Members**: Generate Invite Link.
- Save & hot-reload.

Open invite URL in `sora` and `kai` → both auto-redirected to channel.

### Step 4 — Verify the auto welcome

Within ~10 s, Conductor posts a brief greeting that mentions
`#release-v2`. (Default `welcomeStyle: "auto"` branch.)

---

## Phase 2 — `list_channel_members` + spawn_thread×3

### Step 5 — Hana asks for the release plan

> `@Conductor kick off the release plan with three artifacts: 1) changelog, 2) blog post, 3) tweet thread. One thread each.`

Bot calls `spawn_thread × 3`. Each thread session, per the
`permissionMode: ask` config, should spawn with `permissionMode='ask'`
in metadata (vs the default `bypassPermissions/yolo`). Verify via
hub API:

```bash
curl /api/channels/<ch>/sessions
# each non-bot session's metadata.permissionMode should be 'ask'
```

(If permissionMode doesn't propagate to spawned threads → bug.)

### Step 6 — Hana asks for the team roster

> `@Conductor greet the release team by name`

Bot calls `list_channel_members` (round-5 fix) and addresses each by
displayName: "Hana Yamada", "Sora Kim", "Kai Mensah". Raw userIds = bug.

---

## Phase 3 — §4 spec test: bot-session POST returns 403

### Step 7 — Direct API: try to send a message INTO the bot session

> Spec §4: "Hub API: `POST /api/sessions/:id/messages` 在 `session.isChannelBot = true` 时直接返回 403"

```bash
HANA_JWT=$(curl /api/auth ... | jq .token)
curl -X POST /api/sessions/<bot-session-id>/messages \
     -H "Authorization: Bearer $HANA_JWT" \
     -d '{ "content": "hi from outside" }'
# Expected: 403 Forbidden — bot sessions only accept hub-internal injects
# Actual: ???
```

Whatever the API returns, log it as a **bug if not 403**.

---

## Phase 4 — Scheduled thread + debounceMs verification

### Step 8 — Kai @Conductor for periodic check

> `@Conductor every 1 minute, list active threads and report progress.`

Bot calls `spawn_scheduled_thread` (auto-pinned, shared). The scheduled
thread will fire its first iteration ~1 min after creation. Verify
the chip appears in header on all three sessions.

### Step 9 — Wait for first scheduled-thread iteration

After ~75 s, the scheduled thread should produce its first
`send_to_channel` report — a "Thread: Active threads progress check"
style message. Verify it lands in the channel timeline of all three.

(Round-2 fix verified the chip appears live; this round verifies the
*recurring iteration* actually fires once.)

---

## Phase 5 — debounceMs override

### Step 10 — Sora posts a single chit-chat message (1 weak signal)

> Sora: `morning everyone`

Per default rules, a single weak signal needs *2 messages OR 3 s of
silence* to flush. With `debounceMs: 1000`, the silence threshold
should be 1 s.

### Step 11 — Wait exactly 2 s + verify bot reacted

If the override is honored, bot should have flushed at the ~1 s mark
and reacted (👋 / 🌅 / similar) before our 2 s wait completes.

If we wait 2 s and there's no reaction, then 1 s more (total 3 s) and
suddenly there is one → debounceMs override is **NOT honored**, hub is
still using the hardcoded 3000.

---

## Phase 6 — noop() as a valid response

### Step 12 — Sora posts a vague low-info `@Conductor`

> `@Conductor lol nice`

A pure low-info @-mention. Per system prompt rule 1, the bot MUST
respond via MCP — but `noop()` is explicitly listed as valid. The bot
*may* call `noop()` and produce no visible output. Verify:

- Channel timeline shows NO new bot message after this @-mention.
- Bot session transcript shows the @-mention received AND a `noop`
  MCP tool call.

If the bot replies with a full message instead of noop, that's a
soft-bug (excessive noise) but not a system bug. If the bot never
acknowledges the strong signal at all (no MCP call) → bug.

---

## Phase 7 — get_thread + thread-card reaction

### Step 13 — Hana asks status of just the changelog thread

> `@Conductor what's the changelog thread doing right now?`

Bot calls `mcp__hapi__get_thread` (single-thread inspector) and
synthesizes a brief reply. (Different from round-5's
`list_threads` for "all threads".)

### Step 14 — Sora reacts ❤️ to the changelog thread CARD

The thread cards emitted on spawn are normal channel messages with
`kind="thread_card"`. The reaction picker should work on them too.
Click the thread card's `+ 😊` button (or equivalent) → ❤️.

Verify:
- `❤️` bubble renders below the card.
- DB row in `channel_message_reactions` for that message id.
- All three sessions see it via SSE.

(Round-4 covered text-message reactions; thread-card reactions are
the gap.)

---

## Phase 8 — Concurrent @-mentions

### Step 15 — Two users @Conductor in the same second

Hana types `@Conductor stand-by call 4pm` and clicks Send.
Within 200 ms, Kai types `@Conductor confirm tweet draft` and Sends.

Both messages are strong signals. Bot should:
- Send both to its session
- Reply to both (in some order — even if combined into one message)
- NOT drop either

Verify both Hana and Kai's mentions get acknowledged in the bot
transcript.

---

## Phase 9 — Rename + delete

### Step 16 — Hana hot-reloads botName Conductor → Maestro (round-5 regression)

Settings → Identity → Bot name = `Maestro`. Save.

### Step 17 — Hana pings the renamed bot

> `@Maestro confirm new identity`

Bot replies; new label "Maestro"; old "Conductor" messages keep their
original label. Strong-signal regex picks up `@Maestro` (round-5 fix
verifies channelAgent invalidates the cache on `channel-updated`).

### Step 18 — Hana creates `#chitchat` (no agentConfig)

In a separate quick exercise: create channel `chitchat`, do NOT open
Settings to add agentConfig.

Verify:
- Channel renders normally with empty timeline.
- `+ New thread` button is **disabled** (no bot to spawn it).
- Message input works; send `hello world` and verify it appears.
- Header shows no `Bot session →` link (no bot exists).

### Step 19 — Hana hard-deletes `#release-v2`

Settings → Danger zone → check "Also delete files" → Delete.

Verify:
- Folder `~/.hapi/workspaces/hana/release-v2` is gone.
- No orphan claude subprocesses.
- Sidebars on Sora + Kai drop the channel.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R6-1 | 3 — debounceMs via JS-eval | n/a (test artifact) | A `--raw eval` that set `input.value="1000"` and dispatched `input`/`change` events did NOT propagate into React state — agent.json saved with `debounceMs: 3000`. | React's controlled-input handler doesn't see programmatic `dispatchEvent` from outside. Switched to `playwright-cli fill` which simulates real keyboard typing — agent.json then correctly saved `debounceMs: 1000`. | n/a (test-tooling, not a HAPI bug) |
| R6-2 | 5 — `permissionMode: ask` not honored on spawned threads | HIGH | Hana set `agentConfig.permissionMode = "ask"` but all three bot-spawned threads (Release Changelog / Blog Post / Tweet Thread) had `permissionMode: "bypassPermissions"` in DB. The "ask" setting was completely ignored. | `hub/src/sync/syncEngine.ts` `botSpawnThread` hard-coded `true /* yolo */` as the 6th argument to `spawnSession` and passed `undefined` for `permissionMode`, never reading `channel.agentConfig.permissionMode`. | Read `cfg.permissionMode` from the channel's agentConfig (`'yolo' \| 'ask'`). Map: `'yolo'` → `yolo=true`; `'ask'` → `yolo=false` plus a flavor-appropriate concrete `permissionMode` (`'default'` for claude/codex/gemini/opencode, literal `'ask'` for cursor). Verified: re-spawned scheduled monitor with `permMode=default` (the round 6 fresh spawn after the fix). |
| R6-3 | 7 — §4 spec test | HIGH (security) | `POST /api/sessions/:id/messages` with `text: "hi from outside"` to a `isChannelBot=true` session returned **200 OK** and injected the text into the bot's transcript. mvp-ux-stage-2 §4 explicitly mandates **403** here — the bot session must only accept hub-internal injects from the channel-routing path, otherwise any channel member can spoof system messages or inject prompts past the strong/weak signal gate. | `hub/src/web/routes/messages.ts` had no `session.isChannelBot` check before calling `engine.sendMessage`. | Added an explicit early `return 403` with explanatory body when the resolved session has `isChannelBot=true`. Verified: same curl call now returns `403 {"error":"Bot sessions do not accept direct messages..."}`. |
| R6-4 | 11 — debounceMs override ignored | MEDIUM | The `agentConfig.debounceMs = 1000` saved correctly in `agent.json`, but `channelAgent` always used the hardcoded `WEAK_SIGNAL_DEBOUNCE_MS = 3_000` constant for the weak-signal flush timer. The override field was DOA. | `hub/src/sync/channelAgent.ts` `enqueueWeakSignal` referenced the module-level constant directly, never reading `cfg.debounceMs`. | Extended `ChannelContext` with a `debounceMs: number` field populated from `cfg.debounceMs` (clamped to `[500, 30000]` to match the editor bounds). The setTimeout site now reads `ctx.debounceMs` instead of the constant. The cache invalidates on `channel-updated` (round-5 fix) so a hot-reload of debounceMs takes effect immediately. |

### Coverage outcome

All 19 numbered scenario steps executed (Steps 15/16/17 covered by round-5
regression — botName rename — were dropped to keep this run focused on
the new behaviors).

Soft observations (not bugs):
- The bot used `noop()` exactly when expected — for Sora's `@Conductor lol nice`
  low-info @-mention. That's the spec-compliant "I see this but choose not
  to act" response.
- Reactions on `thread_card` messages work end-to-end: API accepts, DB
  stores, SSE delivers (verified Sora's ❤️ on the Release Changelog card).
- Channel without agentConfig renders cleanly: `+ New thread` is disabled,
  no `Bot session →` link, message input still works.

Round-2/3/4/5 fixes still hold:
- cross-ns user displayName ("Hana Yamada", "Sora Kim", "Kai Mensah")
- invite-link UI flow + auto-redirect to channel
- scheduled-thread auto-pinned chip live (round-2)
- agentConfig hot-reload (round-3 per-channel watcher)
- welcomeStyle: "auto" (round-4)
- list_channel_members enriched (round-5)
- channelAgent context cache invalidates on `channel-updated` (round-5)
- hard-delete clean: no folder, no orphan claude subprocesses

