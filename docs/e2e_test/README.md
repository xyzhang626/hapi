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
| **[R10](round-10.md)** | 3人架构评审委员会 | **Atlas** | `+ New thread` UI 按钮端到端首次点击 + soft-private → shared `🔒Share to channel` toggle（在 More actions overflow）+ 用户 reaction picker 切换 + 单条消息触发多个 MCP（spawn × 2 + pin × 1）+ **channel timeline markdown 渲染** | **1 bug + 1 bonus**：channel timeline 用 `<p whitespace-pre-wrap>` 渲染 bot 消息，markdown `**bold**` / 列表全是字面字符（thread 详情页是渲染的，channel 是唯一不渲染的地方）。修复：从 codex-debug worktree port StandaloneMarkdown 组件。Bonus：`accessToken.ts` whitespace 校验补全（`"token: alice"` 之前会静默接受为 namespace=" alice"，造成幽灵工作区），测试套件首次 240/240 |
| **[R11](round-11.md)** | 3人 monorepo → polyrepo 迁移协作 | **Forge** | channel description 在 header 渲染 + 非 owner 看 agentConfig 编辑器为只读 + markdown 代码块（`<pre class="language-bash">`）渲染 + `noop()` 强信号响应（无 timeline 产物）+ **用户 reaction → bot 弱信号 buffer** + 修 R10 遗留 thread_card 没有 `+ 😊` 入口 | **2 bugs**：(1) `ChannelAgent.handleEvent` 完全不监听 `message-reaction-added`/`removed`，用户对消息加 emoji bot 永远看不见 — spec §V 承诺这是弱信号 buffer 输入，半个§V 之前是 DOA。修复：新增 `handleReaction` 把 reaction 事件合成成文本进 `enqueueWeakSignal`，bot 自加的 reaction 跳过避免自激。(2) `thread_card` 没有 `+ 😊` picker 触发器 UI（数据通路支持 spec §IX 任意消息 reaction，但只有 text-message 行有按钮）。修复：在 card 包裹层加 hover-revealed `absolute top-1 right-1` 按钮。R10 软观察转 R11 修复 |
| **[R12](round-12.md)** | 3人面试 debrief 房间 | **Lumen** | `welcomeStyle:custom` 精确文本验证 + 3 个跨 ns 用户并发 storm（spec §V 验证 2-msg 阈值切批正确）+ MCP `list_threads` + MCP `get_thread` + thread → channel `send_to_channel` 反向流的 `Thread: <title>` 作者标签**视觉**验证 | **0 bugs**（第二次零 bug 回归通过，继 R8 之后；4 项 NEW 行为 + 6 项 R3-R11 回归全部 hold） |
| **[R13](round-13.md)** | 3人 chaos engineering Game Day | **Watchdog** | `spawn_scheduled_thread` 真的执行 `/loop`（等 130s 看到 thread session 19→50 条消息 + send_to_channel + 多次 get_channel_history catch-up）+ 取消 scheduled thread + `change_title` MCP 在 bot session 页**视觉**验证 + markdown 表格渲染 + description-only PUT 不重启 bot | **1 bug**：`cancelThreadSession` 把 thread 标 `archived` 但**没清 `pinned`**，⏰ chip 还在 header 指向死线程。修复：cancel 时如果原本 pinned 就调 `setSessionPinned(false)`，SSE `thread-unpinned` 事件让 chip 立即消失。3 个回归测试 |
| **[R14](round-14.md)** | 3人客户访谈合成（隔离环境运行：hub 3106 / web 5273 / `~/.hapi-mine`，并行另一个测试占用 3006/5173）| **Echo→Synth** | typing indicator (`✨ <name> is thinking…`) + thread → channel 多次更新 `Thread:` label 一致性 + bot 用 `send_to_thread` 跨用户路由 + PUT botName 改名让 channelAgent regex 缓存失效 | **2 bugs**：(1) typing indicator 硬编码 "Agent"，无视 agentConfig.botName。修复：读 channel.agentConfig.botName。(2) `deleteChannel` 用当前 `channel.name` 算 workspace 文件夹路径，但 PUT 改名不会移动磁盘上的文件夹 → 改名+硬删除后原文件夹残留。修复：删除前从 bot session 的 `metadata.path` 取原始路径作为 backup candidate。1 个回归测试 |
| **[R15](round-15.md)** | 3人产品发布协调（隔离环境同 R14）| **Quill** | bot SIGKILL → watchdog respawn 端到端（kill -9 claude subproc + 验证 botSessionId 不变 + resume 保留对话上下文）+ 空 timeline first-message UX + 无 reaction 自反馈循环 + 成员自主退出频道 | **1 bug**：channel 创建时如果初始 spawnChannelBot 失败（比如 embedded runner 子进程刚 exit），channel 留在 `botSessionId=NULL` 孤儿态，**没有路径**重试 — `updateChannelData` 的 spawn-on-add guard 要求 `!hadConfig`，这里是 false。修复：放宽 guard 增加 `hadConfig && hasConfig && !hadBot` 的 orphan-retry 分支。3 个回归测试 |
| **[R16](round-16.md)** | 3人 Q2 i18n Japanese rollout（隔离环境同 R14-15）| **Polyglot** | **首个 multi-file long-range 轮**：3 个并发 thread agent 真正去 workspace 编辑 `.json` / `.ts` / `.md` 文件（add-ja-locale / register-ja-loader / update-readme），bot 用 `send_to_thread` 注入 correction directive 多轮迭代，硬删带文件清场。**+ 首个视觉 UX 评分 pass** 按 spec §XIII 检查 transitions / animations / 视觉层级 | **0 bugs**（第三次零 bug 通过，继 R8/R12 之后）：multi-file 工件三件齐全（5 keys 全日语 / loader.ts 加 ja import + Locale union + REGISTRY / README 加 Japanese），多轮 send_to_thread 注入 → 线程在 seq=14 收到 `<system>injected-by-bot</system>` 并在 seq=16 用日语回复，硬删时 PID 778913 bot subproc 在 12s 内被 watchdog 收走，workspace 文件夹（含 `locales/` `src/i18n/` `README.md`）一并消失。视觉评分发现 `animate-*` 类在频道 DOM 上 0 个（spec §XIII 要 typing indicator 脉动光晕） + thread card 无渐变（spec 要"卡片背景渐变带边光"）— 按 memory 规则记为 soft observation，下一轮如果同样 gap 仍在则升级为 bug |
| **[R17](round-17.md)** | 3人 Q2 API v2 Orders 重设计（隔离环境同 R14-16）| **Gateway** | **multi-file long-range** 升级到 4 文件类型（yaml + ts + test.ts + md），多轮 send_to_thread correction，**首个 `Bot session →` 链接 + read-only 横幅 e2e 验证**（spec §IV），**首个 `Share to channel` toggle e2e 验证**（spec §VII 私有→共享），**第二轮视觉 UX 评分**按 memory 规则升级 R16 留下的 soft observation 为修复 | **2 bugs**：(1) typing indicator 一直只在 1.5×1.5 px 小点上 `animate-pulse` —— 视觉上完全看不到的 "脉动光晕"。spec §XIII 明确要"渐变文字 + 脉动光晕"。R16 已记 soft，R17 第二次 — 升级为修复：新加 keyframe `bot-typing-halo` (1.6s 光晕扩散) + `bot-typing-text-shimmer` (2.4s 渐变滚动)，glyph 17.6px indigo→purple 圆 + 透明渐变文字 5 色 stops。(2) thread `Share to channel` toggle 只翻 DB 的 `session.visibility` 但 channel timeline thread_card 视觉不变 — spec §VII 明确"Card 升级显示详细 action"。修复：`ChannelView` 用 live session 解析 `visibility` + 最新 `threadTitle` 注入 enriched cardData；`ThreadCard` 在 `data.visibility==='shared'` 时渲染 indigo 渐变背景 + indigo 边框光环 + `🔗 Shared` 徽章。Felix 视角端到端验证，private↔shared 双向 toggle 实时 SSE 反映 |
| **[R18](round-18.md)** | 3人 Q2 SLO Review Prep（隔离环境同 R14-17）| **Beacon** | **5 文件类型**（sql×2 + md + yaml + ts×2 + json）+ **首个 `pin_thread` MCP from bot session e2e + 头部 chip strip live 验证**（spec §III/§XIII 📌 chip） + **首个 `change_title` MCP live propagation 端到端验证**（spec §VI） + **首个 owner UI 长按 / 右键 unpin 端到端**（spec §III line 114） + **同 emoji 反应 Slack 风格切换移除**（spec §IX）+ 第三轮视觉 UX 评分回归 R17 修复 | **3 bugs**：(1) Opus 4.7 thread agent 直接拒绝 `<system>injected-by-bot</system>` Lead-Teammate 注入为"prompt injection attempt"。修复：spawn 出来的 thread session 加 `customSystemPrompt` 显式说明 spec §VI 注入规约 + 可用 MCP 工具，让 security-aware models 也接受。(2) `change_title` MCP 把新名落到 `metadata.summary.text` 但**没有同步**到 `sessions.thread_title`，channel timeline 卡片 + pinned chip 永远显示老名字。修复：新增 `setSessionThreadTitle` + 在 `handleUpdateMetadata` 检测 `summary.text` 变化时同步到 `thread_title`。(3) Pinned chip 缺 owner 长按 / 右键 unpin 入口（spec §III line 114 明确要求）。修复：新 `PinnedThreadChip` 组件用 `useLongPress` hook，owner 长按 / 右键 → `📍 Unpin from header` 菜单 → API 调 `setThreadPinned(false)` → SSE 实时同步删除 chip。三个 fix 都端到端验证 |
| **[R19](round-19.md)** | 3人 Q2 mobile launch readiness review（隔离环境同 R14-18）| **Pilot** | **5 文件类型**（md×2 + json + **txt 首入** + ts×2）+ **首个 `cancel_thread(threadId, reason?)` reason 渲染端到端验证**（spec §VI line 184） + **首个 agentConfig UI editor save → hot-reload 端到端**（spec §X line 351 + §XIII line 441） + **首个 3-user reaction stack `👀 3` count badge 验证**（spec §IX，R18 只验证 2 人） + 第四轮视觉 UX 评分回归 R17/R18 fixes + scheduled thread `/loop` 实际执行回归（R13） + channel description PUT live 更新 bot 不重启回归（R6） | **1 bug**：`cancel_thread` 时 bot 传的 `reason="out-of-scope for week 3 launch"` 落进 agent_summary card 的 body data 但 `ThreadCard.tsx` 只渲染状态 pill 不读 `data.reason` — 用户无法在频道时间线看到取消原因。修复：`ThreadCard` 现读 `data.reason`，cancelled 卡片下方加一个 italic slate-bordered 侧边块 `Reason: <text>`。端到端验证 OK，DOM 显示 "Cancelled / by Priya Iyengar / Reason: out-of-scope for week 3 launch" |
| **[R20](round-20.md)** | 3人 SOC 2 Type II 审计准备（隔离环境同 R14-19）| **Cipher** | **5 文件类型**（md + yaml + ts×2 + sql + **csv 首入**）+ **首个 `+ New thread` UI 按钮端到端**（spec §VII line 207-208 模态对话框 → bot 自动 spawn_thread） + **首个 `list_channel_members` MCP bot 实际使用 e2e**（bot 用结果按名字 @ 具体成员 spec §VI line 192） + **首个 `get_thread` MCP bot 实际使用 e2e**（bot 引用 thread 真实状态而非猜测 spec §VI line 190） + **首个 channel rename mid-flight with active threads 端到端**（PUT name 改名，sidebar 三个用户即时更新，bot_session_id 不变，workspace 文件夹按 R14-2 保留原 path 等删除时清理） + 第五轮视觉 UX 评分 | **0 bugs**（**第四次零 bug 通过**，继 R8/R12/R16 之后）：4 个 NEW 行为首跑全部端到端通过，5 个 thread 全部 spawn 成功（包括按钮触发的那个），R14-2 deleteChannel 用 metadata.path 而非当前 name 算 workspace 文件夹的 fix 终于在 e2e 命中验证 — 改名后硬删 channel，被删除的是原始 `soc2-audit-prep-q2/` 文件夹而非 post-rename 的 `soc2-evidence-bundle-q2/`，干净 |
| **[R21](round-21.md)** | **50人** Q2 平台方向 RFC 评审（隔离环境同 R14-20）| **Senate** | **首个规模轮**：3 人 UI 驱动（Anders/Naomi/Oluchi）+ 47 人 API 驱动（eng001..eng047），50 人成员表 + 30 反应风暴 + 10 消息突发 + 5 文件类型 + 第六轮视觉 UX 评分。验证 (a) 50-member channel 创建/邀请规模正常；(b) 30 同时 reactions 在 45ms 内全部入库 + DOM 渲染 `👍 30` + SSE 投递所有订阅者；(c) 10 消息 burst → bot weak-signal-batch 23 次注入，bot 用 `react_to_message` 2× 而非刷屏；(d) 50 成员硬删干净 | **1 bug**：50 人频道 header 只显示 "👥 1 online" — 因为 presence 是 namespace-scoped (Anders 一个人在 `anders` ns 下)，跟实际 50 人完全脱节。spec §III "channel header" + 用户"现代流畅"期望都要求 room 大小一眼可见。修复：`ChannelView` 拉 `useQuery(channelMembers)` 并组合渲染 "👥 50 members · 1 online"。验证后 Anders header 显示 "👥 50 members · 1 online" |
| **[R22](round-22.md)** | 3人前端 landing page 重设计 sprint（隔离环境同 R14-21）| **Atelier** | **5 文件类型**（**.tsx 首入** + **.css 首入** + .test.tsx + json + md）+ **首个 soft-delete 端到端验证**（spec §XII line 418-422 — workspace 文件夹原子重命名为 `-archived-<ts>`，threads 标 archived，bot subprocess 终止，channel 从 list 隐藏）+ **首个 channel re-create with same name post-soft-delete e2e**（POST 同名成功，新旧 workspace 文件夹并存，新 bot 干净重生，header `👥 1 member · 1 online`）+ 第七轮视觉 UX 评分 | **0 bugs**（**第五次零 bug 通过**，继 R8/R12/R16/R20 之后）：soft-delete 把 `landing-page-redesign-w2/` 重命名为 `landing-page-redesign-w2-archived-1777437650304/`、3 个 thread 全部 archived、Atelier PID 终止干净；同名再创建立即成功（new id 27630e86）+ 新文件夹 + 旧 archived 文件夹和谐共存；后续 hard-delete 只清新文件夹保留 archived。soft observation：spec line 419 说 mark `deleted_at`，但 `channels` 表没这列 — 实际是直接删除行，user-visible 行为等价但理论 restore 路径不存在 |

