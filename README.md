# agent-economy

Spend fewer tokens in coding agents without losing quality. It works with any harness and any
model vendor.

Every vendor sells a capable tier, a fast tier and a small tier. Most token waste comes from a
few habits:

- running everything on the capable tier
- discarding the prompt cache mid-session
- polling
- pouring raw tool output into the context

agent-economy is a short policy written **by tier, never by model name**. A small hook enforces
the parts a machine can check. A measurement script tells you whether it worked.

## What you get

| Piece | What it does | Harnesses |
|---|---|---|
| `POLICY.md` → your `AGENTS.md` | ~25 lines. They cover which tier and effort to use per task type, plus seven session-economy rules. | Every harness that reads `AGENTS.md`: Codex, OpenCode, Cursor, Gemini CLI, Copilot, Aider, Zed and others. Claude Code reads it through `CLAUDE.md` → `@AGENTS.md` or a symlink. |
| `.agent-economy.json` | The **only** place with model names: the tier → model/effort map per harness, plus guard settings. | Any |
| `hooks/guard.mjs` | A PreToolUse hook. It denies four things: foreground waits, polling loops, subagents without an explicit tier, and project-defined heavy commands. Each denial names the cheaper path. | Claude Code, Codex, OpenCode (plugin) |
| `hooks/session-start.mjs` | Tells the agent which concrete models are small / fast / capable in this harness. | Claude Code |
| `bin/quiet.mjs` | Runs a noisy command (tests, analyzers, builds) and shows only the failure lines and the tail. The full log stays on disk, and the exit code is kept. | Any, including harnesses without hooks |
| `measure/claude-logs.mjs` | Weekly report per repo from Claude Code's local logs: weighted input, cache hit rate, capable-tier share, and the behaviours the guard targets. It gives you a retroactive baseline, because the logs already hold the weeks before adoption. | Claude Code |
| `measure/cost-per-pr.sh` | Cost per merged PR over N days, with the cache hit rate. Data comes from `ccusage`, which reads the local logs of most harnesses. | Any |

No dependencies: plain Node ≥ 18. Everything is vendored into your repo, so nothing is fetched
at runtime.

## Adopt it

```bash
git clone https://github.com/weppa-cloud/agent-economy
node agent-economy/install.mjs /path/to/your/project --dry-run   # see what it will touch
node agent-economy/install.mjs /path/to/your/project
```

The installer is idempotent, so run it again to upgrade. It:

1. Vendors the hooks into `.agent-economy/`.
2. Creates `.agent-economy.json` from the example, if missing.
3. Writes the policy between markers into `AGENTS.md`. It follows the symlink when `AGENTS.md`
   points to `CLAUDE.md`, and falls back to `CLAUDE.md` when there is no `AGENTS.md`.
4. Adds its hooks to `.claude/settings.json`, `.codex/hooks.json` (and `hooks = true`) and
   `.opencode/plugin/`, without touching hooks that are already there.

Limit it with `--harness claude,codex`. Use `--lang es` for the Spanish policy block
(`POLICY.es.md`); translations are welcome.

Then:

1. **Fill the tiers** in `.agent-economy.json` for each harness you use. Claude Code ships filled
   (`haiku` / `sonnet` / `opus`). For a harness with a single model, express the tiers as effort
   levels.
2. **Declare your heavy commands**, so a full test suite does not run on every turn:

   ```json
   "guard": { "heavy": [
     { "pattern": "^flutter test$", "message": "run one file: flutter test test/<file>_test.dart, or wrap it: node .agent-economy/bin/quiet.mjs -- flutter test" }
   ] }
   ```

3. **Measure** a baseline week before you trust it ([measure/README.md](measure/README.md)).

## The policy in one screen

| Task | Tier | Effort |
|---|---|---|
| Search, read, summarize, triage, wait for CI | small | low |
| Implement with a clear issue or plan, tests, refactor, docs | fast | medium |
| Plan or design, security/authorization, core logic, hard diagnosis, final review | capable | high |

Escalate one tier only when an objective check fails. Then:

1. Fix model and effort at the start of a session.
2. One task per session.
3. Never poll.
4. Read by symbol or range, and filter noisy output.
5. Give every subagent an explicit tier and a short brief.
6. Use multi-agent only for parallel, independent work.
7. Lead with the result.

The full text is in [POLICY.md](POLICY.md). The reasoning and the numbers behind each rule are
in [EVIDENCE.md](EVIDENCE.md).

## What the guard denies

| Rule | Denied | Cheaper path it suggests |
|---|---|---|
| `wait` | `sleep N` with N ≥ 30 s (configurable), or a sleep tool with that many ms | background wait, `--watch` flags |
| `poll` | a `while`/`until`/`for` loop that sleeps; `watch` | the harness's background task, `gh pr checks --watch`, `kubectl wait` |
| `subagent-tier` | a Claude Code subagent with no `model`, whose definition has no `model:` either | pass the tier's model |
| `heavy` | your own patterns | your own message |

It fails open: bad input or an internal error lets the call through. It is a nudge, not a
security boundary.

Override it for one launch of the client with `AGENT_ECONOMY_ALLOW="<reason>"`. The reason is
logged to `$XDG_STATE_HOME/agent-economy/overrides.log`.

## Harness support

| Harness | Policy (AGENTS.md) | Guard | Session tiers | quiet |
|---|---|---|---|---|
| Claude Code | yes (`@AGENTS.md` or symlink) | yes | yes | yes |
| Codex CLI | yes | yes (shell + sleep tool) | via AGENTS.md + config | yes |
| OpenCode | yes | yes (bash) | via AGENTS.md + config | yes |
| Cursor, Gemini CLI, Copilot, Aider, others | yes | not yet: contributions welcome | via AGENTS.md + config | yes |

A rule that must hold no matter which harness runs belongs in a mechanism every harness goes
through, such as git hooks or CI. Text in `AGENTS.md` explains why; the hook enforces what a
machine can see.

## What this deliberately does not do

- **No "caveman" output rules.** Measured at about 8.5 % less output and no detectable gain on
  total cost (see EVIDENCE).
- **No lossy prompt compression.** Lossy compression saves tokens by dropping information; `quiet`
  keeps the full log instead.
- **No gateway or router.** A proxy is one more thing to operate, and one that strips cache
  markers makes every turn more expensive. Route by session, task or subagent: your harness
  already can.
- **No long `AGENTS.md`.** Repository summaries in context files raised cost by more than 20 %
  without raising success. Keep the policy block short and project facts to what an agent cannot
  infer.

## Development

```bash
npm test   # node --test, no dependencies
```

MIT licensed.
