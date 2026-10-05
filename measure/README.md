# Measure before and after

Adopting rules without a baseline produces opinions, not savings. The metric is **cost per merged
PR** (or per resolved task), not raw tokens: a cheap session that fails is the most expensive one.

1. **Baseline.** Before installing, run for one normal week:

   ```bash
   measure/cost-per-pr.sh 7
   ```

   Save the output in the adoption issue or PR.

2. **Install** agent-economy and work normally for another week.

3. **Compare** with the same command and the same window length. Also watch quality signals you
   already have: reverted PRs, review findings, CI failures per PR.

Notes:

- `ccusage` reads the local logs of Claude Code, Codex, OpenCode, Gemini CLI and more; its
  numbers are machine-wide unless you pass a `--project` filter (second argument).
- Variance is large. A 10 % difference over one week is noise; repeat the window or compare
  several weeks before concluding (JetBrains saw a ~10 % saving vanish into run-to-run variance).
- Cache hit rate is the first thing to look at: if it drops after a change, something in the
  prompt prefix is being rewritten (model or effort switches, tool lists, timestamps).
- On a subscription the dollar figure is API-equivalent spend: use it as a unit of quota.
