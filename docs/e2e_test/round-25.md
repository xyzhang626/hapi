# Round 25 End-to-End Test — Auth-library zero-day (CVE-2025-XYZ) war room

> Distinct from rounds 1–24. R25 exercises **five behaviors no prior
> round verified end-to-end**, set in a security-incident response
> scenario where 3 SecOps engineers triage a critical vulnerability:
>
> 1. **Bot-emitted `react_to_message`** (spec §IX). Prior rounds saw
>    user→bot reactions; R25 verifies the *bot* uses `react_to_message`
>    as a low-noise acknowledgement (🙏 / 👀 / 🤔) per §IX/§XI rule 2 —
>    this is the explicit "prefer reactions over text on weak signals"
>    behavior.
> 2. **`cancel_thread` MCP** (spec §VI.B). Bot is asked to abort a
>    misdirected thread mid-run after a teammate corrects the scope.
>    No prior round triggered cancel_thread.
> 3. **Manual `pin_thread`** of a *non-scheduled* thread (spec §VI.B,
>    §VII pinned-threads paragraph). R20 covered the `+ New thread`
>    button + scheduled auto-pin; R25 covers a regular task thread
>    that becomes important enough mid-flight to pin to the header.
> 4. **AgentConfig hot-reload via filesystem edit** (spec §X). Prior
>    rounds either passed agentConfig at create time (R3+) or used
>    the schema-driven UI editor; R25 has the owner shell-edit
>    `~/.hapi-mine/channels/{id}/agent.json` directly, verifying the
>    hub watcher fires `__config_updated` and the bot adapts.
> 5. **Wrapper-hang fix regression (commit `fec812a`)**. R23+R24
>    were both blocked by the wrapper hanging because `claude` was
>    not on PATH for hub-spawned subprocesses. R25 boots hub
>    explicitly under stripped env (`env -i ... PATH=…/.bun/bin:…`)
>    so the bot wrapper *must* rely on the embeddedRunner PATH
>    prepend to find claude.
>
> File types touched (multi-file long-range, per spec): **5** —
> `.ts` (patch code), `.yml` (CI workflow), `.json` (vuln manifest),
> `.md` (CVE writeup), `.sh` (mitigation script).
> Isolated env: hub 3106, web 5273, `HAPI_HOME=/home/azureuser/.hapi-mine`.

## Cast

| User       | Role                                  | Namespace |
| ---------- | ------------------------------------- | --------- |
| **Hannah** | Security lead, channel **owner**      | `hannah`  |
| **Marco**  | Backend engineer (auth-library owner) | `marco`   |
| **Priya**  | DevOps / CI lead                      | `priya`   |

Custom channel: **`#cve-2025-acid-rabbit`** with description
"P0 zero-day in @hapi/auth-jwt v3 — bypasses signature verification
under certain header crafting. Coordinate patch + CI gating + docs."
Bot named **"Sentinel"**, flavor `claude`, model `claude-haiku-4-5-20251001`,
permissionMode `yolo`. Owner: Hannah.

## Behaviors no prior round exercised end-to-end (R25 first)

1. Bot `react_to_message` (bot-author) — Hannah says "thanks 🙏"
   to bot reply → bot reciprocates with `react_to_message(emoji='🙏')`
   on Hannah's message instead of replying with text. Verified by
   DB row in `channel_message_reactions` with `reactor_ref` =
   `bot:<botSessionId>` (not `user:…`) and SSE event
   `message-reaction-added` carrying that reactor_ref.
2. `cancel_thread` — Marco @s bot asking to "spawn a thread to patch
   `signJWT`". Bot spawns. Priya immediately corrects: "wait, the
   bug is in `verifyJWT`, not `signJWT`." Marco: "@Sentinel cancel
   that thread". Bot calls `cancel_thread(threadId, reason)`. Verified
   thread session marked archived/cancelled; channel timeline shows
   the cancellation.
3. Manual `pin_thread` of non-scheduled thread — bot decides patch
   thread is critical, calls `pin_thread(threadId)`. Verified pinned
   chip appears in channel header WITHOUT being scheduled
   (`scheduled = 0`, `pinned = 1`).
