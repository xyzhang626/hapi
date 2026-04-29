# Round {{ROUND_NUM}} — Find-Only E2E Round (HAPI Stage-2)

> **You are a QA agent in find-only mode.** Your job is to **discover bugs and write high-quality bug reports**, not to fix code. A separate triage step on the host will aggregate your findings with sibling rounds and a different agent will do the fixes.
>
> 跟前 N-1 轮(R1–R{{PRIOR_ROUND}})不同的是:之前的 round 是"测+修+commit fix",这一轮是"**只测 + 只报告**"。修代码会触发 `bun --watch` 热重载风暴(R17 已经撞过 inotify EMFILE)、会污染 product code 边界、会让多 round 撞同一个 bug 各修各的 → 现在拆开。
>
> 你正在容器内运行。Hub/web/runner 已就绪 (`/data/.hapi` 干净),不要 `pkill` 也不要 `rm -rf`。本 worktree 是 `/workspace`,branch 是 `{{BRANCH}}`,你的 commit 直接落在这个分支。

---

## 任务

完整阅读 `docs/mvp-ux-stage-2.md`,然后想出来一个**跟之前 R1–R{{PRIOR_ROUND}} 不同的、企业场景下三人协作连续工作的使用场景**的完整测试流程。把它写到 `docs/e2e_test/round-{{ROUND_NUM}}.md`,包含 spec 里提到的用户体验:多用户聊天、@agent、channel bot 与 thread agent 的多轮交互、reactions、scheduled threads 等。

接下来用 `playwright-cli` 完成这个测试流程。完成测试流程后,**同时观察 DOM 和视觉截图**。

**对每个发现的 bug 都写结构化 bug report**(模板在下面)进 `round-{{ROUND_NUM}}.md` 的 `Bugs Found` 段。**不要修代码**。

最后:
- 在 `docs/e2e_test/README.md` 的"Round summary"表格里加一行 R{{ROUND_NUM}}(只标 bug 数量,不标"all fixed")
- 按 concern 分组 commit `docs/e2e_test/round-{{ROUND_NUM}}.md` + `docs/e2e_test/round-{{ROUND_NUM}}-screenshots/`,留在分支 `{{BRANCH}}` 上
- **不**要 push,**不**要切分支,**不**要 merge,**不**要 typecheck / test

---

## 场景提示(宿主预分配)

{{SCENARIO_HINT}}

> 如果你读完 R1–R{{PRIOR_ROUND}} 之后觉得这个提示跟某轮重复或者有更好的方向,你可以自己换 —— 在 round-{{ROUND_NUM}}.md 顶部写明你最终选了什么场景以及为什么。

---

## ⚠ 写权限边界(严格)

**只允许**写下面这些路径:

| 允许写 | 用途 |
|---|---|
| `docs/e2e_test/round-{{ROUND_NUM}}.md` | 测试 plan + bug reports |
| `docs/e2e_test/round-{{ROUND_NUM}}-screenshots/*.png` | 视觉证据 |
| `docs/e2e_test/README.md` | 末尾加一行历史表 |

**禁止**写以下任何路径(就算发现的 bug 修起来一行也不许):

- `hub/`、`web/`、`cli/`、`shared/`、`website/` 下任何文件 —— product code,以后由 host triage agent 处理
- `docker/` 下任何文件 —— 那是 orchestrator,不是测试目标
- 仓库根的 `package.json` / `bun.lock` / `tsconfig*.json` / `*.md`(除 `docs/e2e_test/`)
- 任何 `.github/`, `.vscode/` 等隐藏配置

如果你找到一个"修起来一行就好"的 bug,**写在 bug report 的 `Pointers for fix` 段就行,不要真去改**。让 host triage 决定怎么修。

**为什么这个边界**:之前 R17 的 agent 顺手改了 hub source 触发 `bun --watch` 在容器内反复 SIGTERM/重启 hub child,4 路并行下把宿主的 `fs.inotify.max_user_instances=128` 撑爆,EMFILE。把 product-code 写权限砍掉,这条路径就消失了。

---

## 容器环境(已就绪,不要改动)

| | |
|---|---|
| Hub | `http://localhost:3006` (已在跑) |
| Web | `http://localhost:5173` (已在跑) |
| Embedded runner | 已 fork,已 register |
| HAPI_HOME | `/data/.hapi` (容器私有,空白) |
| Anthropic | `~/.claude/settings.json` 是宿主 RO bind |
| Playwright | `playwright-cli` 全局可用,Chromium 147 已装 |
| 工作目录 | `/workspace` (本 worktree) |
| Git branch | `{{BRANCH}}` |

