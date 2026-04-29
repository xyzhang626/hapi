# HAPI E2E sandbox — Docker setup

封装 hub + web + embedded runner + Chromium + `playwright-cli` + `claude` CLI
进一个 Docker image。每个容器有自己的 `~/.hapi`、自己的 Claude session
state、自己的端口空间,互不干扰。

两种模式:

| 模式 | 启动 | 用途 |
|---|---|---|
| **Service** | `bash docker/run.sh` | 起服务 + 给你 `docker exec` 进去手动 / 半自动驱动 |
| **Round** | `bash docker/run-round.sh N "scenario hint"` | 全自动:开 worktree、起服务、容器内 claude --print 设计 + 跑 + 修 + commit 整个 R{N} |

为什么要做这个,看 `/home/azureuser/.claude/plans/soft-exploring-bonbon.md`
和 `docs/e2e_test/README.md`(R1–R13 共 13 轮 E2E 都共享同一份 `~/.hapi`,
只能串行,清进程的 `pkill` 模式还是个雷)。

## 前置说明

- 当前用户 (`azureuser`) 不在 `docker` 组,所有 docker 命令需要 `sudo`,
  本目录脚本已经显式带上 `sudo`。
- `~/.claude/settings.json` 指向自建 endpoint `http://10.0.0.12:8536`,
  容器要能从 LAN 路由过去。bridge 通常可以,通不了就 `--network host`
  (single-container 才行,并发时端口会冲突)。
- 容器内以 **`pwuser`** (uid 1000) 跑,跟宿主 `azureuser` (uid 1000) 一致,
  所以 bind-mount 的文件 / commit / SMOKE.md 等都直接是 azureuser-owned,
  不需要 `sudo chown` 善后。**唯一例外**:`/workspace/node_modules` 是
  容器私有命名卷,清理时若有残留 `sudo rm -rf` 一下即可。
- `claude --dangerously-skip-permissions` 拒绝 root,所以我们必须以非 root
  跑 —— 这就是用 `pwuser` 的原因。

## 一次性 build

```bash
sudo docker build -t hapi-e2e:latest -f docker/Dockerfile docker/
```

build context 只有 `docker/` 这几个文件(`.dockerignore` 把别的全过滤掉),
~1 分钟,镜像 ~2.5 GB(playwright base + chromium + bun + claude)。

---

## 模式 1:Service mode — `run.sh`

```bash
bash docker/run.sh                # 默认名 hapi-e2e
bash docker/run.sh hapi-e2e-r13   # 自定义名
bash docker/run.sh hapi-e2e host  # bridge 通不了 LAN 时的兜底
```

`run.sh` 干的事:

1. 镜像不存在就 build
2. 用容器名做前缀,创建三个**命名卷**:
   - `<name>-node-modules` → `/workspace/node_modules`
   - `<name>-hapi-home` → `/data` (`HAPI_HOME=/data/.hapi`)
   - `<name>-claude-home` → `/home/pwuser/.claude` (Claude session 写入)
3. Bind-mount 宿主仓库到 `/workspace`(改一行代码不用重 build)
4. Bind-mount 宿主 `~/.claude/settings.json` (RO) 到 `/home/pwuser/.claude/settings.json`
5. `-p 3006:3006 -p 5173:5173`(并发要去掉这两个 -p)
6. 后台跑,`--rm`,容器 PID 1 = `bun run dev`(hub + web + embedded runner)

### 看日志 / 进容器 / 用 web

```bash
sudo docker logs -f hapi-e2e
sudo docker exec -it hapi-e2e bash
# 浏览器
open http://localhost:5173
```

进容器后 `playwright-cli` 命令跟现有 `docs/e2e_test/round-N.md` 一字不差:

```bash
playwright-cli -s=alice open --browser chromium http://localhost:5173
playwright-cli -s=alice snapshot
playwright-cli -s=alice fill 'access token' '<TOKEN>:alice:Alice'
```

### 重置状态(等价于以前的 `rm -rf ~/.hapi`)

```bash
sudo docker stop hapi-e2e
sudo docker volume rm hapi-e2e-hapi-home hapi-e2e-claude-home
bash docker/run.sh hapi-e2e
```

