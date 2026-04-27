---
name: codex-exec
description: Get a second opinion from Codex (OpenAI) on architecture, design, or code review questions.
user-invocable: true
allowed-tools:
  - Bash(codex exec *)
---

# /codex-exec — Get Codex's Opinion

Send a question to OpenAI Codex CLI and return the response.

Arguments: `$ARGUMENTS`

## Steps

1. If `$ARGUMENTS` is empty, ask the user what they want.
2. If the question references code, read the relevant files first and embed key excerpts into the prompt.
3. Run Codex — **use a heredoc to avoid shell quoting issues**:
   ```bash
   codex exec <<'PROMPT'
   Your prompt here. Can contain any characters safely.
   PROMPT
   ```
4. Present the response. Note agreements/disagreements with your own analysis.

## Rules

- **Always use heredoc** (`<<'PROMPT'` ... `PROMPT`) — never pass the prompt as a quoted string argument. This prevents shell escaping bugs with quotes, backticks, and special characters.
- Keep prompts self-contained — Codex has no memory of this conversation.
- For multi-part questions, run multiple `codex exec` calls in parallel.
- End prompts with a word limit like "Under 300 words."
