# HAPI Stage-2 E2E Test History

End-to-end UX testing of `docs/mvp-ux-stage-2.md` driven by `playwright-cli`,
3 named browser sessions per round (one per simulated user), with full
DOM + visual screenshot observation. Each round designs a **fresh enterprise
scenario** distinct from prior rounds and targets behaviors not yet stressed.

## Round summary

| 轮 | 场景 | Bot 名 | 重点测试 | 修复的 bug |
|---|---|---|---|---|
| **R1** | 2人登录页实现（最初基线） | — | 基础双人聊天 | 未独立成文，原始 PR 已并入 |
| **[R2](round-2.md)** | 3人生产事故响应 | **Sentry** | 跨 namespace 频道成员、邀请、@mention、定时线程、reactions、bot session 只读、agentConfig 热更新、软删除 | **15 bugs**：CORS PUT、邀请 UI 缺失、跨 ns 用户名渲染（thread card / 消息作者两处）、scheduled chip 不实时、`+ New thread` 用 `window.prompt`、Pin/Share 菜单缺失、删除频道 UI 缺失、agentConfig 热更新偶发竞态、unpin UI 缺失、pin 路由 cross-ns 安全漏洞 |
| **[R3](round-3.md)** | 3人文档冲刺 | **Scribe** | scheduled link-checker 实际触发、跨频道导航、bot session catch-up | **2 bugs**：Bun `fs.watch({recursive:true})` 在 Linux 静默丢嵌套文件事件 → agentConfig 热更新失效；删除频道后 thread 子进程仍跑导致 ghost workspace 文件夹被重新创建 |
| **[R4](round-4.md)** | 3人客户工单升级 | **Triage / Quiet** | `welcomeStyle:skip`、`cancel_thread` MCP、bot SIGKILL 崩溃恢复、硬删除（含文件）、频道改名、移除成员 | **5 bugs**：`welcomeStyle` 字段从未被 cli 读取；cancelled 线程卡片渲染成 "Active"；SIGKILL 永远不触发 watchdog（disconnect 没合成 session-end）；移除成员 UI 缺失；频道改名 + 描述编辑 UI 缺失 |
| **[R5](round-5.md)** | 3人冲刺启动 | **Plot → Captain** | `welcomeStyle:"custom:..."`、非 owner 只读 Settings、`list_channel_members`、运行中改名、跨频道多任务、被踢出后跳转 | **3 bugs**：`list_channel_members` 与 `get_channel_history` MCP handlers 走 ns-scoped lookup 漏掉跨 ns 成员；被移除用户停留在缓存的频道页（需自动跳转 `/channels`）；botName 改名后 channelAgent 缓存的强信号 regex 仍是旧名 |
| **[R6](round-6.md)** | 3人开源发布协调 | **Conductor** | `permissionMode:ask`、`debounceMs:1000`、§4 spec：bot session POST 应 403、`noop()` 强信号回应、thread_card 上的 reactions、无 agentConfig 频道 | **3 bugs**：`botSpawnThread` 硬编码 `yolo=true` 完全忽略 agentConfig.permissionMode；`POST /api/sessions/:id/messages` 对 bot session 返回 200 而非 spec 要求的 403（安全）；`debounceMs` 配置 DOA — channelAgent 走 hardcoded 3000 常量 |
| **[R7](round-7.md)** | 3人学术论文评审 | **Reviewer** | 频道重名、bot 的 `unpin_thread` MCP（区别于 UI unpin）、邀请二次接受幂等性、邀请过期 UX、`detach` 线程从频道、reaction 切换 toggle、bad UUID 上的 `get_thread` | **1 bug**：`POST /channels` 无重名检查 → 同一 workspace 可有两个同名频道，sidebar 两个相同按钮，workspace 文件夹冲突。修复为 409 Conflict |
| **[R8](round-8.md)** | 3人黑客松项目室 | **Captain** | 5 个并发线程 + 3 个 pinned chip 的 overflow 行为、`POST /members`（按 id 加成员，非邀请链接）、`send_to_thread` valid id、thread → channel 反向流的 "Thread:" 归属 | **0 bugs**（纯回归通过）：add-member-by-id 端到端 OK；5 cards + 3 chips 单行不截断；`send_to_thread` valid id 注入消息成功落进目标 thread；cancel + "Cancelled" badge 持续 OK；硬删除清场无残留 |
| **[R9](round-9.md)** | 3人 Q4 董事会准备 | **Compass** | post-audit-fix 验证（默认频道带 bot / 侧栏 PRIVATE+CHANNELS 分组 / namespace 标题 / 在线数 / CLI 自动附加 #private）+ bot `react_to_message` on 弱信号 + scheduled thread `⏰` chip 视觉验证 + bot session 只读视图 + **agent.json 文件直接编辑热重载** | **1 bug**：agentConfig 文件 watcher 被 `endsWith('agent.json')` 过滤掉了 sed/vim 等编辑器的 temp+rename atomic 写入事件 → 任何非直写编辑器修改 `~/.hapi/channels/{chid}/agent.json` 都不触发 `__config_updated` 注入。修复为 notify-on-any-event |

