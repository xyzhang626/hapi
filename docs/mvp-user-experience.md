# MVP User Experience: Agent-Native Collaboration Platform

> HAPI 升级为以 Channel + Thread 为核心的多人多 Agent 协作平台

---

## 产品一句话

**每个项目有一个 AI 项目经理，协调人和 AI 工程师一起把事情做完。**

---

## 核心概念

| 概念 | 是什么 | 对应现有 HAPI |
|---|---|---|
| **Workspace** | 一个团队/组织的协作空间 | = namespace |
| **Channel** | 持久频道，多人 + 1 agent 协作 | 新概念，替代文件夹分组 |
| **Thread** | 一个具体任务的执行空间 | = session |
| **Channel Agent** | 频道里的 AI 项目经理 | 新概念 |
| **Thread Agent** | Thread 里的 AI 工程师 | = Claude Code session |

---

## 角色模型

```
Channel Agent（项目经理）
├── 不写代码，了解所有 thread 的进展
├── 回答 "登录页做到哪了？" "这周完成了什么？"
├── 帮用户把模糊需求拆清楚再交给 thread agent
├── 发现两个 thread 有冲突时主动提醒
└── 非技术成员（设计师、PM）主要跟它交流

Thread Agent（AI 工程师 / 实习生）
├── 就是 Claude Code，全力干活
├── 上下文 = 具体任务 + 项目经理注入的背景信息
├── 只跟发起人和关心细节的人对话
└── 完成后汇报给项目经理，项目经理在 channel 总结
```

**Agent 归属**: 属于 workspace/channel（共享的），但 thread 属于发起人（个人的）。所有人都能看到进展，但每个人控制自己的任务。

---

## 默认频道设计

每个 workspace 自动创建两个频道:

| 频道 | 可见性 | 用途 |
|---|---|---|
| **#general** | 所有 workspace 成员 | 团队协作，多人共享 |
| **#private** | 仅当前用户 | 个人工作空间，= 现有 HAPI 体验 |

用户还可以:
- 创建自定义频道（如 #frontend, #design, #bugs）
- 通过邀请链接添加成员到自定义频道

---

## 用户旅程

### 旅程 1: 现有 HAPI 用户（个人使用）

```
打开 App
  → 左侧看到频道列表:
      # general
      # private  ← 高亮，这是你熟悉的地方
  → 点击 #private
  → 看到所有现有 session，以 thread 卡片形式展示
  → 操作方式和以前一样: 新建 session、和 Claude Code 对话
  → 零摩擦，无学习成本
```

### 旅程 2: 团队协作（核心新体验）

```
Alice（工程师）在 #general:

  Alice: @Claude 实现登录页面，参考最新的设计稿

  Claude (项目经理): 收到，我来创建任务。
  ┌──────────────────────────────────┐
  │ 📋 实现登录页面        🟢 进行中  │
  │ by Alice · just now              │
  │ ──────────────────────────────── │
  │ 🔄 分析需求和设计稿...            │
  │ [打开 Thread →]                  │
  └──────────────────────────────────┘

  -- 5 分钟后 --

  Claude (项目经理): 登录页面进展: 表单组件已完成 (2/4)，
                    正在接入认证 API。

  Bob: @Claude 修一下头像显示的 bug，issue #234

  Claude (项目经理): 在看了。
  ┌──────────────────────────────────┐
  │ 📋 修复头像显示 #234   🟢 进行中  │
  │ by Bob · just now                │
  │ [打开 Thread →]                  │
  └──────────────────────────────────┘

  -- Alice 点击 "打开 Thread" --

  → 进入 Thread 详情页（完整的 Claude Code 对话界面）
  → 可以跟 Thread Agent 精细对话、审批权限、查看 diff
  → 返回按钮 → 回到 #general
```

### 旅程 3: 非技术用户

```
Carol（设计师）在 #general:

  Carol: @Claude 登录页的按钮间距应该是 16px 不是 8px [附图]

  Claude (项目经理): 收到，这是个样式调整。
                    已加入 Alice 的登录页面 Thread 中作为子任务。

  -- Carol 不需要知道什么是 Thread、worktree、CLI --
  -- 她看到的就是: 说了一句话，事情被安排了 --
```