## 总览

**累计 47 个 bug，全部修复**（不含 R1 — 基线轮无独立审计；R8 是首次零 bug 回归通过的轮次，证明前 6 轮的修复达到了稳态；R9 在新一轮 audit-driven fix 之后新发现 1 个 stage-2 spec § X 文件编辑热重载漏洞；R10 找到了 channel timeline 一直没有 markdown 渲染的视觉漏洞 + bonus 关掉了套件长期带的 1 个 access-token 校验测试；R11 发现 spec §V 半个弱信号通路 DOA — 用户 reaction 永远到不了 bot — 以及 R10 遗留的 thread card 缺 reaction 入口；R12 第二次零 bug 通过；R13 验证 scheduled `/loop` 真的执行后发现 cancel 没清 pinned；R14 找出了 typing indicator 永远显示 "Agent" 不读 botName + delete 用当前名而非原始 path 算 workspace 文件夹两个旧 bug；R15 发现 bot 初始 spawn 失败后 channel 进入孤儿态没有重试路径；R16 第三次零 bug 通过 — 多文件多类型工件验证 + 多轮 send_to_thread correction + 视觉 UX 评分首跑，发现 2 个视觉 gap 但按 memory 规则按 soft observation 暂记不修；R17 把 R16 的 typing-indicator soft observation 升级为修复（按 memory 2+ rounds 规则）+ 修了 Share-to-channel toggle 在 channel timeline 卡片视觉无变化的 bug — 把 `ChannelView` 卡片渲染改为读 live session.visibility，`ThreadCard` 增加 shared 视觉态 indigo 渐变 + 🔗 Shared 徽章；R18 一次发现并修复 3 个 bug：spawn thread 缺 system prompt 解释 Lead-Teammate 注入规约导致 Opus 4.7 拒绝执行 send_to_thread；`change_title` MCP 没把 metadata.summary.text 同步到 sessions.thread_title 导致 UI 永远不更新；pinned chip 缺 owner 长按 unpin 入口（spec §III line 114 要求）；R19 发现 cancel_thread 的 reason 参数从未在 channel timeline 渲染 — `ThreadCard` 不读 `data.reason`，导致用户无法看到为什么 thread 被取消；修复：cancelled 卡片增加 italic slate-bordered 侧边块 `Reason: <text>` 渲染 reason；R20 第四次零 bug 通过 — 4 个 NEW 行为首跑全部端到端通过（+ New thread UI 按钮、list_channel_members MCP、get_thread MCP、channel rename mid-flight），R14-2 deletePath fix 终于在 e2e 命中验证（改名后硬删干净）；R21 首个 50-人规模轮发现 channel header 在 50 成员频道显示 `👥 1 online` — 用户根本看不出房间多大。修复：header 同时显示成员数和在线数 `👥 50 members · 1 online`，使用现有 `getChannelMembers` API + `useQuery`，零 server 改动；R22 第五次零 bug 通过 — soft-delete 路径首跑端到端通过，工作区原子重命名为 `-archived-<ts>`、threads 标 archived、bot 终止、channel 隐藏；同名再创建立即成功无碰撞；2 个新文件类型 `.tsx` + `.css` 加入累计列表，cumulative 11 个文件类型贯穿 R16-R22）

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
