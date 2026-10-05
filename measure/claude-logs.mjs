#!/usr/bin/env node
// Weekly token report per repository from Claude Code's local logs (~/.claude/projects), including
// subagent transcripts and worktrees. No network, no dependencies. Use it for a retroactive
// baseline: the logs already hold the weeks before adoption.
//
//   node measure/claude-logs.mjs --repo weppa-app=/path/to/weppa-app --repo bukeer=/path/to/bukeer [--days 28]
//
// A request belongs to a repo when its cwd is the repo or lives under it (worktrees included).
// "weighted input" = input + 1.25 × cache writes + 0.1 × cache reads: the cache-aware input that
// providers bill, in tokens. Tier shares use the model id (haiku/sonnet/opus/other).
// Behaviour counters (what the guard targets): foreground sleeps >= 30 s, polling loops, and
// subagents launched without an explicit model.
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../hooks/guard.mjs';

const family = (model = '') => (/haiku/i.test(model) ? 'small' : /sonnet/i.test(model) ? 'fast' : /opus|fable/i.test(model) ? 'capable' : 'other');

function* walk(dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

const weekOf = (ts) => {
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};

const blank = () => ({ requests: 0, sessions: new Set(), input: 0, write: 0, read: 0, output: 0, byTier: {}, sleeps: 0, polls: 0, untieredAgents: 0, agents: 0 });

export async function report({ repos, days = 28, root = join(homedir(), '.claude', 'projects') }) {
  const since = Date.now() - days * 86400e3;
  const seen = new Set();
  const out = {};
  const repoOf = (cwd) => (cwd ? repos.find((r) => cwd === r.path || cwd.startsWith(`${r.path}/`))?.name : undefined);
  for (const file of walk(root)) {
    if (statSync(file).mtimeMs < since) continue;
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"assistant"')) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (d.type !== 'assistant' || !d.message) continue;
      const ts = Date.parse(d.timestamp);
      if (!(ts >= since)) continue;
      const repo = repoOf(d.cwd);
      if (!repo) continue;
      const repoRoot = repos.find((r) => r.name === repo).path;
      const key = `${d.message.id}:${d.requestId}`;
      const bucket = ((out[repo] ??= {})[weekOf(ts)] ??= blank());
      for (const c of Array.isArray(d.message.content) ? d.message.content : []) {
        if (c?.type !== 'tool_use') continue;
        const name = String(c.name || '').toLowerCase();
        if (name === 'agent' || name === 'task') {
          bucket.agents++;
          const r = evaluate({ tool_name: 'Agent', tool_input: c.input }, { root: repoRoot, config: {} });
          if (r.rules.includes('subagent-tier')) bucket.untieredAgents++;
        } else if (name === 'bash') {
          const r = evaluate({ tool_name: 'Bash', tool_input: c.input }, { root: repoRoot, config: {} });
          if (r.rules.includes('wait')) bucket.sleeps++;
          if (r.rules.includes('poll')) bucket.polls++;
        }
      }
      if (seen.has(key)) continue; // streamed records repeat the same usage
      seen.add(key);
      const u = d.message.usage || {};
      bucket.requests++;
      bucket.sessions.add(d.sessionId);
      bucket.input += u.input_tokens || 0;
      bucket.write += u.cache_creation_input_tokens || 0;
      bucket.read += u.cache_read_input_tokens || 0;
      bucket.output += u.output_tokens || 0;
      const tier = family(d.message.model);
      const weighted = (u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0);
      const t = (bucket.byTier[tier] ??= { weighted: 0, output: 0 });
      t.weighted += weighted;
      t.output += u.output_tokens || 0;
    }
  }
  return out;
}

const M = (n) => `${(n / 1e6).toFixed(1)}M`;
export function format(out) {
  const lines = [];
  for (const [repo, weeks] of Object.entries(out)) {
    lines.push(`\n## ${repo}`, '', '| week (Mon) | sessions | requests | weighted input | output | cache hit | capable share | sleeps≥30s | poll loops | agents w/o model |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [week, b] of Object.entries(weeks).sort()) {
      const weighted = b.input + 1.25 * b.write + 0.1 * b.read;
      const total = Object.values(b.byTier).reduce((s, t) => s + t.weighted, 0) || 1;
      const hit = b.read / ((b.input + b.write + b.read) || 1);
      lines.push(`| ${week} | ${b.sessions.size} | ${b.requests} | ${M(weighted)} | ${M(b.output)} | ${(100 * hit).toFixed(1)}% | ${(100 * (b.byTier.capable?.weighted || 0) / total).toFixed(0)}% | ${b.sleeps} | ${b.polls} | ${b.untieredAgents}/${b.agents} |`);
    }
  }
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const repos = [];
  let days = 28;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo') { const [name, path] = args[++i].split('='); repos.push({ name, path: resolve(path) }); }
    else if (args[i] === '--days') days = Number(args[++i]);
  }
  if (!repos.length) { console.error('usage: claude-logs.mjs --repo name=/path [--repo ...] [--days 28]'); process.exit(2); }
  report({ repos, days }).then((o) => console.log(format(o)));
}