4. AgentConfig hot-reload via filesystem edit — Hannah edits
   `~/.hapi-mine/channels/{cid}/agent.json` directly to add
   `systemPromptAddition: "Be terse. PR-link every code change."`.
   Hub watcher fires; bot session receives `<system>__config_updated:
   {...}</system>` injection; subsequent bot replies become noticeably
   terse and reference PR links.
5. Wrapper-hang regression (post-`fec812a`) — hub launched with
   `env -i ... PATH=/home/azureuser/.bun/bin:...:/bin` (no
   `~/.local/bin`). embeddedRunner must prepend `~/.local/bin` so
   wrapper finds `claude`. Verified by:
   - runner subprocess `/proc/<pid>/environ` PATH starts with
     `/home/azureuser/.local/bin:...`
   - bot wrapper logs do NOT contain `[remote]: launch error`
     repeating
   - first @-mention completes (bot replies via send_to_channel)
     within 60 s

## Regression coverage (post-R24)

- @-mention triggers `spawn_thread`
- `+ New thread` UI button triggers `spawn_thread` (Priya uses it)
- Multi-turn thread correction (Phase 6 below)
- Soft-delete + archive folder rename (Phase 9)
- Channel re-create after soft-delete (Phase 9b)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec §              | R25 step                       |
| ------------------- | ------------------------------ |
| §I lifecycle/spawn  | Phase 1 / 3                    |
| §II botName custom  | Phase 3 ("Sentinel")           |
| §III timeline       | Phase 4–8                      |
| §IV bot session     | Phase 7                        |
| §V strong+weak sigs | Phase 4–7                      |
| §VI tools           | spawn/send/react/cancel/pin    |
| §VII threads        | Phase 5–7                      |
| §IX reactions       | Phase 6 (bot react)            |
| §X agentConfig FS   | Phase 8 (hot-reload via file)  |
| §XII delete         | Phase 9 (soft + 9b re-create)  |
| §XIII visual polish | Phase 10                       |

---

## Phase 0 — Setup (stripped PATH, isolated home, fresh data)

```bash
# Surgical kill — never broad pkill (CLAUDE.md)
pkill -f "/home/azureuser/hapi/.*src/index.ts" 2>/dev/null
pkill -f "/home/azureuser/hapi/cli/.*claude.*--hapi-starting-mode" 2>/dev/null
pkill -f "/home/azureuser/hapi/cli/.*runner.*start-sync" 2>/dev/null
sleep 2

# Wipe isolated test home
rm -rf ~/.hapi-mine

# Boot hub under stripped env so wrapper-hang fix is exercised
env -i HOME=/home/azureuser USER=azureuser \
    PATH=/home/azureuser/.bun/bin:/usr/local/bin:/usr/bin:/bin \
    HAPI_HOME=/home/azureuser/.hapi-mine HAPI_LISTEN_PORT=3106 \
    setsid /home/azureuser/.bun/bin/bun run /home/azureuser/hapi/hub/src/index.ts \
    > /tmp/r25-hub.log 2>&1 < /dev/null &
disown

# Web (5273) is already running on the v2 worktree — don't restart it
# unless playwright fails to load /

# Wait for hub readiness
for i in $(seq 1 20); do
    grep -q "HAPI Hub is ready!" /tmp/r25-hub.log && break
    sleep 1
done
grep -q "HAPI Hub is ready!" /tmp/r25-hub.log || { echo "Hub failed"; exit 1; }
```

Expected immediate post-boot:
- `[EmbeddedRunner] started subprocess pid=<N> → http://127.0.0.1:3106`
- runner `/proc/<N>/environ` PATH starts with `/home/azureuser/.local/bin:`

---

## Phase 1 — Auth 3 users in 3 browser sessions

```bash
playwright-cli -s=r25-hannah open --browser chromium http://localhost:5273
playwright-cli -s=r25-marco  open --browser chromium http://localhost:5273
playwright-cli -s=r25-priya  open --browser chromium http://localhost:5273
```

Each session: token-mode auth `TOKEN:<namespace>:<DisplayName>` →
land on home view with empty channel list.

---

## Phase 2 — Hannah creates `#cve-2025-acid-rabbit`

