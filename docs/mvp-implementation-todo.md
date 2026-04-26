# MVP Implementation TODO

> Agent-Native Collaboration Platform — Channel + Thread Model
>
> Parent doc: [MVP User Experience](./mvp-user-experience.md)

---

## Phase 0: Shared Types & Data Model

### 0.1 Channel 数据模型 (`shared/`)

- [ ] 在 `shared/src/schemas.ts` 新增 Channel Zod schema:
  ```typescript
  Channel {
    id: string              // nanoid
    workspaceId: string     // = namespace (复用现有概念)
    name: string            // 显示名，如 "general", "frontend"
    type: 'general' | 'private' | 'custom'
    description?: string
    agentConfig?: {         // channel-level agent 配置
      flavor: AgentFlavor
      model?: string
      systemPrompt?: string // 项目经理人设
    }
    createdBy: string       // userId
    createdAt: number
    updatedAt: number
  }
  ```
- [ ] 新增 ChannelMember schema:
  ```typescript
  ChannelMember {
    channelId: string
    userId: string
    role: 'owner' | 'member'
    joinedAt: number
  }
  ```
- [ ] 在 `shared/src/types.ts` 导出 Channel, ChannelMember 类型
- [ ] 扩展现有 `Session` 类型，新增字段:
  ```typescript
  Session {
    ...existing,
    channelId?: string      // 所属 channel
    threadTitle?: string    // thread 在 channel 中的标题
    threadStatus?: 'active' | 'completed' | 'archived'
    createdByUserId?: string // 谁发起的 thread
  }
  ```

### 0.2 用户身份增强 (`shared/`)

- [ ] 新增 WorkspaceUser schema（MVP 阶段简化）:
  ```typescript
  WorkspaceUser {
    id: string
    namespace: string       // = workspace
    displayName: string
    avatarUrl?: string
    role: 'admin' | 'member'
    lastActiveAt: number
  }
  ```
- [ ] JWT payload 扩展：`{ uid, ns, displayName? }`

---

## Phase 1: Database & Store Layer

### 1.1 新增 channels 表 (`hub/src/store/`)

- [ ] 在 `hub/src/store/index.ts` 中升级 `SCHEMA_VERSION` (7 → 8)
- [ ] 新增 migration v8，创建 channels 表:
  ```sql
  CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'custom',
    description TEXT,
    agent_config TEXT,        -- JSON
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_channels_namespace ON channels(namespace);
  ```
- [ ] 新增 channel_members 表:
  ```sql
  CREATE TABLE channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, user_id)
  );
  CREATE INDEX idx_channel_members_user ON channel_members(user_id);
  ```
- [ ] 给现有 sessions 表新增列:
  ```sql
  ALTER TABLE sessions ADD COLUMN channel_id TEXT REFERENCES channels(id);
  ALTER TABLE sessions ADD COLUMN thread_title TEXT;
  ALTER TABLE sessions ADD COLUMN thread_status TEXT DEFAULT 'active';
  ALTER TABLE sessions ADD COLUMN created_by_user_id TEXT;
  CREATE INDEX idx_sessions_channel ON sessions(channel_id);
  ```

### 1.2 ChannelStore (`hub/src/store/channelStore.ts`)

- [ ] 新建 `ChannelStore` 类:
  - `createChannel(namespace, name, type, createdBy, agentConfig?) → StoredChannel`
  - `getChannel(id) → StoredChannel | null`
  - `getChannelByNamespace(id, namespace) → StoredChannel | null`
  - `getChannelsByNamespace(namespace) → StoredChannel[]`
  - `updateChannel(id, namespace, updates) → boolean`
  - `deleteChannel(id, namespace) → boolean`
  - `addMember(channelId, userId, role) → boolean`
  - `removeMember(channelId, userId) → boolean`
  - `getMembers(channelId) → ChannelMember[]`
  - `getChannelsForUser(namespace, userId) → StoredChannel[]`
    - 返回: type='general' 的所有频道 + 用户是 member 的 custom 频道 + 用户自己的 private 频道
  - `ensureDefaultChannels(namespace, userId) → void`
    - 幂等创建 #general (如果不存在)
    - 幂等创建用户的 #private (如果不存在)

