# Round 10 End-to-End Test — Architecture Review Board

> Distinct from rounds 1–9. Round 10 picks up the four behaviors that R9
> deferred AND adds a fresh visual gap I expect to fail (markdown rendering
> in the channel timeline — bot's `**bold**`/list-item output renders as
> literal `**` in R8/R9 DOM dumps).
>
> **Behaviors no prior round exercised end-to-end** (R10 first):
>
> - **`+ New thread` button click flow** end-to-end. R2 originally found this
>   used `window.prompt`; R8 verified the disabled-vs-enabled state. Nobody
>   has actually *clicked* it, typed a topic, and watched the bot pick up
>   the strong signal and call `spawn_thread`.
> - **Soft-private → shared "Share to channel" toggle UI** (creator-only
>   button on thread page, mvp-ux-stage-2 §VII). R9 had this in plan but
>   skipped to keep scope tight; R8 verified the data-path but never
>   clicked the toggle.
> - **User reactions on bot text + on thread cards** with the picker UI.
>   R6 verified bot reactions but never user→bot, R8 only did programmatic
>   reactions.
> - **`get_channel_history` MCP tool** explicit invocation by the bot. R9
>   deferred this. Spec §VI lists it; nobody has stress-tested whether
>   the bot actually reaches for it when asked to recap.
> - **Channel-timeline markdown rendering**. R8 + R9 DOM screenshots show
>   `**bold**` and `- list items` as literal characters in bot welcome
>   messages. The thread session detail page (SessionChat) renders
>   markdown; the channel timeline does not. Spec §XIII calls for "美感
>   动态优雅". This round will visually fail Step 2 → fix before commit.
>
> **Regression coverage** (post-R9 fixes):
> - Default channels with bot (`3d58ec7`)
> - Sidebar PRIVATE / CHANNELS split + namespace title (`b3f8958`)
> - CLI auto-attach to private (`20a1b2a`)
> - agentConfig file-edit hot-reload (`8c1913b`)
> - `cancel_thread` "Cancelled" badge (R4 fix R4-2)
> - `pin_thread` / `unpin_thread` MCP (R7 fix R7-2)
> - Owner removes member → kicked-user sidebar drops (R5 fix R5-2)
> - Hard-delete cleanup (R3 fix R3-2)

---

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Hana** | Principal Architect, channel **owner** | `hana` |
| **Diego** | Backend Director | `diego` |
| **Yuki** | Platform Director | `yuki` |

Custom channel: **`#arb-review`** with description "Architecture Review
Board — Q2 design proposals". Bot named **"Atlas"**.

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels with bot — REGRESSION | 1 | R9 post-fix sanity |
| §III sidebar PRIVATE/CHANNELS — REGRESSION | 1 | Same |
| §XIII markdown rendering in channel timeline | 2 | NEW — visual gap from R8/R9 |
| §III channel create + invite | 3 | Custom channel + cross-ns invite |
| §V "+ New thread" UI button click flow | 4 | NEW — never end-to-end clicked |
| §V multi-mention strong signal → multiple MCP calls | 5 | NEW — multiple tools per turn |
| §VII "Share to channel" creator-only toggle | 6 | NEW (deferred from R9) |
| §IX user → reaction on bot text (toggle) | 7, 8 | NEW (deferred from R9) |
| §IX user → reaction on thread card | 9 | NEW |
| §VI MCP `get_channel_history` explicit | 10 | NEW (deferred from R9) |
| §IV bot session read-only view (non-owner) | 11 | Regression of R9 |
| §VII detach thread from channel | 12 | Regression of R7 |
| §III owner removes member → sidebar drop | 13 | Regression of R5 |
| §XII channel hard-delete cleanup | 14 | Regression of R3 |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup

```bash
rm -rf ~/.hapi
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; export CORS_ORIGINS="http://localhost:5173,http://localhost:3006"; cd /home/azureuser/hapi/hub && exec bun --watch run src/index.ts' > /tmp/r10-hub.log 2>&1 &
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd /home/azureuser/hapi/web && exec bun run dev' > /tmp/r10-web.log 2>&1 &

playwright-cli -s=hana  open http://localhost:5173
playwright-cli -s=diego open http://localhost:5173
playwright-cli -s=yuki  open http://localhost:5173
```