- Click "New channel" → Custom (with agent config)
- Name: `cve-2025-acid-rabbit`
- Description: as in spec above
- Bot name: `Sentinel`
- Flavor: `claude`, Model: `claude-haiku-4-5-20251001`
- permissionMode: `yolo`
- Submit

Verify within 5 s:
- Hub log: `[SyncEngine] Channel bot spawned: channel=… session=…`
- DOM: pinned-threads strip empty (no threads yet)
- DOM: input box visible, Sentinel's avatar shown in header
- Sentinel `__channel_initialized` welcome reply within 30 s

---

## Phase 3 — Hannah invites Marco + Priya

- Channel members panel → Invite → search by namespace `marco` → add
- Same for `priya`
- Marco + Priya browser sessions: channel appears in their list
  (verify via `playwright-cli snapshot` shows the channel chip)

---

## Phase 4 — Pre-seed workspace baseline (5 file types)

In `~/.hapi-mine/workspaces/hannah/cve-2025-acid-rabbit/` write these
files via `Bash` (simulating prior repo content):

| Path                  | Content sketch                                     |
| --------------------- | -------------------------------------------------- |
| `src/auth.ts`         | `verifyJWT(token)` w/ vulnerable header lookup     |
| `manifest.json`       | `{"name":"@hapi/auth-jwt","version":"3.0.1"}`      |
| `.github/workflows/ci.yml` | run `bun test`, no SAST step yet              |
| `docs/CVE-2025-acid-rabbit.md` | empty stub for writeup                    |
| `scripts/mitigate.sh` | empty placeholder                                  |

(Pre-seeded so threads have something to actually edit.)

---

## Phase 5 — @mention spawn_thread, scope correction, cancel_thread (NEW §VI cancel)

5a. Marco posts in channel: `@Sentinel spawn a thread to patch
    src/auth.ts:signJWT to add stricter signature verification`
    → bot strong signal → bot calls `spawn_thread(title="Patch
    signJWT", prompt=..., flavor="claude")` → thread card appears.

5b. Priya posts: `Wait — the CVE is in verifyJWT, not signJWT.
    signJWT is fine.`
    → debounced, bot may react 🤔 or noop.

5c. Marco posts: `@Sentinel cancel that signJWT thread, please.
    The bug is in verifyJWT.`
    → bot strong signal → bot calls `cancel_thread(threadId,
    reason="scope corrected to verifyJWT")` → thread session
    marked cancelled; channel timeline shows the cancellation.
    DB check:
    ```sql
    SELECT id,status,scheduled,pinned FROM sessions
    WHERE channel_id=? AND id=<oldThreadId>;
    -- expected status archived OR ended
    ```

---

## Phase 6 — Correct thread + bot react_to_message (NEW §IX bot reaction)

6a. Marco posts: `@Sentinel ok now spawn a thread to patch
    src/auth.ts:verifyJWT — make the header lookup case-insensitive
    AND add a SAST regression test`
    → bot calls `spawn_thread(title="Patch verifyJWT", ...)`

6b. Wait for thread to do its work. Verify it actually edits
    `src/auth.ts` AND adds a test file under `src/auth.test.ts`
    (multi-file long-range — at least 2 files modified).

6c. Hannah posts: `🙏 thanks Sentinel, that was fast`
    → debounced weak signal, bot **prefers** `react_to_message
    (messageId, emoji='🙏')` over text reply.
    Verify:
    - DB: `channel_message_reactions` row with `reactor_ref =
      bot:<botSessionId>`, `emoji = '🙏'`
    - DOM: bubble under Hannah's message shows 🙏 with bot avatar
      indicator (or count = 1)
    - SSE: web client receives `message-reaction-added` event

---

## Phase 7 — Bot pin_thread mid-flight (NEW §VI manual pin non-scheduled)