### 1.3 扩展 SessionStore

- [ ] 修改 `getSessionsByNamespace()` → 支持可选 `channelId` 过滤
- [ ] 新增 `getSessionsByChannel(channelId, namespace) → StoredSession[]`
- [ ] 修改 `getOrCreateSession()` → 接受可选 `channelId`, `threadTitle`, `createdByUserId`

### 1.4 Store 入口注册

- [ ] 在 `Store` class 中注册 `readonly channels: ChannelStore`
- [ ] 在 `hub/src/store/types.ts` 新增 `StoredChannel`, `StoredChannelMember` 类型

---

## Phase 2: Hub Sync Engine 扩展

### 2.1 Channel Cache (`hub/src/sync/channelCache.ts`)

- [ ] 新建 ChannelCache（仿照 SessionCache 模式）:
  - 内存 Map<channelId, Channel>
  - `loadFromStore(namespace)` → 初始化
  - `addChannel() / updateChannel() / removeChannel()`
  - `getChannelsForUser(namespace, userId)` → 过滤逻辑

### 2.2 SyncEngine 扩展 (`hub/src/sync/syncEngine.ts`)

- [ ] 新增 channelCache 成员
- [ ] 新增方法:
  - `getChannels(namespace, userId) → Channel[]`
  - `getChannel(channelId, namespace) → Channel | null`
  - `createChannel(namespace, name, type, createdBy, agentConfig?) → Channel`
  - `deleteChannel(channelId, namespace) → boolean`
  - `addChannelMember(channelId, userId, namespace) → boolean`
  - `removeChannelMember(channelId, userId, namespace) → boolean`
- [ ] 修改 `getSessions()` → 支持按 channelId 过滤
- [ ] 扩展 handleRealtimeEvent → 处理 channel-* 事件

### 2.3 SSE 事件扩展

- [ ] 在 `shared/src/schemas.ts` 的 SyncEvent union 新增:
  - `channel-added { channelId, namespace, data }`
  - `channel-updated { channelId, namespace, data }`
  - `channel-removed { channelId, namespace }`
- [ ] SSEManager `shouldSend()` 增加 channel 事件路由逻辑

### 2.4 Thread 进展回传机制

- [ ] 在 `hub/src/sync/syncEngine.ts` 中，当 session（thread）状态变化时:
  - session 标记 completed → 在所属 channel 生成一条摘要消息
  - session todos 更新 → 可选推送进展到 channel
- [ ] 新增 `ChannelMessageService`:
  - Channel 级别的消息（不同于 session messages）
  - 存储: 复用 messages 表，新增 `channel_id` 列（或新建 channel_messages 表）
  - 包含: 用户消息 + agent 总结消息 + thread 状态卡片

> **设计决策**: Channel 消息和 Session(Thread) 消息分开存储。Channel messages 表用于频道对话流，Session messages 保持原样用于 thread 内的 Claude Code 对话。

- [ ] Channel messages 表:
  ```sql
  CREATE TABLE channel_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT,              -- null = agent message
    content TEXT NOT NULL,     -- JSON
    thread_session_id TEXT REFERENCES sessions(id),  -- 关联的 thread
    type TEXT DEFAULT 'message',  -- 'message' | 'thread-created' | 'thread-update' | 'thread-completed'
    created_at INTEGER NOT NULL,
    seq INTEGER NOT NULL
  );
  CREATE INDEX idx_channel_messages_channel ON channel_messages(channel_id);
  ```

---

## Phase 3: HTTP API Routes

### 3.1 Channel Routes (`hub/src/web/routes/channels.ts`)

