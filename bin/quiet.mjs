#!/usr/bin/env node
// quiet: run a noisy command (tests, analyzers, builds) and show the agent only what matters.
// The full output is kept on disk, so nothing is lost: read the log only if the summary is not
// enough. Exit code is preserved. Works in any harness, including those without hooks.
//
//   node .agent-economy/quiet.mjs -- flutter test
//   node .agent-economy/quiet.mjs --max 80 -- npm run lint
//
// On success: one line. On failure: lines that look like failures (deduplicated, capped) plus
// the last lines of output, then the log path.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, loadConfig } from '../hooks/guard.mjs';

export const DEFAULT_PATTERN = '(error|fail|failed|failure|exception|panic|fatal|assert|expected|✗|✘|FAILED|ERROR)';

export function summarize(text, { code, pattern = DEFAULT_PATTERN, max = 60, tail = 15, log }) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (code === 0) return `ok: ${lines.length} lines of output (full log: ${log})`;
  const re = new RegExp(pattern, 'i');
  const seen = new Set();
  const hits = [];
  for (const l of lines) {
    if (re.test(l) && !seen.has(l)) { seen.add(l); hits.push(l); }
  }
  const tailLines = lines.slice(-tail).filter((l) => !seen.has(l));
  const shown = hits.slice(0, max);
  return [
    `exit ${code}: ${lines.length} lines, ${hits.length} matching failure lines${hits.length > max ? ` (first ${max} shown)` : ''}`,
    ...shown,
    ...(tailLines.length ? ['--- last lines ---', ...tailLines] : []),
    `full log: ${log}`,
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { max: undefined, tail: undefined };
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i++) {
    if (argv[i] === '--max') opts.max = Number(argv[++i]);
    else if (argv[i] === '--tail') opts.tail = Number(argv[++i]);
    else break;
  }
  if (argv[i] === '--') i++;
  return { opts, cmd: argv.slice(i) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { opts, cmd } = parseArgs(process.argv.slice(2));
  if (!cmd.length) { process.stderr.write('usage: quiet.mjs [--max N] [--tail N] -- <command> [args...]\n'); process.exit(2); }
  const cfg = loadConfig(findRoot(process.cwd())).quiet || {};
  const dir = join(tmpdir(), 'agent-economy');
  mkdirSync(dir, { recursive: true });
  const slug = cmd.join('-').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40);
  const log = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug}.log`);
  const out = createWriteStream(log);
  const child = cmd.length === 1 ? spawn(cmd[0], { shell: true }) : spawn(cmd[0], cmd.slice(1), { shell: false });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  child.on('error', (err) => { out.write(`quiet: ${err.message}\n`); });
  child.on('close', (code) => {
    out.end(() => {
      const exit = code ?? 1;
      const text = readFileSync(log, 'utf8');
      process.stdout.write(`${summarize(text, { code: exit, pattern: cfg.failurePattern, max: opts.max ?? cfg.maxLines, tail: opts.tail ?? cfg.tailLines, log })}\n`);
      process.exit(exit);
    });
  });
}
