# HAPI E2E sandbox — Docker setup

封装 hub + web + embedded runner + Chromium + `playwright-cli` + `claude` CLI
进一个 Docker image。每个容器有自己的 `~/.hapi`、自己的 Claude session
state、自己的端口空间,互不干扰。

两种模式:

| 模式 | 启动 | 用途 |
|---|---|---|
| **Service** | `bash docker/run.sh` | 起服务 + 给你 `docker exec` 进去手动 / 半自动驱动 |
| **Round (find,默认)** | `bash docker/run-round.sh N "scenario hint"` | 全自动:容器 RO 看 source、agent 只测 + 写 bug report 到 `/round-out/`(host `/home/azureuser/hapi-rounds/round-N/`)。无 git worktree,无 branch |
| **Round (fix,legacy)** | `bash docker/run-round.sh N "..." --mode fix` | 老的 worktree+branch 路径:agent 也修代码 + commit。R14-R17 用过这个 |

为什么要做这个,看 `docs/e2e_test/README.md`(R1–R17 演化:R1-R13 共享 `~/.hapi`,只能串行;R14-R17 docker 化但 4 个 worktree 各自占 ~600 MB + branch 管理负担;R18+ 走"共享 RO source + per-round artifact dir",找 bug 跟修 bug 拆开)。

## 前置说明

- 当前用户 (`azureuser`) 不在 `docker` 组,所有 docker 命令需要 `sudo`,本目录脚本已经显式带上 `sudo`。
- `~/.claude/settings.json` 指向自建 endpoint `http://10.0.0.12:8536`,容器要能从 LAN 路由过去。bridge 通常可以,通不了就 `--network host`(single-container 才行,并发时端口会冲突)。
- 容器内以 **`pwuser`** (uid 1000) 跑,跟宿主 `azureuser` (uid 1000) 一致,bind-mount 的文件 / artifact / screenshots 直接是 azureuser-owned。
- `claude --dangerously-skip-permissions` 拒绝 root,所以必须以非 root 跑。

## 一次性 build

```bash
sudo docker build -t hapi-e2e:latest -f docker/Dockerfile docker/
```

build context 只有 `docker/` 这几个文件(`.dockerignore` 把别的全过滤掉),~1 分钟,镜像 ~2.5 GB。

---

## 模式 1:Service mode — `run.sh`

```bash
bash docker/run.sh                # 默认名 hapi-e2e
bash docker/run.sh hapi-e2e-r13   # 自定义名
bash docker/run.sh hapi-e2e host  # bridge 通不了 LAN 时的兜底
```

把宿主仓库 RW bind-mount 进 `/workspace`,起 hub+web+embedded runner,后台跑。`docker exec -it` 进去手动驱动 playwright-cli。

```bash
sudo docker logs -f hapi-e2e
sudo docker exec -it hapi-e2e bash
playwright-cli -s=alice open --browser chromium http://localhost:5173
```

重置 `~/.hapi`:

```bash
sudo docker stop hapi-e2e
sudo docker volume rm hapi-e2e-hapi-home hapi-e2e-claude-home
bash docker/run.sh hapi-e2e
```

---

## 模式 2:Round mode — `run-round.sh`

完全自动跑一整轮 E2E。**默认是 find-mode**(只找 bug,不修代码,artifact 落到独立目录)。

```bash
bash docker/run-round.sh 18 "scenario hint"                 # find mode (默认)
bash docker/run-round.sh 18 "..." --mode fix                # legacy fix mode
bash docker/run-round.sh 18 "..." --network host            # LAN endpoint 兜底
bash docker/run-round.sh 18 "..." --dry-run                 # 只渲染 prompt,不 docker run
bash docker/run-round.sh 18 "..." --prompt-file my.md       # 自定义 prompt 替代 template
bash docker/run-round.sh 18 "..." --mode fix --base main    # fix mode 指定 base 分支
```

### Find mode vs Fix mode

| | **Find (默认,推荐)** | Fix (legacy) |
|---|---|---|
| `/workspace` 里的 source | RO bind-mount 当前 docker worktree | RW per-round git worktree |
| Agent 写权限 | **物理上**只能写 `/round-out/`(`/workspace` 任何写都返 EROFS) | 整个 worktree 都写得动 |
| Bug 怎么记 | 结构化 bug report(repro / 截图 / DOM / 初步根因 / 文件指针) | Markdown 表 + 直接 commit fix |
| Bug 谁修 | **host triage agent** 看 `triage-rounds.sh` 汇总后串行修 | 容器内 agent 当场修 + 当场 commit |
| Artifact 落点 | `/home/azureuser/hapi-rounds/round-N/` | `/home/azureuser/hapi-worktrees-round-N/` |
| Per-round git branch | ❌ 无 | ✅ `e2e/round-N` |
| 触发 `bun --watch` 风暴 | ❌ agent 不写 source,所以不触发(R17 撞过 EMFILE 不会再现)| ✅ |
| 一轮耗时 | ~15-30 min | ~30-90 min |
| 适合 | 4-way 并行 + 集中诊断 | 单 round 串行 + 想要"测试通过 = 修复也通过" |

