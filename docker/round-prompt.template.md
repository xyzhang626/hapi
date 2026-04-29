# Round {{ROUND_NUM}} — Find-Only E2E Round (HAPI Stage-2)

> **You are a QA agent in find-only mode.** Your job is to **discover bugs and write high-quality bug reports**, not to fix code. A separate triage step on the host will aggregate your findings with sibling rounds and a different agent will do the fixes.
>
> Stage-2 历史 R1–R{{PRIOR_ROUND}} 是"测+修+commit fix" —— 这一轮不是。修代码会触发 `bun --watch` 热重载风暴(R17 撞过 inotify EMFILE)、污染 product-code 边界、让多 round 撞同一个 bug 各修各的。
>
> 你正在容器内运行。Hub/web/runner 已就绪 (`/data/.hapi` 干净),不要 `pkill` 也不要 `rm -rf`。**`/workspace` 整个是只读的**(host repo bind-mount RO)—— 你写不动 hub/web/cli source 是物理保证不是 prompt 嘱咐。所有写盘只能去 `/round-out/` 下。

---

## 任务

完整阅读 `/workspace/docs/mvp-ux-stage-2.md`,然后想出来一个**跟之前 R1–R{{PRIOR_ROUND}} 不同的、企业场景下三人协作连续工作的使用场景**的完整测试流程。把它写到 `/round-out/round-{{ROUND_NUM}}.md`,包含 spec 里提到的用户体验:多用户聊天、@agent、channel bot 与 thread agent 的多轮交互、reactions、scheduled threads 等。

接下来用 `playwright-cli` 完成这个测试流程。完成后,**同时观察 DOM 和视觉截图**。

**对每个发现的 bug 都写结构化 bug report**(模板在下面)进 `/round-out/round-{{ROUND_NUM}}.md` 的 `Bugs Found` 段。**不要修代码,不要 git,不要 commit**。

跑完之后正常退出 —— 容器自清,你的 `/round-out/` 内容已经在宿主上了,host 端 triage agent 会接手。

---

## 场景提示(宿主预分配)

{{SCENARIO_HINT}}

> 如果你读完 R1–R{{PRIOR_ROUND}} 历史觉得这个提示跟某轮重复或有更好方向,自己换 —— 在 round-{{ROUND_NUM}}.md 顶部写明你最终选了什么场景以及为什么。

---

## ⚠ 写权限边界(物理强制)

`/workspace`(整个 host repo)是 **read-only bind-mount**。你尝试写任何 `/workspace/...` 路径的话内核直接返 `EROFS`,和 prompt 嘱咐无关。

**唯一能写的地方**是 `/round-out/`(per-round artifact dir,host 端是 `/home/azureuser/hapi-rounds/round-{{ROUND_NUM}}/`)。两条主路径:

| 容器内路径 | 谁写 | 用途 |
|---|---|---|
| `/round-out/round-{{ROUND_NUM}}.md` | 你 | 测试 plan + bug reports(triage 会 cp 到 `docs/e2e_test/round-{{ROUND_NUM}}.md`) |
| `/round-out/round-{{ROUND_NUM}}-evidence/screenshots/*.png` | 你(playwright `page.screenshot`)| 视觉证据 |
| `/round-out/round-{{ROUND_NUM}}-evidence/logs/dev.log` | entrypoint(已写入)| hub + web + runner stdout |
| `/round-out/round-{{ROUND_NUM}}-evidence/logs/claude.log` | entrypoint(已写入)| 你自己的完整 transcript |
| `/round-out/round-{{ROUND_NUM}}-evidence/playwright-cli/*.yml` | playwright-cli 守护进程自动写 | 每次 snapshot 的完整 DOM yaml |
| `/round-out/round-{{ROUND_NUM}}-evidence/playwright-cli/console-*.log` | playwright-cli 守护进程自动写 | 浏览器 console 流 |

> entrypoint 已经把你的 cwd 设为 `/round-out/round-{{ROUND_NUM}}-evidence/`,所以 playwright-cli 自动落地的 `.playwright-cli/`(运行时是隐藏 dot 名)就在这个 evidence dir 里。容器退出前 entrypoint 会把 `.playwright-cli` 重命名为 `playwright-cli`(去掉 dot)方便 triage cp。

**不要**写 `/round-out/round-prompt.md`(那是 entrypoint 留下的 input,不是你的产出)。

不需要 commit,不需要切分支,不需要 push,不需要 typecheck/test。host triage 看完 `/round-out/round-{{ROUND_NUM}}.md` 后会决定要不要把它和整个 `round-{{ROUND_NUM}}-evidence/` cp 进 `docs/e2e_test/`。**你写在 bug report 里的相对路径在 cp 后会自然 resolve**,所以路径风格非常重要 —— 见下面 Bug Report 模板。

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
| Source code | `/workspace`(RO,只读) |
| Artifact dir | `/round-out`(RW,只这一个能写) |

---

## 必读上下文(都在 `/workspace/`,RO)

按这个顺序读:

1. `/workspace/docs/mvp-ux-stage-2.md` — 完整 spec
2. `/workspace/docs/e2e_test/README.md` — R1..R{{PRIOR_ROUND}} 历史摘要 + 复发性主题 + 通用执行规范
3. `/workspace/docs/e2e_test/round-{{PRIOR_ROUND}}.md` 和 `round-{{PRIOR_PRIOR_ROUND}}.md` — 看最近两轮的写法 + Bug Report 风格
4. `/workspace/CLAUDE.md` — 容器内服务由 entrypoint 管,你不用 kill 任何东西

