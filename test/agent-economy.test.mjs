import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluate, handle, splitShell } from '../hooks/guard.mjs';
import { render } from '../hooks/session-start.mjs';
import { summarize } from '../bin/quiet.mjs';
import { install, mergeHooks, upsertBlock } from '../install.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'ae-'));
const ctx = (extra = {}) => ({ root: tmp(), home: tmp(), config: {}, ...extra });
const bash = (command, c = ctx()) => evaluate({ tool_name: 'Bash', tool_input: { command } }, c);

test('splitShell keeps quoted text in one word and strips loop prefixes', () => {
  assert.deepEqual(splitShell('while true; do sleep 5; done'), [['while', 'true'], ['sleep', '5'], ['done']]);
  assert.deepEqual(splitShell('echo "while sleep 99"'), [['echo', 'while sleep 99']]);
});

test('wait: long foreground sleep is denied, short is allowed', () => {
  assert.equal(bash('sleep 60').decision, 'deny');
  assert.equal(bash('sleep 1m').decision, 'deny');
  assert.equal(bash('sleep 5 && npm run build').decision, 'allow');
  assert.equal(bash('echo "sleep 600"').decision, 'allow');
});

test('wait: configurable threshold and Codex sleep tool in ms', () => {
  assert.equal(bash('sleep 20', ctx({ config: { guard: { waitSeconds: 10 } } })).decision, 'deny');
  assert.equal(evaluate({ tool_name: 'sleep', tool_input: { duration_ms: 45000 } }, ctx()).decision, 'deny');
  assert.equal(evaluate({ tool_name: 'sleep', tool_input: { duration_ms: 2000 } }, ctx()).decision, 'allow');
  assert.equal(bash('sleep 600', ctx({ config: { guard: { wait: false } } })).decision, 'allow');
});

test('poll: loops that sleep and `watch` are denied; loops without sleep pass', () => {
  assert.deepEqual(bash('until gh pr checks 12 | grep -q pass; do sleep 10; done').rules, ['poll']);
  assert.deepEqual(bash('watch -n 5 kubectl get pods').rules, ['poll']);
  assert.equal(bash('for f in a b; do echo $f; done').decision, 'allow');
  const bg = evaluate({ tool_name: 'Bash', tool_input: { command: 'until x; do sleep 60; done', run_in_background: true } }, ctx());
  assert.equal(bg.decision, 'allow');
  assert.equal(bash('until x; do sleep 10; done', ctx({ config: { guard: { poll: false } } })).decision, 'allow');
});

test('Codex shell argv: the -lc script is analyzed', () => {
  const r = evaluate({ tool_name: 'exec_command', tool_input: { cmd: ['bash', '-lc', 'sleep 120'] } }, ctx());
  assert.equal(r.decision, 'deny');
});

test('subagent-tier: a subagent must name its model, or its definition must', () => {
  const c = ctx({ config: { tiers: { 'claude-code': { small: { model: 'haiku' } } } } });
  const denied = evaluate({ tool_name: 'Agent', tool_input: { prompt: 'x', subagent_type: 'general-purpose' } }, c);
  assert.equal(denied.decision, 'deny');
  assert.match(denied.reason, /small = haiku/);
  assert.equal(evaluate({ tool_name: 'Agent', tool_input: { prompt: 'x', model: 'haiku' } }, c).decision, 'allow');
  mkdirSync(join(c.root, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(c.root, '.claude', 'agents', 'explorer.md'), '---\nname: explorer\nmodel: haiku\n---\nbody');
  writeFileSync(join(c.root, '.claude', 'agents', 'heir.md'), '---\nname: heir\nmodel: inherit\n---\nbody');
  assert.equal(evaluate({ tool_name: 'Agent', tool_input: { subagent_type: 'explorer' } }, c).decision, 'allow');
  assert.equal(evaluate({ tool_name: 'Agent', tool_input: { subagent_type: 'heir' } }, c).decision, 'deny');
  const listed = ctx({ config: { guard: { subagentTypesWithModel: ['Explore'] } } });
  assert.equal(evaluate({ tool_name: 'Task', tool_input: { subagent_type: 'Explore' } }, listed).decision, 'allow');
});

test('heavy: project patterns with the project message', () => {
  const c = ctx({ config: { guard: { heavy: [{ pattern: '^flutter test$', message: 'run one file: flutter test test/x_test.dart' }] } } });
  const r = bash('flutter test', c);
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /run one file/);
  assert.equal(bash('flutter test test/a_test.dart', c).decision, 'allow');
});