### Find mode — 干的事

1. **创建 artifact dir** `/home/azureuser/hapi-rounds/round-N/round-N-evidence/{screenshots/,logs/}`
2. **渲染 prompt** 到 `/home/azureuser/hapi-rounds/round-N/round-prompt.md`
3. **起容器** mount 关系:
   - 宿主 `hapi-worktrees-docker/` → `/workspace` **RO**(整个 source tree,agent 看得到 spec / R1-R17 历史 / 代码 但写不动)
   - 宿主 `hapi-rounds/round-N/` → `/round-out` RW
   - 命名卷 `<container>-node-modules` → `/workspace/node_modules`(在 RO 父 mount 上叠 RW 子 mount)
   - 6 个命名卷 `<container>-{cli,hub,web,shared,website,docs}-nm` → `/workspace/<ws>/node_modules`(bun workspace install 必需)
   - 命名卷 `<container>-hapi-home` → `/data`(`HAPI_HOME=/data/.hapi`)
   - 命名卷 `<container>-claude-home` → `/home/pwuser/.claude`
   - 宿主 `~/.claude/settings.json` (RO) → `/home/pwuser/.claude/settings.json`
4. **Entrypoint** 检测 `HAPI_ROUND_EVIDENCE_DIR=/round-out/round-N-evidence`(round-mode 信号):
   - `bun install --frozen-lockfile`(首次)
   - `bun run dev` 后台,日志重定向到 `/round-out/round-N-evidence/logs/dev.log`
   - 等 dev.log 出现"HAPI Hub is ready" + "EmbeddedRunner ... started"双信号(max 120s)
   - `cd /round-out/round-N-evidence`(playwright-cli 的 `.playwright-cli/` 自动落到这,跟 logs/screenshots 同目录)
   - `claude --print --dangerously-skip-permissions < /round-out/round-prompt.md > /round-out/round-N-evidence/logs/claude.log`
5. claude 自主跑流程:读 spec、设计 round、写 `/round-out/round-N.md`、playwright 三个 named session 操作 → 发现 bug 写**结构化 bug report**(每个 bug 4 类 evidence:screenshot / DOM yaml / console log / hub log,路径全用 `round-N-evidence/...` 相对路径)
6. claude 退出 → entrypoint 把 `.playwright-cli` 改名 `playwright-cli`(去掉 dot 让 triage `cp -r` 不漏)→ cleanup → `--rm` 自清

### Find mode — `/round-out` 实际产出

```
/home/azureuser/hapi-rounds/round-N/
├── round-prompt.md              ← run-round.sh 渲染(input)
├── round-N.md                   ← agent 写,bug report 总入口,引用所有 evidence 用相对路径
└── round-N-evidence/            ← 整个 cp 进 docs/e2e_test/round-N-evidence/ 即可
    ├── screenshots/
    │   ├── r{N}-step5-channel-header.png
    │   └── r{N}-bug-1-injected-bubble.png
    ├── playwright-cli/          ← 原本叫 .playwright-cli,entrypoint 改名
    │   ├── page-2026-04-29T...yml         (完整 DOM yaml,每次 snapshot 一份)
    │   └── console-2026-04-29T...log      (浏览器 console 流)
    └── logs/
        ├── dev.log               (hub + vite + embedded runner stdout)
        └── claude.log            (claude --print 全 transcript)
```

### Fix mode — 干的事(legacy)

跟之前一样:`git worktree add` + `e2e/round-N` branch + `.git` 共享 mount + 容器内 agent commit。详细看历史 R14-R17 的 commit。

### 看进度(find mode)

```bash
sudo docker logs -f hapi-e2e-round-18                                              # entrypoint stdout
tail -f /home/azureuser/hapi-rounds/round-18/round-18-evidence/logs/dev.log        # hub/web 日志
tail -f /home/azureuser/hapi-rounds/round-18/round-18-evidence/logs/claude.log     # 完整 claude transcript
ls -la /home/azureuser/hapi-rounds/round-18/round-18-evidence/                     # 看 evidence subtree 长成什么
cat   /home/azureuser/hapi-rounds/round-18/round-18.md                              # bug report 入口
```

### 跑完了,把 bug 报告汇总到一处

```bash
bash docker/triage-rounds.sh                # 自动发现所有 find/fix round
bash docker/triage-rounds.sh 18 19 20 21    # 显式列出
bash docker/triage-rounds.sh -o /tmp/r18-21.md 18 19 20 21  # 自定义输出
```

`triage-rounds.sh` 自动识别 find-mode (`/home/azureuser/hapi-rounds/round-N/`) 和 fix-mode (`/home/azureuser/hapi-worktrees-round-N/`),把每轮的 `## Bugs Found` 段抽出来 + 标注 source path + 截图目录,拼成 `/tmp/BUGS-AGGREGATE.md`。