- [ ] 新建 channels 路由文件:
  - `GET /api/channels` → 返回当前用户可见的所有 channels
  - `POST /api/channels` → 创建自定义 channel `{ name, description? }`
  - `GET /api/channels/:id` → 获取 channel 详情 + 成员列表
  - `DELETE /api/channels/:id` → 删除 channel（仅 owner）
  - `POST /api/channels/:id/members` → 添加成员 `{ userId }`（或邀请链接 token）
  - `DELETE /api/channels/:id/members/:userId` → 移除成员
  - `GET /api/channels/:id/sessions` → 获取 channel 下的所有 threads (sessions)
  - `GET /api/channels/:id/messages` → 获取 channel 级别的消息流（分页）
  - `POST /api/channels/:id/messages` → 在 channel 发消息（@agent 派任务或普通聊天）

### 3.2 邀请链接

- [ ] `POST /api/channels/:id/invite` → 生成邀请 token（带过期时间）
- [ ] `POST /api/invite/:token` → 通过邀请链接加入 channel

### 3.3 修改现有 Sessions Routes

- [ ] `POST /api/channels/:channelId/sessions` → 在 channel 下创建 thread
  - 当用户 @agent 派任务时，由 channel agent 调用
  - 参数: `{ title, machineId?, directory? }`
  - 底层复用现有 session spawn 逻辑
- [ ] `GET /api/sessions/:id` → 返回增加 channelId, threadTitle, threadStatus
- [ ] `PATCH /api/sessions/:id/thread-status` → 更新 thread 状态

### 3.4 Auth 扩展

- [ ] 登录/注册时自动调用 `ensureDefaultChannels(namespace, userId)`
- [ ] JWT 中包含 userId 以便 channel 权限检查

---

## Phase 4: Web UI — Channel 视图

### 4.1 路由重构 (`web/src/router.tsx`)

- [ ] 新增路由结构:
  ```
  /                           → redirect /channels
  /channels                   → ChannelsPage (频道列表 + 内容区)
  /channels/:channelId        → ChannelPage (频道消息流)
  /channels/:channelId/threads/:sessionId → ThreadPage (= 现有 SessionPage)
  /channels/:channelId/threads/:sessionId/files → FilesPage
  /channels/:channelId/threads/:sessionId/terminal → TerminalPage
  /settings                   → SettingsPage (保持不变)
  ```
- [ ] 保留 `/sessions/*` 路由作为 redirect 兼容

### 4.2 频道列表 (`web/src/components/ChannelList.tsx`)

- [ ] 新建 ChannelList 组件，替代 SessionList:
  - 顶部: Workspace 名称 + 设置按钮
  - 频道分区:
    ```
    ▼ Channels
      # general          (2 active threads)
      # frontend         (1 active thread)
      # design
    ▼ Private
      # private          (你的个人空间)
    ─────
    + Create Channel
    ```
  - 每个频道项显示: 名称 + 活跃 thread 数 + 未读指示器
  - 点击频道 → 导航到 `/channels/:channelId`
  - 长按频道 → 上下文菜单（邀请成员、删除）

### 4.3 频道消息视图 (`web/src/components/ChannelView.tsx`)

- [ ] 新建 ChannelView 组件:
  - 顶部: 频道名称 + 成员列表 + 设置
  - 消息流:
    - 用户消息: 显示发送者名称 + 头像
    - Agent 消息: 项目经理风格的简洁回复
    - Thread 卡片: 折叠的 thread 摘要卡片（标题 + 状态 + 进展）
  - 输入框: 支持 `@agent` mention + 文件上传
  - 输入框发送时:
    - 普通消息 → 直接发到 channel
    - `@agent + 任务描述` → 创建 thread + 在 channel 显示卡片

### 4.4 Thread 卡片 (`web/src/components/ThreadCard.tsx`)