test('MCP and unknown tools pass; malformed events fail open', () => {
  assert.equal(evaluate({ tool_name: 'mcp__x__sleep', tool_input: { ms: 99999 } }, ctx()).decision, 'allow');
  assert.deepEqual(handle('not json'), {});
  assert.deepEqual(handle('{}'), {});
});

test('handle emits a PreToolUse deny, and AGENT_ECONOMY_ALLOW overrides it', () => {
  const ev = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sleep 300' }, cwd: tmp() });
  assert.equal(handle(ev, {}).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(handle(ev, { AGENT_ECONOMY_ALLOW: 'waiting on a real deploy', XDG_STATE_HOME: tmp() }), {});
  assert.equal(handle(ev, { AGENT_ECONOMY_ALLOW: 'off' }).hookSpecificOutput.permissionDecision, 'deny');
});

test('hook script end to end over stdin', () => {
  const out = execFileSync('node', [join(REPO, 'hooks/guard.mjs')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sleep 99' }, cwd: tmp() }) });
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
});

test('session-start renders the tier map only when filled', () => {
  assert.match(render({ tiers: { codex: { fast: { model: 'm', effort: 'medium' } } } }, 'codex'), /fast: model `m`, effort `medium`/);
  assert.equal(render({ tiers: { codex: {} } }, 'codex'), '');
});

test('quiet: one line on success, failure lines + tail on failure, exit code kept', () => {
  assert.match(summarize('a\nb\n', { code: 0, log: '/l' }), /^ok: 2 lines/);
  const s = summarize('ok 1\nFAILED test x\nError: boom\nok 2\nsummary', { code: 1, log: '/l', tail: 1 });
  assert.match(s, /FAILED test x/);
  assert.match(s, /Error: boom/);
  assert.match(s, /summary/);
  assert.doesNotMatch(s, /ok 1/);
  const run = spawnSync('node', [join(REPO, 'bin/quiet.mjs'), '--', 'node', '-e', 'console.log("noise");console.error("Error: x");process.exit(3)'], { encoding: 'utf8' });
  assert.equal(run.status, 3);
  assert.match(run.stdout, /Error: x/);
  assert.match(run.stdout, /full log: /);
});

test('upsertBlock appends once and replaces in place', () => {
  const once = upsertBlock('# Title\n', '<!-- agent-economy:start v1 -->\nA\n<!-- agent-economy:end -->');
  const twice = upsertBlock(`${once}\n## After\n`, '<!-- agent-economy:start v2 -->\nB\n<!-- agent-economy:end -->');
  assert.equal((twice.match(/agent-economy:start/g) || []).length, 1);
  assert.match(twice, /v2[\s\S]*B[\s\S]*## After/);
});

test('mergeHooks keeps existing hooks and is idempotent', () => {
  const mine = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine.sh' }] }] }, model: 'x' };
  const adapter = JSON.parse(readFileSync(join(REPO, 'adapters/claude/settings.json'), 'utf8'));
  const first = mergeHooks(mine, adapter);
  assert.equal(first.settings.hooks.PreToolUse.length, 2);
  assert.equal(first.settings.model, 'x');
  assert.equal(mergeHooks(first.settings, adapter).added, 0);
});

test('install follows an AGENTS.md -> CLAUDE.md symlink and is idempotent', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n');
  symlinkSync('CLAUDE.md', join(dir, 'AGENTS.md'));
  const quiet = () => {};
  install(dir, { log: quiet });
  install(dir, { log: quiet });
  const doc = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  assert.equal((doc.match(/agent-economy:start/g) || []).length, 1);
  const settings = JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.match(readFileSync(join(dir, '.codex/config.toml'), 'utf8'), /hooks = true/);
  readFileSync(join(dir, '.agent-economy/hooks/guard.mjs'));
  readFileSync(join(dir, '.opencode/plugin/agent-economy.js'));
});

test('install --lang es writes the Spanish block; unknown language fails', () => {
  const dir = tmp();
  install(dir, { lang: 'es', harnesses: [], log: () => {} });
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /Economía de agentes/);
  assert.throws(() => install(tmp(), { lang: 'xx', log: () => {} }), /no policy/);
});

test('dry run writes nothing', () => {
  const dir = tmp();
  install(dir, { dryRun: true, log: () => {} });
  assert.throws(() => readFileSync(join(dir, 'AGENTS.md')));
});