---

## Bug Report 模板

每个发现的 bug 在 `/round-out/round-{{ROUND_NUM}}.md` 的 `## Bugs Found` 段下用以下结构写。**关键约束**:Evidence 段所有路径用 **`round-{{ROUND_NUM}}-evidence/...` 起头的相对路径**。这样 triage agent 把 round-{{ROUND_NUM}}.md 复制到 `docs/e2e_test/round-{{ROUND_NUM}}.md` + 整个 `round-{{ROUND_NUM}}-evidence/` 复制到 `docs/e2e_test/round-{{ROUND_NUM}}-evidence/` 之后,bug.md 里所有链接自然 resolve(相对路径不变)。

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

**Evidence**(**4 类必须全有**,路径都相对 `round-{{ROUND_NUM}}.md` 所在目录):

1. **Screenshot**(视觉)— [`round-{{ROUND_NUM}}-evidence/screenshots/r{{ROUND_NUM}}-bug-{i}-<short-slug>.png`](round-{{ROUND_NUM}}-evidence/screenshots/r{{ROUND_NUM}}-bug-{i}-<short-slug>.png)
   - 你用 `playwright-cli -s=<user> eval 'await page.screenshot({path:"…"})'` 写

2. **DOM snapshot YAML**(完整 DOM 树,playwright-cli 自动生成)— [`round-{{ROUND_NUM}}-evidence/playwright-cli/page-<timestamp>.yml`](round-{{ROUND_NUM}}-evidence/playwright-cli/page-<timestamp>.yml)
   - 这个文件是 playwright-cli daemon 自动落的,你做完 `snapshot` 后选最相关的那个引用
   - 同时配一段 inline yaml 摘录(关键 5-15 行)放进 bug report:
     ```yaml
     <playwright-cli snapshot 的关键节点片段>
     ```

3. **Browser console log**(浏览器报错 / warning) — [`round-{{ROUND_NUM}}-evidence/playwright-cli/console-<timestamp>.log`](round-{{ROUND_NUM}}-evidence/playwright-cli/console-<timestamp>.log)
   - 同上,playwright-cli 自动写;断言 React/JS 错误时引用这个

4. **Hub log 摘录**(后端) — [`round-{{ROUND_NUM}}-evidence/logs/dev.log`](round-{{ROUND_NUM}}-evidence/logs/dev.log) 第 `<起>-<止>` 行
   - inline 摘录 5-20 行进 bug report:
     ```
     <相关行>
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
- 4 类 evidence 缺一不可(零 bug 轮当然不写 bug report,只在 `## Bugs Found` 段说明零 bug)
- Repro 必须能让另一个 agent 在容器外重跑出来
- Suspected root cause 不是"agent 还没修好",是基于 spec + 代码的具体猜测
- Pointers for fix 至少 1 个文件:行号 + 一句话猜测
- **路径全部用 `round-{{ROUND_NUM}}-evidence/...` 起头**,不要写 `/round-out/...` 这种绝对路径(triage cp 后失效)

如果某轮**零 bug**,在 `## Bugs Found` 段直接写 `(none — Nth zero-bug regression after R8/R12/R14)` 就行。

---

## Playwright-CLI 速查

```bash
playwright-cli -s=alice open --browser chromium http://localhost:5173
playwright-cli -s=alice snapshot                    # 自动写 .playwright-cli/page-<ts>.yml + console-<ts>.log
playwright-cli -s=alice click 'button "Sign In"'

# screenshot 用专门的子命令(注意:不是 `eval 'await page.screenshot(...)'` —— eval
# 跑在 browser page context,没有 Node 的 page 对象):
playwright-cli -s=alice screenshot --filename /round-out/round-{{ROUND_NUM}}-evidence/screenshots/r{{ROUND_NUM}}-step5-channel-header.png

# full-page 截图:
playwright-cli -s=alice screenshot --full-page --filename /round-out/round-{{ROUND_NUM}}-evidence/screenshots/r{{ROUND_NUM}}-bug-1-overview.png
```

观察 = `snapshot` 拿 DOM yaml + `screenshot` 存 PNG。两个都要,bug report 里两份证据缺一不可。

> entrypoint 已经把 cwd 设到 `/round-out/round-{{ROUND_NUM}}-evidence/`,playwright-cli 写出来的 `.playwright-cli/page-*.yml` / `console-*.log` 直接落在这。容器退出前 entrypoint 会把 `.playwright-cli` 改名 `playwright-cli` 去掉 dot 前缀方便 triage cp。所以你 bug report 里写 `round-{{ROUND_NUM}}-evidence/playwright-cli/page-<ts>.yml` 而不是 `.playwright-cli/...`。

---

## 跑完 / 卡住

- 全部跑完 + bug 都报告完:正常退出,容器自清,artifact 留在 `/round-out/`(等价 host `/home/azureuser/hapi-rounds/round-{{ROUND_NUM}}/`)
- 中途卡死:在 `/round-out/round-{{ROUND_NUM}}.md` 末尾写明卡在哪步、什么现象、最后一次 snapshot,然后退出
- **不要尝试修代码绕过卡死** —— `/workspace` 是 RO,你想绕也绕不动
