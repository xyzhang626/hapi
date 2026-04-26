# MVP Implementation TODO

> Agent-Native Collaboration Platform — Channel + Thread Model
>
> Parent doc: [MVP User Experience](./mvp-user-experience.md)

---

## 关键设计决策

> 以下决策来自 Claude + Codex 联合评审，解决了原方案中的 6 个核心问题。

### D1: 统一 Channel 模型（无 type/kind 字段）

所有 channel 数据模型完全一致，**靠成员组成决定可见性**，不设 type/kind 字段。

- `#general` = 所有 workspace 成员都是 member 的 channel
- 个人空间 = 只有一个 member（自己）的 channel
- 自定义频道 = 有 N 个 member 的 channel

**优势**: 一条代码路径、无分支逻辑、天然支持"分享个人空间给某人"的未来场景。

**如何找到用户的个人 channel**: `workspace_users.personal_channel_id` 外部指针。

**如何防止误删个人 channel**: 删除 API 检查 `workspace_users` 表中是否有引用。

### D2: Channel Messages 独立管线

Channel 消息与 Session 消息**完全独立**，不复用 `MessageService`。

| | Session Messages | Channel Messages |
|---|---|---|
| 加密 | E2EE | 明文（多人可见，MVP 不加密） |
| 发送者 | 隐含 | 需要 `author_user_id` |
| 内容 | agent 对话流 | 文本 + thread 卡片 + agent 摘要 |
| 分页 | 复杂 window store | cursor-based `useInfiniteQuery` |
| seq | 内存计数器 | **DB-backed 事务递增** |

### D3: FK 策略 — sessions 用 RESTRICT，不用 CASCADE

`channel_messages` → `channels`: `ON DELETE CASCADE`（channel 删了消息可以删）

`sessions` → `channels`: **`ON DELETE RESTRICT`**（必须先解绑 session 才能删 channel）

删除 channel 的安全流程:
1. `UPDATE sessions SET channel_id = NULL WHERE channel_id = ?`
2. `DELETE FROM channels WHERE id = ?`

### D4: SSE 单连接 + 服务端过滤

每用户一条 SSE 连接，身份 = `namespace + userId`。服务端根据 `channel_members` 判断事件路由。

- channel 事件 → 检查 membership（可内存缓存）
- thread 事件 → 仅当 `sessionId === connection.activeThreadId`
- 客户端通过 `PATCH /api/sse/subscription` 更新 `activeThreadId`

### D5: ChannelAgent = Singleton 事件监听器

独立服务，注册为 SyncEngine 的 event listener，不是 SyncEngine 的一部分。

- 一个 singleton 处理所有 channel
- per-channel 并发队列: `maxActive=2, maxQueued=20`
- 完成摘要不用 LLM，用结构化模板（todos + duration + last message excerpt）

### D6: Channel 消息 seq 必须 DB-backed

多用户并发写入，内存计数器不安全。用 channels 表的 `next_seq` 列，事务内原子递增:

```sql
UPDATE channels SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq;
```

---

## Phase 0: Shared Types & Data Model ✅ 完成

### 0.1 Channel 数据模型 (`shared/`)

- [x] 在 `shared/src/schemas.ts` 新增 Channel Zod schema:
  ```typescript
  Channel {
    id: string              // nanoid
    workspaceId: string     // = namespace
    name: string            // 显示名，如 "general", "frontend"
    description?: string
    agentConfig?: {
      flavor: AgentFlavor
      model?: string
      systemPrompt?: string
    }
    createdBy: string       // userId
    createdAt: number
    updatedAt: number
  }
  ```
- [x] 新增 ChannelMember schema:
  ```typescript
  ChannelMember {
    channelId: string
    userId: string
    role: 'owner' | 'member'
    joinedAt: number
  }
  ```
- [x] 在 `shared/src/types.ts` 导出 Channel, ChannelMember 类型
- [x] 扩展现有 `Session` 类型，新增字段:
  ```typescript
  Session {
    ...existing,
    channelId?: string        // 所属 channel
    threadTitle?: string      // thread 在 channel 中的标题
    threadStatus?: 'active' | 'completed' | 'archived'
    createdByUserId?: string  // 谁发起的 thread
  }
  ```

### 0.2 用户身份增强 (`shared/`)

