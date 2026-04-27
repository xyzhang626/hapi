# MVP UX Stage 2: Channel Bot as Persistent Agent Session

> Stage 2 重新定义 Channel Bot 的本质 — 从 hub 内置事件函数升级为常驻 agent session,借鉴 Claude Code 已经验证过的 `/loop` + `Channels` + `Routines` + `Agent Teams` 心智模型。

---

## 核心转变

之前 (Stage 1):

```
ChannelAgent = hub 进程内的事件 listener
  ↓ setInterval / on('message')
  → 识别 @mention → 调 spawnSession 创建 thread
  → 自动生成 thread_card / agent_summary
```

现在 (Stage 2):

```
Channel Bot = 一个常驻的 Claude Code session,跑在 Runner 上
  ├── Channel 监听 (事件驱动): 用户消息推送进 bot session
  ├── Bot 通过 MCP 工具回复 channel / 创建 thread / 协调 thread
  └── 与 Thread Agent 关系 = Lead-Teammate (Agent Teams 模式)

Hub 的角色: 路由 + 鉴权 + 状态存储 (不调 LLM)
```

Channel bot 不再是函数,而是**有自己 session、自己工作目录、自己 transcript 的 agent**。Hub 只负责把 channel 消息 forward 进 bot session,bot 自己用 MCP 工具决定怎么响应。

---

## 一、Bot Lifecycle

### 自动 spawn

- Channel 创建瞬间 (有 `agentConfig`) → Hub 立即在 runner 上 spawn 一个 bot session
- Bot session 标记 `is_channel_bot = true`,`channel_id` 反向关联
- Bot 不参与 `attachSessionToChannel` 机制 (那是 thread 用的);bot 是 channel 的"工作人员",不是"参与者"

### Hub Embedded Runner

为消除"channel 创建时没有 runner 在线"这个 edge case:

- Hub 启动时 fork 一个 `startRunner` subprocess,指向自己的 `ws://localhost:HUB_PORT`
- 复用 `cli/src/runner/run.ts` 全部代码,零分叉
- Lifecycle 跟 hub 进程绑
- 用户接入自己的远程 runner 后,可在 channel 设置切换"这个 channel 用哪个 runner"
- **默认工作目录**: `~/.hapi/workspaces/{namespace}/{channelName}`

### 崩溃恢复

- Bot session 意外崩溃 (含 Claude rate limit 后被 kill) → Hub watchdog 检测到
- Hub auto-restart bot,**复用原 sessionId**,session resume 拉回历史 context
- 对用户透明,只在重启过程的 typing-indicator 文字会有短暂"Reconnecting..."

### 配置变更

- `agentConfig` 文件被改 → Hub 注入 `__config_updated` 系统消息进 bot session
- Bot 自适应或必要时重启

---

## 二、Bot 身份 / 名字

- `botName` 字段在 `agentConfig` 里,默认 `"Agent"`
- 用户可改成任意名字 (`"PM Bot"` / `"小丑"` / `"Sherlock"`)
- 在 channel 消息中: `authorUserId = null`,渲染时显示 botName + 区别于人类用户的 avatar
- Strong signal 触发的 @mention alias: `@<botName>` + `@agent` + `@claude` (兜底)

---

## 三、Channel UI

### Timeline (主视图)

只显示**两类**消息:

1. 真人用户消息 (REST `POST /channels/:id/messages`)
2. Bot 通过 MCP 主动发的产物:
   - `send_to_channel(text)` → 普通文字消息
   - `spawn_thread(...)` → 在 channel 里产出 thread card
   - `react_to_message(messageId, emoji)` → 在已有消息下方 reaction bubble

**timeline 不出现的东西**:
- Bot 的内部 LLM reasoning / tool call / 思考过程 (在 bot session 页才能看)
- Bot 的 noop 调用 (无产物)
- Bot 调 list_threads / get_thread / get_channel_history 等查询 (无产物)

### 输入框上方:Typing Indicator

类似 MS Teams 的 "Alice is typing..." 动效,实时反映 bot 当前在做什么:

```
┌─────────────────────────────────────────────────┐
│ ✨ Agent is thinking...                          │  ← live indicator
│ ✨ Agent is spawning thread "Fix login bug"...   │
│ ✨ Agent is reading channel history...           │
├─────────────────────────────────────────────────┤
│ Type a message...                                │
└─────────────────────────────────────────────────┘
```

