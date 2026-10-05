#!/usr/bin/env bash
# Cost per merged PR over the last N days: the one number to compare before and after adopting
# agent-economy. Tokens alone mislead (a cheap session that fails costs more than one that ships).
#
#   measure/cost-per-pr.sh [days=7] [ccusage --project filter]
#
# Needs: ccusage >= 20 (reads local logs of Claude Code, Codex, OpenCode, Gemini CLI and others;
# no network for the data), gh (authenticated) and jq. Run it from the project's checkout.
# On a subscription, read the cost as API-equivalent spend: a stable unit of quota, not a bill.
set -euo pipefail

days="${1:-7}"
project="${2:-}"
since=$(date -v-"${days}"d +%Y%m%d 2>/dev/null || date -d "${days} days ago" +%Y%m%d)
since_iso="${since:0:4}-${since:4:2}-${since:6:2}"

if command -v ccusage >/dev/null 2>&1; then cc=(ccusage); else cc=(npx --yes ccusage@20); fi
args=(daily --json --since "$since")
[[ -n "$project" ]] && args+=(--project "$project")

report=$("${cc[@]}" "${args[@]}")
cost=$(jq -r '.totals.totalCost // .summary.totalCostUSD // 0' <<<"$report")
tokens=$(jq -r '.totals.totalTokens // 0' <<<"$report")
cache_read=$(jq -r '.totals.cacheReadTokens // 0' <<<"$report")
input=$(jq -r '.totals.inputTokens // 0' <<<"$report")
prs=$(gh pr list --state merged --search "merged:>=${since_iso}" --limit 1000 --json number --jq length)

awk -v c="$cost" -v t="$tokens" -v r="$cache_read" -v i="$input" -v p="$prs" -v d="$days" -v s="$since_iso" 'BEGIN {
  printf "window          last %s days (since %s)\n", d, s
  printf "spend           $%.2f (API-equivalent)\n", c
  printf "tokens          %d\n", t
  printf "cache hit       %.0f%% of input read from cache\n", (r + i) > 0 ? 100 * r / (r + i) : 0
  printf "merged PRs      %d\n", p
  printf "cost per PR     %s\n", p > 0 ? sprintf("$%.2f", c / p) : "n/a (no merged PRs)"
}'
