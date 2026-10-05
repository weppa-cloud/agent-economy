#!/usr/bin/env node
// agent-economy session start: tells the agent which concrete models are the small / fast /
// capable tiers in THIS harness, so the tier rules in AGENTS.md become actionable. The output is
// static for a given config, so it sits at the start of the prompt without breaking the cache.
// Usage: node session-start.mjs <harness>   (harness = key under `tiers` in .agent-economy.json)
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, loadConfig } from './guard.mjs';

// Pointer mode (policy.file): the instruction file only links to the policy, so inject the
// block itself here. It is static text, so it does not disturb the prompt cache.
export function policyFrom(root, file) {
  try {
    const text = readFileSync(join(root, file), 'utf8');
    const m = /<!-- agent-economy:start[^>]*-->([\s\S]*?)<!-- agent-economy:end -->/.exec(text);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

export function render(config, harness, root = '.') {
  const tiers = config.tiers?.[harness];
  const file = config.policy?.file;
  const policy = file ? policyFrom(root, file) : '';
  const parts = [];
  if (tiers && Object.keys(tiers).length) {
    const rows = Object.entries(tiers).map(([tier, t]) => `- ${tier}: model \`${t.model}\`${t.effort ? `, effort \`${t.effort}\`` : ''}`);
    parts.push(`agent-economy tiers for ${harness} (rules in ${file ?? 'AGENTS.md § Agent economy'}):`, ...rows);
  }
  if (policy) parts.push('', policy);
  return parts.join('\n').trim();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let cwd;
    try { cwd = JSON.parse(readFileSync(0, 'utf8')).cwd; } catch { /* no event on stdin */ }
    const root = findRoot(cwd);
    const text = render(loadConfig(root), process.argv[2] || 'claude-code', root);
    if (text) process.stdout.write(`${text}\n`);
  } catch { /* never break session start */ }
}