- 状态文字随 bot 当前 action 动态切换
- Bot idle / noop 后消失
- 这是 channel timeline 干净的关键 — bot 中间过程不留 timeline 痕迹

### Channel Header

- **Pinned threads chip 条** (横向):
  - 显示所有 pinned thread (包括 scheduled threads,自动 pin)
  - 每个 chip = thread title + 状态指示符 (⏳ active / ✓ done / ⏰ scheduled / ❌ failed)
  - 点击 → 进入 thread
  - Owner 长按 → 弹出 unpin 菜单
- **"Bot session →"按钮**: 跳到 bot 独立 session 页 (channel 成员均可只读)
- **"Channel settings"按钮** (仅 owner 可见): 编辑 agentConfig

---

## 四、Bot Session 页

- **路径**: 复用现有 session 详情页 (一致的 transcript UI)
- **可见性**: **所有 channel 成员均可只读查看** (因 thread 是软私有,无泄露顾虑)
- **交互**: 输入框隐藏或 disabled,顶部加横幅 "View only — interact in channel" 带返回 channel 的箭头
- **内容**: 完整 LLM transcript (system prompt / 用户消息 inject / assistant reasoning / tool calls / tool results)
- **目的**: 好奇查看,debug 用

### 实现约束

- Hub API: `POST /api/sessions/:id/messages` 在 `session.isChannelBot = true` 时直接返回 403
- Bot session 只接受 hub 内部的 channel-message-forward (走另一个内部路径,不是公开 API)
- SSE: bot session 的常规 session 消息事件**不**广播到 channel 订阅者 — 必须主动进 bot session 页才能看

---

## 五、消息路由

Hub 决定哪些 channel 事件进 bot session,以及怎么进。

### 强信号 (立即推 + Bot 必须 MCP 回复)

| 事件 | 注入 bot session 的内容 |
| --- | --- |
| `@mention` (bot/agent/claude/customName) | 真人消息原文 + `<system>mentioned</system>` 标记 |
| Thread 启动 / 完成 / 失败 | `<system>thread {id} {status}: {summary}</system>` |
| "+ New thread" 按钮触发 | `<system>user {id} requested new thread on topic: {snippet}</system>` |
| Channel 初始化 (新 channel 第一次 spawn bot) | `<system>__channel_initialized: {channelName, members}</system>` |
| AgentConfig 更新 | `<system>__config_updated: {diff}</system>` |

**Bot 必须用 MCP 工具回复** (`send_to_channel` / `react_to_message` / `spawn_thread` / ... / `noop` 任选其一)。System prompt 强制这点。

### 弱信号 (Debounce 推送 + Bot 自由选择)

- 其他真人消息 (普通对话,不 @ bot)
- User 给 channel 任何消息加 / 移除 emoji reaction

**Debounce 规则**: 攒到 **2 条** 消息 OR **3 秒** 静默 → 触发一次推送,把累积内容打包成一条 user message 进 bot session。

**Bot 自由选择**:
- `react_to_message(emoji)` — 轻量留意 (👀 / 👍 / 🤔)
- `send_to_channel(text)` — 觉得有有效观点
- `noop()` — 没什么要补充

---

## 六、MCP 工具集

### 设计原则

- 复用现有 `cli/src/claude/utils/startHappyServer.ts` 模式 (per-runner localhost HTTP MCP)
- Bot session 启动时 hub 把 channelId / botSessionId 写入 session metadata,工具调用通过 ApiSessionClient → WebSocket → hub,**bot 不需要在工具里传 channelId**
- Codex/其他 flavor 通过 `cli/src/codex/utils/buildHapiMcpBridge.ts` 自动 stdio 桥接

### 工具列表 (P0 + P1 + P2)

#### A. Channel 输出
- `send_to_channel(text)` — 普通文字消息
- `react_to_message(messageId, emoji)` — emoji reaction (Bot 可对任何 channel 消息加,user 也可加)
- `noop()` — 强信号场景下的"已知悉但不回复" escape hatch