- [x] 新增 WorkspaceUser schema:
  ```typescript
  WorkspaceUser {
    id: string
    namespace: string            // = workspace
    userId: string
    displayName: string          // 来源: Telegram 名 或 token 后缀
    avatarUrl?: string
    personalChannelId?: string   // 指向该用户的个人 channel
    createdAt: number
    lastActiveAt: number
  }
  ```
- [x] JWT payload 扩展：`{ uid, ns, displayName? }`
- [x] 登录路由中 upsert WorkspaceUser，displayName 取 Telegram 名或 token namespace 后缀

---

## Phase 1: Database & Store Layer ✅ 完成

### 1.1 新增 channels 表 (`hub/src/store/`)

- [x] 在 `hub/src/store/index.ts` 中升级 `SCHEMA_VERSION` (7 → 8)
- [x] 新增 migration v8:
  ```sql
  -- channels 表（无 type/kind 字段）
  CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    agent_config TEXT,             -- JSON
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    next_seq INTEGER NOT NULL DEFAULT 1  -- DB-backed seq for channel messages
  );
  CREATE INDEX idx_channels_namespace ON channels(namespace);

  -- 成员表（可见性的唯一依据）
  CREATE TABLE channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, user_id)
  );
  CREATE INDEX idx_channel_members_user ON channel_members(user_id);

  -- workspace_users 表
  CREATE TABLE workspace_users (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    personal_channel_id TEXT REFERENCES channels(id),
    created_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL,
    UNIQUE(namespace, user_id)
  );

  -- sessions 表扩展（RESTRICT，不是 CASCADE）
  ALTER TABLE sessions ADD COLUMN channel_id TEXT REFERENCES channels(id) ON DELETE RESTRICT;
  ALTER TABLE sessions ADD COLUMN thread_title TEXT;
  ALTER TABLE sessions ADD COLUMN thread_status TEXT DEFAULT 'active';
  ALTER TABLE sessions ADD COLUMN created_by_user_id TEXT;
  CREATE INDEX idx_sessions_channel ON sessions(namespace, channel_id);

  -- channel messages 表（独立管线）
  CREATE TABLE channel_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    namespace TEXT NOT NULL,
    author_user_id TEXT,                   -- null = agent/system
    kind TEXT NOT NULL DEFAULT 'text'
      CHECK (kind IN ('text', 'thread_card', 'agent_summary')),
    body TEXT NOT NULL,                    -- JSON
    thread_session_id TEXT,                -- 关联的 thread（可选）
    created_at INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    UNIQUE(channel_id, seq)
  );
  CREATE INDEX idx_channel_messages_channel ON channel_messages(channel_id, seq);
  ```

### 1.2 ChannelStore (`hub/src/store/channelStore.ts`)

- [x] 新建 `ChannelStore` 类:
  - `createChannel(namespace, name, createdBy, description?) → StoredChannel`
  - `getChannel(id, namespace) → StoredChannel | null`
  - `getChannelsByNamespace(namespace) → StoredChannel[]`
  - `updateChannel(id, namespace, updates) → boolean`
  - `deleteChannel(id, namespace) → boolean` — 先检查 workspace_users 引用，拒绝删除个人 channel
  - `addMember(channelId, userId, role) → boolean`
  - `removeMember(channelId, userId) → boolean`
  - `getMembers(channelId) → ChannelMember[]`
  - `isMember(channelId, userId) → boolean`
  - `getChannelsForUser(namespace, userId) → StoredChannel[]`
    - 实现: `SELECT c.* FROM channels c JOIN channel_members cm ON c.id = cm.channel_id WHERE c.namespace = ? AND cm.user_id = ?`

### 1.3 ChannelMessageStore (`hub/src/store/channelMessageStore.ts`)

- [x] 新建 `ChannelMessageStore` 类:
  - `addMessage(channelId, namespace, authorUserId, kind, body, threadSessionId?) → StoredChannelMessage`
    - 事务内: `UPDATE channels SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq` → 用返回值作为 seq
  - `getMessages(channelId, opts: { before?: number, limit?: number }) → StoredChannelMessage[]`
    - cursor-based 分页: `WHERE channel_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`
  - `getMessagesSince(channelId, afterSeq) → StoredChannelMessage[]`

### 1.4 扩展 SessionStore