### Triage → 修 → commit(host 端,find mode 必须)

```bash
# 1. 看汇总,跨 round 去重根因
less /tmp/BUGS-AGGREGATE.md

# 2. 把决定要修的 round 的 artifacts 全套 cp 进 repo:
cp /home/azureuser/hapi-rounds/round-18/round-18.md docs/e2e_test/
cp -r /home/azureuser/hapi-rounds/round-18/round-18-evidence docs/e2e_test/
# bug.md 里写的相对路径 round-18-evidence/screenshots/... / logs/... / playwright-cli/...
# cp 后自动 resolve(因为相对路径不变,只是把整个 evidence subtree 整体迁过去)
# 也手动改一下 docs/e2e_test/README.md 的历史表加 R18 行

# 3. 根据 round-18.md 的 Pointers for fix 写代码
$EDITOR hub/src/...

# 4. 跑该 round 的 Repro steps 重验(可以再起一个 docker/run.sh service 容器)

# 5. 按现有 repo 风格 commit:fixes-then-test
git add hub/src/foo.ts && git commit -m "fix(stage-2): ..."
git add docs/e2e_test/round-18.md docs/e2e_test/round-18-evidence docs/e2e_test/README.md
git commit -m "test(round-18): ..."
```

### 失败 / 想抛弃这一轮(find mode)

```bash
sudo docker rm -f hapi-e2e-round-18 2>/dev/null
sudo docker volume rm hapi-e2e-round-18-{node-modules,hapi-home,claude-home}
sudo rm -rf /home/azureuser/hapi-rounds/round-18
```

### 失败 / 想抛弃这一轮(fix mode)

```bash
sudo docker rm -f hapi-e2e-round-18 2>/dev/null
sudo docker volume rm hapi-e2e-round-18-{node-modules,hapi-home,claude-home}
sudo rm -rf /home/azureuser/hapi-worktrees-round-18
git -C /home/azureuser/hapi-worktrees-docker worktree prune
git -C /home/azureuser/hapi-worktrees-docker branch -D e2e/round-18
```

---

## 并发跑多个 round

`run-round.sh` 默认就支持并发(没有 `-p`,容器名 / artifact dir / volume 都按 round 号区分)。

```bash
bash docker/run-round.sh 18 "scenario A" &
bash docker/run-round.sh 19 "scenario B" &
bash docker/run-round.sh 20 "scenario C" &
bash docker/run-round.sh 21 "scenario D" &
wait
bash docker/triage-rounds.sh
```

要注意:

- **凭证 rate limit**:所有容器共享 `~/.claude/settings.json`,即同一个 Anthropic 账号 / endpoint。4-way 跑长 round 容易撞 rate limit。
- **磁盘**:find-mode 每个 round artifact ~ 几 MB(纯文本 + PNG),find 比 fix 省 ~600 MB / round(没有 worktree 副本)。
- **Round 号去重**:脚本会 refuse 已存在的 artifact dir / worktree / branch / 容器名。
- **不要在 round 跑期间编辑 docker worktree source**:find-mode `/workspace` 是 RO bind-mount 同一份文件,你 host 端改一行 `hub/src/...` 就触发**每个**正在跑的容器内 `bun --watch` 重启。多 round 并行时这是 inotify 配额杀手。

---

## 已知坑

- **Bind-mount 与原生模块**:`/workspace/node_modules` 用命名卷覆盖,容器自己 `bun install`。RO 父 mount 上叠 RW 子 mount 是 Docker 标准能力。第一次启动 ~5-10 秒装 3000 包。
- **`hub GET /` 返回 503**:健康检查改成 grep dev.log 双信号("HAPI Hub is ready" + "EmbeddedRunner ... started"),120s timeout。
- **`/root` 700,HOME 必须是 `/home/pwuser`**:Claude Code 要读 `~/.claude/settings.json`,/root 默认 700 锁住非 root 用户。
- **`claude --dangerously-skip-permissions` 拒绝 root**:必须 `USER pwuser`,所以容器以 uid 1000 跑(=宿主 azureuser,bind-mount 文件权限自然对齐)。
- **Worktree `.git` 是 file**:fix-mode 才需要;`gitdir: /home/azureuser/hapi/.git/worktrees/<name>` —— 容器要能 resolve 那个绝对路径,所以 mount 共享 `.git` 在同绝对路径上。find-mode 不用,因为不 git。
- **`pkill -f bun` 警告**:`/CLAUDE.md` 那段在容器内不再是高优先级 —— 容器内除了 hub/web 没别的 bun 进程。但养成精确 PID 习惯不亏。
- **EMFILE inotify 配额**(R17 撞过):find-mode 物理上避免了 agent 触发,但宿主端改 source 仍会触发。撞了的话 `sudo sysctl -w fs.inotify.max_user_instances=1024` 治标。