#### B. Thread 管理
- `spawn_thread(title, prompt, flavor?)` — 创建普通 thread,**默认 visibility = private (软概念)**
- `spawn_scheduled_thread(title, prompt, schedule, flavor?)` — 创建定时 thread,auto-pin,visibility = shared
- `cancel_thread(threadId, reason?)` — 取消跑偏的 thread
- `send_to_thread(threadId, text)` — Lead 给 Teammate 注入上下文
- `pin_thread(threadId)` / `unpin_thread(threadId)` — 手动钉/取消钉

#### C. 状态查询
- `list_threads(filter?)` — 当前 channel 的所有 thread + 状态 + 最后活动时间
- `get_thread(threadId)` — 单个 thread 详情 (title / status / todos / latest message)
- `get_channel_history(beforeSeq?, limit?)` — 主动拉历史 (主要用于崩溃恢复后追上下文)
- `list_channel_members()` — 谁在 channel 里 (便于 @具体的人)

### 不在工具集里 (使用 Claude Code 内置)

- 巡检循环 → 内置 `/loop` slash command (在 scheduled thread 内部使用)
- 调度唤醒 → 内置 `ScheduleWakeup` (在 scheduled thread 内部使用)

---

## 七、Thread

### Thread 创建路径

**唯一路径** = 通过 bot:

1. **用户 @ bot**: "@agent 实现登录页" → 强信号进 bot session → bot 调 `spawn_thread`
2. **用户点 channel 里 "+ New thread" 按钮**: UI 后台发个特殊 channel 消息 (强信号: `<system>user X requested new thread on: ...</system>`) → bot 调 `spawn_thread`

无论哪条路径,thread 的 `createdBy` 都是用户 userId (不是 bot)。Bot 在 spawn 时通过 metadata 传递。

### Thread Visibility — Soft Concept

**Private 和 shared 不是 ACL,而是 attention 模式。** 任何 channel 成员都能打开 thread 看,只是默认呈现方式不同。

| | Private (默认) | Shared (升级后) |
| --- | --- | --- |
| 谁能打开 thread 看 | 任何 channel 成员 | 任何 channel 成员 |
| Channel timeline 中的 card | 最小化:`⏳ Active` / `✓ Done` | 详细:`🔧 Editing src/auth.ts` |
| 出现在 "Active threads" sidebar | 创建者自己看到,别人不显示 | 全员显示 |
| 通知 / badge | 不打扰别人 | 不发广播,但 sidebar 高亮 |
| Bot 处理 thread 状态变化的强信号 | 仍产生强信号给 bot,但 bot 决定要不要发 channel summary | 强信号 + bot 必发 summary |

### Share 升级路径

Thread 页有 "Share to channel" 按钮 (仅创建者可见),点击 toggle:
- Card 升级显示详细 action
- 进 sidebar
- **不**发广播消息 (避免噪音)
- 可以来回 toggle

### Thread 内消息

- DB 层不区分来自 user / bot;thread session 一视同仁
- **Web UI 视觉差异**: bot 注入的消息用中灰色,与 user 消息**对侧**显示 (跟 thread 内 agent CLI 消息同侧),区分来源但不打断对话流

### Thread Card 在 Channel Timeline

- 实时更新一行 "latest action" (private 显示状态,shared 显示工具名 + 主参数)
- Thread 完成后变 `✓ Done — 23 files changed`
- 卡片标题 = thread title (创建时由 bot 决定)

### Pinned Threads

- Scheduled threads 创建时 auto-pin
- Owner / bot 可手动 pin / unpin 任何 thread
- Pinned threads 显示在 channel header 横向 chip 条
- 普通成员不能 pin / unpin

---

## 八、Scheduled Threads

### 概念

用户想要"巡检 / 定时任务"时,**bot 创建一个独立的 scheduled thread**,而不是在 bot 自己的 session 内部跑 /loop。

### 优势

- 职责分离: bot session 退化为纯 event-driven,无内部 /loop 开销
- 每个 scheduled task 是独立 thread session,自己跑 Claude Code 内置 `/loop`
- Pinned + shared,任何人能看,适合"团队级别监控任务"
- History 在 thread 内 — 每次循环跑的输出是 thread 的一条消息,可回看

### 创建

- Bot 调 `spawn_scheduled_thread(title, prompt, schedule, flavor?)`
- `schedule` = cron 字符串 ("0 9 * * 1-5" 或 simpler interval)
- 创建时 visibility = shared,pinned = true

### Scheduled Thread 内部