- [x] 修改 `getSessionsByNamespace()` → 支持可选 `channelId` 过滤
- [x] 新增 `getSessionsByChannel(channelId, namespace) → StoredSession[]`
- [x] 修改 `getOrCreateSession()` → 接受可选 `channelId`, `threadTitle`, `createdByUserId`
- [x] 新增 `detachSessionsFromChannel(channelId, namespace) → number` — 删除 channel 前先解绑

### 1.5 WorkspaceUserStore (`hub/src/store/workspaceUserStore.ts`)

- [x] 新建 `WorkspaceUserStore` 类:
  - `upsertUser(namespace, userId, displayName, avatarUrl?) → StoredWorkspaceUser`
  - `getUser(namespace, userId) → StoredWorkspaceUser | null`
  - `setPersonalChannel(namespace, userId, channelId) → boolean`
  - `getPersonalChannelId(namespace, userId) → string | null`
  - `ensureDefaults(namespace, userId, displayName) → { personalChannel, generalChannel }`
    - 幂等: 创建 #general（如不存在）+ 创建个人 channel + 把用户加入两个 channel 的 members + 回填 personalChannelId

### 1.6 Store 入口注册

- [x] 在 `Store` class 中注册:
  - `readonly channels: ChannelStore`
  - `readonly channelMessages: ChannelMessageStore`
  - `readonly workspaceUsers: WorkspaceUserStore`
- [x] 在 `hub/src/store/types.ts` 新增 `StoredChannel`, `StoredChannelMember`, `StoredChannelMessage`, `StoredWorkspaceUser` 类型

---

## Phase 2: Hub Sync Engine 扩展 ✅ 完成

### 2.1 Channel Cache (`hub/src/sync/channelCache.ts`)

- [x] 新建 ChannelCache（仿照 SessionCache 模式）:
  - 内存 Map<channelId, Channel>
  - 内存 Map<channelId, Set<userId>> — membership 缓存（用于 SSE 路由）
  - `loadFromStore(namespace)` → 初始化
  - `addChannel() / updateChannel() / removeChannel()`
  - `getChannelsForUser(userId)` → 过滤
  - `isMember(channelId, userId)` → 快速判断（SSE 路由用）

### 2.2 SyncEngine 扩展 (`hub/src/sync/syncEngine.ts`)

- [x] 新增 channelCache 成员
- [x] 新增方法:
  - `getChannels(namespace, userId) → Channel[]`
  - `getChannel(channelId, namespace) → Channel | null`
  - `createChannel(namespace, name, createdBy, description?) → Channel`
  - `deleteChannel(channelId, namespace) → boolean` — 调用 store.sessions.detachSessionsFromChannel → store.channels.deleteChannel
  - `addChannelMember(channelId, userId, namespace) → boolean`
  - `removeChannelMember(channelId, userId, namespace) → boolean`
  - `sendChannelMessage(channelId, namespace, authorUserId, kind, body, threadSessionId?) → ChannelMessage`
- [x] 修改 `getSessions()` → 支持按 channelId 过滤
- [x] 扩展 handleRealtimeEvent → 处理 channel-* 事件

### 2.3 SSE 事件扩展

- [x] 在 `shared/src/schemas.ts` 的 SyncEvent union 新增:
  - `channel-added { channelId, namespace, data }`
  - `channel-updated { channelId, namespace, data }`
  - `channel-removed { channelId, namespace }`
  - `channel-message-received { channelId, namespace, message }`
  - `channel-member-added { channelId, namespace, userId }`
  - `channel-member-removed { channelId, namespace, userId }`
- [x] SSEManager 扩展:
  - connection 对象新增 `userId` 字段
  - `shouldSend()` 逻辑:
    - channel 事件 → 检查 channelCache.isMember(channelId, connection.userId)
    - namespace 级事件 → 保持不变
- [x] connection 对象新增 `activeThreadId?` 字段
- [x] session/message 事件 → 仅当 sessionId === connection.activeThreadId（当前仍是旧逻辑）
- [x] 新增 `PATCH /api/sse/subscription` 端点 → 更新 connection 的 activeThreadId

### 2.4 ChannelAgent (`hub/src/sync/channelAgent.ts`) — ✅ 完成

> Singleton 事件监听器，注册在 SyncEngine 上，不是 SyncEngine 的一部分。