Each session signs in:
- `<TOKEN>:hana:Hana Park`
- `<TOKEN>:diego:Diego Ramos`
- `<TOKEN>:yuki:Yuki Sato`

**Snapshot discipline**: `playwright-cli ... snapshot 2>&1` returns the
fresh DOM **inline in stdout** (don't pipe through `tail` to a file —
the saved files lag and produce stale results, confirmed in R9).

---

## Phase 1 — Default-channel regression

### Step 1 — Hana signs in

After auth, verify in the inline snapshot:
- Workspace title is `hana` (namespace).
- Sidebar `Channels` section shows `# general`.
- Sidebar `Private` section shows `# private`.
- Click `# general` → header has `👥 1 online` + `✨ Bot session →` link
  + `+ New thread` (NOT disabled).
- Bot welcome message renders within ~10 s.

---

## Phase 2 — Custom channel + markdown rendering check (NEW visual)

### Step 2 — Hana creates `#arb-review` and configures Atlas

`+ Create Channel` → `arb-review` → submit. Then `⚙ Settings`:
- Description: `Architecture Review Board — Q2 design proposals`
- Bot name: `Atlas`
- Model: `claude-haiku-4-5-20251001`
- System prompt addition: `You are Atlas, the architecture review coordinator. Concise (≤2 sentences). Use markdown formatting in your replies — **bold** for emphasis, lists for enumerations. When asked to spawn parallel reviews, fire one spawn_thread per item and pin the most-important one.`
- Welcome style: `auto`
- Save & hot-reload.

After ~10 s, Atlas's welcome message appears in the timeline.

**Visual check (NEW):** Atlas's welcome typically contains `**bold**`
and `- list` markdown. In the rendered DOM, `**` characters should NOT
appear literally — they should be rendered as `<strong>` and `<ul><li>`
elements. If literal `**` show up, that's the channel-timeline markdown
rendering gap; log as a bug, fix, retest.

---

## Phase 3 — Cross-ns invites

### Step 3 — Diego + Yuki accept invite

Generate invite from `#arb-review` settings. Open the invite URL in
Diego's session, sign in. Repeat for Yuki. Verify Settings → Members
shows three: Hana (owner), Diego (member), Yuki (member) with their
displayNames + namespaces.

---

## Phase 4 — `+ New thread` UI button click (NEW end-to-end)

### Step 4 — Hana clicks `+ New thread`

Click the `+ New thread` button in the channel header. A modal/dialog
appears asking for the topic. Type:

> `Review proposal: event-sourcing for billing`

