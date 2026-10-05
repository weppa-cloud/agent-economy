#!/usr/bin/env node
// agent-economy guard: a PreToolUse hook for Claude Code and Codex (OpenCode calls `evaluate`
// through its plugin). It only DENIES, and every denial names the cheaper path:
//
//   wait          `sleep N` with N >= guard.waitSeconds, or a sleep tool with that many ms
//   poll          a shell loop (`while`/`until`/`for`) that sleeps, or `watch`: polling burns a
//                 turn per check; use the harness's background wait or a `--watch` flag
//   subagent-tier a subagent launched without an explicit model, so it silently inherits the
//                 (usually most expensive) session model
//   heavy         project-defined commands (guard.heavy) with the project's own message
//
// Fails OPEN: malformed input, a huge event or an internal error exit 0 with `{}`.
// It is a nudge, not a security boundary: a text scanner does not see variables or scripts.
// Override for one launch with AGENT_ECONOMY_ALLOW=<reason> (logged, see README).
// No dependencies (plain Node >= 18).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_EVENT = 1024 * 1024;
export const DEFAULTS = {
  waitSeconds: 30,
  poll: true,
  subagentTier: true,
  subagentTypesWithModel: [],
  heavy: [],
};

const SHELL_TOOLS = new Set(['bash', 'shell', 'shell_command', 'exec_command', 'local_shell', 'unified_exec', 'container.exec']);
const SUBAGENT_TOOLS = new Set(['agent', 'task']);
const SLEEP_TOOL = /(?:^|[._:/]|__)sleep$/;
const LOOP_WORDS = new Set(['while', 'until', 'for']);
const PREFIX_WORDS = new Set(['do', 'then', 'else', '{', '(', '!', 'time']);

// ------------------------------------------------------------------ config

export function findRoot(start) {
  let dir = resolve(start || process.cwd());
  for (;;) {
    if (existsSync(join(dir, '.agent-economy.json')) || existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(start || process.cwd());
    dir = up;
  }
}

export function loadConfig(root) {
  try {
    const raw = JSON.parse(readFileSync(join(root, '.agent-economy.json'), 'utf8'));
    return { ...raw, guard: { ...DEFAULTS, ...(raw.guard || {}) } };
  } catch {
    return { guard: { ...DEFAULTS } };
  }
}

// ------------------------------------------------------------------ shell

// Splits a script into simple commands (on newline, ;, &, |) and each into words, honouring
// quotes. It does not expand anything; quoted text stays inside one word.
export function splitShell(source) {
  const commands = [];
  let words = [];
  let word = null;
  const endWord = () => { if (word !== null) words.push(word); word = null; };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  const s = String(source);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') {
      const close = s.indexOf(c, i + 1);
      const end = close < 0 ? s.length : close;
      word = (word ?? '') + s.slice(i + 1, end);
      i = end;
    } else if (c === '\\' && i + 1 < s.length) {
      if (s[i + 1] !== '\n') word = (word ?? '') + s[i + 1];
      i++;
    } else if (c === '#' && word === null) {
      while (i < s.length && s[i] !== '\n') i++;
      endCommand();
    } else if ('\n;&|'.includes(c)) endCommand();
    else if (/\s/.test(c)) endWord();
    else if ((c === '(' || c === ')') && word === null) { endCommand(); }
    else word = (word ?? '') + c;
  }
  endCommand();
  return commands.map((w) => {
    let k = 0;
    while (k < w.length - 1 && PREFIX_WORDS.has(w[k])) k++;
    return w.slice(k);
  });
}

const DURATION = /^(\d+(?:\.\d+)?)([smhd]?)$/;
function sleepSeconds(words) {
  if (words[0] !== 'sleep') return undefined;
  let total = 0;
  for (const w of words.slice(1)) {
    const m = DURATION.exec(w);
    if (!m) return undefined;
    total += Number(m[1]) * { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  }
  return total;
}

// Codex shells come as `["bash", "-lc", "<script>"]`; anything else is a plain argv.
function scriptsIn(input, depth = 0) {
  if (typeof input === 'string') return [input];
  if (!input || typeof input !== 'object' || depth > 3) return [];
  return Object.entries(input).flatMap(([key, v]) => {
    if (key === 'command' || key === 'cmd') {
      if (typeof v === 'string') return [v];
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        const flag = v.findIndex((x) => x === '-c' || x === '-lc');
        return [flag >= 0 && v[flag + 1] ? v[flag + 1] : v.join(' ')];
      }
    }
    return scriptsIn(v, depth + 1);
  });
}

function sleepToolMs(input) {
  if (!input || typeof input !== 'object') return undefined;
  for (const [key, scale] of [['duration_ms', 1], ['durationMs', 1], ['ms', 1], ['seconds', 1000], ['duration_s', 1000]]) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) return input[key] * scale;
  }
  return undefined;
}

// ------------------------------------------------------------------ subagents