- [x] 新建 ChannelAgent 类:
  ```typescript
  class ChannelAgent {
    constructor(syncEngine, store) {
      syncEngine.on('channel-message-received', this.handleMessage)
      syncEngine.on('session-updated', this.handleSessionUpdate)
    }
  }
  ```
  - `handleMessage`: 检测 `@agent` → 从任务队列中申请 slot → spawn session → 发 thread_card 消息
  - `handleSessionUpdate`: todos 变化 → 更新 channel 中的 thread_card；threadStatus=completed → 发 agent_summary
- [x] 并发控制:
  ```typescript
  // per-channel 内存状态（启动时从 DB 重建）
  Map<channelId, { activeCount: number, queue: TaskEntry[] }>
  maxActiveThreadsPerChannel = 2
  maxQueuedThreadsPerChannel = 20
  ```
- [x] 完成摘要格式（不用 LLM）:
  ```json
  {
    "status": "completed",
    "taskTitle": "实现登录页面",
    "threadId": "session-xxx",
    "durationMs": 720000,
    "todos": { "completed": 5, "total": 5 },
    "lastMessageExcerpt": "已完成所有组件开发并通过测试..."
  }
  ```

---

## Phase 3: HTTP API Routes ✅ 完成

### 3.1 Channel Routes (`hub/src/web/routes/channels.ts`)

- [x] 新建 channels 路由文件:
  - `GET /api/channels` → 返回当前用户可见的所有 channels（基于 membership）
  - `POST /api/channels` → 创建 channel `{ name, description? }`，创建者自动成为 owner member
  - `GET /api/channels/:id` → 获取 channel 详情 + 成员列表（需 membership 检查）
  - `DELETE /api/channels/:id` → 删除 channel（需 owner role + 非个人 channel）
  - `POST /api/channels/:id/members` → 添加成员 `{ userId }`
  - `DELETE /api/channels/:id/members/:userId` → 移除成员
  - `GET /api/channels/:id/sessions` → 获取 channel 下的所有 threads
  - `GET /api/channels/:id/messages?before=<seq>&limit=50` → cursor-based 分页消息流
  - `POST /api/channels/:id/messages` → 发消息 `{ body, kind? }`

### 3.2 邀请链接 — ✅ 完成

- [x] `POST /api/channels/:id/invite` → 生成邀请 token（带过期时间）
- [x] `POST /api/invite/:token` → 通过邀请链接加入 channel

### 3.3 修改现有 Sessions Routes

- [x] `POST /api/channels/:channelId/sessions` → 在 channel 下创建 thread
- [x] `GET /api/sessions/:id` → 返回增加 channelId, threadTitle, threadStatus
- [x] `GET /api/sessions/:id/route` → 返回 `{ channelId }` — 用于旧 URL redirect
- [x] `PATCH /api/sessions/:id/thread-status` → 更新 thread 状态

### 3.4 Auth 扩展

- [x] 登录路由中调用 `store.workspaceUsers.ensureDefaults(namespace, userId, displayName)`
- [x] JWT 中包含 userId 以便 channel 权限检查

---

## Phase 4: Web UI — Channel 视图 ✅ 完成

### 4.1 路由重构 (`web/src/router.tsx`)

- [x] 新增路由结构:
  ```
  /                           → redirect /channels
  /channels                   → ChannelsPage (频道列表 + 内容区)
  /channels/:channelId        → ChannelPage (频道消息流)
  /channels/:channelId/threads/:sessionId → ThreadPage (= 现有 SessionPage)
  /channels/:channelId/threads/:sessionId/files → FilesPage
  /channels/:channelId/threads/:sessionId/terminal → TerminalPage
  /settings                   → SettingsPage (保持不变)
  ```
- [x] 旧路由 redirect 兼容:
  ```typescript
  // /sessions → /channels (replace: true)
  // /sessions/:id → async loader: fetch /api/sessions/:id/route → redirect
  ```

### 4.2 频道列表 (`web/src/components/ChannelList.tsx`)

- [x] 新建 ChannelList 组件，替代 SessionList:
  - 顶部: Workspace 名称 + 设置按钮
  - 频道列表（全部平铺，不按 type 分组——因为没有 type）:
    ```
    # general          (2 active threads)
    # frontend         (1 active thread)
    # design
    # my workspace     (你的个人空间)
    ─────
    + Create Channel
    ```
  - 每个频道项: 名称 + 活跃 thread 数 + 未读指示器
  - 个人 channel 可通过比较 `workspace_users.personalChannelId` 来标识显示
  - 点击频道 → `/channels/:channelId`
  - 响应式: 移动端做 drawer，选择频道后自动关闭

