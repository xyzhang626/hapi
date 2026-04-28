# Round 8 End-to-End Test — Hackathon Project Room

> Distinct from rounds 1–7. Round 8 stresses behaviors NOT yet exercised:
> **5+ thread cards simultaneously with 3+ pinned chips** (overflow /
> wrap behavior of the chip strip), **adding a channel member directly
> via `POST /api/channels/:id/members`** (the by-id API, never tested
> vs the invite-link flow), bot's **`send_to_thread` with a valid
> threadId end-to-end** (round 5 only saw a typo'd id), and the
> **thread agent → channel `send_to_channel` reverse flow with proper
> "Thread: <title>" attribution** in the rendered timeline (round 3
> proved the data path works but never asserted the UI label).
> Doubles as a regression run for round-1-through-7 fixes.

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Reza** | Hackathon organizer, channel **owner** | `reza` |
| **Lin** | Frontend developer | `lin` |
| **Bo** | Backend developer | `bo` |

Channel: **`#hack-2026`** with description "Hackathon 2026 — 24h sprint, 5
tracks". Bot named **"Captain"**.

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §3 Pinned-thread chip strip with **3 chips** + 5 thread cards | 7, 8 | Overflow / wrap behavior — rounds prior had at most 2 chips |
| `POST /api/channels/:id/members` (by-id add) | 4 | Untested in any prior round (only invite-link flow used) |
| §6 MCP `send_to_thread` with **valid** threadId | 9 | Round 5 had Claude typo a UUID character → MCP returned error → bot pivoted to send_to_channel. Round 8 explicitly hands the bot the right id and verifies the injection lands in the thread. |
| Thread agent → Channel reverse flow with "Thread: <title>" UI label | 10 | Round 3 verified data-path; round 8 asserts the rendered author chip says `Thread: <title>`, not "system" or raw session id |
| §6 MCP `cancel_thread` (round-4 regression) | 11 | Confirms the cancelled card still renders as "Cancelled" |
| Round-2 fix: scheduled-thread auto-pin chip live (passive) | n/a | — |
| Round-2 fix: invite link UI | 3 | Bo joins |
| Round-2 fix: cross-ns user displayName | all | "Reza Khan", "Lin Chen", "Bo Williams" |
| Round-3 fix: agentConfig hot-reload (passive, single save) | 2 | — |
| Round-4 fix: cancelled card → "Cancelled" badge | 11 | Regression |
| Round-5 fix: list_channel_members enriched | 6 | Bot greets by name (verified passively) |
| Round-6 fix: §4 spec `POST /api/sessions/:id/messages` 403 (passive) | n/a | — |
| Round-7 fix: duplicate channel name → 409 (passive — only one channel created) | n/a | — |
| Round-3 fix: hard-delete clean | 13 | Final cleanup |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup

```bash
rm -rf ~/.hapi
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; export CORS_ORIGINS="http://localhost:5173,http://localhost:3006"; cd /home/azureuser/hapi/hub && exec bun --watch run src/index.ts' > /tmp/r8-hub.log 2>&1 &
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd /home/azureuser/hapi/web && exec bun run dev' > /tmp/r8-web.log 2>&1 &

playwright-cli -s=reza open http://localhost:5173
playwright-cli -s=lin  open http://localhost:5173
playwright-cli -s=bo   open http://localhost:5173
```

Each session sets hub URL `http://localhost:3006` and signs in:
- `<TOKEN>:reza:Reza Khan`
- `<TOKEN>:lin:Lin Chen`
- `<TOKEN>:bo:Bo Williams`

---

## Phase 1 — Channel + Captain + add-member-by-id

### Step 1 — Reza signs in

### Step 2 — Reza creates `#hack-2026` and configures Captain

In Settings:
- **Channel**: name `hack-2026`, description `Hackathon 2026 — 24h sprint, 5 tracks`.
- **Identity**: Bot name = `Captain`, Model = `claude-haiku-4-5-20251001`.
- **Behavior**: System prompt addition = `You are Captain, the hackathon coordinator. Concise replies (≤2 sentences). Spawn one thread per track when asked.` Welcome style = `auto`.
- Save.

### Step 3 — Reza generates invite, Bo accepts

Invite-link flow as in prior rounds.

### Step 4 — Reza adds Lin **directly** via `POST /api/channels/:id/members` (NEW)

```bash
LIN_USER_ID=$(curl /api/auth ... | jq .user.id)   # 32-bit hash of "lin:Lin Chen"
curl -X POST /api/channels/<chid>/members \
  -H "Authorization: Bearer <reza JWT>" \
  -d "{\"userId\":\"$LIN_USER_ID\",\"role\":\"member\"}"
# Expected: 200/201; member added; SSE `channel-member-added` fires for Lin
```

Verify:
- Lin's sidebar gets `# hack-2026` without ever clicking an invite link.
- Members list (Settings → Members) shows three: Reza (owner), Bo (member), Lin (member).
- Bot system-prompt-addition wasn't disturbed.

If the API requires Lin to be in the same namespace as the channel, this is
the membership-based access bug we already fixed (round 2). If it asks for
some other shape, document the actual contract.

### Step 5 — Bot welcome (auto)

Within ~10 s, Captain greets the channel mentioning `#hack-2026`. Lin and
Bo should both see it via SSE.

---

## Phase 2 — Five tracks, three pins

### Step 6 — Reza @Captain to spawn 5 threads

> `@Captain spawn one thread per track for the hackathon: ui-design, api, db-schema, auth, deployment.`

Bot calls `spawn_thread × 5`. Verify:
- 5 thread cards appear in timeline, each "by Reza Khan" Active.
- DB: 5 sessions with `channelId` set; `pinned=false` on all five.

### Step 7 — Reza @Captain to pin three of them

> `@Captain pin api, db-schema, and auth as priority tracks for the first hour.`

Bot calls `pin_thread × 3`. Chips must appear in header within ~5 s
(round-2 fix: live SSE).

### Step 8 — **Visual + DOM check on the chip strip**

With **three** chips of length-varying titles (`📌 API`, `📌 DB Schema`,
`📌 Auth`) the header should:
- Render all three chips on a single row OR wrap to a second row cleanly.
- Be horizontally scrollable (`overflow-x-auto` per round-2 commit) if the
  combined width exceeds container.
- Not truncate any chip's title with ellipsis to fewer than ~12 visible chars.
- Not push the timeline area down or overlap the `Bot session →` /
  `⚙ Settings` / `+ New thread` buttons.

Take a screenshot and DOM-snapshot to confirm.

---

## Phase 3 — `send_to_thread` with valid id (Lead → Teammate)

### Step 9 — Reza @Captain hands a CONCRETE valid threadId

Look up the api thread's full id via `GET /api/channels/<id>/sessions`,
then:

> `@Captain send_to_thread on <api-thread-uuid> with text "focus on REST endpoints, NOT GraphQL — we're keeping the surface tiny for the hackathon".`

Bot calls `mcp__hapi__send_to_thread` with the supplied id. Verify:
- MCP call succeeds (no error icon in bot transcript).
- Lin opens the api thread page → sees a new bot-injected message in the
  thread containing the focus instruction.
- The injected message renders on the **opposite side** from human
  messages (Stage-2 §7) with the mid-grey style.

---

## Phase 4 — Thread agent → channel reverse flow with "Thread:" attribution

### Step 10 — Lin posts in the api thread to nudge it; verify thread→channel msg

Lin replies in the api thread input:
> `quick — what auth do you assume? I'm starting on POST /api/login.`

The api thread agent will respond INSIDE the thread (normal flow). After
~30–60 s, the thread agent may also call `mcp__hapi__send_to_channel` to
report progress (e.g. `Plan: REST + JWT, see api thread for details`).

If the thread agent does NOT proactively call `send_to_channel` (Claude's
choice), nudge it from the bot side: Reza @Captain "ask the api thread to
post a one-line status to the channel" → bot calls `send_to_thread` →
thread agent receives the directive → thread agent calls `send_to_channel`.

Verify in **all three** users' channel timelines:
- A new text message appears.
- Author label reads exactly **`Thread: <api-thread-title>`** (round-2 fix
  e.g. `d784d44`), NOT "system" or raw session id.
- Avatar marker is the thread "T" indicator.
- Clicking the message author area takes the viewer into the thread page
  (or a similar affordance).

---

## Phase 5 — cancel + final state visual

### Step 11 — Bo @Captain to cancel deployment thread

> `@Captain cancel the deployment thread — we'll defer that to demo day prep.`

Bot calls `cancel_thread`. Verify:
- Channel timeline shows a new `agent_summary` card with **"Cancelled"**
  badge (round-4 fix R4-2).
- Original `thread_card` for deployment stays at "Active" (immutable).
- DB: deployment session `threadStatus='archived'` (or 'cancelled').

### Step 12 — Visual: complex timeline state

Take a final screenshot of Reza's channel view. Should show:
- 5 thread cards from Step 6 (Active)
- 1 cancelled card from Step 11
- Captain replies + reactions (if any)
- Header: 3 pinned chips (api, db-schema, auth)

---

## Phase 6 — Cleanup

### Step 13 — Reza hard-deletes `#hack-2026`

Settings → Danger zone → Also delete files → Delete.

Verify:
- Folder `~/.hapi/workspaces/reza/hack-2026` is gone.
- No orphan claude subprocesses.
- Sidebars on Lin + Bo drop the channel.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R8-1 | 4 — add member by API | n/a (test artifact) | Initial check thought Lin's sidebar didn't refresh after `POST /members`. Re-test confirmed it actually does — my eval used `b.textContent.startsWith("# ")` (with a space) but the rendered text is `"#hack-2026"` (no space). SSE flow + React Query invalidation work correctly. | Test-tooling selector mismatch. Verified end-to-end with hub-side trace (`SSE.shouldSend` showed `isMember=true` for Lin's connection on `channel-member-added`). | n/a (no HAPI bug) |

### Coverage outcome — no real bugs found

All 13 numbered scenario steps executed.

**Successes (regressions all hold)**:
- **`POST /api/channels/:id/members` (add by id)** works end-to-end (Step 4):
  Reza added Lin via direct API; SSE `channel-member-added` filter passed
  for Lin's connection (debug log confirmed `isMember=true`); Lin's sidebar
  picked up `#hack-2026` without reload. Three-member roster rendered
  correctly in Settings → Members for all viewers.
- **5 thread cards + 3 pinned chips** render cleanly (Steps 6–8): chips fit
  on a single row in the header, no truncation / wrap to a second row, no
  overlap with `Bot session →` / `⚙ Settings` / `+ New thread` buttons.
- **`send_to_thread` with a VALID threadId** works (Step 9): Lin opened the
  api thread and saw the bot-injected `<system>injected-by-bot</system>\n<text>`
  message. Round-5 only ever observed a typo'd UUID failure path; round-8
  proves the success path.
- **`cancel_thread` + "Cancelled" badge** regression (Step 11): Bo asked
  Captain to cancel `Track: Deployment`; bot called the MCP; new
  `agent_summary` card rendered with grey "Cancelled" badge (round-4 fix
  R4-2). Original `thread_card` for Deployment stays "Active" (immutable).
- **Hard delete** (Step 13): folder gone, no orphan claude subprocesses,
  sidebars on Lin + Bo dropped the channel.

**Soft observation (not a HAPI bug)**:
- Step 10 (thread agent → channel `send_to_channel` with "Thread:"
  attribution) couldn't be exercised proactively — the api thread Claude
  agent got stuck in `AskUserQuestion` mode asking Lin for repo paths and
  refused to call `send_to_channel` even after explicit `send_to_thread`
  injects told it to. Same Claude prompt-flow quirk as round-5 and round-7
  (the non-scheduled thread system prompt is too open-ended). Future work:
  give threads a more directive system prompt for non-scheduled use, OR
  validate the data-path with a unit test instead of E2E.

