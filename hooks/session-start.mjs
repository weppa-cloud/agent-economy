#!/usr/bin/env node
// agent-economy session start: tells the agent which concrete models are the small / fast /
// capable tiers in THIS harness, so the tier rules in AGENTS.md become actionable. The output is
// static for a given config, so it sits at the start of the prompt without breaking the cache.
// Usage: node session-start.mjs <harness>   (harness = key under `tiers` in .agent-economy.json)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, loadConfig } from './guard.mjs';

export function render(config, harness) {
  const tiers = config.tiers?.[harness];
  if (!tiers || !Object.keys(tiers).length) return '';
  const rows = Object.entries(tiers).map(([tier, t]) => `- ${tier}: model \`${t.model}\`${t.effort ? `, effort \`${t.effort}\`` : ''}`);
  return [`agent-economy tiers for ${harness} (rules in AGENTS.md § Agent economy):`, ...rows].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let cwd;
    try { cwd = JSON.parse(readFileSync(0, 'utf8')).cwd; } catch { /* no event on stdin */ }
    const text = render(loadConfig(findRoot(cwd)), process.argv[2] || 'claude-code');
    if (text) process.stdout.write(`${text}\n`);
  } catch { /* never break session start */ }
}