### 4.3 频道消息视图 (`web/src/components/ChannelView.tsx`)

- [x] 新建 ChannelView 组件:
  - 顶部: 频道名称 + 成员列表 + 设置
  - 消息流: 用户消息 + Agent 摘要 + Thread 卡片
  - 输入框: 支持 `@agent` mention
  - **不复用 message-window-store**，用 `useInfiniteQuery` + SSE patch

### 4.4 Thread 卡片 (`web/src/components/ThreadCard.tsx`)

- [x] 新建 ThreadCard 组件:
  ```
  ┌──────────────────────────────────┐
  │  实现登录页面           进行中    │
  │ by Alice · 3 minutes ago        │
  │ ────────────────────────────────│
  │ [done] 分析设计稿                │
  │ [..] 编写表单组件                │
  │ [ ] 接入认证 API                 │
  │ ────────────────────────────────│
  │ [打开 Thread]                    │
  └──────────────────────────────────┘
  ```

### 4.5 Thread 详情页（复用现有 SessionChat）

- [x] 新增: 顶部面包屑 `#frontend > 实现登录页面` + 返回按钮 + 状态切换
- [x] 其余保持不变

### 4.6 个人 channel 简化布局

- [x] 当 channelId === personalChannelId 时:
  - 不显示成员列表
  - Thread 列表类似现有 SessionList 体验
  - 保留 machine/directory 选择

---

## Phase 5: Web UI — Hooks & State ✅ 完成

### 5.1 新增 Query Hooks

- [x] `useChannels(api)` → `GET /api/channels` (queryKey: `['channels']`)
- [x] `useChannel(api, channelId)` → `GET /api/channels/:id` (queryKey: `['channel', id]`)
- [x] `useChannelMessages(api, channelId)` → `useInfiniteQuery` cursor-based 分页
- [x] `useChannelSessions(api, channelId)` → `GET /api/channels/:id/sessions`

### 5.2 新增 Mutation Hooks

- [x] `useCreateChannel(api)` → `POST /api/channels`
- [x] `useSendChannelMessage(api, channelId)` → `POST /api/channels/:id/messages`
- [x] `useCreateThread(api, channelId)` → `POST /api/channels/:id/sessions`
- [x] `useInviteToChannel(api, channelId)` → `POST /api/channels/:id/invite`

### 5.3 SSE 扩展 (`web/src/hooks/useSSE.ts`)

- [x] 处理新增事件类型:
  - `channel-added` → `queryClient.setQueryData(['channels'], ...)`
  - `channel-updated` → patch channel data
  - `channel-removed` → remove from cache
  - `channel-message-received` → `setQueryData` 追加到 infinite query 首页
- [x] 连接时传 `userId`，路由切换时 PATCH `activeThreadId`

### 5.4 Query Keys 扩展

- [x] 在 `web/src/lib/query-keys.ts` 新增:
  ```typescript
  channels: ['channels'],
  channel: (id) => ['channel', id],
  channelSessions: (channelId) => ['channel-sessions', channelId],
  channelMessages: (channelId) => ['channel-messages', channelId],
  ```

---

## Phase 6: 多用户实时在线 ✅ 完成

### 6.1 用户在线状态

- [x] SSE 连接时记录 presence: `{ userId, status: 'online' | 'away', lastSeenAt }`
- [x] 广播 presence 变化给同 channel 的其他用户（通过 membership 过滤）
- [x] ChannelView 顶部显示在线成员头像

### 6.2 多用户消息归属

- [x] Channel messages 通过 `author_user_id` JOIN `workspace_users` 获取 displayName
- [x] 消息气泡显示发送者信息
- [x] 支持多用户同时在同一 channel 发消息

### 6.3 通知

- [x] 复用现有 push notification + Telegram bot 通知机制
- [x] @mention 通知 / Thread 完成通知 / 新消息通知（可配置）

---

## Phase 7: 迁移 & 兼容 ✅ 完成

### 7.1 数据迁移