### 旅程 4: 创建自定义频道

```
Alice 在左侧点击 "+ Create Channel"
  → 输入频道名: frontend
  → 创建成功，生成邀请链接
  → 把链接发给 Bob
  → Bob 打开链接，加入 #frontend
  → 现在他们有一个专属前端的频道
```

---

## UI 布局

### 桌面端

```
┌─────────────────────────────────────────────────────┐
│  Workspace Name                          ⚙️ Settings │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ CHANNELS │  #general                    👥 3 online │
│          │  ────────────────────────────────────────│
│ # general│                                          │
│ # front  │  Alice: @Claude 实现登录页面              │
│ # design │                                          │
│          │  ┌── 📋 实现登录页面 ─── 🟢 ──────────┐  │
│ PRIVATE  │  │ by Alice · 5 min ago               │  │
│ # privat │  │ ✅ 分析设计稿  🔄 编写组件          │  │
│          │  │ [打开 Thread →]                     │  │
│ ──────── │  └────────────────────────────────────┘  │
│ + Create │                                          │
│          │  Claude: 登录页进展 2/4，正在接入 API。   │
│          │                                          │
│          │  Bob: @Claude 修头像 bug #234            │
│          │                                          │
│          │  ┌── 📋 修复头像 #234 ─── 🟢 ────────┐  │
│          │  │ by Bob · just now                  │  │
│          │  │ [打开 Thread →]                     │  │
│          │  └────────────────────────────────────┘  │
│          │                                          │
│          │ ┌──────────────────────────────────────┐ │
│          │ │ @Claude 消息...                  📎 ↑│ │
│          │ └──────────────────────────────────────┘ │
└──────────┴──────────────────────────────────────────┘
```

### Thread 详情页（点击 "打开 Thread" 后）

```
┌─────────────────────────────────────────────────────┐
│  ← #general  >  📋 实现登录页面          🟢 进行中  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  （完整的 Claude Code 对话界面，和现在的 SessionChat  │
│   完全一样: 消息流、权限审批、diff 查看、模型切换等）  │
│                                                      │
│  唯一新增: 顶部面包屑 + 状态标签                      │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### #private 频道（= 现有 HAPI 体验）

```
┌──────────┬──────────────────────────────────────────┐
│          │                                          │
│ CHANNELS │  # private                    (仅你可见) │
│ # general│  ────────────────────────────────────────│
│ # front  │                                          │
│          │  ┌── 📋 debug auth flow ── ✅ ────────┐  │
│ PRIVATE  │  │ 2 hours ago · ~/projects/backend   │  │
│ # privat │  └────────────────────────────────────┘  │
│          │                                          │
│ ──────── │  ┌── 📋 refactor utils ── 🟢 ────────┐  │
│ + Create │  │ 10 min ago · ~/projects/frontend   │  │
│          │  └────────────────────────────────────┘  │
│          │                                          │
│          │  [+ New Thread]  ← 这就是现在的 New Session│
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

---

## MVP 边界

### 做

- #general + #private 默认频道
- 自定义频道创建 + 邀请链接
- @agent 派任务 → 自动创建 thread
- Thread 卡片折叠展示在 channel 中
- Thread 详情 = 完整 Claude Code 对话
- 进展回传（thread → channel 摘要）
- 现有 CLI 无感兼容（sessions 自动归入 #private）
- 仅支持 Claude agent

### 不做

- 项目经理的 LLM 智能协调（MVP 阶段只做转发 + 总结）
- 跨频道 link/引用
- 多 agent 类型（Codex/Gemini/Cursor）
- 精细权限管理（admin/member 区分）
- 跨 workspace
- 个人 DM

---

## 实现计划

详见 **[Implementation TODO](./mvp-implementation-todo.md)** — 包含完整的数据模型、API 设计、UI 组件拆解和分阶段实施计划。