7a. Bot decides verifyJWT thread is critical → calls
    `pin_thread(threadId)`. (May happen autonomously, or the test
    can prompt: Hannah posts `@Sentinel please pin the verifyJWT
    patch thread so we can find it later`.)
    → bot calls `pin_thread(threadId)` → SSE `thread-pinned` event
    → Web UI: thread chip appears in channel header strip with
      📌 icon (NOT ⏰, since it's not scheduled).
    DB check:
    ```sql
    SELECT id, scheduled, pinned FROM sessions WHERE id=<verifyThreadId>;
    -- expected scheduled=0 pinned=1
    ```

7b. Click chip → navigates to thread page. Verify thread page loads.

7c. Click "Bot session →" header button → navigate to bot session
    transcript. Verify input is disabled / "View only" banner shown
    (per spec §IV).

---

## Phase 8 — AgentConfig hot-reload via FILE edit (NEW §X)

8a. Find channel id:
    ```bash
    cid=$(sqlite3 ~/.hapi-mine/hapi.db "SELECT id FROM channels
        WHERE name='cve-2025-acid-rabbit' AND deleted_at IS NULL;")
    ```
8b. Edit the file directly (NOT via UI):
    ```bash
    cat > ~/.hapi-mine/channels/${cid}/agent.json <<EOF
    {
      "flavor": "claude",
      "model": "claude-haiku-4-5-20251001",
      "botName": "Sentinel",
      "permissionMode": "yolo",
      "systemPromptAddition": "Be terse. ALWAYS reference an explicit PR-style change reference (path:linerange) when describing code work."
    }
    EOF
    ```
8c. Within 5 s hub log shows `agent-config-changed` and the bot's
    transcript shows a `<system>__config_updated:</system>` injection.
8d. Hannah posts: `@Sentinel summarize the patch`. Bot reply must
    contain `src/auth.ts:` style file:line reference and be markedly
    terser than its earlier replies (rough heuristic: < 6 sentences).

---

## Phase 9 — Soft delete (regression of R22 + 9b re-create)

9a. As Hannah, channel settings → "Delete channel" → uncheck "Also
    delete files" → confirm. (DEFAULT path = soft.)
    Verify:
    - DB row `channels.deleted_at` set
    - Channel hidden from `GET /api/channels` for all 3 users
    - Workspace folder renamed `cve-2025-acid-rabbit-archived-<ts>`
    - Bot session ended; threads archived

9b. Hannah immediately creates a new channel with the SAME name
    `cve-2025-acid-rabbit`. Verify:
    - Creation succeeds (no DB unique violation)
    - New empty workspace `cve-2025-acid-rabbit/` exists alongside
      the archived one
    - New bot session spawns; old archived folder untouched

---

## Phase 10 — Visual UX polish scoring (8th pass)

Per memory rule "E2E rounds also score visual UX polish — escalate
if same gap appears 2+ rounds": review the Phase 2-9 screenshots and
score against modern web-app expectations:

- transitions on chip strip add/remove
- typing-indicator pulse animation when bot is thinking
- empty-state of channel timeline before first message
- hover state on pinned chip / message reaction bubble
- avatar shape (square + AI dot for bot vs round for users)
- terse-reply visual continuity after config hot-reload

Note any persistent gap (3+ rounds) → escalate to bug fix.

---

## Phase 11 — Cleanup

```bash
playwright-cli -s=r25-hannah close
playwright-cli -s=r25-marco  close
playwright-cli -s=r25-priya  close
# Leave hub running so the next round can re-use the env.
```

## Bugs Found (filled during execution)

### Behaviors verified (PASS)

| ID    | What                                                       | Evidence |
| ----- | ---------------------------------------------------------- | -------- |
| R25-A | Wrapper hang post-`fec812a` regression                     | Hub booted under `env -i ... PATH=/home/azureuser/.bun/bin:...:/bin` (no `~/.local/bin`). Runner `/proc/<pid>/environ` showed `PATH=/home/azureuser/.local/bin:/home/azureuser/.bun/bin:/usr/local/bin:/usr/bin:/bin` (prepend correct). Bot wrapper booted; first `__channel_initialized` produced `mcp__hapi__send_to_channel` welcome within 9 s. **No `[remote]: launch error` lines** in any wrapper log. |
| R25-B | `cancel_thread` MCP                                        | Bot autonomously cancelled the misdirected `signJWT` thread after Priya's correction message. Cancellation card rendered in channel timeline with reason text. |
| R25-C | Manual `pin_thread` of non-scheduled thread                | Bot called `mcp__hapi__pin_thread` after Hannah's @-mention. DB session `pinned=1, scheduled=0`. Header strip rendered `📌 CVE-2025: Patch JWT signature-bypass in verifyJWT` chip. Click-through navigated to `/threads/<id>`. |
| R25-D | Bot-author `react_to_message`                              | Bot reacted on Hannah's "🙏 thanks" message with `✅`. DB row: `reactor_ref = bot:15aa3b8d-…`, `emoji = '✅'`. DOM rendered `button "✅"` under that bubble. |
| R25-E | AgentConfig hot-reload via direct file edit                | Owner shell-edited `~/.hapi-mine/channels/<cid>/agent.json` adding new `systemPromptAddition`. Wrapper transcript received `<system>__config_updated</system> { … }` injection within 2 s. |
| R25-F | Soft delete + same-name re-create                          | `DELETE /api/channels/<cid> 200`. Workspace renamed to `cve-2025-acid-rabbit-archived-1777459960760`. Channel disappeared from all 3 users' channel list. Subsequent `POST /api/channels` for the same name returned `201` (no DB collision). |
| R25-G | Multi-file long-range edit                                 | `verifyJWT` thread modified `src/auth.ts` (added `EXPECTED_ALG`, `safeJSONParse`, `timingSafeStringEqual`) AND created `src/auth.test.ts` (new file, 3955 bytes). Two distinct files touched. |
| R25-H | "Bot session →" view-only                                  | Header link navigated to `/sessions/<botSessionId>`. "View only" banner present. Full transcript visible (incl. `<system>mentioned:</system>` and `<system>weak-signal-batch:</system>` injects). |

### Soft observations (not actionable bugs)

1. **Model picked `✅` instead of `🙏` for thanks-reciprocation.** Spec §IX
   suggests `🙏` for "user expresses thanks" but doesn't mandate the
   exact glyph. `claude-haiku-4-5` chose `✅`. Behavior conforms (bot
   reacted instead of texting); emoji choice is model judgment.

2. **Bot turn-end without MCP call → silence.** On Hannah's
   "@Sentinel summarize the verifyJWT patch in 2 lines max" the bot's
   stream produced a `result.subtype=success` with `result` text
   `"Thread shows work complete. Summary: Patched verifyJWT
   (src/auth.ts) ..."` but the bot did **not** call `send_to_channel`
   or any MCP tool. Net effect: nothing reached the channel, even
   though the user @-mentioned (strong signal). Spec §V says strong
   signals MUST be answered via MCP (incl. `noop()`); model produced
   text-only end-turn instead of calling a tool. Marked as soft —
   the system prompt should pressure this harder, but it's a model
   compliance issue, not a code defect.

3. **Spec §XII vs implementation drift on soft-delete DB state.**
   Spec line 419 says "DB: channel 标记 `deleted_at`, 从 channel list
   隐藏". Actual `channels` table has **no `deleted_at` column**;
   `syncEngine.deleteChannel` calls `store.channels.deleteChannel`
   which removes the row entirely, then renames the folder. The
   user-visible outcome (channel hidden, folder archived, same-name
   re-create works) matches the spec, but the *mechanism* differs.
   Re-creating with the same name therefore yields no archived DB
   ghost — only the filesystem retains the archived folder. Note
   that this also means **bot reactions on a soft-deleted channel's
   messages are lost** (FK cascade), since the row is actually gone.
   Worth tracking; not blocking.

4. **Default channel-create flow has no agentConfig dialog.** The
   "+ Create Channel" UI is a single name+submit textbox; agentConfig
   is filled afterwards via Settings → "Save & hot-reload". Spec
   doesn't mandate a single-step dialog, but onboarding-flow could
   benefit from inline agentConfig prompt to avoid the empty-channel
   intermediate state. Pre-existing (not R25-introduced).

### Cleanup

```bash
playwright-cli -s=r25-hannah close
playwright-cli -s=r25-marco  close
playwright-cli -s=r25-priya  close
```

Hub left running on 3106; ~/.hapi-mine retained for the next round.