- [x] migration v8→v9 脚本:
  - 为每个 namespace 创建 #general channel + 将所有现有 user 加为 member
  - 为每个 user 创建个人 channel + workspace_user 记录
  - 现有 sessions 的 `channel_id` 设为对应用户的个人 channel
- [x] 迁移幂等（可重复运行）

### 7.2 CLI 兼容

- [x] 通过 CLI 创建的 session（无 channelId）→ hub 自动归入用户的个人 channel
- [x] 不需要修改 CLI 代码（hub 侧通过 `workspace_users.personal_channel_id` 兜底）

### 7.3 API 兼容

- [x] 保留所有现有 `/api/sessions/*` 端点，行为不变
- [x] 新增 `/api/channels/*` 端点为增量
- [x] `GET /api/sessions` 仍然返回所有 sessions（跨 channel）

---

## 实施优先级

```
Week 1:  Phase 0 + 1 (数据模型 + 存储层) + Phase 9 后端测试       ✅ 完成
Week 2:  Phase 3 + 2 (API + Sync Engine) + API 集成测试            ✅ 完成
Week 3:  Phase 4 + 5 (Web UI 核心)                                 ✅ 完成
Week 4:  Phase 2.4 + 6 + 7 (Channel Agent + 多用户 + 迁移)         ✅ 完成
```

### 各 Phase 完成度速览

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| 0 | Shared Types | ✅ 100% | — |
| 1 | Database & Store | ✅ 100% | — |
| 2 | Sync Engine | ✅ 100% | — |
| 3 | HTTP API Routes | ✅ 100% | — |
| 4 | Web UI Channel 视图 | ✅ 100% | — |
| 5 | Web UI Hooks | ✅ 100% | — |
| 6 | 多用户实时 | ✅ 100% | — |
| 7 | 迁移 & 兼容 | ✅ 100% | — |
| 9 | 后端测试 | ✅ 100% | 173 tests, smoke script created |

### MVP 完成标准

- [x] 用户登录后看到 #general 和个人频道
- [x] 个人频道体验 ≈ 现有 HAPI session 列表
- [x] 在 #general 里发消息，所有 workspace 成员可见
- [x] @agent + 任务描述 → 自动创建 thread（Claude Code session）
- [x] Thread 以卡片形式折叠在 channel 中
- [x] 点击卡片进入 thread → 完整 Claude Code 对话体验
- [x] Thread 完成后在 channel 显示摘要
- [x] 用户可创建自定义 channel 并通过邀请链接添加成员
- [x] 现有 CLI 用户无感升级（sessions 自动归入个人 channel）

---

## Phase 9: 后端测试策略（脱离 UI） ✅ 完成 — 173 tests

> 后端逻辑在没有 UI 的情况下完全可测。项目已有 bun:test 基础设施，遵循现有模式即可。

### 9.1 测试分层

```
Layer 1: Store 单元测试（纯 SQLite :memory:，无 HTTP）             ✅ 已实现
  → hub/src/store/channels.test.ts (29 tests)
  → hub/src/store/edge-cases.test.ts (35 tests)

Layer 2: API 路由集成测试（Hono app + Store adapter，无真实 server） ✅ 已实现
  → hub/src/web/routes/channels-e2e.test.ts (34 tests)

Layer 3: SyncEngine 集成测试（真实 Store + 真实 Cache，无 HTTP）    ✅ 已实现
  → hub/src/sync/channelCache.test.ts (19 tests)

Layer 3.5: Server E2E 测试（Bun.serve + JWT，真实 HTTP）           ✅ 已实现
  → hub/src/web/routes/channels-server-e2e.test.ts (8 tests)

Layer 4: curl 脚本冒烟测试（真实 Hub 进程，命令行验证）
  → ❌ hub/test/smoke-channels.sh 未创建
```

### 9.2 Store 单元测试 ✅

**文件**: `hub/src/store/channels.test.ts` — 29 tests (CRUD, membership, namespace isolation, FK RESTRICT, seq, pagination, workspace defaults)

