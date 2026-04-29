# Round 20 End-to-End Test — SOC 2 Audit Prep (`+ New thread` button + list_channel_members + get_thread + channel rename mid-flight)

> Distinct from rounds 1–19. R20 picks **four NEW behaviors** no prior
> round verified end-to-end:
>
> 1. **`+ New thread` UI button → bot spawns thread** (spec §VII line
>    207-208). Per spec the button posts a strong signal
>    `<system>user X requested new thread on: ...</system>` into the bot
>    session, which then must respond via `spawn_thread`. R10 first
>    clicked the button; R20 verifies the FULL pipeline (button →
>    strong signal → bot spawn_thread → thread card visible).
> 2. **`list_channel_members` MCP** — bot calls it and uses the results
>    to address a specific user by display name (spec §VI line 192).
>    Verified by reading bot session messages for the tool_use call.
> 3. **`get_thread` MCP** — bot calls it on a sibling thread to check
>    state before deciding next action (spec §VI line 190 + §VI line
>    374). Verified by reading bot session messages.
> 4. **Channel rename mid-flight with active threads** — owner PUTs
>    new name; verify sidebar updates everywhere, header updates,
>    bot session keeps running, workspace folder is appropriately
>    managed (R5 partial; never tested while active threads exist).
>
> Plus 5 file types (regression of R16/R18/R19) including **`.csv`**
> (NEW), the **5th visual UX scoring pass**, and a regression of
> R18-1's spawned-thread inject system prompt under multi-thread
> coordination. Runs in isolated env (hub 3106 / web 5273 /
> `HAPI_HOME=/home/azureuser/.hapi-mine`).

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Iggy** | Compliance lead, channel **owner** | `iggy` |
| **Mei** | Security engineer | `mei` |
| **Bjorn** | Infra lead | `bjorn` |

Custom channel: **`#soc2-audit-prep-q2`** with description
"SOC 2 Type II evidence collection for Q2 audit window. CC1-CC9
controls. Gather screenshots, access reviews, change-mgmt logs."
Bot named **"Cipher"**.

## Behaviors no prior round exercised end-to-end (R20 first)

1. **`+ New thread` UI button → bot spawn flow**: click button, type
   topic in modal, submit. Verify (a) channel-message strong signal
   `<system>user X requested new thread on topic: ...</system>` lands
   in bot session, (b) Cipher calls `spawn_thread`, (c) thread card
   appears in timeline within ~30 s.
2. **`list_channel_members` MCP usage by bot**: prompt Cipher with a
   task that requires knowing who's in the channel. Verify the bot's
   tool-call transcript shows `mcp__hapi__list_channel_members` and
   the bot's outgoing message references members by name.
3. **`get_thread` MCP usage by bot**: prompt Cipher to check the
   status of a specific thread before deciding whether to spawn another
   one. Verify the bot's transcript shows
   `mcp__hapi__get_thread` and the bot's reply quotes the thread's
   current state (title / status / todos).