- [ ] 新建 ThreadCard 组件:
  ```
  ┌──────────────────────────────────┐
  │ 📋 实现登录页面        🟢 进行中  │
  │ by Alice · 3 minutes ago        │
  │ ────────────────────────────────│
  │ ✅ 分析设计稿                    │
  │ 🔄 编写表单组件                  │
  │ ⬜ 接入认证 API                  │
  │ ────────────────────────────────│
  │ [打开 Thread →]                  │
  └──────────────────────────────────┘
  ```
  - 数据来源: session.todos + session.threadTitle + session.threadStatus
  - 点击 → 导航到 thread 详情页（= 现有 SessionChat）
  - 展开/折叠动画

### 4.5 Thread 详情页（复用现有 SessionChat）

- [ ] 修改 SessionChat，新增:
  - 顶部面包屑: `#frontend > 实现登录页面`
  - 返回按钮 → 回到 channel 视图
  - Thread 状态切换（进行中 → 已完成）
- [ ] 其余保持不变（消息流、权限审批、模型切换等全部复用）

### 4.6 #private 频道特殊处理

- [ ] #private 的 ChannelView 使用简化布局:
  - 不显示成员列表（只有自己）
  - Thread 列表类似现有 SessionList 体验
  - 可以直接从这里新建 session（= 现有 NewSession 流程）
  - 保留 machine/directory 选择（开发者仍然需要）

---

## Phase 5: Web UI — Hooks & State

### 5.1 新增 Query Hooks

- [ ] `useChannels(api)` → `GET /api/channels` (queryKey: `['channels']`)
- [ ] `useChannel(api, channelId)` → `GET /api/channels/:id` (queryKey: `['channel', id]`)
- [ ] `useChannelMessages(api, channelId)` → channel 消息流（新的 message store 实例）
- [ ] `useChannelSessions(api, channelId)` → `GET /api/channels/:id/sessions`

### 5.2 新增 Mutation Hooks

- [ ] `useCreateChannel(api)` → `POST /api/channels`
- [ ] `useSendChannelMessage(api, channelId)` → `POST /api/channels/:id/messages`
- [ ] `useCreateThread(api, channelId)` → `POST /api/channels/:id/sessions`
- [ ] `useInviteToChannel(api, channelId)` → `POST /api/channels/:id/invite`

### 5.3 SSE 扩展 (`web/src/hooks/useSSE.ts`)

- [ ] 处理新增事件类型:
  - `channel-added` → `queryClient.setQueryData(['channels'], ...)`
  - `channel-updated` → patch channel data
  - `channel-removed` → remove from cache
- [ ] Channel messages 的实时更新（类似现有 session message 机制）

### 5.4 Query Keys 扩展

- [ ] 在 `web/src/lib/query-keys.ts` 新增:
  ```typescript
  channels: ['channels'],
  channel: (id) => ['channel', id],
  channelSessions: (channelId) => ['channel-sessions', channelId],
  channelMessages: (channelId) => ['channel-messages', channelId],
  ```

---

## Phase 6: Channel Agent（项目经理）

### 6.1 Channel Agent 逻辑 (`hub/src/sync/channelAgent.ts`)

- [ ] 新建 ChannelAgent 模块:
  - **触发**: 用户在 channel 发送 `@agent` 消息
  - **行为**:
    1. 解析用户意图（任务描述）
    2. 调用 RPC spawn session → 创建 thread
    3. 在 channel 发送 thread 创建确认卡片
    4. 监听 thread session 的状态变化
    5. Thread 完成时在 channel 发送完成摘要
  - MVP 阶段简化: 不使用 LLM 做意图解析，直接把 @agent 后的文本作为任务标题

### 6.2 进展同步

- [ ] 监听 session-updated 事件:
  - `todos` 变化 → 更新 channel 中对应 ThreadCard
  - `threadStatus` 变为 completed → 在 channel 发送完成消息
  - `active` 变为 false → 更新 ThreadCard 状态
- [ ] 进展更新频率: 仅在 todo status 变化时推送，不实时转发每条 thread 消息

### 6.3 项目经理 Agent 对话能力（可选，MVP 后期）