```typescript
import { describe, expect, it } from 'bun:test'
import { Store } from './index'

describe('ChannelStore', () => {
    it('creates a channel and retrieves by namespace', () => {
        const store = new Store(':memory:')
        const ch = store.channels.createChannel('ns1', 'general', 'user-1')
        expect(ch.name).toBe('general')
        const channels = store.channels.getChannelsByNamespace('ns1')
        expect(channels).toHaveLength(1)
    })

    it('membership determines visibility', () => {
        const store = new Store(':memory:')
        const ch = store.channels.createChannel('ns1', 'team', 'user-1')
        store.channels.addMember(ch.id, 'user-1', 'owner')
        store.channels.addMember(ch.id, 'user-2', 'member')
        // user-1 and user-2 can see it
        expect(store.channels.getChannelsForUser('ns1', 'user-1')).toHaveLength(1)
        expect(store.channels.getChannelsForUser('ns1', 'user-2')).toHaveLength(1)
        // user-3 cannot
        expect(store.channels.getChannelsForUser('ns1', 'user-3')).toHaveLength(0)
    })

    it('RESTRICT prevents deleting channel with sessions', () => {
        const store = new Store(':memory:')
        const ch = store.channels.createChannel('ns1', 'dev', 'user-1')
        store.sessions.getOrCreateSession('tag', { path: '/p' }, null, 'ns1', ch.id)
        expect(() => store.channels.deleteChannel(ch.id, 'ns1')).toThrow()
    })

    it('detach then delete succeeds', () => {
        const store = new Store(':memory:')
        const ch = store.channels.createChannel('ns1', 'dev', 'user-1')
        store.sessions.getOrCreateSession('tag', { path: '/p' }, null, 'ns1', ch.id)
        store.sessions.detachSessionsFromChannel(ch.id, 'ns1')
        expect(store.channels.deleteChannel(ch.id, 'ns1')).toBe(true)
    })
})
```

**文件**: `hub/src/store/channelMessages.test.ts`

```typescript
describe('ChannelMessageStore', () => {
    it('seq auto-increments atomically', () => {
        const store = new Store(':memory:')
        const ch = store.channels.createChannel('ns1', 'general', 'user-1')
        const m1 = store.channelMessages.addMessage(ch.id, 'ns1', 'user-1', 'text', '{"text":"hello"}')
        const m2 = store.channelMessages.addMessage(ch.id, 'ns1', 'user-2', 'text', '{"text":"world"}')
        expect(m1.seq).toBe(1)
        expect(m2.seq).toBe(2)
    })

    it('cursor-based pagination', () => {
        const store = new Store(':memory:')
        const ch = store.channels.createChannel('ns1', 'general', 'user-1')
        for (let i = 0; i < 100; i++) {
            store.channelMessages.addMessage(ch.id, 'ns1', 'user-1', 'text', `{"n":${i}}`)
        }
        const page1 = store.channelMessages.getMessages(ch.id, { limit: 20 })
        expect(page1).toHaveLength(20)
        expect(page1[0].seq).toBe(100) // newest first
        const page2 = store.channelMessages.getMessages(ch.id, { before: page1[19].seq, limit: 20 })
        expect(page2[0].seq).toBe(80)
    })
})
```

**文件**: `hub/src/store/workspaceUsers.test.ts`

```typescript
describe('WorkspaceUserStore', () => {
    it('ensureDefaults creates personal channel + general + membership', () => {
        const store = new Store(':memory:')
        const result = store.workspaceUsers.ensureDefaults('ns1', 'alice', 'Alice')
        expect(result.personalChannel).toBeDefined()
        expect(result.generalChannel).toBeDefined()
        // alice is member of both
        expect(store.channels.isMember(result.personalChannel.id, 'alice')).toBe(true)
        expect(store.channels.isMember(result.generalChannel.id, 'alice')).toBe(true)
        // idempotent
        const result2 = store.workspaceUsers.ensureDefaults('ns1', 'alice', 'Alice')
        expect(result2.personalChannel.id).toBe(result.personalChannel.id)
    })

    it('personal channel is not deletable', () => {
        const store = new Store(':memory:')
        const { personalChannel } = store.workspaceUsers.ensureDefaults('ns1', 'alice', 'Alice')
        expect(() => store.channels.deleteChannel(personalChannel.id, 'ns1')).toThrow()
    })
})
```

### 9.3 API 路由测试 ✅

**文件**: `hub/src/web/routes/channels-e2e.test.ts` — 34 tests (全生命周期, 多用户, 权限, 分页)
**文件**: `hub/src/web/routes/channels-server-e2e.test.ts` — 8 tests (真实 HTTP + JWT + namespace 隔离)

