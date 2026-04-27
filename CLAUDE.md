# CLAUDE.md — HAPI repo notes for Claude Code sessions

## Killing HAPI processes — DO NOT use broad pkill patterns

The Claude Code CLI itself is a `bun` / `node` process. Patterns like
`pkill -f bun`, `pkill -f vite`, `pkill -f node` will terminate the running
Claude Code session along with the intended target. **This has happened.**

Instead, target HAPI specifically:

```bash
# Hub  (cwd-anchored full path, not just "bun")
pkill -f "/home/azureuser/hapi/hub/.*src/index.ts"
# Web (vite running inside the hapi/web dir)
pkill -f "/home/azureuser/hapi/web/.*vite"
# Runner subprocess (CLI started by hub embedded runner)
pkill -f "/home/azureuser/hapi/cli/.*runner.*start-sync"
# Claude agent subprocesses spawned by HAPI runner (specific flag chain)
pkill -f "claude --output-format stream-json --verbose --append-system-prompt"
```

Or, safer still: collect PIDs first with `pgrep -af "<full-path-pattern>"`,
inspect, then `kill <PID> <PID>...` one by one.

Never use `pkill -9 -f bun`, `pkill -f vite`, or `pkill -f node`. Always
include the absolute repo path or a HAPI-unique flag combination so the
pattern can't match the host harness.

## Repo layout pointers

- Hub server: `hub/src/index.ts` (Bun, port 3006 by default)
- Web app: `web/` (Vite, port 5173 by default; falls through to 5174 if held)
- CLI runner: `cli/src/runner/run.ts` (forked by hub as embedded runner)
- Stage 2 design: `docs/mvp-ux-stage-2.md`
- Round-N E2E test plans: `round-N-end-to-end-test.md` at repo root

## Test data

- `~/.hapi/` — DB + workspaces + per-channel `agent.json`
- Wipe with `rm -rf ~/.hapi` before each fresh end-to-end round.
