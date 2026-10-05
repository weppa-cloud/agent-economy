# Evidence

Why each rule exists, ranked by impact, with sources. Collected 2026-10-05; prices and model
names change fast, so the **mechanisms** matter more than the exact numbers.

Labels:

- **[V]** verified in primary documentation or a controlled measurement
- **[T]** third-party measurement or write-up
- **[M]** the author's own claim, unverified

## 1. Protect the prompt cache (largest lever)

**Prices [V].**

- Anthropic: a cache read costs 0.1× normal input, a cache write 1.25× (5-minute TTL) or 2×
  (1-hour TTL).
- OpenAI: cache reads cost 0.1× on recent models.
- Gemini 2.5+: implicit caching gives a 90 % discount on cached input.

**Effect in agent loops [V].** Caching cuts cost 2.7×–5.3×. Median real traffic reads 84 % of
input from cache.

**What breaks it.**

- Anthropic [V]: changing tool definitions, the model, effort mid-session (most models) or fast
  mode; loading MCP tools up front; timestamps or variable content early in the prompt.
- OpenAI [V]: tool names, order or schemas; `reasoning.effort`; the model; compaction.

**Implication.** Fix model and effort at the start. Switch by starting a subagent or a new
session, never mid-conversation. Watch the cache hit rate (`measure/`).

Sources:

- <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- <https://code.claude.com/docs/en/prompt-caching>
- <https://developers.openai.com/api/docs/guides/prompt-caching>

## 2. Effort per task type [V]

Anthropic effort guidance:

| Comparison | Quality | Cost |
|---|---|---|
| SWE-bench Pro: `medium` vs `high` | −2.5 points | ~30 % less |
| SWE-bench Pro: `low` vs `high` | −8 points | ~67 % less |
| `xhigh` vs `high` | +1.4 points | 2.5× |
| Research tasks: `low` vs default | −1 to −3 points | 33–50 % less |

`low` is recommended for subagents. `max` can overthink outside frontier problems.

Source: <https://platform.claude.com/docs/en/build-with-claude/effort>

## 3. Tier per task, routed per session or subagent

- Anthropic recommends the small tier with low effort for subagents, and the fast tier for most
  coding tasks [V].
- **Advisor pattern** (fast executor consults a capable model) [V]. In Anthropic's measurement it
  scored +1.7 points over the executor alone at ~2.1× cost. It helps only when the executor
  actually consults: in one benchmark the executor stopped asking and gained nothing.
- **Aider architect/editor** [V]. Pairing a reasoning model as architect with a fast editor gave
  64 % on the polyglot benchmark at 14× lower cost than the frontier model alone. With newer
  models the pair did not always beat the strong model alone, so this is not universal.
- **Switching model** mid-session recomputes the whole history in the new model's cache [V].

Sources:

- <https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence>
- <https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool>
- <https://aider.chat/2024/09/26/architect.html>
- <https://aider.chat/2025/01/24/r1-sonnet.html>

## 4. Multi-agent is a trade, not a free saving [V/T]

- Multi-agent systems used ~15× the tokens of a chat. Token usage explained 80 % of the
  performance variance in BrowseComp. Agent teams use ~7×.
- An orchestrator with many fast-tier workers cut cost 47–55 % but lost 10–12 accuracy points.

Hence: multi-agent only for parallel, independent work, at most 3 at once, each with an explicit
tier.

## 5. Load tools on demand; filter tool output [V]

- Tool search: tool definitions fell from ~77K to ~8.7K tokens (−85 %), and tool-selection
  accuracy rose (49 → 74 % in one model, 79.5 → 88.1 % in another).
- Code execution against MCP: 150K → 2K tokens in one case.
- A hook that keeps only ERROR lines turns tens of thousands of tokens into hundreds.

Sources:

- <https://www.anthropic.com/engineering/advanced-tool-use>
- <https://www.anthropic.com/engineering/code-execution-with-mcp>
- <https://code.claude.com/docs/en/costs>

## 6. Context files: short, and only what cannot be inferred [V]

arXiv 2602.11988: context files (AGENTS.md and similar) did not improve success on average and
raised cost by more than 20 %. Agents do follow the instructions, but repository summaries do not
help. Useful content is non-standard practice the agent cannot discover.

## 7. Output style ("caveman") [V]

The most-starred repo on this topic (~110K stars) claims −65 % [M]. JetBrains measured it:

- Setup: 86 tasks, ~240 runs.
- Result: 8.5 % less output.
- Quality: no detectable difference (8 better, 10 worse, 64 ties).
- Total cost: the ~10 % saving disappeared into run-to-run variance.

In agents most output is code, diffs and tool calls, which style rules do not shrink, and the
rules themselves cost tokens on every request.

Source: <https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/>

## 8. Budgets and inherited prompts [V]

- **Budgets.** A loose task budget saved 44 % for ~3 points; a tight one saved 58 % for 6 points.
- **Inherited prompts.** Prompts written for an older model cost +36 % at equal accuracy. After
  an audit, cost fell 14 % and accuracy rose to 97 % (from 92 %).
- **Expensive phrases.** "Double-check everything", "be maximally exhaustive".

## 9. CI with LLMs [T]

- Batch APIs are 50 % off for work that tolerates a delay [V]. Good for nightly audits, not for a
  PR gate.
- Common practice, not controlled studies:
  - review once per commit SHA
  - cancel superseded runs
  - path filters
  - small-tier triage, escalating doubtful findings to the capable tier
- Never skip review by diff size on security, secrets or migrations. Filter by path and
  sensitivity instead.

## 10. Measure cost per resolved task [V]

- Same task set, at least 3 repetitions, fixed harness.
- arXiv 2608.01347: the value of an optimization changes when the harness changes, so measure in
  yours.

## Repositories reviewed

GitHub stars read on 2026-10-05. Stars measure popularity, not verified savings.

| Repo | ⭐ | Used here? |
|---|---|---|
| agentsmd/agents.md | 24.8K | Yes: the policy format |
| ryoppippi/ccusage | 18.9K | Yes: measurement |
| rtk-ai/rtk | 82.4K | Idea only (output filtering), with recovery |
| Aider-AI/aider | 49.4K | Evidence for tiering; repo-map idea |
| JuliusBrussee/caveman | 109.9K | No (see §7) |
| BerriAI/litellm, musistudio/claude-code-router, Portkey-AI/gateway | 60.2K / 37.6K / 13.1K | No: an extra proxy, and a cache risk |
| lm-sys/RouteLLM | 5.6K | Evidence only (chat benchmarks, unmaintained since 2024-08) |
| oraios/serena | 30.0K | Idea only (read by symbol) |
| yamadashy/repomix | 28.7K | No: for models without tools |
| microsoft/LLMLingua | 6.7K | No: lossy |
| getagentseal/codeburn, langfuse/langfuse, Helicone/helicone | 11.3K / 35.4K / 6.2K | Optional alternatives for measurement |
| qodo-ai/pr-agent | 13.3K | Reference for LLM review in CI |