**禁止**:`rm -rf /data` / `pkill -f bun` / 切分支 / push / 改远端。

---

## 必读上下文

按这个顺序读:

1. `docs/mvp-ux-stage-2.md` — 完整 spec
2. `docs/e2e_test/README.md` — R1..R{{PRIOR_ROUND}} 历史摘要 + 复发性主题 + 通用执行规范
3. `docs/e2e_test/round-{{PRIOR_ROUND}}.md` 和 `round-{{PRIOR_PRIOR_ROUND}}.md` — 看最近两轮的写法
4. `CLAUDE.md` — 容器内服务由 entrypoint 管,你不用 kill 任何东西

---

## Bug Report 模板

每个发现的 bug 在 `round-{{ROUND_NUM}}.md` 的 `## Bugs Found` 段下用以下结构写:

```markdown
### Bug R{{ROUND_NUM}}-{i}: <一句话标题>

| 字段 | 值 |
|---|---|
| Severity | blocker / serious / annoyance / cosmetic / spec-gap |
| Phase | <round-{{ROUND_NUM}}.md 里第几步触发> |
| First observed | <容器内 wall time, e.g. 17:14> |
| Reproducible | always / flaky / one-shot |

**Symptom**(用户视角看到什么,≤ 3 句):
...

**Repro steps**(逐字 copy-paste 可执行):
1. ...
2. ...
3. ...

**Expected vs Actual**:
- Expected: ...
- Actual: ...

**Evidence**:
- DOM snapshot 关键摘录:
  ```
  <playwright-cli snapshot 的相关片段>
  ```
- Screenshot: `docs/e2e_test/round-{{ROUND_NUM}}-screenshots/r{{ROUND_NUM}}-bug-{i}-<short-slug>.png`
- Hub log 摘录(如果相关):从 `/workspace/.round-logs/dev.log`
  ```
  <相关 N 行>
  ```

**Suspected root cause**(你的初步诊断,≤ 5 句):
...

**Pointers for fix**(可疑文件 + 行,**不写实际 patch**):
- `hub/src/foo.ts:42` — 可能因为 ...
- `web/src/Bar.tsx:88` — 可能因为 ...

**Spec reference**(如适用):
> docs/mvp-ux-stage-2.md §<section>: "<原文摘录>"
```

**质量底线**:
- 每个 bug 都必须有 screenshot 落在 `docs/e2e_test/round-{{ROUND_NUM}}-screenshots/` 里(就算只是错误状态截图也比没有强)
- Repro 步骤必须能让另一个 agent / 人在容器外重跑出来,不能是"我看到了"这种
- Suspected root cause 不是"agent 还没修好",而是基于 spec + 代码的具体猜测
- Pointers for fix 至少 1 个文件:行号 + 一句话猜测

如果某轮**零 bug**,在 `## Bugs Found` 段直接写 `(none — Nth zero-bug regression after R8/R12)` 就行,跟 R8/R12/R14 风格一致。

---

## Playwright-CLI 速查

```bash
playwright-cli -s=alice open --browser chromium http://localhost:5173
playwright-cli -s=alice snapshot
playwright-cli -s=alice click 'button "Sign In"'
# screenshot 落到 round 自己的目录,bug report 引用的就是这个路径:
mkdir -p /workspace/docs/e2e_test/round-{{ROUND_NUM}}-screenshots
playwright-cli -s=alice eval 'await page.screenshot({ path: "/workspace/docs/e2e_test/round-{{ROUND_NUM}}-screenshots/r{{ROUND_NUM}}-step5-channel-header.png" })'
```

观察 = `snapshot` 拿 DOM yaml + `screenshot` 存 PNG。两个都要,bug report 里两份证据缺一不可。

---

## Commit 规范

- 测试 plan + bug reports 一个 commit:`test(round-{{ROUND_NUM}}): ...`
- 历史表 README 一个 commit:`docs(e2e): index R{{ROUND_NUM}} in history table`
- 如果有 ≥ 2 个独立 bug,可以每个 bug 一个 sub-commit(可选,只是为了 triage 时好 cherry-pick),或者全部塞一个 commit
- 不 push,不 amend,不 merge

---

## 跑完 / 卡住

- 全部跑完 + bug 都报告完 + commit:正常退出,容器自清
- 中途卡死(playwright 挂、channel 数据怪、claude 自己卡):先 commit 已有的 round-{{ROUND_NUM}}.md,在末尾写明卡在哪步、什么现象、你的最后一次 snapshot,然后退出
- 不要尝试修代码绕过卡死。host 看到日志会处理