function declaresModel(type, root, home) {
  if (!type || /[\\/]/.test(type)) return false;
  for (const dir of [join(root, '.claude', 'agents'), join(home, '.claude', 'agents')]) {
    try {
      const text = readFileSync(join(dir, `${type}.md`), 'utf8');
      const front = /^---\n([\s\S]*?)\n---/.exec(text);
      if (front && /^model:\s*\S+/m.test(front[1]) && !/^model:\s*inherit\s*$/m.test(front[1])) return true;
    } catch { /* not defined here */ }
  }
  return false;
}

// ------------------------------------------------------------------ decision

function tierHint(config, harness) {
  const tiers = config.tiers?.[harness];
  if (!tiers) return 'small, fast or capable (see .agent-economy.json)';
  return Object.entries(tiers).map(([tier, t]) => `${tier} = ${t.model}`).join(', ');
}

/**
 * @param {any} event decoded PreToolUse event ({ tool_name, tool_input, cwd })
 * @param {{ config?: any, root?: string, home?: string, harness?: string }} [ctx]
 * @returns {{ decision: 'allow' | 'deny', rules: string[], reason?: string }}
 */
export function evaluate(event, ctx = {}) {
  const root = ctx.root ?? findRoot(event?.cwd);
  const config = ctx.config ?? loadConfig(root);
  const g = { ...DEFAULTS, ...(config.guard || {}) };
  const name = typeof event?.tool_name === 'string'
    ? event.tool_name.toLowerCase().replace(/^(?:functions|tools|default)[._:/]+/, '') : '';
  const input = event?.tool_input;
  if (!name || name.startsWith('mcp__')) return { decision: 'allow', rules: [] };
  const reasons = new Map();

  if (SUBAGENT_TOOLS.has(name) && g.subagentTier && input && typeof input === 'object') {
    const type = input.subagent_type;
    const pinned = typeof input.model === 'string' && input.model.trim() !== '';
    if (!pinned && !g.subagentTypesWithModel.includes(type) && !declaresModel(type, root, ctx.home ?? homedir())) {
      reasons.set('subagent-tier', `agent-economy: give this subagent an explicit tier instead of inheriting the session model. Pass \`model\` (${tierHint(config, ctx.harness ?? 'claude-code')}). Search/read/summarize → small; implement with a clear plan → fast; design, security, hard diagnosis → capable.`);
    }
  }

  if (SLEEP_TOOL.test(name)) {
    const ms = sleepToolMs(input);
    if (ms !== undefined && ms >= g.waitSeconds * 1000) reasons.set('wait', waitReason(g));
  }

  if (SHELL_TOOLS.has(name)) {
    for (const script of scriptsIn(input)) {
      const commands = splitShell(script);
      const loops = commands.some((w) => LOOP_WORDS.has(w[0]));
      for (const words of commands) {
        const secs = sleepSeconds(words);
        if (secs !== undefined && secs >= g.waitSeconds) reasons.set('wait', waitReason(g));
        if (g.poll && ((loops && secs !== undefined) || words[0] === 'watch')) {
          reasons.set('poll', 'agent-economy: polling loop blocked; every check costs a turn of context. Run it in the background with the harness (background task / monitor) or use a blocking watch flag, e.g. `gh pr checks <n> --watch`, `gh run watch <id> --exit-status`, `kubectl wait`.');
        }
        const line = words.join(' ');
        for (const h of g.heavy) {
          try { if (new RegExp(h.pattern).test(line)) reasons.set(`heavy:${h.pattern}`, `agent-economy: ${h.message}`); } catch { /* bad pattern: ignore */ }
        }
      }
    }
  }

  if (!reasons.size) return { decision: 'allow', rules: [] };
  return { decision: 'deny', rules: [...reasons.keys()], reason: [...reasons.values()].join('\n') };
}
const waitReason = (g) => `agent-economy: waiting ${g.waitSeconds}s or more in the foreground blocks the session. Use the harness's background wait or a \`--watch\` flag on the thing you are waiting for.`;

// ------------------------------------------------------------------ hook entry point

function logOverride(env, reason, result) {
  try {
    const dir = join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'agent-economy');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, 'overrides.log'), `${JSON.stringify({ ts: new Date().toISOString(), reason, rules: result.rules })}\n`, { mode: 0o600 });
  } catch { /* logging never blocks */ }
}

export function handle(source, env = process.env, harness = 'claude-code') {
  if (source.length > MAX_EVENT) return {};
  let event;
  try { event = JSON.parse(source); } catch { return {}; }
  const result = evaluate(event, { harness });
  if (result.decision !== 'deny') return {};
  const motive = (env.AGENT_ECONOMY_ALLOW || '').trim();
  if (motive && !['0', 'false', 'no', 'off'].includes(motive.toLowerCase())) {
    logOverride(env, motive, result);
    return {};
  }
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output = {};
  try { output = handle(readFileSync(0, 'utf8'), process.env, process.argv[2] || 'claude-code'); } catch { output = {}; }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