## 总览

**累计 33 个 bug，全部修复**（不含 R1 — 基线轮无独立审计；R8 是首次零 bug 回归通过的轮次，证明前 6 轮的修复达到了稳态；R9 在新一轮 audit-driven fix 之后新发现 1 个 stage-2 spec § X 文件编辑热重载漏洞）

### 复发性主题

1. **跨 namespace 用户名解析**（R2 / R3 → R5 → MCP path）— 同一类问题在
   REST、MCP、`channel_members` 多处独立出现。每轮新发现一处都要同样的
   `getUserGlobal` 兜底。
2. **AgentConfig 字段不通**（R4: `welcomeStyle`；R6: `permissionMode` +
   `debounceMs`）— 字段写到 `agent.json` 但代码从未读 → mvp 文档定义的
   schema 字段需要逐个端到端验证，不能假设"实现了表单 = 实现了行为"。
3. **缺 UI surface**（R2: 邀请 / 删除 / `+New thread` 弹窗 / Pin-Share
   菜单；R4: 改名 / 移除成员）— API 早就存在但从未在前端连线。
4. **缓存失效**（R5 / R6: channelContext 在改名 / debounceMs 改动后未失效；
   R3: scheduled-thread chip 不实时）— 任何"per-channel 缓存"都要在
   `channel-updated` 事件上 invalidate。
5. **进程生命周期**（R3: 删除后 thread 子进程跑；R4: SIGKILL bot 不触发
   watchdog）— hub 必须显式管理 thread CLI 子进程的死亡 / 信号合成。

### 仍待解决的 soft observations（非 HAPI bug 不修）

- Claude 偶发遗漏最后一次 `send_to_channel`（推理写出回复但忘了调 MCP
  工具）— R3-1 / R5 / R7 都看到。需要在 bot 系统提示中加强"composing
  reasoning is not a substitute for calling send_to_channel"。
- 非 scheduled thread 的 system prompt 不够指向（R5: thread agent 卡在
  `AskUserQuestion` 询问 repo 路径）— 需要 thread-flavor 系统提示词调优。
- Expired-invite 着陆页渲染原始 `HTTP 404 Not Found: {"error":"..."}`
  字符串而非友好句子（R7 cosmetic）。

## 通用执行规范

每一轮统一遵循：

1. 用 [`docs/mvp-ux-stage-2.md`](../mvp-ux-stage-2.md) 的章节作为 coverage
   map 起点，识别尚未被前几轮覆盖的功能。
2. 设计一个**完全不同的企业域**作为故事载体（事故响应 / 文档冲刺 /
   工单升级 / 冲刺启动 / 发布协调 / 论文评审），三人角色明确、bot
   起一个贴合域的名字。
3. 写测试脚本到 `docs/e2e_test/round-N.md`，含 cast / coverage map /
   按步骤的预期 / 失败时该如何记录。
4. 用 `~/.bun/bin/bun` 安全杀掉前一轮的 HAPI 进程（精确 PID，**禁止**
   `pkill -f bun` —— 见 [`/CLAUDE.md`](../../CLAUDE.md)），`rm -rf ~/.hapi`
   后重启 hub + web。
5. 三个命名 playwright 会话（一个用户一个），按 round 文档逐步执行；DOM
   snapshot + screenshot 都看。
6. 发现 bug 立即定位 root cause、写 fix、跑 typecheck + tests，commit
   按 concern 分组。
7. 每轮的 README / round-N.md 末尾写 "Bugs Found" 表 + "Coverage
   outcome" + 复发性观察。

## 常驻原则（来自 mvp-ux-stage-2 + 项目 CLAUDE.md）

- **No fallbacks**：暴露错误以便 debug，不要 try/catch 然后 swallow。
- **绝不用宽 pkill**：在共享主机里 `pkill -f bun` / `pkill -f vite` 会把
  Claude Code 自己也杀掉，必须用全路径 anchored pattern 或 PID。
- **Stage-2 是 membership-based**：不要再做 namespace-match 鉴权 —— 频道
  可以跨 ns 共享成员。所有"namespace-scoped lookup"代码点都需要审计有没有
  漏掉跨 ns 用户。
