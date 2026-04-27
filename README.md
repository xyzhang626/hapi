# HAPI — Enterprise Collaboration Edition

> **企业化协作改造版本**：这是对[原版 HAPI](https://github.com/twsxtd/hapi) 的多人协作扩展。原版 HAPI 是 Happy 的 local-first 替代，让你在终端跑官方 Claude Code / Codex / Gemini 并通过 Web/PWA/Telegram 远程操控；本版本在此之上把它升级为**以 Channel + Thread 为核心、原生支持 Agent 协作的团队工作平台**。原有单人体验完全保留（自动落到 `#private` 频道）。

---

## 一句话产品定位

**每个项目频道里有一个常驻的 AI 项目经理（Channel Bot），协调人和 AI 工程师一起把事情做完。**

---

## 核心概念

| 概念 | 是什么 | 对应原版 HAPI |
|---|---|---|
| **Workspace** | 一个团队/组织的协作空间 | = namespace |
| **Channel** | 持久频道，多人 + 1 个常驻 Agent 协作 | 新概念，替代文件夹分组 |
| **Thread** | 一个具体任务的执行空间 | = session |
| **Channel Agent** (Bot) | 频道里的 AI 项目经理，常驻 Claude Code session | 新概念 |
| **Thread Agent** | Thread 里的 AI 工程师 | = Claude Code session |

**角色模型**：

- **Channel Agent** 不写代码，了解所有 thread 的进展。回答 "登录页做到哪了？"，把模糊需求拆清楚后交给 thread agent，发现冲突时主动提醒。非技术成员（设计师、PM）主要跟它交流。
- **Thread Agent** 就是 Claude Code，全力干活。上下文 = 具体任务 + Channel Agent 注入的背景。完成后汇报给 Channel Agent，由它在频道里总结。

Agent 归属：Channel Agent 属于 workspace/channel（共享）；Thread 属于发起人（个人控制，但全员可见进展）。

---

## 默认频道

每个 workspace 自动创建：

| 频道 | 可见性 | 用途 |
|---|---|---|
| **#general** | 所有 workspace 成员 | 团队协作 |
| **#private** | 仅当前用户 | = 原版 HAPI 单人体验，零摩擦兼容 |

用户也可以创建自定义频道（`#frontend`、`#design`、`#bugs` 等），通过邀请链接加人。

---

## 用户旅程

### 旅程 1：原版 HAPI 用户（个人）

打开 App → 看到左侧 `# private` 高亮 → 点进去看到所有现有 session（以 thread 卡片形式）→ 操作和以前完全一样：新建 session、和 Claude Code 对话。**零学习成本**。

### 旅程 2：团队协作（核心新体验）

```
Alice (工程师) 在 #general:
  Alice: @Agent 实现登录页面，参考最新设计稿

  Agent: 收到。
  ┌──────────────────────────────────┐
  │ 📋 实现登录页面        🟢 进行中  │
  │ by Alice · just now              │
  │ 🔄 分析需求和设计稿...            │
  │ [打开 Thread →]                  │
  └──────────────────────────────────┘

  -- 5 分钟后 --
  Agent: 登录页进展：表单组件已完成 (2/4)，正在接入认证 API。

  Bob: @Agent 修一下头像显示的 bug，issue #234
  Agent: 在看了。  ┌─📋 修复头像 #234 🟢 进行中─┐ ...
```

点击 thread 卡片 → 进入完整 Claude Code 对话界面（消息流、权限审批、diff 查看），返回按钮回到频道。

### 旅程 3：非技术用户

```
Carol (设计师): @Agent 登录页按钮间距应该是 16px 不是 8px [附图]
Agent: 收到，已加入 Alice 的登录页 Thread 作为子任务。
```

Carol 不需要知道 Thread / worktree / CLI 是什么。她看到的就是：说了一句话，事情被安排了。

---

## Channel UI 关键元素

### Channel Timeline（主视图）

只显示**两类**消息：

1. 真人用户消息
2. Bot 通过 MCP 主动发的产物：`send_to_channel`（文字）/ `spawn_thread`（thread 卡片）/ `react_to_message`（emoji bubble）

**timeline 不出现**：bot 内部 reasoning / tool calls / 思考过程 / noop / 查询调用。Bot 中间过程通过输入框上方的 **typing indicator** 实时表达（"✨ Agent is spawning thread..."），idle 后消失。

### Channel Header

- **Pinned threads chip 条**（横向）：scheduled threads 自动 pin；点击进 thread；owner 长按可 unpin
- **"Bot session →" 按钮**：跳到 bot 独立 session 页（所有成员只读，可看完整 LLM transcript / tool call，方便 debug 和好奇）
- **"Channel settings"**（仅 owner 可见）：编辑 agentConfig

### Thread 详情页

完整 Claude Code 对话界面 + 顶部面包屑 + 状态标签。底部新增 "Share to channel" 按钮（创建者可见）控制 visibility。

---

## Thread Visibility — Soft Concept

**Private 和 shared 不是 ACL，是 attention 模式。** 任何 channel 成员都能打开任何 thread 看，区别只是默认呈现方式：

| | Private (默认) | Shared |
|---|---|---|
| Channel timeline 卡片 | 最小化：`⏳ Active` / `✓ Done` | 详细：`🔧 Editing src/auth.ts` |
| "Active threads" sidebar | 仅创建者看到 | 全员显示 |
| 通知 / badge | 不打扰 | 不广播但 sidebar 高亮 |

创建者点 "Share to channel" toggle 即可升级，可来回切换。

---

## Bot 是什么（Stage 2 架构）

Channel Bot **不是 hub 内置函数**，而是一个**常驻 Claude Code session**，跑在 Runner 上，有自己的工作目录和 transcript。Hub 只负责路由和存储，所有"怎么响应"由 bot 自己用 MCP 工具决定。

### Bot Lifecycle

- Channel 创建瞬间（带 `agentConfig`）→ Hub 立即在 runner 上 spawn bot session
- Hub 启动时 fork 一个 embedded runner subprocess，消除 "channel 创建时没有 runner 在线" 的边界问题
- **默认工作目录**：`~/.hapi/workspaces/{namespace}/{channelName}`
- 崩溃恢复：bot 挂掉 → Hub watchdog 自动重启，**复用原 sessionId**，session resume 拉回历史 context
- Config hot-reload：`agentConfig` 文件被改 → Hub 注入 `__config_updated` 系统消息进 bot session

### MCP 工具集（Bot 能做什么）

- **Channel 输出**：`send_to_channel` / `react_to_message` / `noop`
- **Thread 管理**：`spawn_thread` / `spawn_scheduled_thread` / `cancel_thread` / `send_to_thread` / `pin_thread` / `unpin_thread`
- **状态查询**：`list_threads` / `get_thread` / `get_channel_history` / `list_channel_members`

### 消息路由（Hub → Bot）

| 信号类型 | 触发 | 推送策略 |
|---|---|---|
| **强信号** | `@mention` / thread 状态变化 / "+ New thread" 按钮 / channel 初始化 / config 更新 | 立即推送，bot **必须**通过 MCP 回复（noop 也算） |
| **弱信号** | 普通对话、reactions | Debounce：攒到 **2 条** 或 **3 秒** 静默后打包推送，bot 自由选择 react / send / noop |

---

## Scheduled Threads（巡检 / 定时任务）

Bot 可调 `spawn_scheduled_thread(title, prompt, schedule)` 创建独立的定时 thread：

- 自己跑 Claude Code 内置 `/loop` slash command 循环执行 prompt
- 默认 auto-pin + shared，所有人能看，适合"团队级别监控任务"
- 每次循环的输出是 thread 内一条消息，可回看
- 有有效观察就调 `send_to_channel` 通知频道，否则保持沉默

---

## Reactions

- Bot + user 都能加，加在任何 channel 消息上
- 同人 + 同 emoji + 同消息 = toggle（Slack 风格）
- User 加 reaction → 进 bot 弱信号 buffer
- Bot 加 reaction → 不反馈给 bot 自己（避免自激）
- Bot 倾向用 reaction 而非长文本回复，减少噪音（👀 留意 / 🙏 收到 / 🤔 有道理 / 😅 我错了）

---

## AgentConfig

每个 channel 一份配置文件 `~/.hapi/channels/{channelId}/agent.json`，hub watch 文件变化自动 hot-reload：

```json
{
    "flavor": "claude",
    "model": "claude-opus-4-7",
    "botName": "Agent",
    "systemPromptAddition": "你是 #engineering 的 PM agent，关注后端代码质量",
    "permissionMode": "yolo",
    "debounceMs": 3000,
    "welcomeStyle": "auto",
    "runnerId": null
}
```

仅 channel owner 可编辑（schema-driven form，分组 Identity / Behavior / Permissions / Advanced）。

---

## 频道删除

- **默认 soft delete**：channel 标记 `deleted_at`，`~/.hapi/workspaces/{ns}/{channelName}` 重命名为 `{channelName}-archived-{ts}`，bot 被 kill，threads 状态改 archived
- **Toggle "Also delete files"**：上述 + 文件夹彻底 `rm -rf`

---

## 保留的原版 HAPI 能力

- **Seamless Handoff**：本地干活，需要时切到远程，再切回来。无 context 丢失
- **Native First**：包装 AI agent 而非替代它。同样的终端，同样的肌肉记忆
- **AFK Without Stopping**：手机上一键审批 AI 请求
- **Your AI, Your Choice**：Claude Code、Codex、Cursor Agent、Gemini、OpenCode 统一工作流
- **Terminal Anywhere**：手机/浏览器跑命令，直连工作机
- **Voice Control**：内置语音助手

---

## Demo

https://github.com/user-attachments/assets/38230353-94c6-4dbe-9c29-b2a2cc457546

## Getting Started

```bash
npx @twsxtd/hapi hub --relay     # start hub with E2E encrypted relay
npx @twsxtd/hapi                 # run claude code
```

`hapi server` remains supported as an alias.

The terminal will display a URL and QR code. Scan the QR code with your phone or open the URL to access.

> The relay uses WireGuard + TLS for end-to-end encryption. Your data is encrypted from your device to your machine.

For self-hosted options (Cloudflare Tunnel, Tailscale), see [Installation](docs/guide/installation.md)

## Docs

- [MVP User Experience](docs/mvp-user-experience.md) — 协作 UX 设计原稿
- [MVP UX Stage 2](docs/mvp-ux-stage-2.md) — Channel Bot 架构详解
- [App](docs/guide/pwa.md)
- [How it Works](docs/guide/how-it-works.md)
- [Cursor Agent](docs/guide/cursor.md)
- [Voice Assistant](docs/guide/voice-assistant.md)
- [Why HAPI](docs/guide/why-hapi.md)
- [FAQ](docs/guide/faq.md)

## Build from source

```bash
bun install
bun run build:single-exe
```

## Credits

HAPI means "哈皮"，是 [Happy](https://github.com/slopus/happy) 的中文音译，向原项目致敬。本仓库是在 [原版 HAPI](https://github.com/twsxtd/hapi) 基础上做的**企业化多人协作改造**，将单人 AI agent 工作流扩展为团队级 Channel + Thread + 常驻 Bot 的协作平台。