`node_modules` 卷保留,避免每轮重新 `bun install`。

---

## 模式 2:Round mode — `run-round.sh`

完全自动跑一整轮 E2E。**默认是 find-only 模式**(agent 只测 + 写 bug report,不改代码),老的 fix-mode 仍然可用作向后兼容。

```bash
bash docker/run-round.sh 14 "你想要 agent 跑的场景提示"               # 默认 find mode
bash docker/run-round.sh 14 "..." --mode find                       # 显式 find
bash docker/run-round.sh 14 "..." --mode fix                        # legacy:agent 也修代码
bash docker/run-round.sh 14 "..." --base main                       # 默认就是 main
bash docker/run-round.sh 14 "..." --network host                    # LAN endpoint 兜底
bash docker/run-round.sh 14 "..." --dry-run                         # 只 worktree+渲染 prompt,不 docker run
bash docker/run-round.sh 14 "..." --prompt-file my.md               # 用自定义 prompt 替代 template
```

### Find mode vs Fix mode

| | Find (默认) | Fix (legacy) |
|---|---|---|
| 模板 | `docker/round-prompt.template.md` | `docker/round-prompt-fix.template.md` |
| Agent 写权限 | 仅 `docs/e2e_test/round-N.md` + 截图目录 | 整个仓库 |
| Bug 怎么记 | 结构化 bug report(repro / 截图 / DOM / 初步根因 / 文件指针) | Markdown 表 + 直接 commit fix |
| Bug 怎么修 | 容器外 host triage agent 串行修(`triage-rounds.sh` 汇总) | 容器内 agent 当场修 + 当场 commit |
| 触发 `bun --watch` 风暴 | ❌ agent 不动 hub source,所以不触发 | ✅(R17 因此撞了 EMFILE) |
| 一轮耗时 | ~15-30 min | ~30-90 min |
| 适合场景 | 4-way 并行 + 集中诊断 + 高 round 通量 | 单 round 串行 + 想要"测试通过 = 修复也通过"的强保证 |

`run-round.sh` 干的事:

1. **创建 worktree**:`git worktree add /home/azureuser/hapi-worktrees-round-14 -b e2e/round-14 main`
2. **渲染 prompt**:把 `docker/round-prompt.template.md` 里的 `{{ROUND_NUM}}` /
   `{{SCENARIO_HINT}}` / `{{BRANCH}}` 等替换掉,写到 `<worktree>/.round-prompt.md`
3. **起容器** (`hapi-e2e-round-14`,`--rm`,**没有 `-p`** —— 没冲突),mount 4 个东西:
   - 宿主 worktree → `/workspace`
   - `/home/azureuser/hapi/.git` → 同一绝对路径(让容器内 git 能 resolve worktree pointer)
   - 三个命名卷(node_modules / data / claude home)
   - 宿主 settings.json (RO)
4. **容器 entrypoint 检测 `HAPI_ROUND_PROMPT_FILE`** → 进 round 模式:
   - `bun install` (首次)
   - `bun run dev` 后台 + 重定向到 `/workspace/.round-logs/dev.log`
   - 等 dev.log 出现 "HAPI Hub is ready" + "EmbeddedRunner ... started" 信号 (max 120s)
   - `claude --print --dangerously-skip-permissions < /workspace/.round-prompt.md > /workspace/.round-logs/claude.log`
5. claude 自主跑完整 90m 流程:读 spec、设计 round、写 `docs/e2e_test/round-14.md`、
   驱动 playwright-cli、修 bug、`bun typecheck`/`test`、按 concern commit 到 `e2e/round-14`
6. claude 退出 → entrypoint cleanup(SIGTERM bun)→ 容器 `--rm` 自清

### 看进度

```bash
sudo docker logs -f hapi-e2e-round-14                         # 容器 stdout (entrypoint + git status)
tail -f /home/azureuser/hapi-worktrees-round-14/.round-logs/dev.log     # hub/web 日志
tail -f /home/azureuser/hapi-worktrees-round-14/.round-logs/claude.log  # 完整 claude transcript
git -C /home/azureuser/hapi-worktrees-round-14 log --oneline           # 已 commit 哪些
```

### 跑完了,把 bug 报告汇总到一处(find mode)

