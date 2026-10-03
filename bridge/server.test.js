// Drives the bridge over HTTP with a recording `exec`, so nothing runs on the Mac.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hotkeyScript, parseHush } from './actions.js';
import { defaultDeck, validateDeck } from './deck.js';
import { serve } from './server.js';

function harness() {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const script = args[1] ?? '';
    if (cmd === 'osascript' && script.startsWith('set s to get volume')) return '44,false,60';
    if (cmd === 'osascript' && script.startsWith('input volume')) return '60';
    if (cmd === '/bin/zsh' && args[1]?.startsWith('lsappinfo')) return '"LSDisplayName"="zoom.us"';
    if (args[0] === 'status') return JSON.stringify({ status: 'connected', battery: 30, anc: { level: 7 } });
    if (cmd === 'shortcuts') return 'Morning\nFocus';
    return '';
  };
  const dir = mkdtempSync(join(tmpdir(), 'helm-'));
  const hushCli = join(dir, 'hush');
  writeFileSync(hushCli, '');
  return { calls, exec, dir, hushCli };
}

async function start(t) {
  const h = harness();
  const server = await serve({ port: 0, exec: h.exec, hushCli: h.hushCli, supportDir: h.dir, name: 'Mac mini' });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let token = '';
  const call = async (method, path, body, auth = `Bearer ${token}`) => {
    const r = await fetch(base + path, { method, headers: { authorization: auth }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  // Pair like the iPad does: start, read the code from the notification, exchange it for a token.
  await call('POST', '/pair/start');
  const code = h.calls.findLast(c => c[0] === 'osascript' && /display notification/.test(c[2]))[3];
  token = (await call('POST', '/pair', { code, device: 'test iPad' })).body.token;
  const run = (action, id) => call('POST', '/run', { action, id });
  return { ...h, call, run };
}

test('pairing: code exchange, wrong guesses, token required', async t => {
  const { call, calls } = await start(t);
  assert.equal((await call('GET', '/deck')).status, 200);
  assert.equal((await call('GET', '/deck', null, 'Bearer nope')).status, 401);
  assert.equal((await call('GET', '/deck', null, '')).status, 401);
  assert.deepEqual((await call('GET', '/hello', null, '')).body, { app: 'helm', name: 'Mac mini' });

  assert.equal((await call('POST', '/pair', { code: '000000' }, '')).status, 400, 'no pairing in progress');
  await call('POST', '/pair/start', null, '');
  const code = calls.findLast(c => /display notification/.test(c[2] ?? ''))[3];
  const wrong = code === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/pair', { code: wrong }, '')).status, 400);
  assert.equal((await call('POST', '/pair', { code }, '')).status, 400, 'burned after 5 wrong guesses');

  await call('POST', '/pair/start', null, '');
  const code2 = calls.findLast(c => /display notification/.test(c[2] ?? ''))[3];
  const r = await call('POST', '/pair', { code: code2, device: 'second iPad' }, '');
  assert.equal((await call('GET', '/deck', null, `Bearer ${r.body.token}`)).status, 200);
  assert.equal((await call('POST', '/pair', { code: code2 }, '')).status, 400, 'codes are single-use');
});

test('serves, validates and saves the deck', async t => {
  const { call } = await start(t);
  const deck = (await call('GET', '/deck')).body;
  assert.equal(deck.pages[0].id, 'main');
  deck.pages[0].name = 'Home';
  assert.equal((await call('PUT', '/deck', deck)).status, 200);
  assert.equal((await call('GET', '/deck')).body.pages[0].name, 'Home');
  assert.equal((await call('PUT', '/deck', { ...deck, grid: { cols: 40, rows: 1 } })).status, 400);
  assert.equal((await call('PUT', '/deck', { ...deck, pages: [{ id: 'x', keys: { 0: { action: { type: 'rm' } } } }] })).status, 400);
});

test('runs each action type as the right command', async t => {
  const { run, calls } = await start(t);
  const last = () => calls.at(-1);

  await run({ type: 'hotkey', key: 'a', mods: ['cmd', 'shift'] });
  assert.equal(last()[0], 'osascript');
  assert.match(last()[2], /keystroke \(item 1 of argv\) using \{command down, shift down\}/);
  assert.equal(last()[3], 'a');

  await run({ type: 'open', target: 'Safari' });
  assert.deepEqual(last(), ['open', '-a', 'Safari']);
  await run({ type: 'open', target: 'https://example.com' });
  assert.deepEqual(last(), ['open', 'https://example.com']);

  await run({ type: 'text', text: 'مرحبا "quoted"' });
  assert.equal(last()[3], 'مرحبا "quoted"'); // passed as argv, not spliced into the script

  await run({ type: 'shortcut', name: 'Morning' });
  assert.deepEqual(last(), ['shortcuts', 'run', 'Morning']);
  await run({ type: 'script', command: 'echo hi' });
  assert.deepEqual(last(), ['/bin/zsh', '-lc', 'echo hi']);
  await run({ type: 'volume', change: 6 });
  assert.match(last()[2], /\+ 6\)$/);
  await run({ type: 'system', what: 'sleep-display' });
  assert.deepEqual(last(), ['pmset', 'displaysleepnow']);

  await run({ type: 'mic' });
  assert.match(last()[2], /set volume input volume 0/);

  await run({ type: 'hush', cmd: 'anc/10' });
  assert.deepEqual(last().slice(1), ['anc', '10']);
  assert.equal((await run({ type: 'hush', cmd: 'anc/99' })).status, 400);
  assert.equal((await run({ type: 'system', what: 'reboot' })).status, 400);

  const n = calls.length;
  await run({ type: 'page', page: 'zoom' });
  assert.equal(calls.length, n, 'navigation runs nothing on the Mac');
});

test('multi runs steps in order; toggle alternates per key', async t => {
  const { run, calls } = await start(t);
  await run({ type: 'multi', delayMs: 1, steps: [{ type: 'open', target: 'Notes' }, { type: 'hush', cmd: 'anc/0' }] });
  assert.deepEqual(calls.slice(-2).map(c => c.slice(-1)[0]), ['Notes', '0']);

  const toggle = { type: 'toggle', on: { type: 'hush', cmd: 'anc/10' }, off: { type: 'hush', cmd: 'anc/5' } };
  let r = await run(toggle, 'zoom/6');
  assert.equal(calls.at(-1).at(-1), '10');
  assert.equal(r.body.toggles['zoom/6'], true);
  r = await run(toggle, 'zoom/6');
  assert.equal(calls.at(-1).at(-1), '5');
  assert.equal(r.body.toggles['zoom/6'], false);
});

test('state reports Mac, front app and headphones', async t => {
  const { call } = await start(t);
  const s = (await call('GET', '/state')).body;
  assert.deepEqual(s.mac, { volume: 44, muted: false, micMuted: false, app: 'zoom.us' });
  assert.equal(s.headphones.battery, 30);
  assert.deepEqual((await call('GET', '/shortcuts')).body, ['Morning', 'Focus']);
});

test('helpers', () => {
  assert.doesNotThrow(() => validateDeck(defaultDeck()));
  assert.match(hotkeyScript('Return', ['cmd']), /key code 36 using \{command down\}/);
  assert.deepEqual(parseHush('eq/bass/-3'), ['eq', 'bass', '-3']);
  for (const bad of ['anc/11', 'switch/a/b', 'rm/-rf', '']) assert.equal(parseHush(bad), null);
});
