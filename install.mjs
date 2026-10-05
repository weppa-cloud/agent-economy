#!/usr/bin/env node
// Adopt agent-economy in a project. Idempotent: run it again to upgrade.
//
//   node install.mjs <project-dir> [--harness claude,codex,opencode] [--dry-run]
//
// What it does (and nothing else):
//   1. vendors the guard, session-start hook and `quiet` into <project>/.agent-economy/
//   2. creates <project>/.agent-economy.json from the example if it does not exist
//   3. writes the policy block into AGENTS.md (follows a symlink, e.g. AGENTS.md -> CLAUDE.md),
//      or into CLAUDE.md if there is no AGENTS.md, replacing a previous block between markers
//   4. registers the hooks for each harness, without touching hooks that are already there
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const START = '<!-- agent-economy:start';
const END = '<!-- agent-economy:end -->';
const VENDORED = ['hooks/guard.mjs', 'hooks/session-start.mjs', 'bin/quiet.mjs'];

export function upsertBlock(text, block) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a >= 0 && b > a) return text.slice(0, a) + block.trim() + text.slice(b + END.length);
  return `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}${block.trim()}\n`;
}

export function mergeHooks(settings, adapter) {
  const out = structuredClone(settings);
  out.hooks ??= {};
  let added = 0;
  for (const [event, entries] of Object.entries(adapter.hooks)) {
    out.hooks[event] ??= [];
    const present = JSON.stringify(out.hooks[event]).includes('.agent-economy/hooks/');
    if (present) continue;
    out.hooks[event].push(...structuredClone(entries));
    added += entries.length;
  }
  return { settings: out, added };
}

export function install(target, { harnesses = ['claude', 'codex', 'opencode'], dryRun = false, log = console.log } = {}) {
  const root = resolve(target);
  if (!existsSync(root)) throw new Error(`no such directory: ${root}`);
  const write = (path, text) => { if (!dryRun) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); } };
  const rel = (p) => relative(root, p) || '.';

  for (const f of VENDORED) {
    const dest = join(root, '.agent-economy', f);
    if (!dryRun) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(join(SRC, f), dest); }
    log(`vendored  ${rel(dest)}`);
  }

  const cfg = join(root, '.agent-economy.json');
  if (existsSync(cfg)) log(`kept      ${rel(cfg)} (already present)`);
  else { write(cfg, readFileSync(join(SRC, 'agent-economy.example.json'), 'utf8')); log(`created   ${rel(cfg)} — fill the tiers for the harnesses you use`); }

  const agents = join(root, 'AGENTS.md');
  const claude = join(root, 'CLAUDE.md');
  const doc = existsSync(agents) ? realpathSync(agents) : existsSync(claude) ? realpathSync(claude) : agents;
  const before = existsSync(doc) ? readFileSync(doc, 'utf8') : '';
  write(doc, upsertBlock(before, readFileSync(join(SRC, 'POLICY.md'), 'utf8')));
  log(`${(before.includes(START) ? 'updated' : 'added').padEnd(9)} policy block in ${rel(doc)}${existsSync(agents) && lstatSync(agents).isSymbolicLink() ? ' (via AGENTS.md symlink)' : ''}`);
  if (!existsSync(agents)) log('note      no AGENTS.md: Codex, OpenCode, Cursor and Gemini CLI will not read the policy until one exists');

  const jsonHarness = { claude: ['.claude/settings.json', 'adapters/claude/settings.json'], codex: ['.codex/hooks.json', 'adapters/codex/hooks.json'] };
  for (const h of harnesses) {
    if (jsonHarness[h]) {
      const [dest, adapter] = jsonHarness[h];
      const path = join(root, dest);
      let current = {};
      if (existsSync(path)) {
        try { current = JSON.parse(readFileSync(path, 'utf8')); }
        catch { log(`skipped   ${dest}: not valid JSON, add the hooks from ${adapter} by hand`); continue; }
      }
      const { settings, added } = mergeHooks(current, JSON.parse(readFileSync(join(SRC, adapter), 'utf8')));
      if (added) write(path, `${JSON.stringify(settings, null, 2)}\n`);
      log(`${added ? 'hooked   ' : 'kept     '} ${dest}${added ? '' : ' (hooks already present)'}`);
      if (h === 'codex') {
        const toml = join(root, '.codex', 'config.toml');
        if (!existsSync(toml)) { write(toml, '[features]\nhooks = true\n'); log('created   .codex/config.toml (hooks = true)'); }
        else if (!/^\s*hooks\s*=\s*true/m.test(readFileSync(toml, 'utf8'))) log('note      .codex/config.toml: set `hooks = true` under [features] for the guard to run');
      }
    } else if (h === 'opencode') {
      const dest = join(root, '.opencode', 'plugin', 'agent-economy.js');
      if (!dryRun) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(join(SRC, 'adapters/opencode/agent-economy.js'), dest); }
      log(`hooked    ${rel(dest)}`);
    } else log(`skipped   unknown harness "${h}"`);
  }
  log(dryRun ? 'dry run: nothing written' : 'done. Commit the changes, then measure: see measure/README.md');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--harness');
  const hi = args.indexOf('--harness');
  if (!target) { console.error('usage: node install.mjs <project-dir> [--harness claude,codex,opencode] [--dry-run]'); process.exit(2); }
  try {
    install(target, { harnesses: hi >= 0 ? args[hi + 1].split(',') : undefined, dryRun: args.includes('--dry-run') });
  } catch (err) { console.error(`install: ${err.message}`); process.exit(1); }
}