- 是个普通 Claude Code session,跑在 runner 上
- System prompt 引导它使用 `/loop` slash command 循环执行 prompt
- 每次循环:执行 prompt → 如果有有效观察,调 `send_to_channel` 通知 channel,否则保持沉默 (类似 noop)
- Thread session 也有 channel-aware MCP 工具 (send_to_channel / react_to_message / send_to_thread 等)

---

## 九、Reactions

### 规则

- Bot + user 都能加 reaction
- 加在任何 channel 消息上 (真人消息 / bot 消息 / thread cards)
- 同一个 reactor + 同一个 emoji + 同一条消息 = 不重复;再加一次 = 移除 (Slack 风格 toggle)
- User 加 reaction → 进 bot 的弱信号 buffer (debounce)
- Bot 加 reaction → **不**反馈给 bot 自己 (避免自激)

### Bot 用 reaction 的场景

System prompt 引导:
- 弱信号场景**优先** `react_to_message` 而非 `send_to_channel` (减少噪音)
- Bot 看到一条普通对话觉得"留意一下" → 👀
- 用户表达感谢 → 🙏
- 用户提了一个 bot 觉得有道理但暂时没行动的建议 → 🤔
- 用户报告 bot 之前说错了 → 😅

### 数据模型

新表:
```sql
CREATE TABLE channel_message_reactions (
    message_id  TEXT NOT NULL,
    reactor_ref TEXT NOT NULL,  -- "user:{userId}" or "bot:{sessionId}"
    emoji       TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (message_id, reactor_ref, emoji)
)
```

SSE 事件: `message-reaction-added` / `message-reaction-removed`

---

## 十、AgentConfig

### 文件位置

- `~/.hapi/channels/{channelId}/agent.json` (或 `.toml`)
- Hub watch 文件变化,触发 hot-reload (注入 `__config_updated` 系统消息进 bot session)

### Schema (草稿)

```json
{
    "flavor": "claude",
    "model": "claude-opus-4-7",
    "botName": "Agent",
    "systemPromptAddition": "你是 #engineering 的 PM agent,关注后端代码质量",
    "permissionMode": "yolo",
    "debounceMs": 3000,
    "welcomeStyle": "auto",
    "runnerId": null
}
```

| 字段 | 说明 |
| --- | --- |
| `flavor` | "claude" / "codex" / "cursor" / "gemini" / "opencode" |
| `model` | 具体 model id (空则用 flavor 默认) |
| `botName` | 在 channel 中显示的发件人名,默认 "Agent" |
| `systemPromptAddition` | 在 base bot system prompt 之后追加的自定义文本 |
| `permissionMode` | "yolo" / "ask" — 控制 spawned thread 的权限模式 |
| `debounceMs` | 弱信号 debounce 静默阈值,默认 3000 |
| `welcomeStyle` | "auto" / "skip" / "custom:{text}" |
| `runnerId` | 指定 runner,null 则用 hub embedded runner |

### 编辑权限

- 仅 channel owner 可编辑文件 / UI
- 普通成员只能查看 (read-only view)
- Web UI: schema-driven form,字段美观分组 (Identity / Behavior / Permissions / Advanced)

---

## 十一、Bot System Prompt (草稿)

```
You are the channel agent for #{channelName} in workspace {namespace}.

Your role:
- You are NOT a passive responder. You are a project manager-style agent
  that actively coordinates threads (sub-agent sessions) on behalf of channel members.
- Channel messages from real users get forwarded to you. You decide what to do.

Tools (via MCP):
- send_to_channel(text)             — post a text message to the channel
- react_to_message(msgId, emoji)    — add a reaction (lighter than full reply)
- spawn_thread(...)                 — create a new task thread
- spawn_scheduled_thread(...)       — create a recurring/scheduled thread (auto-pinned)
- cancel_thread(...) / send_to_thread(...)  — coordinate teammates
- pin_thread(...) / unpin_thread(...)
- list_threads / get_thread / get_channel_history / list_channel_members
- noop()                            — explicit "I see this but choose not to act"

Behavior rules:

1. Strong signals (mentions / thread state changes / user "+ thread" requests /
   channel init / config updates): you MUST respond via MCP. noop() counts.

2. Weak signals (other real-user messages, accumulated via debounce): respond
   freely. Prefer react_to_message over send_to_channel for low-information
   acknowledgments. Use noop() if there's nothing worth saying.

3. When user requests a new task or @s you with work, prefer spawn_thread.
   When user mentions "monitoring", "every X", "watch", "check periodically",
   prefer spawn_scheduled_thread.

4. Threads default to private visibility — only the creator's attention is
   pulled in. Use shared (via spawn_scheduled_thread or pin_thread on a
   regular thread) when the work is team-relevant.

5. Avoid noise. Multiple consecutive long replies = bad. Prefer reactions
   for acknowledgment, threads for actual work.

6. You may use Claude Code's /loop and ScheduleWakeup to schedule your own
   wakeups for periodic check-ins. But for user-facing recurring tasks,
   spawn_scheduled_thread instead.

7. Your full conversation transcript is visible (read-only) to all channel
   members at the bot session page. Be honest in your reasoning, no secrets.

Welcome behavior: {welcomeStyle === 'auto' ? 'On __channel_initialized,
write a brief greeting via send_to_channel introducing yourself and how
to delegate work.' : welcomeStyle === 'skip' ? 'Stay silent on init.' :
welcomeText}

{systemPromptAddition}
```