```bash
bash docker/triage-rounds.sh                     # 自动发现所有 round-* worktree
bash docker/triage-rounds.sh 14 15 16 17         # 显式列出
bash docker/triage-rounds.sh -o /tmp/r1422.md 14 15 16 17 22  # 自定义输出
```

`triage-rounds.sh` 把每个 worktree 的 `docs/e2e_test/round-N.md` 里 `## Bugs Found` 段抽出来,加上每个 round 的 worktree 路径 + branch 名 + 截图目录指针,拼成一份 `/tmp/BUGS-AGGREGATE.md`(默认路径,可 `-o` 覆盖)。然后 host triage agent / 你 review 这份汇总:跨 round 去重相同根因 → 决定修哪些 → 在一个独立 fix 分支上写代码 → 跑 round-N.md 的 Repro steps 重验。

### 跑完了,把成果合回 main(fix mode)

```bash
git -C /home/azureuser/hapi-worktrees-docker fetch .
git -C /home/azureuser/hapi-worktrees-docker checkout main
git -C /home/azureuser/hapi-worktrees-docker merge --no-ff e2e/round-14
# 或者 cherry-pick 部分:
git -C /home/azureuser/hapi-worktrees-docker cherry-pick <commit-hash>
```

### 失败 / 想抛弃这一轮

```bash
sudo docker rm -f hapi-e2e-round-14 2>/dev/null
sudo docker volume rm hapi-e2e-round-14-{node-modules,hapi-home,claude-home}
sudo rm -rf /home/azureuser/hapi-worktrees-round-14
git -C /home/azureuser/hapi-worktrees-docker worktree prune
git -C /home/azureuser/hapi-worktrees-docker branch -D e2e/round-14
```

---

## 并发跑多个 round

`run-round.sh` 默认就支持并发(没有 `-p`,容器名带 round 号区分,worktree 各自一个,
volume 各自一组)。串行写法:

```bash
bash docker/run-round.sh 14 "scenario A" &
bash docker/run-round.sh 15 "scenario B" &
bash docker/run-round.sh 16 "scenario C" &
wait
```

但要注意:

- **凭证 rate limit**:所有容器共享 `~/.claude/settings.json`,即同一个
  Anthropic 账号 / endpoint。4-way 并发跑 90m 容易撞 rate limit。
- **disk + CPU**:每个容器 ~600 MB node_modules + chromium + bun watch +
  vite watch。4 个并发 = ~6 GB RAM,且容器内会跑 chrome-for-testing。
- **Round 号去重**:你要保证传给 N 个并发的 round-num 不重(脚本会
  refuse 已存在的 worktree / branch / 容器名)。

---

## 已知坑

- **Bind-mount 与原生模块**:`/workspace/node_modules` 用命名卷覆盖宿主,
  容器自己 `bun install`,不会受宿主 native binding 不兼容的影响。第一次
  启动 ~5–10 秒装 3000 包。
- **`hub GET /` 返回 503**:hub 没注册根路由,所以容器健康检查不能用 curl `/`。
  我们改成 grep dev.log 里的 "HAPI Hub is ready" + "EmbeddedRunner ... started"
  双信号(120s timeout)。
- **`/root` 700**:Claude Code 必须能读 `~/.claude/settings.json`,所以容器
  HOME 不能是 `/root`(那里 700)。改用 `/home/pwuser`。
- **`claude --dangerously-skip-permissions` 拒绝 root**:必须 `USER pwuser`,
  否则 claude --print 模式根本起不来。
- **Worktree `.git` 是个 file**:`gitdir: /home/azureuser/hapi/.git/worktrees/<name>` —
  容器要能 resolve 这个绝对路径才能 git commit。`run-round.sh` 用
  `git rev-parse --git-common-dir` 找到真正的 shared `.git`,然后以同
  绝对路径 bind-mount 进容器。多个并发 round 写同一 `.git/objects/` 是
  git-safe(content-addressable + atomic ref writes)。
- **`pkill -f bun` 警告**:`/CLAUDE.md` 那段在容器内不再是高优先级 ——
  容器内除了 hub/web 没别的 bun 进程。但养成精确 PID 习惯不亏。