- [ ] 接入 LLM API（轻量模型如 Haiku）:
  - 能回答频道内的项目状态问题
  - 能根据 thread 历史总结进展
  - 能将模糊的用户需求拆解为清晰的 thread 任务

---

## Phase 7: 多用户实时在线

### 7.1 用户在线状态

- [ ] 在 SSE 连接时记录用户 presence:
  - `{ userId, channelId, status: 'online' | 'away', lastSeenAt }`
- [ ] 广播 presence 变化给同 channel 的其他用户
- [ ] ChannelView 顶部显示在线成员头像

### 7.2 多用户消息归属

- [ ] Channel messages 包含 `userId` + `displayName`
- [ ] 消息气泡显示发送者信息（不同于 thread 里的单人对话）
- [ ] 支持多个用户同时在同一 channel 发消息

### 7.3 通知

- [ ] 复用现有 push notification 机制:
  - @mention 通知
  - Thread 完成通知
  - 新消息通知（可配置）
- [ ] 复用现有 Telegram bot 通知

---

## Phase 8: 迁移 & 兼容

### 8.1 数据迁移

- [ ] 升级脚本: 现有 sessions 自动归入用户的 #private channel:
  ```sql
  -- 为每个 namespace 创建 #general 和 #private
  -- 将现有 sessions 的 channel_id 设为对应 namespace 的 #private
  ```
- [ ] 迁移幂等（可重复运行）

### 8.2 CLI 兼容

- [ ] 现有 CLI 不感知 channel 概念 → 通过 CLI 创建的 session 自动归入 #private
- [ ] CLI `apiSession.ts` 中 session 创建时，hub 检查 channel_id:
  - 有 → 用指定的 channel
  - 无 → 默认 #private
- [ ] 不需要修改 CLI 代码（hub 侧兜底）

### 8.3 API 兼容

- [ ] 保留所有现有 `/api/sessions/*` 端点，行为不变
- [ ] 新增 `/api/channels/*` 端点为增量
- [ ] `GET /api/sessions` 仍然返回所有 sessions（跨 channel）

---

## 实施优先级

```
Week 1:  Phase 0 + 1 (数据模型 + 存储层)
Week 2:  Phase 3 + 2 (API + Sync Engine)
Week 3:  Phase 4 + 5 (Web UI 核心)
Week 4:  Phase 6 + 7 + 8 (Channel Agent + 多用户 + 迁移)
```

### MVP 完成标准

- [ ] 用户登录后看到 #general 和 #private 两个默认频道
- [ ] #private 频道体验 ≈ 现有 HAPI session 列表
- [ ] 在 #general 里发消息，所有 workspace 成员可见
- [ ] @agent + 任务描述 → 自动创建 thread（Claude Code session）
- [ ] Thread 以卡片形式折叠在 channel 中
- [ ] 点击卡片进入 thread → 完整 Claude Code 对话体验
- [ ] Thread 完成后在 channel 显示摘要
- [ ] 用户可创建自定义 channel 并通过邀请链接添加成员
- [ ] 现有 CLI 用户无感升级（sessions 自动归入 #private）

---

## 开发调试环境

### 硬件拓扑

```
┌─────────────────────────────────────────────┐
│  Azure VM (当前机器)                         │
│                                             │
│  ┌─── Hub ──────────────────────────────┐   │
│  │  bun run dev:hub                     │   │
│  │  HAPI_LISTEN_HOST=0.0.0.0            │   │
│  │  Port 3006 (HTTP + Socket.IO + SSE)  │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌─── Web Dev Server ──────────────────┐    │
│  │  bun run dev:web                     │   │
│  │  Vite port 5173                      │   │
│  │  Proxy /api → localhost:3006         │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌─── CLI + Runner ───────────────────┐     │
│  │  HAPI_API_URL=http://localhost:3006  │   │
│  │  同机直连，无网络开销               │    │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌─── SQLite DB ──────────────────────┐     │
│  │  ~/.hapi/hapi.db (WAL mode)         │   │
│  └──────────────────────────────────────┘   │
│                                             │
└──────────────────┬──────────────────────────┘
                   │ LAN / 公网 IP
                   │
┌──────────────────┴──────────────────────────┐
│  开发电脑 (浏览器)                           │
│                                             │
│  访问: http://<Azure-VM-IP>:5173            │
│  Vite 自动 proxy /api 和 /socket.io 到 hub  │
│                                             │
│  多用户测试:                                 │
│  Tab 1: token "base-token:alice"            │
│  Tab 2: token "base-token:bob"              │
└─────────────────────────────────────────────┘
```