```typescript
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { createChannelsRoutes } from './channels'

function createApp(engine) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        c.set('userId', 'alice')
        await next()
    })
    app.route('/api', createChannelsRoutes(() => engine))
    return app
}

describe('channels routes', () => {
    it('GET /api/channels returns only channels user is member of', async () => {
        const engine = {
            getChannels: (ns, userId) => userId === 'alice'
                ? [{ id: 'ch1', name: 'general' }]
                : []
        }
        const app = createApp(engine)
        const res = await app.request('/api/channels')
        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data).toHaveLength(1)
        expect(data[0].name).toBe('general')
    })

    it('DELETE /api/channels/:id rejects personal channel', async () => {
        const engine = {
            deleteChannel: () => { throw new Error('Cannot delete personal channel') }
        }
        const app = createApp(engine)
        const res = await app.request('/api/channels/ch-personal', { method: 'DELETE' })
        expect(res.status).toBe(400)
    })

    it('GET /api/channels/:id/messages supports cursor pagination', async () => {
        const engine = {
            getChannelMessages: (chId, opts) => ({
                messages: [{ seq: 50, body: '{}' }],
                hasMore: true
            })
        }
        const app = createApp(engine)
        const res = await app.request('/api/channels/ch1/messages?before=51&limit=1')
        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.hasMore).toBe(true)
    })
})
```

### 9.4 curl 冒烟测试脚本 — ✅ 已创建

**文件**: `hub/test/smoke-channels.sh`

```bash
#!/bin/bash
# 启动 hub 后运行: bash hub/test/smoke-channels.sh
set -euo pipefail
BASE="http://localhost:3006"
TOKEN="${CLI_API_TOKEN:?Set CLI_API_TOKEN}"

# 登录获取 JWT
JWT=$(curl -sf "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN:alice\"}" | jq -r '.token')

H="Authorization: Bearer $JWT"

echo "=== 1. List channels (should have general + personal) ==="
curl -sf "$BASE/api/channels" -H "$H" | jq '.[] | {id, name}'

echo "=== 2. Create custom channel ==="
CH_ID=$(curl -sf "$BASE/api/channels" -H "$H" \
  -H 'Content-Type: application/json' \
  -d '{"name":"frontend"}' | jq -r '.id')
echo "Created: $CH_ID"

echo "=== 3. Send message ==="
curl -sf "$BASE/api/channels/$CH_ID/messages" -H "$H" \
  -H 'Content-Type: application/json' \
  -d '{"body":"{\"text\":\"hello team\"}","kind":"text"}' | jq .

echo "=== 4. Get messages (cursor pagination) ==="
curl -sf "$BASE/api/channels/$CH_ID/messages?limit=10" -H "$H" | jq '.messages | length'

echo "=== 5. Delete channel ==="
curl -sf "$BASE/api/channels/$CH_ID" -H "$H" -X DELETE | jq .

echo "=== PASS ==="
```

### 9.5 运行方式

```bash
# Store 单元测试（无需启动 hub）
cd /home/azureuser/hapi && bun test hub/src/store/

# Route 测试（无需启动 hub）
cd /home/azureuser/hapi && bun test hub/src/web/routes/

# 全部 hub 测试
cd /home/azureuser/hapi && bun run test:hub

# 冒烟测试（需先启动 hub）
bun run dev:hub &
sleep 2
bash hub/test/smoke-channels.sh
```

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
```

**Terminal 2 — Web Dev Server:**
```bash
cd /home/azureuser/hapi
bun run dev:web
```

**Terminal 3 — CLI (测试 agent session):**
```bash
cd /path/to/test-project
export HAPI_API_URL=http://localhost:3006
export CLI_API_TOKEN="<hub输出的token>"
hapi claude
```

### 数据库操作

```bash
# 查看数据库内容
sqlite3 ~/.hapi/hapi.db ".tables"
sqlite3 ~/.hapi/hapi.db "SELECT id, namespace, name FROM channels;"
sqlite3 ~/.hapi/hapi.db "SELECT channel_id, user_id, role FROM channel_members;"

# 完全重置
rm -f ~/.hapi/hapi.db ~/.hapi/hapi.db-wal ~/.hapi/hapi.db-shm

# 只重置 channel 相关数据
sqlite3 ~/.hapi/hapi.db "DELETE FROM channel_messages; DELETE FROM channel_members; DELETE FROM channels;"
```
