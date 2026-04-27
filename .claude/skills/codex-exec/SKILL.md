---
name: codex-exec
description: Get a second opinion from Codex (OpenAI) on architecture, design, or code review questions.
user-invocable: true
allowed-tools:
  - Bash(codex exec *)
  - Read
---

# /codex-exec — Get Codex's Opinion

Send a question to OpenAI Codex CLI and return the response.

Arguments: `$ARGUMENTS`

## Steps

1. If `$ARGUMENTS` is empty, ask the user what they want.
2. If the question references code, read the relevant files first and embed key excerpts into the prompt.
3. Run Codex with `--output-last-message` so only the final answer hits disk
   — Codex's stdout includes the workdir/model header, every `exec` tool
   call (often re-printing entire files), and reasoning summaries. Letting
   that all flow back into your conversation typically burns 20–40k
   tokens for a 400-word answer.

   ```bash
   codex exec -o /tmp/codex-answer.md <<'PROMPT' >/dev/null 2>&1
   Your prompt here. Can contain any characters safely.
   PROMPT
   ```

4. Read `/tmp/codex-answer.md` with the Read tool to get the final answer.
5. Present the response. Note agreements/disagreements with your own analysis.

## Rules

- **Always use heredoc** (`<<'PROMPT'` ... `PROMPT`) — never pass the prompt as a quoted string argument. This prevents shell escaping bugs with quotes, backticks, and special characters.
- **Always use `-o /tmp/codex-answer.md` + redirect stdout to /dev/null**, then `Read` the output file. Don't capture Codex's full process trace into context — it bloats the conversation by 10–100x without adding signal.
- For multiple parallel calls, use distinct output paths (e.g. `/tmp/codex-answer-1.md`, `/tmp/codex-answer-2.md`) so they don't clobber each other.
- Keep prompts self-contained — Codex has no memory of this conversation.
- For multi-part questions, run multiple `codex exec` calls in parallel.
- End prompts with a word limit like "Under 300 words."

