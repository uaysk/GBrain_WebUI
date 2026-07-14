# Codex Agent Notes

## GPT-5.3-Codex-Spark workers

Use independent Codex CLI workers when a task explicitly requires `gpt-5.3-codex-spark`:

```bash
codex exec \
  --model gpt-5.3-codex-spark \
  --sandbox workspace-write \
  -C "$PWD" \
  "독립 작업 지시"
```

- Use `--sandbox read-only` for analysis and review tasks that do not need edits.
- Give concurrent workers bounded, non-overlapping files or read-only tasks, then have the main agent review and integrate their results.
- Report these as CLI-based independent Spark workers, not built-in `spawn_agent` subagents.
- On 2026-07-14, a direct invocation returned `SPARK_MODEL_OK`, confirming model access in the tested environment.
- Codex CLI 0.144.3 exposed no model or custom-role argument in the available `spawn_agent` schema. Project-local custom-agent files and `[agents.spark]` registration were tested, but spawned children still used `gpt-5.6-sol` with `agent_role = null`.
- Each CLI invocation can send its prompt and loaded instructions to the OpenAI Codex service and consume model usage. Keep delegated context minimal and avoid secrets.

### Operating cautions

- Treat this as nested, independent CLI execution. It does not inherit built-in collaboration lifecycle, steering, result collection, or conflict prevention.
- Do not trust a worker's self-reported model identity or a requested task name as proof. Verify the CLI startup header says `model: gpt-5.3-codex-spark`; inspect session metadata when the header is unavailable.
- Re-check `codex --version` and the available `spawn_agent` schema after upgrades. The limitation recorded above is version-specific and may change.
- If policy or sandbox review blocks the call because repository context will leave the local workspace, disclose that source, loaded instructions, and prompts may be sent to the Codex service and wait for explicit approval. Do not retry through a workaround before approval.
- Default to `--sandbox read-only`. Use `workspace-write` only for an explicitly bounded implementation task, and never assign concurrent workers overlapping files. Independent workers share the same working tree, so edits become visible immediately and can overwrite or invalidate each other.
- Before a write-capable worker starts, record `git status --short`. After it exits, inspect the exact diff and preserve pre-existing user changes. Stop orphaned processes and recheck the worktree after interruption or cancellation.
- Delegate one narrow deliverable per worker. Specify files or symbols, required evidence, prohibited edits, and a concise final format. Broad repository reviews can generate very large intermediate tool logs even when the requested final answer is short.
- Prefer two or three focused workers over many simultaneous workers. Each process consumes its own context, model usage, CPU, and tool calls; parallelism is useful only for independent work.
- Wait for the process to exit and collect its final result. A message such as `Reading additional input from stdin...`, a terminal session ID, or a partial log is not completion. Do not rely on `--output-last-message` until the process has finished and the file exists.
- Ask workers to return conclusions and file references instead of raw command output. If aggregated output is truncated, treat the missing result as unavailable and rerun a smaller task rather than guessing.
- The main agent owns architecture, integration, security decisions, and final verification. Check every adopted finding against the current source, run relevant tests, inspect screenshots or runtime behavior when applicable, and reject unsupported assumptions.
- Use Spark preferentially for bounded static analysis, test-gap analysis, pure helper implementation, and focused diff review. Keep visual UX judgment, cross-cutting refactors, shared-state changes, and final integration with the main agent.
- In the final report, distinguish successful Spark processes from rejected or aborted attempts, and record which outputs were adopted as-is, adopted after modification, or discarded. Do not invent time or token savings.