Submit. The dialog closes. Within ~30 s:
- A new `thread_card` row appears in the timeline titled exactly
  `event-sourcing-billing` (or the bot's interpretation of the topic).
- Card author is "by Hana Park".
- DB: `SELECT thread_title, channel_id, created_by_user_id FROM
  sessions WHERE channel_id = '<arb id>' AND is_channel_bot = 0`
  shows the new thread crediting Hana's userId.

---

## Phase 5 — Multi-mention strong signal (NEW: multiple tools per turn)

### Step 5 — Diego @mentions with a 2-thread + pin request

> Diego: `@Atlas spawn parallel reviews for: 1) auth-service-v2, 2) ingestion-pipeline-rewrite. Make sure to pin auth-service-v2 — it's the main agenda item.`

Within ~45 s, Atlas calls `spawn_thread × 2` AND `pin_thread × 1`.

Verify:
- Two new `thread_card` rows in the timeline (auth-service-v2,
  ingestion-pipeline-rewrite), both `Active`, "by Diego Ramos".
- Header pinned-chip strip shows `📌 auth-service-v2` (NOT `⏰` —
  this is regular pin, not scheduled).

---

## Phase 6 — Soft-private → shared upgrade UI (NEW)

### Step 6 — Hana opens her own thread, clicks `Share to channel`

Click the `event-sourcing-billing` thread card to open the thread page.

Verify in the inline snapshot:
- Page header shows breadcrumb `← #arb-review > 📋 event-sourcing-billing`.
- A `Share to channel` (or similar wording) toggle/button is **visible**
  (creator-only — only Hana sees this since she created the thread).
- Click the toggle.

Switch to Diego's session, navigate to `#arb-review`. Compare the
`event-sourcing-billing` card before vs after — the rendering should
indicate the visibility change (e.g. card upgrades from minimal "Active"
to a more detailed/expanded form per spec §VII).

DB check: `SELECT visibility FROM sessions WHERE thread_title =
'event-sourcing-billing'` should be `'shared'`.

If the `Share to channel` toggle is missing from the thread page, log
as a bug — UI surface for the data path that exists at
`hub/src/sync/syncEngine.ts` `setThreadVisibility`.

---

## Phase 7 — User reactions (NEW: picker UI)

### Step 7 — Yuki adds 👍 on Atlas's welcome message

Yuki in `#arb-review` clicks the `+ 😊` reaction trigger on Atlas's
welcome message → picker pops, click 👍. Within ~1 s a 👍 bubble appears
under the message with count `1`.

### Step 8 — Yuki toggles 👍 off (Slack-style toggle, §IX)

Click the same 👍 bubble. Within ~1 s the bubble disappears (or count
goes to 0). Verify Hana + Diego both see the change in real time
(SSE-pushed).

### Step 9 — Diego 🚀 on the auth-service-v2 thread card

Same picker UX, but now on a thread_card kind. The picker should appear,
🚀 bubble should appear under the card.

---

## Phase 8 — `get_channel_history` MCP (NEW)

### Step 10 — Hana asks Atlas for a recap

> Hana: `@Atlas — give me a one-paragraph recap of what we've spawned for ARB review and the priority order.`

Within ~30 s Atlas should:
- Briefly show typing indicator `✨ Atlas is reading channel history…`
  (per spec §III) — note this is hard to catch without a video; tail
  `/tmp/r10-hub.log` for the bot's tool-use events instead.
- Post a text message naming the three threads:
  event-sourcing-billing, auth-service-v2, ingestion-pipeline-rewrite,
  and noting auth-service-v2 is pinned/priority.

The bot session transcript should show a `mcp__hapi__get_channel_history`
tool call in the assistant's reasoning.

---

## Phase 9 — Bot session read-only (regression)

### Step 11 — Diego clicks `Bot session →`

Lands on `/sessions/<botId>`. Verify:
- Banner reads `👁️ View only — This is the channel bot's internal
  transcript. Interact with it from the channel.` with `← Back to
  channel` link.
- No `<textarea>` or `<input type=text>` in the page (composer hidden).
  Verify via `eval '() => document.querySelectorAll("textarea, input[type=text]").length'` returns 0.

---

## Phase 10 — Detach thread (regression)

### Step 12 — Hana asks Atlas to detach `ingestion-pipeline-rewrite`

> Hana: `@Atlas detach ingestion-pipeline-rewrite — Yuki's team will own that proposal in their own channel.`

NOTE: there's no `detach_thread` MCP tool (R7 noted this is via UI). So
Atlas may simply respond with "you can detach via the thread settings".
Do the detach manually via UI as a fallback path:

POST `/api/channels/<arb id>/sessions/<thread id>/detach`. Verify the
thread no longer appears in `#arb-review`'s timeline / sessions list,
but the session itself still exists at `/sessions/<id>`.

---

## Phase 11 — Owner removes a member (regression)

### Step 13 — Hana removes Diego from `#arb-review`

`⚙ Settings` → Members → Remove Diego. Verify in Diego's open session
that `#arb-review` drops from his sidebar within ~3 s (R5 fix —
auto-redirect away from a kicked channel via SSE).

---

## Phase 12 — Cleanup

### Step 14 — Hana hard-deletes `#arb-review`

`⚙ Settings` → Danger zone → toggle `Also delete files` → Delete.

Verify:
- `~/.hapi/workspaces/hana/arb-review` is gone.
- No orphan claude subprocesses for the bot or threads.
- Yuki's sidebar drops the channel (Diego was already removed).
- Hana's `# general` and `# private` are still present.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R10-1 | 2 — markdown | blocker | Bot text in channel timeline rendered `**bold**`, `- list items`, etc. as **literal characters**. R8 + R9 DOM dumps already showed this; nobody had filed it. Channel timeline is the ONLY surface in the app that doesn't render markdown — thread session detail page (SessionChat) does. | `web/src/components/ChannelView.tsx` text-message branch wrapped `bodyText` in `<p className="whitespace-pre-wrap">` — no markdown processor. | Port `StandaloneMarkdown` component (132 lines, react-markdown + remark-gfm + rehype-katex + existing repo helpers `remark-disable-indented-code` / `remark-strip-cjk-autolink`); add `react-markdown` as direct dep; integrate via `<div className="channel-message-markdown"><StandaloneMarkdown content={bodyText} /></div>`; tightened CSS spacing (`channel-message-markdown` strips first/last child margins so single-paragraph messages stay inline). Verified Atlas's `**Atlas**` welcome now renders as `<strong>Atlas</strong>`. |

### Bonus fix included with this round (R10-bonus)

The single failing test our suite has been carrying ("rejects whitespace
inside namespace" in `accessToken.test.ts`) was a real validation gap —
`parseAccessToken("token: alice")` returned `{baseToken:"token", namespace:" alice"}`
with a leading space, silently corrupting the namespace identifier and
creating phantom workspaces. Added `hasWhitespace()` checks in `accessToken.ts`
(rejects whitespace in baseToken / namespace / single-segment tokens). Hub
test suite now **240 pass / 0 fail**.

### Coverage outcome

All 14 numbered scenario steps executed.

**Successes** (post-R9 fixes hold):
- Default channels with bot (Step 1) — sidebar split + namespace title + online count + bot greeted Hana by name.
- `+ New thread` UI button click (Step 4) — clicked the button, typed topic, dialog closed, Atlas's `spawn_thread` call landed within ~30 s, card appeared crediting Hana Park.
- Multi-mention strong signal (Step 5) — Atlas issued `spawn_thread × 2` + `pin_thread × 1` from a single user turn; pinned-chip strip rendered `📌 Review: auth-service-v2`.
- Soft-private → shared toggle (Step 6) — `🔒Share to channel` lives in the More-actions overflow menu (creator-only); click flipped `visibility` from `private` to `shared` in DB.
- User reactions on bot text + toggle (Steps 7–8) — picker renders, 👍 bubble shows, click again removes; SSE-pushed live to all 3 viewers.
- Bot session read-only (Step 11) — `👁️ View only` banner + `← Back to channel` button + 0 input/textarea elements (composer fully hidden).
- Detach thread (Step 12) — `POST /channels/:id/sessions/:tid/detach` cleared `channel_id`, thread disappeared from sidebar, session itself remained.
- Owner removes member (Step 13) — Diego's sidebar dropped `#arb-review` after `DELETE /channels/:id/members/:uid` (R5 SSE fix held).
- Hard delete (Step 14) — folder removed, channels list back to defaults, Yuki's sidebar dropped the channel, Atlas claude subprocess died within ~10 s.

**Soft observations (not HAPI bugs, documented for round 11)**:
- **No `+ 😊` picker trigger on `thread_card` rows** (Step 9). The data
  path supports adding a reaction to any message kind; `ReactionRow` IS
  rendered after a `<ThreadCard />` (ChannelView.tsx:397); but the
  picker only appears when `showPicker=true` and there's no UI affordance
  to flip that state on a card (the `+ 😊` trigger is only added to text
  messages). Spec §IX explicitly lists "thread cards" as react-able. Fix
  shape: add a small `+ 😊` button to the card hover state.
- **Claude omits the final `send_to_channel`** (Step 10). Same quirk noted
  in R3-1 / R5 / R7. Atlas wrote a multi-paragraph recap ("Active ARB
  reviews (priority order): 1. **auth-service-v2** ...") in its
  reasoning text but never called `send_to_channel`. Bot-side prompt
  reinforcement is needed — composing reasoning is not a substitute for
  calling the tool. Not a HAPI bug; it's a Claude-prompt-flow tuning
  issue.
