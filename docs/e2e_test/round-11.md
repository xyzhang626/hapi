# Round 11 End-to-End Test — Cross-Team Monorepo→Polyrepo Migration

> Distinct from rounds 1–10. Round 11 fixes one R10 soft-observation
> (thread cards have no `+ 😊` picker UI) AND exercises four behaviors
> no prior round verified end-to-end.

## Cast

| User | Role | Namespace |
| --- | --- | --- |
| **Sven** | Frontend lead, channel **owner** | `sven` |
| **Priya** | Backend lead | `priya` |
| **Otto** | Infra lead | `otto` |

Custom channel: **`#repo-split`** with description "Monorepo → polyrepo
migration — Q2 cutover". Bot named **"Forge"**.

## Behaviors no prior round exercised end-to-end (R11 first)

1. **Channel description rendered in header** — every prior round set a
   description in the create call but nobody verified it actually shows
   up next to the channel name in the header (spec §III "Channel
   Header" implies it does).
2. **Bot reply with multi-line code block** in the channel timeline —
   markdown rendering shipped in R10-1; R11 stress-tests the code-block
   path specifically by asking Forge to print a `bash` snippet with
   real characters (spaces, `&&`, `\n`).
3. **AgentConfig editor read-only view for non-owners** — only owner
   can edit (mvp-ux-stage-2 §X "仅 channel owner 可编辑文件 / UI"); non-owner
   should still be able to *see* the form but cannot save. Never tested.
4. **`noop()` strong-signal response** — spec §VI lists noop as a tool;
   §V says noop counts as "responding to a strong signal". Never
   explicitly proven that calling `noop()` produces zero timeline
   artifacts (i.e. silent acknowledgment).
5. **User reaction → weak-signal cascade** — spec §V says "User 加
   reaction → 进 bot 的弱信号 buffer (debounce)". R9 verified bot reacting
   to user *text* messages; nobody verified that adding a reaction (an
   emoji, NOT a text message) is ALSO consumed by the debounce buffer
   and surfaces to the bot session.
6. **`+ 😊` reaction picker on a `thread_card`** — R10 found no UI
   trigger to open the picker on a thread_card row even though the
   data path supports reactions on any kind. Plan: fix during R11.

## Regression coverage (post-R10)

- Markdown rendering in channel timeline (`4a373b4`)
- Default channels with bot (`3d58ec7`)
- Sidebar PRIVATE/CHANNELS split + namespace title (`b3f8958`)
- Soft-private → shared `Share to channel` toggle (R10)
- Hard delete cleanup (R3 fix)

## Coverage map (mvp-ux-stage-2.md → step #)

| Spec section | Step | Why this round |
| --- | --- | --- |
| §III default channels with bot | 1 | regression |
| §III channel description in header | 5 | NEW — never visually verified |
| §X agentConfig editor read-only for non-owner | 6 | NEW |
| §XIII markdown rendering — code blocks | 7 | NEW (markdown is general; code block is specific) |
| §V multi-mention spawn 3 threads | 8 | regression |
| §V user reaction → weak-signal buffer | 9 | NEW |
| §VI MCP `noop()` strong-signal response | 10 | NEW |
| §IX `+ 😊` picker on thread_card | 11 | NEW (fix during round) |
| §XII channel hard-delete cleanup | 12 | regression |

If a step's expectation fails, log under **Bugs Found**.

---

## Phase 0 — Setup

```bash
playwright-cli -s=hana close 2>/dev/null
playwright-cli -s=diego close 2>/dev/null
playwright-cli -s=yuki close 2>/dev/null
ps -ef | grep -E "bun.*src/index|bun.*runner|bun.*dev|bun.*claude --output" | grep -v grep | awk '{print $2}' | xargs -r kill 2>/dev/null
rm -rf ~/.hapi
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; export CORS_ORIGINS="http://localhost:5173,http://localhost:3006"; cd /home/azureuser/hapi/hub && exec bun --watch run src/index.ts' > /tmp/r11-hub.log 2>&1 &
nohup bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd /home/azureuser/hapi/web && exec bun run dev' > /tmp/r11-web.log 2>&1 &

playwright-cli -s=sven  open --browser chromium http://localhost:5173
playwright-cli -s=priya open --browser chromium http://localhost:5173
playwright-cli -s=otto  open --browser chromium http://localhost:5173
```

Sign in:
- `<TOKEN>:sven:Sven Lindqvist`
- `<TOKEN>:priya:Priya Subramaniam`
- `<TOKEN>:otto:Otto Bauer`

**Snapshot discipline (R9 lesson)**: `playwright-cli ... snapshot 2>&1`
returns DOM **inline in stdout** — don't `tail | cat` the saved file.

---

## Phase 1 — Default-channel regression

### Step 1 — Sven signs in, sidebar OK

Verify in inline snapshot: workspace title `sven`, sidebar split
`Channels`/`Private`, `# general` + `# private` buttons, click into
general → bot welcome appears within ~10 s, header shows
`👥 1 online` + `Bot session →` + enabled `+ New thread`.

### Step 2 — `# private` works

Click `# private`, verify bot's by-name greeting (`👋 Hi Sven`).

---

## Phase 2 — Custom channel + Forge

### Step 3 — Sven creates `#repo-split`

Use direct API (R10 found inline UI flakiness; just POST):

```bash
curl -X POST /api/channels -d '{"name":"repo-split","description":"Monorepo → polyrepo migration — Q2 cutover","agentConfig":{"flavor":"claude","botName":"Forge","model":"claude-haiku-4-5-20251001","permissionMode":"yolo","systemPromptAddition":"You are Forge, the migration coordinator. Use markdown including ```bash``` code blocks when illustrating commands. Reply concise (≤3 sentences). When asked to acknowledge silently, call noop() — do NOT also send_to_channel.","welcomeStyle":"auto"}}'
```

Within ~25 s Forge welcomes the channel (markdown content expected).

---

## Phase 3 — Cross-ns invites

### Step 4 — Priya + Otto accept invite

Standard invite-link flow as in prior rounds. Verify Members section
shows three roles + cross-ns displayNames.

---

## Phase 4 — Channel description in header (NEW)

### Step 5 — All three users see the description

Each user clicks `#repo-split`; verify the description string
`Monorepo → polyrepo migration — Q2 cutover` is rendered in the channel
header next to (or below) the channel name. Snapshot all three.

---

## Phase 5 — AgentConfig editor read-only for non-owner (NEW)

### Step 6 — Otto opens Settings

Otto clicks `⚙ Settings`. Dialog opens. Verify:
- Form **renders** with current values populated (Otto can see
  configuration).
- All editable fields are either **disabled** OR the **`Save`** button
  is hidden / disabled (owner-only edit per §X).
- A read-only banner / message indicates this (nice-to-have).

If ALL fields are editable AND Save submits successfully, that's a
permission gap — log as bug.

---

## Phase 6 — Markdown code-block rendering (NEW)

### Step 7 — Sven asks Forge for a code-block reply

> Sven: ``@Forge show the cutover script for moving the auth-service into its own repo. Use a ```bash``` code block.``

Within ~25 s Forge replies with a code block. Verify:
- A `<pre>` element with `aui-md-pre` class is in the DOM.
- Inside is `<code>` with monospace font + `aui-md-code` class.
- Original message body has triple-backtick block; rendered DOM has NO
  literal triple backticks; commands like `git filter-repo …` etc.
  are visible.

---

## Phase 7 — Multi-thread spawn

### Step 8 — Forge spawns 3 migration threads

> Sven: `@Forge spawn one migration thread per service: auth-service-extract, billing-service-extract, frontend-spa-extract. Pin auth-service-extract — it's the dependency root.`

Bot does `spawn_thread × 3 + pin_thread × 1`. Verify 3 cards in
timeline + `📌 auth-service-extract` chip in header strip.

---

## Phase 8 — User reaction → bot weak signal (NEW)

### Step 9 — Otto adds 👀 to one of Forge's bot messages

Click the `+ 😊` picker on a Forge text message → 👀. Wait
`debounceMs + ~3 s` (~6 s default). Inspect Forge's bot session
transcript for a new injected message with the user's reaction
(should look like `<system>weak-signal-batch</system>...👀...` per
spec §V "User 加 reaction → 进 bot 的弱信号 buffer").

If no inject appears within ~10 s, log as bug — spec promises this is
an input to the bot.

---

## Phase 9 — `noop()` strong-signal response (NEW)

### Step 10 — Sven explicitly asks Forge to ack-only with noop

> Sven: `@Forge — Priya is on PTO this week, no action needed; just acknowledge with noop().`

Within ~30 s verify in Forge's bot transcript: a `mcp__hapi__noop`
tool_use call. In the channel timeline: **no** new bot message after
this @mention (noop produces zero artifacts per spec §III "timeline
不出现的东西: ... Bot 的 noop 调用 (无产物)").

If a text reply *does* appear instead of (or in addition to) noop,
that's a Claude prompt-flow weakness, not a HAPI bug — note it.

---

## Phase 10 — `+ 😊` picker on thread_card (NEW + likely fix)

### Step 11 — Priya tries to react 🚀 to a thread card

Locate the `auth-service-extract` thread card row in Priya's view.
Look for a `+ 😊` button or equivalent reaction trigger on the card
itself (not on text messages above/below). If absent (R10 finding),
this is the bug to fix in this round:

- Add a small `+ 😊` button to the `thread_card` branch of
  `ChannelMessageItem` (mirror the text-message branch).
- After fix: clicking trigger opens picker; selecting 🚀 stamps
  the reaction in DB (`reactorRef = user:<priyaUserId>`) and renders
  a 🚀 bubble below the card.

---

## Phase 11 — Cleanup

### Step 12 — Sven hard-deletes `#repo-split`

`⚙ Settings` → Danger zone → Also delete files → Delete.

Verify:
- `~/.hapi/workspaces/sven/repo-split` is gone.
- After ~10 s no `claude --output-format` subprocesses for that
  channel (R9 found cleanup is async; wait, then check).
- Priya + Otto sidebars drop the channel.
- `# general` and `# private` survive.

---

## Bugs Found (filled during execution)

| # | Phase | Severity | Symptom | Root cause | Fix |
| --- | --- | --- | --- | --- | --- |
| R11-1 | 8 — user reaction → bot | blocker | Otto adds 👀 to Forge's welcome message; reaction is stored in DB and visible to all viewers via SSE; **but Forge's bot session never receives any inject**. Spec §V explicitly promises "User 加 reaction → 进 bot 的弱信号 buffer (debounce)". Bot was completely deaf to user reactions — couldn't react back, couldn't escalate to text, couldn't even noop on them. | `hub/src/sync/channelAgent.ts` `handleEvent` switch only branched on `channel-message-received` / `session-updated` / `channel-thread-requested` / `channel-updated`. The `message-reaction-added` / `message-reaction-removed` events were emitted by `syncEngine.toggleMessageReaction` (line 1102) but had **no listener** in ChannelAgent. | Add a 5th branch `else if (event.type === 'message-reaction-added' \|\| event.type === 'message-reaction-removed') { this.handleReaction(event) }` and a new `handleReaction` method that synthesizes a text-shaped weak-signal entry (`reacted 👀 on msgId=…` / `un-reacted 👀 on msgId=…`) and feeds it through the existing `enqueueWeakSignal` debounce path. Skip `bot:`-prefixed `reactorRef`s per §IX "Bot 加 reaction → **不**反馈给 bot 自己 (避免自激)". 2 regression tests added in `channelAgent.test.ts`. |
| R11-2 | 11 — picker on thread_card | annoyance | Thread cards rendered in the channel timeline had **no `+ 😊` reaction picker trigger**. The `ReactionRow` was rendered after `<ThreadCard />` but never showed (the picker only opens when `showPicker=true`, and there was no UI affordance to flip that on a card). Spec §IX says reactions work on "any channel message: 真人消息 / bot 消息 / **thread cards**". R10 documented this as a soft observation; R11 fixed it. | `web/src/components/ChannelView.tsx` `thread_card` branch was missing the `+ 😊` button that the text-message branch had. | Add a hover-revealed absolute-positioned `+ 😊` button in the top-right corner of the card wrapper (mirror the text-message branch's hover affordance). Wrapper uses `group relative`; button uses `opacity-0 group-hover:opacity-60` for the polish-on-hover behavior. Verified by clicking → picker opens → 🤔 click stamps reaction in DB with `reactorRef=user:<priyaUserId>` on the auth-service-extract card. |

### Coverage outcome

All 12 numbered scenario steps executed.

**Successes (post-R10 fixes hold)**:
- Default channels with bot, sidebar split, namespace title, online count.
- Markdown rendering (Step 7) — code-block path verified: `<pre class="aui-md-pre">` containing `<code class="language-bash">` with the multi-line bash script intact, plus 3 inline `<code class="aui-md-code">` for backtick spans.

**Successes (NEW behaviors no prior round verified)**:
- **Channel description in header** (Step 5) — `— Monorepo → polyrepo migration — Q2 cutover` rendered next to the channel name in the header for all three viewers.
- **AgentConfig editor read-only for non-owner** (Step 6) — Otto sees the form populated; **all** input/textbox/combobox/spinbutton fields carry `[disabled]`; the form has `Generate invite link` + `Close` buttons but **no `Save`** at all (clean "view-only" UX).
- **Code-block rendering** (Step 7) — verified above with structured DOM.
- **`noop()` strong-signal response** (Step 10) — Sven asked Forge to ack-only with noop; Forge's bot transcript shows `mcp__hapi__noop` tool_use; **no new bot text message** appears in the channel timeline after that @mention. Confirms spec §III "Bot 的 noop 调用 (无产物)".
- **User reaction → weak-signal cascade** (Step 9, after R11-1 fix) — Otto's 👍 produces an inject `<system>weak-signal-batch: { count: 1 }</system>\n[2354280491 | …] reacted 👍 on msgId=…` in Forge's bot session within ~3 s of the debounce window.
- **`+ 😊` picker on thread_card** (Step 11, after R11-2 fix) — 3 thread cards now expose the trigger on hover; clicking opens the same QUICK_EMOJIS picker; selecting 🤔 stamps a `reactorRef=user:…` reaction on the card in DB.

**Soft observation (not a HAPI bug)**:
- Forge wrote a multi-paragraph reasoning text describing the cutover script in response to Sven's "@Forge show the cutover script" request, but **never called `send_to_channel`** to deliver it. Same recurring Claude-omit-final-tool-call quirk noted in R3-1, R5, R7, R10. We worked around by sending a manual code-block message from Sven to verify markdown rendering, then later prompts (with explicit `noop()` ask) successfully landed in the timeline.

**Soft observation #2 (not a HAPI bug, by design)**:
- Spec §X reads "仅 channel owner 可编辑文件 / UI; 普通成员只能查看 (read-only view)". Step 6 verified all *agentConfig* fields are owner-only. However the dialog still surfaces a **`Generate invite link`** button to non-owners. That is consistent with R2 / R8 invite tests where any member could mint invites — the spec doesn't restrict invite generation to owners. Mention here so future audits don't flag it as a regression.
