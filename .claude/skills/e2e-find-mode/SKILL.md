---
name: e2e-find-mode
description: Run HAPI Stage-2 end-to-end testing with Codex inside isolated Docker containers (find-only mode). Designs a new round scenario, drives playwright-cli through 3 named user sessions, observes DOM + screenshots, writes structured bug reports to /home/azureuser/hapi-rounds/round-N/. No code modification — just bug discovery.
user-invocable: true
allowed-tools:
  - Bash(bash /home/azureuser/hapi-worktrees-docker/docker/run-round.sh *)
  - Bash(bash /home/azureuser/hapi-worktrees-docker/docker/triage-rounds.sh *)
  - Bash(sudo docker ps *)
  - Bash(sudo docker ps -a *)
  - Bash(sudo docker logs *)
  - Bash(sudo docker stop *)
  - Bash(sudo docker rm *)
  - Bash(sudo docker volume *)
  - Bash(ls *)
  - Bash(stat *)
  - Bash(grep *)
  - Bash(awk *)
  - Bash(sed *)
  - Bash(find *)
  - Bash(tail *)
  - Bash(head *)
  - Bash(cat *)
  - Bash(sudo rm -rf /home/azureuser/hapi-rounds/*)
  - Bash(rmdir /home/azureuser/hapi-rounds *)
  - Bash(date *)
  - Bash(free -h *)
  - Bash(df -h *)
  - Read
  - CronCreate
  - CronDelete
  - CronList
---

# /e2e-find-mode — Codex + Docker E2E Bug Discovery

Run one or more parallel HAPI Stage-2 E2E rounds inside Docker containers. The
agent inside each container is **codex-cli** by default; it designs a fresh
enterprise scenario distinct from prior rounds, drives `playwright-cli`
through 3 named user sessions, observes DOM + visual screenshots, and writes
structured bug reports to a per-round artifact dir on the host.

**No product code is modified** — `/workspace` inside the container is a
read-only bind-mount of the docker worktree (kernel returns `EROFS` on
write). Bug fixes happen in a separate host-side triage step.

Arguments: `$ARGUMENTS`

Common forms:
- `/e2e-find-mode 26 "scenario hint"` — single round
- `/e2e-find-mode parallel 26 27 28 29` — 4 parallel rounds (you'll pick scenarios)
- `/e2e-find-mode triage 26 27 28 29` — aggregate finished rounds into /tmp/BUGS-AGGREGATE.md
- `/e2e-find-mode status` — current container + artifact state

---

## Pre-flight (always)

1. Confirm the orchestrator path exists (the docker setup lives in this repo):
   ```bash
   ls /home/azureuser/hapi-worktrees-docker/docker/run-round.sh
   ```
2. Pick fresh round numbers — refuse to clobber existing artifacts:
   ```bash
   ls -d /home/azureuser/hapi-rounds/round-N 2>/dev/null   # MUST NOT exist
   sudo docker ps -a --filter name=hapi-e2e-round-N --format '{{.Names}}'
   ```
3. Sanity-check host resources for parallel runs:
   ```bash
   free -h | head -3                  # need ~1.5 GB RAM per parallel round
   df -h /var/lib/docker | tail -1    # need ~2 GB disk per parallel round
   ```

---

## Single round

```bash
bash /home/azureuser/hapi-worktrees-docker/docker/run-round.sh \
    26 "三人协作:<role A> / <role B> / <role C> 在 #<channel> 频道。Bot 起个域感名字。Scenario:<企业故事>。强调:<spec 章节 + 具体行为>。"
```

Defaults: `--mode find` + `--agent codex`. Override with `--agent claude` if
needed (claude is heavier and refuses root, but useful for diversity).

The script:
1. Pre-creates `/home/azureuser/hapi-rounds/round-26/{round-26-evidence/{screenshots,logs}/, round-prompt.md}`
2. Renders the prompt template to `round-prompt.md` with placeholder substitution
3. Boots `hapi-e2e-round-26` container (--rm), bind-mounts:
   - `/home/azureuser/hapi-worktrees-docker` → `/workspace` RO
   - `/home/azureuser/hapi-rounds/round-26` → `/round-out` RW
   - `~/.claude/settings.json` + `~/.codex/config.toml` (RO) + `COPROXY_API_KEY` env
4. Container's entrypoint: `bun install` (first run) → `bun run dev` background → wait for "HAPI Hub is ready" + "EmbeddedRunner ... started" double signal → `cd /round-out/round-26-evidence` → exec codex with the prompt
5. Codex runs autonomously: reads spec, designs round, drives playwright, writes round-26.md + screenshots, exits

Report to user: container name, artifact path, expected duration (~15-30 min for find-mode).

---

## Picking scenarios

Read `docs/e2e_test/README.md` first to see what enterprise domains R1-R(N-1)
have already used. Avoid repeats. Good fresh domains include:

- Health: ICU rounds, pharmacy refill, insurance claim
- Finance: SOX audit, trading desk, compliance review
- Education: exam grading, syllabus review
- Logistics: warehouse pick-pack, fleet dispatch
- Creative: news editorial, music production, film editing
- Manufacturing: shop floor, QA inspection
- Hospitality: restaurant kitchen, hotel front desk
- Tech: incident response, code review, sprint planning, hackathon
- Legal: contract review, e-discovery
- Government: permit processing, public records request

Each scenario hint MUST specify:
1. **Three role names** (one per simulated user, ideally cross-functional)
2. **Channel name** (slack-style with `#`)
3. **Bot name flavor** (let codex pick, but suggest a domain-fitting style)
4. **Concrete scenario story** (1-2 sentences of what's happening)
5. **Spec emphasis** — which Stage-2 §V/§VI/§VII/§IX behaviors to stress (refer to `docs/mvp-ux-stage-2.md`)

Each round runs in parallel with siblings, so you must **pre-assign distinct
scenarios** before launch — agents can't see each other and would otherwise
cluster on the same coverage gaps.

---

## Parallel rounds

Launch sequentially (not with `&`) — concurrent `docker run` invocations
race the daemon. Each run-round.sh call returns in ~5 seconds (container
detached, `--rm`):

```bash
bash docker/run-round.sh 26 "<scenario A>"
bash docker/run-round.sh 27 "<scenario B>"
bash docker/run-round.sh 28 "<scenario C>"
bash docker/run-round.sh 29 "<scenario D>"
```

Verify all up:
```bash
sudo docker ps --filter name=hapi-e2e-round --format 'table {{.Names}}\t{{.Status}}'
```

---

## Polling pattern (recommended)

Set a recurring 5-minute cron to check status without consuming session
context. Use minute offset 2-59/5 to dodge the hour-boundary clustering:

```
CronCreate cron="2-59/5 * * * *" recurring=true prompt="""
Poll R{N..M} containers. For each:
 - sudo docker ps to see if alive
 - if exited (--rm cleaned): grep ^### Bug R<n>- in round-<n>.md, count + titles
 - if alive: tail -10 logs/agent.log + screenshot count
Report 4-col summary: Round | Phase | Bugs | Observation.
If all done: bash docker/triage-rounds.sh <N..M> -o /tmp/r<N>-<M>-bugs.md, write final summary, CronDelete this cron.
"""
```

Phases:
- `bun-install` — first 5-10 sec, only if node_modules volume is fresh
- `warmup` — 10-30 sec waiting for hub + runner
- `playwright` — agent driving 3 sessions, screenshots accumulating in evidence/screenshots/
- `writing-bugs` — playwright idle for >2 min, agent composing markdown
- `done` — container exited (`--rm` cleaned), `playwright-cli` dir renamed (entrypoint did it)
- `dead` — exited non-zero before writing artifacts; check `dev.log` last 80 lines

A typical find-mode round = 15-45 min. If a round goes >60 min idle on
playwright, it's stuck — manually `sudo docker stop hapi-e2e-round-N`.

---

## Reading results

Each finished round leaves on host at `/home/azureuser/hapi-rounds/round-N/`:

```
round-N/
├── round-prompt.md          (input — what we told the agent)
├── round-N.md               (bug report + test plan, agent-written)
└── round-N-evidence/
    ├── screenshots/
    │   └── r{N}-bug-{i}-<slug>.png
    ├── playwright-cli/      (renamed from .playwright-cli on exit)
    │   ├── page-<ts>.yml    (full DOM yaml, one per snapshot)
    │   └── console-<ts>.log (browser console)
    └── logs/
        ├── dev.log          (hub + web + runner stdout)
        └── agent.log        (codex JSONL events / claude transcript)
```

Bug references inside round-N.md use `round-N-evidence/<sub>/<file>` relative
paths — they'll resolve correctly after triage cp into the main repo.

```bash
cat   /home/azureuser/hapi-rounds/round-N/round-N.md            # bug report
ls    /home/azureuser/hapi-rounds/round-N/round-N-evidence/     # subtree
tail  /home/azureuser/hapi-rounds/round-N/round-N-evidence/logs/agent.log
```

---

## Triage

After ≥1 round completes, aggregate Bugs Found sections across rounds:

```bash
bash /home/azureuser/hapi-worktrees-docker/docker/triage-rounds.sh \
    26 27 28 29 \
    -o /tmp/r26-29-bugs.md
```

Output is a single markdown file with each round's `## Bugs Found` block +
evidence dir pointers. Read it. Look for:

1. **Cross-round corroboration** — same bug found by 2+ independent rounds
   (very strong signal, fix first)
2. **Source clusters** — multiple bugs pointing at the same hub handler /
   web component (likely one root cause, batch-fix)
3. **Severity inflation** — codex sometimes calls trivial console warnings
   `serious`; downgrade with judgment
4. **R20-1-style "needs live repro"** — agent's static analysis can't
   confirm root cause — flag for next round, don't fix blindly

---

## Cleanup

Drop a single round's artifacts + container volumes:

```bash
N=26
sudo docker rm -f hapi-e2e-round-$N 2>/dev/null
sudo docker volume ls -q --filter name=hapi-e2e-round-$N | xargs -r sudo docker volume rm
sudo rm -rf /home/azureuser/hapi-rounds/round-$N
```

Drop everything (after a parallel batch ships):

```bash
for N in 26 27 28 29; do
    sudo docker rm -f hapi-e2e-round-$N 2>/dev/null
    sudo docker volume ls -q --filter name=hapi-e2e-round-$N | xargs -r sudo docker volume rm
    sudo rm -rf /home/azureuser/hapi-rounds/round-$N
done
rmdir /home/azureuser/hapi-rounds 2>/dev/null
```

---

## Common gotchas

- **Don't edit `/home/azureuser/hapi-worktrees-docker` mid-round** — it's
  bind-mounted RO into every running container, but `bun --watch` inside
  each container watches the inode. A host-side save triggers hub-restart
  in *every* concurrent round simultaneously, can exhaust the host's
  inotify quota (`fs.inotify.max_user_instances=128`). Was a hard-to-debug
  EMFILE in early fix-mode runs.
- **Codex auth** uses `~/.codex/config.toml` + `COPROXY_API_KEY` env. If the
  host has those set, run-round.sh forwards them. If config or key is
  missing, codex inside container will fail with a clear error in agent.log.
- **The 4-pitfall fixes are baked into commit `69ef10c..1fa45fc`** — RO
  source mount + per-workspace node_modules volumes (6 of them) + cwd
  /round-out for playwright + entrypoint .playwright-cli rename. Don't
  manually undo any of these in the Dockerfile / entrypoint / run-round.sh
  without re-verifying smoke.
- **Round numbers must be globally unique across the repo's history** —
  pick the next available by reading `docs/e2e_test/README.md`'s
  `## Round summary` table.
- **`--rm` cleans the container on exit**, but leaves named volumes
  (`<name>-node-modules`, `-hapi-home`, `-claude-home`, `-codex-home`,
  per-workspace `-{cli,hub,web,shared,website,docs}-nm`). The cleanup
  block above removes all of them.
- **R20-1 is intentionally unfixed** in the current codebase — sequential
  permission prompts may stall after long idle. If you observe it, capture
  live repro steps (browser dev tools network/console) before reporting.

---

## When NOT to use this skill

- Quick bug repro that doesn't need a fresh enterprise scenario — just
  start a service-mode container with `bash docker/run.sh` + drive
  playwright-cli yourself
- Code refactor or feature work — find-mode prompt forbids modifying
  product code; the agent will refuse
- Single-file change verification — overkill, run unit tests instead
- When you need fix + commit in the same flow — use `--mode fix` (legacy)
  to give the agent a writable worktree on its own branch

---

## Implementation reference

- Container image: `mcr.microsoft.com/playwright:v1.59.1-jammy` + bun 1.3.13 + `@anthropic-ai/claude-code` + `@openai/codex` 0.125 + `@playwright/cli` + chromium 147
- Entrypoint dispatches on `${HAPI_AGENT:-codex}` env to `codex exec` or `claude --print`
- `docker/round-prompt.template.md` is the agent-neutral find-mode prompt; placeholders `{{ROUND_NUM}}` / `{{PRIOR_ROUND}}` / `{{BRANCH}}` / `{{AGENT_NAME}}` / `{{SCENARIO_HINT}}` are sed-replaced at launch
- `docker/round-prompt-fix.template.md` is the legacy fix-mode prompt
- Smoke test (occasional sanity check): `bash docker/run-round.sh 99 "smoke" --prompt-file /tmp/your-smoke.md` then verify all 7 steps pass and exit code 0
