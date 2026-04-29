# Round {{ROUND_NUM}} — Autonomous E2E Round (HAPI Stage-2)

> 你正在一个 Docker 容器内运行,这是 HAPI Stage-2 E2E 测试的第 {{ROUND_NUM}} 轮。
> 跟前 13 轮(R1–R13)一样的工作,只是环境是隔离的:hub/web/runner 已经在
> 容器内启动 (`/data/.hapi` 是干净的),不需要 `rm -rf` 也不需要 `pkill`。
> 本 worktree 是 `/workspace`,branch 是 `{{BRANCH}}`,你的 commit 直接落在
> 这个分支上,不会干扰主仓库或其他并行 round。

---

## 任务

完整阅读 `docs/mvp-ux-stage-2.md`,然后想出来一个**跟之前 R1–R{{PRIOR_ROUND}} 不同的、企业场景下三人协作连续工作的使用场景**的完整测试流程(每个用户的发消息和操作 Web UI 的顺序和类型,写到一个额外的 markdown 文件 `docs/e2e_test/round-{{ROUND_NUM}}.md`),包含这个 markdown 里面所有提到的用户体验,包括模拟多用户聊天、@agent 的测试、和 channel bot 与 thread agent 的多轮交互等等。

接下来用 `playwright-cli` 完成这个 `docs/e2e_test/round-{{ROUND_NUM}}.md` 里面的完整交互流程。完成设计的交互测试流程后,**请同时观察 DOM 和视觉截图是否符合预期**。然后**修复过程中发现的所有 bug 然后 commit**。

最后:
- 在 `docs/e2e_test/README.md` 的"Round summary"表格里加一行 R{{ROUND_NUM}}
- 跑 `bun run typecheck` 和相关 `bun run test`,确认绿
- 按 concern 分组 commit,留在当前分支 `{{BRANCH}}` 上;**不要 push,不要切分支,不要 merge**

---

## 场景提示(宿主预分配)

{{SCENARIO_HINT}}

> 这只是提示,不是死命令。如果你读完 R1–R{{PRIOR_ROUND}} 之后觉得这个提示
> 跟某轮重复或者有更好的方向,你可以自己换 —— 在 round-{{ROUND_NUM}}.md 顶部
> 写明你最终选了什么场景以及为什么。

---

## 容器环境(已就绪,**不要改动**)

| | |
|---|---|
| Hub | `http://localhost:3006` (已在跑) |
| Web | `http://localhost:5173` (已在跑) |
| Embedded runner | 已 fork,已 register |
| HAPI_HOME | `/data/.hapi` (容器私有,空白) |
| Anthropic | `~/.claude/settings.json` 是宿主 RO bind |
| Playwright | `playwright-cli` 全局可用,Chromium 147 已装 |
| 工作目录 | `/workspace` (本 worktree) |
| Git branch | `{{BRANCH}}` (worktree 已 checkout 好,直接 commit) |

**禁止**:
- `rm -rf /data` 或任何 `rm -rf ~/.hapi` —— 会清掉本轮的 hub 状态
- `pkill -f bun` / `pkill -f node` —— 会杀掉 hub/web 自己
- 切分支 / push / 改远端
- 改 `/workspace/docker/` 下的文件(那是宿主的 orchestrator,不是测试目标)

---

## 必读上下文

按这个顺序读:

1. `docs/mvp-ux-stage-2.md` — 完整 spec
2. `docs/e2e_test/README.md` — R1..R{{PRIOR_ROUND}} 的历史摘要 + 复发性主题 + 通用执行规范(尤其末尾的"常驻原则")
3. `docs/e2e_test/round-{{PRIOR_ROUND}}.md` 和 `round-{{PRIOR_PRIOR_ROUND}}.md` — 看最近两轮的写法,你的 round-{{ROUND_NUM}}.md 应该结构对齐
4. `CLAUDE.md` — 注意 pkill 那段在容器外是高优先级警告,容器内服务都由 entrypoint 管,你不用 kill 任何东西

---

## Playwright-CLI 使用速查

跟历史 round 完全一样,3 个命名 session 各一个用户:

```bash
playwright-cli -s=alice open --browser chromium http://localhost:5173
playwright-cli -s=alice snapshot
playwright-cli -s=alice click 'button "Sign In"'
# screenshot:
playwright-cli -s=alice eval 'await page.screenshot({ path: "/workspace/.round-screenshots/alice-step-1.png" })'
```

观察 = `snapshot` 拿 DOM yaml + `screenshot` 存 PNG,两个都看,行为符合 spec 才算通过。

---

## Commit 规范

- 按 concern 分组(test 一个 commit、bug fix 各一个 commit)
- commit message 跟现有风格对齐,看 `git log --oneline | head -10`
- 不要 push,不要 amend 已有 commit
- 容器退出后,宿主可以 `git -C <worktree> log --oneline` 查看你的工作

---

## 跑完了 / 卡住了

- 全部跑完 + 全 commit:正常退出即可,容器会自动停
- 中途卡住或者 bug 修不了:先把已经做的 commit,在 round-{{ROUND_NUM}}.md 末尾写明卡在哪、为什么,然后退出
- 任何时候用户可能 `docker exec` 进来看你,所以 `Bash` 命令的 stdout/stderr 都会留底