### 启动步骤

**Terminal 1 — Hub:**
```bash
cd /home/azureuser/hapi
export HAPI_LISTEN_HOST=0.0.0.0
bun run dev:hub
# 输出中会显示 CLI_API_TOKEN，记下来
```

**Terminal 2 — Web Dev Server:**
```bash
cd /home/azureuser/hapi
bun run dev:web
# Vite 启动在 5173 端口，自动 proxy 到 hub 3006
```

**Terminal 3 — CLI (测试 agent session):**
```bash
cd /path/to/test-project
export HAPI_API_URL=http://localhost:3006
export CLI_API_TOKEN="<hub输出的token>"
hapi claude  # 或 bun run dev -- claude
```

**开发电脑浏览器:**
```
打开 http://<Azure-VM-IP>:5173
用 CLI_API_TOKEN 登录（或 CLI_API_TOKEN:namespace 多用户）
```

### 多用户测试

同一个 hub，通过 namespace 后缀模拟不同用户：

```bash
# 假设 base token 是 abc123

# 浏览器 Tab 1 (Alice):
# 登录 token: abc123:alice

# 浏览器 Tab 2 (Bob):  
# 登录 token: abc123:bob

# 两个 tab 同时打开可测试:
# - 多人在同一 channel 的消息可见性
# - thread 的创建和进展广播
# - 在线状态和实时更新
```

### 数据库操作

```bash
# 查看数据库内容
sqlite3 ~/.hapi/hapi.db ".tables"
sqlite3 ~/.hapi/hapi.db "SELECT id, namespace, name, type FROM channels;"

# 清理测试 sessions
bun run clean-session

# 完全重置（删库重来）
rm -f ~/.hapi/hapi.db ~/.hapi/hapi.db-wal ~/.hapi/hapi.db-shm
# 重启 hub 会自动重建

# 只重置 channel 相关数据（开发迭代用）
sqlite3 ~/.hapi/hapi.db "DELETE FROM channel_messages; DELETE FROM channel_members; DELETE FROM channels;"
```

### 前端热更新

Vite dev server 支持 HMR，修改 `web/src/` 下的文件会自动热更新到浏览器。

Hub 使用 `bun --watch`，修改 `hub/src/` 下的文件会自动重启 hub 进程（注意：重启会断开所有 Socket.IO 连接，CLI 会自动重连）。

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| 浏览器无法连接 Vite | 检查 Azure NSG/防火墙是否放行 5173 端口 |
| Socket.IO 连接失败 | 确认 hub 监听 `0.0.0.0` 而不是 `127.0.0.1` |
| CORS 报错 | 设置 `CORS_ORIGINS=*` 或指定开发电脑来源 |
| 多用户看不到对方消息 | 确认用的是相同 base token，只有 namespace 后缀不同 |
| Web proxy 连不上 hub | 确认 `VITE_HUB_PROXY` 指向 `http://127.0.0.1:3006` |

### 端口清单

| 端口 | 服务 | 访问方式 |
|------|------|----------|
| 3006 | Hub (HTTP + WS + SSE) | VM 内部 localhost，外部不直接访问 |
| 5173 | Vite Dev Server | 开发电脑浏览器通过 IP 访问 |

> 注意：开发电脑的浏览器只需要访问 5173（Vite），Vite 会自动 proxy API 和 WebSocket 请求到 hub 3006。不需要对外暴露 3006 端口。