---

## 十二、Channel 删除

Owner 在 channel settings 点 "Delete channel" 时弹出 dialog:

- **默认 (soft delete)**:
  - DB: channel 标记 `deleted_at`,从 channel list 隐藏
  - 文件系统: `~/.hapi/workspaces/{ns}/{channelName}` 重命名为 `{channelName}-archived-{ts}`
  - Bot session: kill (无意义保留)
  - Threads: 状态改为 archived
- **Toggle "Also delete files"**:
  - 上述 + 文件夹彻底删除 (rm -rf)

被移除成员的 thread:跟随 channel ACL,移除成员失去整个 channel 即失去其内所有 thread。

---

## 十三、UI 美感与动态

> User 原话:"对于 web ui 你需要发挥想象力尽可能做的美观动态优雅"

设计原则:
- **少即是多**: channel timeline 永远只有真人 + bot 的有形产物,中间过程通过 typing indicator 表达
- **微动效**: bot typing indicator 用渐变文字 + 脉动光晕,不要 spinner
- **角色区分**: 人类 avatar 圆形彩色,bot avatar 方形渐变 + 一个微微的"AI"指示符
- **Reaction**: bubble 底部贴一行,数字小号灰字
- **Thread card**: 卡片背景渐变带边光,private 浅色 + 状态icon,shared 深色 + 详细 action 文字
- **Pinned chips**: header 下方一行,scheduled thread chip 带个小⏰,普通 pinned 带个📌
- **Schema-driven form** (agentConfig editor): 字段分组卡片化,字段间留白,改动即时 hot-reload 反馈

---

## 十四、Hub Internal API: Channel-Bot RPC

所有 MCP 工具最终通过 ApiSessionClient WebSocket 调到 hub。Hub 端新增 RPC handlers (镜像 MCP 工具集):

| MCP 工具 | Hub WebSocket RPC event |
| --- | --- |
| `send_to_channel` | `channel-bot:send-message` |
| `react_to_message` | `channel-bot:add-reaction` |
| `spawn_thread` | `channel-bot:spawn-thread` |
| `spawn_scheduled_thread` | `channel-bot:spawn-scheduled-thread` |
| `cancel_thread` | `channel-bot:cancel-thread` |
| `send_to_thread` | `channel-bot:send-to-thread` |
| `pin_thread` | `channel-bot:pin-thread` |
| `unpin_thread` | `channel-bot:unpin-thread` |
| `list_threads` | `channel-bot:list-threads` |
| `get_thread` | `channel-bot:get-thread` |
| `get_channel_history` | `channel-bot:get-history` |
| `list_channel_members` | `channel-bot:list-members` |

Hub 用 `sessionId` 反查 `session.metadata.channelId`,所有操作隐式作用于该 channel。

---

## 十五、ChannelAgent 退化

`hub/src/sync/channelAgent.ts` 从"事件 listener + spawn thread"退化为**两层路由**:

1. **Strong signal 检测器**:
   - Parse 消息 body 的 @mention (regex)
   - 监听 session-updated 事件中 channelId 匹配的 thread 状态变化
   - 监听 channel-thread-requested 事件 ("+ New thread" 按钮触发)
   - 这些直接 forward 给 bot session (通过 `engine.sendMessage(botSessionId, ...)` 内部 API)

