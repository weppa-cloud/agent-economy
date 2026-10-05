<!-- agent-economy:start v0.1.0 -->
## Agent economy

Spend tokens where they change the result. Rules are by **tier**, never by model name; the
tier → model map for each harness lives in `.agent-economy.json`.

| Task | Tier | Effort |
|---|---|---|
| Search, read, summarize, triage, wait for CI | small | low |
| Implement with a clear issue or plan, tests, refactor, docs, process PRs | fast | medium |
| Plan or design, security/authorization, core logic, hard diagnosis, final review | capable | high |

- Escalate one tier only when an objective check fails (test, types, lint, review finding). Once.
- `max`/`xhigh` effort needs a written reason (frontier problem), never as a default.

Session economy:
1. Pick model and effort at the start. Changing either mid-session discards the prompt cache;
   start a subagent or a new session instead.
2. One task per session. Clear context when the task changes.
3. Never poll. Wait with the harness's background/notification mechanism or a `--watch` flag.
4. Read by symbol or line range; do not re-read unchanged files. Run noisy commands through
   `quiet` (failures only, full log kept on disk).
5. Every subagent gets an explicit tier and a short brief that points to the issue; it returns
   conclusions, not dumps.
6. Multi-agent only for independent, parallel work; at most 3 at once.
7. Answer with the result first. Do not restate what a tool already printed.
<!-- agent-economy:end -->