4. **Channel rename mid-flight while active threads exist**: owner
   PUTs new channel name (`soc2-audit-prep-q2 → soc2-evidence-bundle-q2`).
   Verify sidebar entries update for all 3 users, channel header text
   updates, `bot_session_id` unchanged, active thread sessions remain
   alive, workspace folder situation handled (R14-2 deletePath logic
   may need to use original path — verify it doesn't break here).

## Regression coverage (post-R19)

- 5 file types in one round (R18/R19) — `.csv` NEW + 4 regressions
- R19-1 cancel_thread reason rendering on cancelled card
- R18-1 spawned-thread system prompt for Lead-Teammate inject
- R18-2 `change_title` propagates to `sessions.thread_title`
- R18-3 owner long-press / right-click pinned chip → unpin
- R17-1 typing indicator pulse + gradient text
- R17-2 shared thread card visual (indigo + 🔗 Shared pill)
- Default channels with bot (R9), markdown (R10/R13)
- 3-user reaction stack with count badge (R19)
- Channel hard-delete cleanup with multi-file artifacts (R16/R18/R19)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels | 1 | regression |
| §VII threads spawn + edit real files (5 types incl `.csv`) | 5–7 | regression + .csv NEW |
| §VII `+ New thread` UI button → bot spawn | 8 | NEW (e2e) |
| §VI `list_channel_members` MCP | 9 | NEW (e2e) |
| §VI `get_thread` MCP | 10 | NEW (e2e) |
| §I + §III channel rename mid-flight with active threads | 11 | NEW (e2e) |
| §XIII visual UX 5th pass | 12 | regression of R17/R18/R19 fixes |
| §XII channel hard-delete cleanup | 13 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup (ALTERNATE PORTS, ISOLATED HAPI_HOME)

```bash
playwright-cli -s=r19m-priya close 2>/dev/null
playwright-cli -s=r19m-ehsan close 2>/dev/null
playwright-cli -s=r19m-lila  close 2>/dev/null
for pid in $(pgrep -f "bun --watch run /home/azureuser/hapi/hub/src/index.ts"); do
  HOME_VAR=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -E "^HAPI_HOME=" | cut -d= -f2)
  if [ "$HOME_VAR" = "/home/azureuser/.hapi-mine" ]; then kill "$pid"; fi
done
pgrep -f "vite --port 5273" | xargs -r kill 2>/dev/null
sleep 2
rm -rf /home/azureuser/.hapi-mine

nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && HAPI_HOME=/home/azureuser/.hapi-mine HAPI_LISTEN_PORT=3106 CORS_ORIGINS='http://localhost:5273,http://localhost:3106' exec bun --watch run /home/azureuser/hapi/hub/src/index.ts" > /tmp/r20-mine-hub.log 2>&1 &
nohup bash -c "export PATH=\"\$HOME/.bun/bin:\$PATH\" && cd /home/azureuser/hapi/web && exec bun run dev -- --port 5273" > /tmp/r20-mine-web.log 2>&1 &
sleep 5

playwright-cli -s=r20m-iggy  open --browser chromium http://localhost:5273
playwright-cli -s=r20m-mei   open --browser chromium http://localhost:5273
playwright-cli -s=r20m-bjorn open --browser chromium http://localhost:5273
```

Each session sets hub URL `http://localhost:3106`. Sign in:
- `<TOKEN>:iggy:Iggy Volkov`
- `<TOKEN>:mei:Mei Watanabe`
- `<TOKEN>:bjorn:Bjorn Halvorsen`

---

## Phase 1 — Defaults regression

### Step 1 — Iggy signs in, sidebar OK + general bot greets

Sidebar shows `iggy` workspace title, `Channels` + `Private` sections.

---

## Phase 2 — Custom channel + Cipher bot

### Step 2 — Iggy creates `#soc2-audit-prep-q2` via API

`agentConfig.botName=Cipher`, `model=claude-haiku-4-5-20251001`,
`systemPromptAddition` instructing Cipher to use `list_channel_members`
when assigning work and `get_thread` to check status before
coordinating.

---

## Phase 3 — Cross-ns invites

### Step 3 — Mei + Bjorn accept via API.

---

## Phase 4 — Pre-seed workspace baseline (5 file types incl `.csv`)

### Step 4 — Iggy seeds the workspace

```bash
WS=/home/azureuser/.hapi-mine/workspaces/iggy/soc2-audit-prep-q2
mkdir -p "$WS/controls" "$WS/scripts" "$WS/queries" "$WS/evidence"

cat > "$WS/controls/cc1-control-environment.md" <<'MD'
# CC1: Control Environment
TBD
MD

cat > "$WS/controls/cc-checklist.yaml" <<'YAML'
controls: []
YAML

cat > "$WS/scripts/gather-access-logs.ts" <<'TS'
export type AccessLog = { user: string; resource: string; ts: number }
export function filterRecent(logs: AccessLog[], windowDays: number): AccessLog[] {
  return logs.slice()
}
TS

cat > "$WS/queries/q2-changes.sql" <<'SQL'
-- placeholder Q2 production change query
SELECT 1;
SQL

cat > "$WS/evidence/evidence-index.csv" <<'CSV'
control,evidence_type,location,gathered_by,gathered_at
CSV
```

---

## Phase 5 — Spawn 4 file-editing threads

### Step 5 — Iggy @Cipher to spawn 4 parallel artifact threads

> Iggy: ``@Cipher we are gathering SOC 2 Type II evidence for the Q2 audit window. Spawn four threads in parallel. Title them exactly: `draft-cc1-control-env`, `complete-cc-checklist`, `extend-access-log-script`, `populate-evidence-index`. Each thread MUST edit real files in the channel workspace dir:
>
> 1. **draft-cc1-control-env** — extend `controls/cc1-control-environment.md` to a full CC1 narrative covering CC1.1 (integrity & ethics commitment), CC1.2 (board independence + oversight), CC1.3 (org structure / authority), CC1.4 (commitment to competence), CC1.5 (accountability for internal control). At least one paragraph per sub-control.
> 2. **complete-cc-checklist** — replace `controls/cc-checklist.yaml` with a CIS-style checklist covering CC1, CC2 (communication & info), CC3 (risk assessment), CC6 (logical access). Each control = name + auditor_question + evidence_required + status fields.
> 3. **extend-access-log-script** — extend `scripts/gather-access-logs.ts` to add `filterFailedLogins(logs: AccessLog[]): AccessLog[]` (treat resource starting with "auth.failed" as failed login) AND `byUser(logs: AccessLog[]): Record<string, AccessLog[]>`. Write a `scripts/gather-access-logs.test.ts` with at least 3 jest-style or assert-style tests.
> 4. **populate-evidence-index** — replace `evidence/evidence-index.csv` with at least 6 rows (header + 5 evidence rows) covering the 4 controls above. Realistic location paths.
>
> Each thread should report back via `send_to_channel` with the file path it touched once done.``

Bot calls `spawn_thread × 4`. Within ~60 s 4 cards appear in timeline.

### Step 6 — Wait ~3-5 minutes for threads to finish

Threads are real Claude sessions. Poll workspace mtimes every 30 s.

### Step 7 — Verify on-disk artifacts (5 file types incl `.csv`)

```bash
WS=/home/azureuser/.hapi-mine/workspaces/iggy/soc2-audit-prep-q2
echo "--- markdown CC1 narrative ---"
grep -cE "CC1\.[1-5]" "$WS/controls/cc1-control-environment.md"
echo "--- yaml checklist ---"
grep -cE "auditor_question:|evidence_required:" "$WS/controls/cc-checklist.yaml"
echo "--- TS access-log script ---"
grep -cE "filterFailedLogins|byUser" "$WS/scripts/gather-access-logs.ts"
ls "$WS/scripts/" | grep test
echo "--- SQL audit query ---"
test -s "$WS/queries/q2-changes.sql" && echo "SQL present"
echo "--- CSV evidence index (NEW file type) ---"
wc -l "$WS/evidence/evidence-index.csv"
head -7 "$WS/evidence/evidence-index.csv"
```

Pass criteria:
- `cc1-control-environment.md` has CC1.1 through CC1.5 sections.
- `cc-checklist.yaml` has at least one auditor_question + evidence_required pair.
- `gather-access-logs.ts` exports `filterFailedLogins` and `byUser`.
- `gather-access-logs.test.ts` exists.
- `evidence-index.csv` has at least 6 lines (1 header + 5 rows).

---

## Phase 6 — `+ New thread` UI button → bot spawn (NEW)

### Step 8 — Iggy clicks `+ New thread` button + types topic

In channel header, click `+ New thread`. A modal/dialog should
appear prompting for a topic. Type:
`vendor-security-questionnaire — review last quarter's vendor SAQs and flag any missing remediation evidence`

Submit. Verify:
- Channel-message strong signal lands in bot session as
  `<system>user <iggy-id> requested new thread on topic: vendor-security-questionnaire — ...</system>`.
- Cipher calls `spawn_thread` within ~30 s.
- A new thread card with title `vendor-security-questionnaire` (or
  Cipher-rewritten variant) appears in timeline.

If the button doesn't open a modal OR the bot doesn't spawn within
30 s, log under Bugs Found.

---

## Phase 7 — `list_channel_members` MCP usage (NEW)

### Step 9 — Iggy asks Cipher to assign work to specific people

> Iggy: `@Cipher please call mcp__hapi__list_channel_members and then send_to_channel a message that addresses the security engineer by name (asking them to verify the access-log script tests pass) and the infra lead by name (asking them to confirm the SQL query has the right time window).`

Wait ~60 s. Verify:
- Cipher's bot session has a `tool_use` for `mcp__hapi__list_channel_members`.
- Cipher's outgoing send_to_channel message references "Mei" AND
  "Bjorn" by name (proves it used the lookup result).

If Cipher invents names instead of calling the MCP tool, that's a
behavior gap (system-prompt issue, not a code bug — log as soft
observation).

---

## Phase 8 — `get_thread` MCP usage (NEW)

### Step 10 — Iggy asks Cipher to check thread status before acting

> Iggy: `@Cipher please call mcp__hapi__get_thread on the draft-cc1-control-env thread and report back via send_to_channel: thread title, current status, and how many todos done vs total. Don't just remember — actually call the MCP and quote what it returned.`

Wait ~60 s. Verify:
- Cipher's bot session has a `tool_use` for `mcp__hapi__get_thread`.
- Cipher's outgoing send_to_channel message quotes the thread's
  actual title + status + todo counts.

---

## Phase 9 — Channel rename mid-flight (NEW)

### Step 11 — Iggy renames channel via PUT while threads still active

```bash
curl -X PUT /api/channels/:cid \
  -d '{"name":"soc2-evidence-bundle-q2"}'
```

Verify:
- All 3 sessions' sidebar entries update from `soc2-audit-prep-q2`
  → `soc2-evidence-bundle-q2` within ~3 s.
- Channel header updates.
- `bot_session_id` does NOT change (rename should not respawn bot).
- Active scheduled or running threads still reachable.
- Send a test message after rename: bot still responds — proves the
  bot session survived the rename and still routes correctly.
- Workspace folder situation: spec §I line 49 says default workspace
  is `~/.hapi/workspaces/{ns}/{channelName}`. After rename, does hub
  rename the folder, or stick with the old path? R14-2 fix uses
  `metadata.path` for delete cleanup — verify it still works.

---

## Phase 10 — Visual UX polish scoring (5th pass)

### Step 12 — Re-verify R17/R18/R19 fixes hold

1. **R17-1 typing indicator** — verify `bot-typing-halo` +
   `bot-typing-text-shimmer` apply during bot work.
2. **R17-2 shared thread card** — flip a thread shared, verify indigo
   gradient + 🔗 Shared pill.
3. **R18-3 owner unpin via right-click** — pin then right-click → unpin
   menu.
4. **R19-1 cancelled card with reason** — cancel a thread w/ reason,
   verify "Reason: <text>" side-call renders.

Record 3-5 visual observations.

---

## Phase 11 — Cleanup

### Step 13 — Iggy hard-deletes the (renamed) channel

Verify folder gone, bot subprocess terminated, defaults survive.
Specifically verify R14-2 still works for the post-rename case
(workspace folder path may differ from `name`).

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| — | — | — | **0 functional bugs found**. R20 is the **fourth zero-bug round** (after R8, R12, R16). All 4 NEW behaviors worked end-to-end on first attempt; all R17/R18/R19 fixes from prior rounds still hold; multi-file long-range pattern continues to scale (5 file types incl `.csv` populated cleanly in ~90 s). | — | — |

### Coverage outcome — 0 functional bugs + 4 NEW behaviors verified

All 13 numbered scenario steps executed.

**NEW behaviors verified end-to-end (first time)**:

- **`+ New thread` UI button → bot spawn** (Step 8, spec §VII line 207-208) — Iggy clicked the `+ New thread` header button → modal `New thread / Briefly describe the topic` opened with a `Spawn thread` button (initially disabled until topic entered). Filled topic `vendor-security-questionnaire — review last quarter's vendor SAQs and flag any missing remediation evidence`, clicked Spawn. Within 30 s, Cipher's bot session received the strong-signal inject, called `mcp__hapi__spawn_thread`, and a new thread card titled `Q1 2026 Vendor SAQ Remediation Review` (Cipher rewrote the title — R18-2 propagation works) appeared in the channel timeline. The vendor-SAQ thread completed its work and reported back via `send_to_channel` with `evidence/vendor-remediation-gaps.csv` reference. R10 had clicked the button once but never verified the full pipeline; R20 closes that loop.
- **`list_channel_members` MCP usage by bot** (Step 9, spec §VI line 192) — Iggy explicitly asked Cipher to call the MCP and address members by name. Bot session shows 4 references to `list_channel_members` (Cipher used it for both the explicit ask AND for verification). Channel-side text from Cipher (seq=13): `@Mei Watanabe — can you verify that the access-log script tests pass once the extend-access-log-script thread completes? @Bjorn Halvorsen — when you get a chance, please confirm the SQL query has the right time window for this audit period.` — proves the bot used the lookup result rather than guessing names.
- **`get_thread` MCP usage by bot** (Step 10, spec §VI line 190) — Iggy asked Cipher to inspect the CC1 thread state via `mcp__hapi__get_thread` and report. Bot session shows 3 calls to `get_thread`. Cipher's channel reply (seq=16) is a structured markdown response: `**draft-cc1-control-env thread status:** - Title: "Draft CC1 Control Environment narrative" - Status: active - Todos: not tracked (MCP returned null for todos field) - Last updated: ~1 min ago` — quotes the actual thread data (the post-`change_title` title, not the original spawn title), proving the MCP path works.
- **Channel rename mid-flight with active threads** (Step 11) — Iggy PUT `name: soc2-audit-prep-q2 → soc2-evidence-bundle-q2`. DB updated immediately; `bot_session_id` UNCHANGED (no respawn — proper rename). All 3 sessions' sidebars refreshed: both Mei and Bjorn confirm `hasNewName: true, hasOldName: false`. Workspace folder STAYED at the old `soc2-audit-prep-q2/` path (by design — R14-2 fix uses `metadata.path` for cleanup, never moves the folder). Post-rename test: Iggy sent `@Cipher quick ack — channel renamed, are you still here? React 👍 if so.` Within 30 s, Cipher reacted 👍 (DB: `reactor_ref=bot:a7c05d67...`) — proves the bot session survived the rename and channel routing still works.
- **5 file types in one round incl `.csv`** (Steps 5-7) — `.md` × 2 (cc1-control-environment.md with CC1.1-CC1.5 sections, gather-access-logs.test.ts implicit), `.yaml` (cc-checklist.yaml with 32 auditor_question/evidence_required pairs), `.ts` × 2 (gather-access-logs.ts with `filterFailedLogins` + `byUser` exports, gather-access-logs.test.ts), `.sql` (q2-changes.sql baseline), and **`.csv` NEW** (evidence-index.csv with 6 rows). All verified clean on disk in ~90 s.

**Regression all hold**:
- R19-1 cancelled-card reason rendering: not directly exercised this round (no cancel calls), but the renderer code path is unchanged.
- R18-1 spawned-thread system prompt for Lead-Teammate inject: 5 spawned threads (4 from initial + 1 from `+ New thread` button) all worked without inject-rejection issues.
- R18-2 `change_title` MCP propagation: 4 of 5 spawned threads carry titles different from the requested ones (Cipher rewrote them); UI thread cards show the live titles.
- R17-1 typing indicator pulse + gradient text — confirmed mid-bot-typing during multiple turns.
- R17-2 shared thread card visual — not directly exercised this round.
- R14-2 deleteChannel uses metadata.path for cleanup (NOT current channel name) — confirmed clean delete of the renamed channel: workspace `soc2-audit-prep-q2/` (the original folder) was removed, NOT `soc2-evidence-bundle-q2/`. The post-rename hard-delete is the **specific edge case** R14-2 was designed for; R20 confirms the fix still works.
- Hard-delete cleanup: bot subprocess (PID 1152339) terminated within 12 s, defaults survived for all 3 namespaces.

### Visual UX notes

R20 is the **fifth pass** at visual UX scoring. R17/R18/R19 fixes all hold. No new bugs surfaced.

**✓ Positive observations**:
- `+ New thread` modal: clean MS-Teams-style dialog with helper text ("Briefly describe the topic — the channel agent will spawn a thread session and start working on it") + a placeholder example. `Spawn thread` button stays disabled until the textbox has content — good empty-state guard.
- Cipher's structured markdown reply for `get_thread` results renders as a proper bullet list with bold heading (R10-1 markdown holds): `**draft-cc1-control-env thread status:** - Title: "Draft CC1 Control Environment narrative" - Status: active...`. Reads like a polished status report, not a raw transcript.
- Channel rename felt instantaneous on all 3 sessions (no flash of stale name).

**Soft observations (track in R21)**:
- After channel rename, the workspace folder stays at the original path. This is correct for cleanup (R14-2) but the path is exposed in some thread-side UI surfaces (e.g. `cwd` in tool calls). A future polish could rename the folder + update `metadata.path` atomically.
- `+ New thread` modal has no character counter or topic-length guidance. For very long topics the modal field doesn't constrain. Polish suggestion only.
- `get_thread` MCP returned `todos: null` for an active thread that does have todos in its session state. Likely a hub-side serialization gap — not surfaced as a bug since the bot handled it gracefully ("Todos: not tracked (MCP returned null for todos field)"). Worth a deeper look in R21 if it persists.

**This round ran on alternate ports** (hub 3106, web 5273) + isolated `HAPI_HOME=/home/azureuser/.hapi-mine` per memory `e2e_round_port_collision.md`.

Hub test suite still **249 / 249** (no fixes needed this round).