2. **Weak signal debounce buffer**:
   - 维护 per-channel 的 pending message buffer
   - 攒到 2 条 OR 3 秒静默 → flush 给 bot session
   - 同一 channel 的 timer 在每条新消息时 reset

**移除**:
- 自己识别 @mention spawn thread (现在由 bot 决定)
- 自动生成 thread_card / agent_summary (现在由 bot MCP 决定)
- 任务队列 / MAX_ACTIVE_PER_CHANNEL 限制 (bot 自己控制并发)

---

## MVP 后再做的

- Bot mute / disable 控制
- Bot 用量指示 (token 消耗)
- 逐人邀请 thread (除了 share-to-all 之外的精细 ACL)
- Thread 跨 channel 移动
- Bot 接受用户 reaction 作为强信号

---

## 实施完成后还欠的尾巴 (deferred from initial implementation)

下面这些是 8 个阶段 (commits `f341abd`–`d9805ca`) 落地后**故意留给后续 PR** 的尾巴 — 都不阻塞主流程跑通,但为了完整性需要补齐:

### 1. AgentConfigEditor (web UI)

后端已就绪 (`PUT /api/channels/:id` 带 agentConfig 会写文件;`AgentConfigStore` 自动 hot-reload + 注入 `__config_updated` 给 bot)。**缺的是**前端的 schema-driven form 抽屉:
- 入口: channel header 加一个 "Channel settings" 按钮 (仅 owner 可见)
- 字段分组 (Identity / Behavior / Permissions / Advanced),用 Zod schema → form 渲染
- Save 调 `api.updateChannelAgentConfig(channelId, agentConfig)`
- 文件: `web/src/components/AgentConfigEditor.tsx` (新)

### 2. SSE 实时推送的新事件订阅 (web UI)

后端已正确 emit 这些事件 (Phase B/D),但 `web/src/hooks/useSSE.ts` 还没加对应的 handler:
- `message-reaction-added` / `message-reaction-removed` → 现在靠 `channel-message-received` invalidation 顺带刷新,**实时性差** (要等下一条消息才看到 reaction 变化)
- `thread-pinned` / `thread-unpinned` / `thread-visibility-changed` → 改完不会立即在 sidebar/header 更新
- `channel-bot-typing` → 通往 `ChannelView` 的 `botTypingAction` prop 还没接通,bot 思考时输入框上方的 typing-indicator 永远空着

修复时只需要在 `useSSE.ts` 里把这几个事件 dispatch 到对应 query key 的 `invalidateQueries` / `setQueryData`。

### 3. 一站式 integration E2E 测试

`docs/mvp-ux-stage-2.md` § Verification 里的"manual end-to-end"是当前唯一的端到端验证。一个真正的自动化集成测试 (create channel → bot 真的 spawn → @mention → bot 真的 reply + spawn thread → reaction → soft delete) 需要在测试 fixture 里跑一个 live runner 进程,这超出 bun in-memory test 的能力。可选方向:
- 用 playwright + 已经在 `.playwright/` 里配好的 browser harness 编写一个 spec
- 或写一个 shell 脚本 `scripts/smoke-stage-2.sh` 顺序调真 hub + runner + curl

### 4. Bot crash recovery 的真实端到端验证

`engine.handleSessionEnd` 里加了 watchdog (Phase A,5 秒后用 `resumeSessionId` 重 spawn),代码逻辑对,但**没有在线测试过** kill PID 后 hub 是否真的复活并保留对话上下文。手动测试步骤已记录在 design doc 的 Verification 段第 12 步。

### 5. 用户点 "+ New thread" 按钮的端到端流程

设计是: button 不直接创建 thread,而是后台发一条 `<system>user-requested-new-thread</system>` 强信号给 bot,bot 决定怎么 spawn。**后端已经支持**(任何强信号都会进 bot),但 web UI 上的 "+ New thread" 按钮以及对应的 backend 路由 (`POST /channels/:id/thread-request` 或类似) 还没实现。

### 6. Strong signal 中的 thread state 区分粒度

当前 ChannelAgent 在任何 `session.active=false` 的 session-updated 事件上都向 bot 推 `thread-completed` 强信号。**应该**进一步区分 `completed` / `failed` / `archived`,以及避免在 thread 还在跑只是短暂离线时误报。当前实现可能产生噪音。

