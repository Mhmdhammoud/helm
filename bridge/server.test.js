// Drives the bridge over HTTP with a recording `exec`, so nothing runs on the Mac.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { appIcon, hotkeyScript, makeRunner, parseHush } from './actions.js';
import { cpuLoad, macBattery, memoryUsed } from './features.js';
import { defaultDeck, saveDeck, validateDeck } from './deck.js';
import { serve } from './server.js';

function harness() {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const script = args[1] ?? '';
    if (cmd === 'osascript' && script.startsWith('set s to get volume')) return `${h.volume},false,60`;
    if (cmd === '/bin/zsh' && args[1] === 'sleep forever') return new Promise(() => {});
    if (cmd === 'osascript' && script.startsWith('input volume')) return '60';
    if (cmd === '/bin/zsh' && args[1]?.startsWith('lsappinfo')) return '"LSDisplayName"="zoom.us"';
    if (args[0] === 'status') return JSON.stringify({ status: 'connected', battery: 30, anc: { level: 7 } });
    if (cmd === 'shortcuts') return 'Morning\nFocus';
    if (cmd === 'ps') return 'launchd\n   Spotify\nzsh';
    if (cmd === 'osascript' && script.startsWith('tell application "Spotify"')) return 'paused\tSong\tBand\tspotify:track:1\thttps://i.scdn.co/image/x';
    if (cmd === 'osascript' && script.startsWith('tell application "Music"')) throw new Error('Music must not be asked when not running');
    if (cmd === 'osascript' && args[3]?.includes('runningApplications')) return '[{"name":"Safari","path":"/Applications/Safari.app"}]';
    if (cmd === 'sips') writeFileSync(args.at(-1), 'png');
    if (cmd === 'vm_stat') return 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages active: 100000.\nPages wired down: 50000.\nPages occupied by compressor: 50000.';
    if (cmd === 'pmset' && args[0] === '-g') return "Now drawing from 'AC Power'";
    return '';
  };
  const dir = mkdtempSync(join(tmpdir(), 'helm-'));
  const hushCli = join(dir, 'hush');
  writeFileSync(hushCli, '');
  const h = { calls, exec, dir, hushCli, volume: 44 };
  return h;
}

async function start(t, opts = {}) {
  const h = harness();
  const server = await serve({ port: 0, exec: h.exec, hushCli: h.hushCli, supportDir: h.dir, name: 'Mac mini', watch: false, ...opts });
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
  return { ...h, h, call, run, base, token: () => token };
}

test('pairing: code exchange, wrong guesses, token required', async t => {
  const { call, calls } = await start(t);
  assert.equal((await call('GET', '/deck')).status, 200);
  assert.equal((await call('GET', '/deck', null, 'Bearer nope')).status, 401);
  assert.equal((await call('GET', '/deck', null, '')).status, 401);
  const hello = (await call('GET', '/hello', null, '')).body;
  assert.deepEqual({ ...hello, id: undefined }, { app: 'helm', name: 'Mac mini', id: undefined });
  assert.match(hello.id, /^[0-9a-f]{16}$/);

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
  assert.equal(r.body.id, hello.id, '/pair returns the bridge id too');
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
  assert.match(last()[0], /bin\/mediakey$/);
  assert.equal(last()[1], '0', 'volume up is a real volume key, so the HUD shows');
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

test('live Mac info: only sources the deck uses, now playing never launches a player', async t => {
  const { call, calls, dir, base, token } = await start(t);
  const plain = (await call('GET', '/state')).body;
  assert.equal(plain.nowPlaying, undefined, 'default deck uses none of them');
  assert.equal(calls.filter(c => ['ps', 'vm_stat'].includes(c[0])).length, 0);

  const deck = defaultDeck();
  deck.pages.push({ id: 'now', name: 'Now', keys: Object.fromEntries(['nowplaying', 'cpu', 'memory', 'macbattery', 'clock'].map((live, i) => [i, { live, action: { type: 'media', key: 'play' } }])) });
  saveDeck(join(dir, 'deck.json'), deck);
  const s = (await call('GET', '/state')).body;
  assert.equal(s.nowPlaying.title, 'Song');
  assert.equal(s.nowPlaying.artist, 'Band');
  assert.equal(s.nowPlaying.playing, false);
  assert.equal(s.nowPlaying.app, 'Spotify');
  assert.match(s.nowPlaying.art, /^[0-9a-f]{12}$/);
  assert.ok(s.cpu >= 0 && s.cpu <= 100);
  assert.equal(s.memory, Math.round((100 * 16384 * 200000) / (await import('node:os')).totalmem()));
  assert.deepEqual(s.macBattery, { percent: null, charging: false, ac: true });
  assert.ok(calls.some(c => c[0] === 'curl' && c.at(-1) === 'https://i.scdn.co/image/x'));

  // Sampled at most every 2s, and the artwork is fetched once per track.
  const n = calls.length;
  await call('GET', '/state');
  assert.equal(calls.filter((c, i) => i >= n && c[0] === 'ps').length, 0);
  assert.equal(calls.filter(c => c[0] === 'curl').length, 1);

  const art = await fetch(`${base}/artwork?v=${s.nowPlaying.art}`, { headers: { authorization: `Bearer ${token()}` } });
  assert.equal(art.status, 200);
  assert.equal(art.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/artwork`)).status, 401);
});

test('running apps, brightness keys, hold actions and page kinds', async t => {
  const { call, run, calls, dir } = await start(t);
  assert.deepEqual((await call('GET', '/running')).body, [{ name: 'Safari', path: '/Applications/Safari.app' }]);
  await run({ type: 'open', target: '/Applications/Safari.app' });
  assert.deepEqual(calls.at(-1), ['open', '/Applications/Safari.app']);

  await run({ type: 'media', key: 'brightness-up' });
  assert.equal(calls.at(-1).at(-1), '2');
  await run({ type: 'media', key: 'brightness-down' });
  assert.equal(calls.at(-1).at(-1), '3');
  assert.equal((await run({ type: 'media', key: 'toString' })).status, 400);

  const deck = defaultDeck();
  deck.pages[0].keys[0].hold = { type: 'open', target: 'Notes' };
  assert.equal((await call('PUT', '/deck', deck)).status, 200);
  deck.pages[0].keys[0].hold = { type: 'rm' };
  assert.equal((await call('PUT', '/deck', deck)).status, 400, 'hold actions are validated');
  delete deck.pages[0].keys[0].hold;
  deck.pages.push({ id: 'apps', name: 'Apps', kind: 'running', keys: {} });
  assert.equal((await call('PUT', '/deck', deck)).status, 200);
  deck.pages.at(-1).kind = 'weird';
  assert.equal((await call('PUT', '/deck', deck)).status, 400);

  await appIcon('/Applications/Visual Studio Code.app', dir, async (...c) => calls.push(c));
  assert.match(calls.at(-1)[1].at(-2), /^\/Applications\/Visual Studio Code\.app$/);
  assert.match(calls.at(-1)[1].at(-1), /icons\/Visual Studio Code\.png$/);
});

test('stat parsers', () => {
  const core = (idle, busy) => ({ times: { user: busy, nice: 0, sys: 0, irq: 0, idle } });
  assert.equal(cpuLoad([core(100, 100)], [core(150, 250)]), 75);
  assert.equal(memoryUsed('page size of 4096 bytes\nPages active: 10.\nPages wired down: 10.\nPages occupied by compressor: 5.', 4096 * 100), 25);
  assert.deepEqual(macBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t42%; discharging; 3:10 remaining present: true"), { percent: 42, charging: false, ac: false });
  assert.deepEqual(macBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t99%; charging; 0:10 remaining"), { percent: 99, charging: true, ac: true });
});

// A WebSocket client on /live that queues messages, so a test can wait for the one it wants.
function live(t, base, token) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/live`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  const seen = [];
  let wake = () => {};
  ws.onmessage = e => { seen.push(JSON.parse(e.data)); wake(); };
  ws.onclose = e => { seen.push({ closed: e.code }); wake(); };
  t.after(() => ws.close());
  const next = pred => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no matching message; got ${JSON.stringify(seen)}`)), 2000);
    const check = () => {
      const i = seen.findIndex(pred);
      if (i < 0) return void (wake = check);
      clearTimeout(timer);
      resolve(seen.splice(0, i + 1).at(-1));
    };
    check();
  });
  return { ws, next };
}

test('live push: initial state, changes only, key press echo, heartbeat', async t => {
  const { h, run, base, token } = await start(t, { pollMs: 20, heartbeatMs: 40 });
  const { next } = live(t, base, token());
  const first = await next(() => true);
  assert.equal(first.t, 'state');
  assert.deepEqual(first.state.mac, { volume: 44, muted: false, micMuted: false, app: 'zoom.us' });
  assert.equal(first.state.headphones.battery, 30);
  assert.deepEqual(first.state.toggles, {});

  h.volume = 50; // changed on the Mac
  const change = await next(m => m.state?.mac);
  assert.deepEqual(Object.keys(change.state), ['mac'], 'only the key that changed is sent');
  assert.equal(change.state.mac.volume, 50);

  const toggle = { type: 'toggle', on: { type: 'hush', cmd: 'anc/10' }, off: { type: 'hush', cmd: 'anc/5' } };
  await run(toggle, 'main/1');
  assert.deepEqual((await next(m => m.state?.toggles)).state.toggles, { 'main/1': true });

  assert.deepEqual(await next(m => m.t === 'hb'), { t: 'hb' });
});

test('live push: token required, and dropped when the iPad is unpaired', async t => {
  const { dir, base, token } = await start(t, { heartbeatMs: 30 });
  assert.equal((await live(t, base, 'nope').next(m => m.closed)).closed, 1006, 'upgrade refused');
  assert.equal((await live(t, base, '').next(m => m.closed)).closed, 1006);

  const { next } = live(t, base, token());
  await next(m => m.t === 'state');
  writeFileSync(join(dir, 'tokens.json'), '{}'); // node server.js --unpair-all
  assert.equal((await next(m => m.closed)).closed, 4001);
});

test('run answers before a slow action finishes; bridge id survives a restart', async t => {
  const { run, dir, call } = await start(t, { runWaitMs: 20 });
  const t0 = Date.now();
  const r = await run({ type: 'script', command: 'sleep forever' });
  assert.equal(r.status, 200);
  assert.equal(r.body.pending, true);
  assert.ok(Date.now() - t0 < 500);
  assert.equal((await run({ type: 'nope' })).status, 400, 'quick failures are still reported');

  const id = (await call('GET', '/hello', null, '')).body.id;
  const again = await serve({ port: 0, supportDir: dir, watch: false });
  t.after(() => again.close());
  const hello = await (await fetch(`http://127.0.0.1:${again.address().port}/hello`)).json();
  assert.equal(hello.id, id);
});

test('volume uses the real volume keys (HUD), latest-wins, osascript fallback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'helm-'));
  let current = 50, failCompile = false;
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'swiftc') { if (failCompile) throw new Error('no swiftc'); return writeFileSync(args.at(-1), ''); }
    if (cmd.endsWith('bin/mediakey')) { await new Promise(r => setTimeout(r, 2)); return ''; }
    if (cmd === 'osascript' && args[1].startsWith('output volume')) return String(current);
    return '';
  };
  const keys = () => calls.filter(c => c[0].endsWith('bin/mediakey')).map(c => c[1]);
  const r = makeRunner({ exec, hushCli: '/x', supportDir: dir });

  await r.run({ type: 'volume', change: -6 }, 'k');
  await r.run({ type: 'volume', mute: 'toggle' }, 'k');
  assert.deepEqual(keys(), ['1', '7']);
  assert.equal(calls.filter(c => c[0] === 'swiftc').length, 1, 'helper compiled once');

  calls.length = 0;
  await r.run({ type: 'volume', set: 75 }, 'dial'); // 50 → 75 = 4 steps of 6.25
  assert.deepEqual(keys(), ['0', '0', '0', '0']);
  calls.length = 0;
  await r.run({ type: 'volume', set: 100 }, 'dial'); // 50 → 100 = 8 steps, capped at 16
  assert.equal(keys().length, 8);
  calls.length = 0;
  await r.run({ type: 'volume', set: 0 }, 'dial');
  assert.deepEqual(new Set(keys()), new Set(['1']));
  assert.equal(keys().length, 8);

  calls.length = 0;
  current = 50;
  await r.run({ type: 'volume', set: 52 }, 'dial'); // under one step: set silently
  assert.equal(keys().length, 0);
  assert.match(calls.at(-1)[2], /set volume output volume 52/);
  calls.length = 0;
  current = 76;
  await r.run({ type: 'volume', set: 50 }, 'dial'); // off-grid: the first press only snaps 76 → 75
  assert.equal(keys().length, 5);

  calls.length = 0;
  current = 0;
  const old = r.run({ type: 'volume', set: 100 }, 'dial');
  await new Promise(res => setTimeout(res, 5));
  await Promise.all([old, r.run({ type: 'volume', set: 0 }, 'dial')]);
  assert.ok(keys().filter(k => k === '0').length < 16, 'the older dial turn was abandoned');

  const dir2 = mkdtempSync(join(tmpdir(), 'helm-'));
  failCompile = true;
  calls.length = 0;
  const r2 = makeRunner({ exec, hushCli: '/x', supportDir: dir2 });
  await r2.run({ type: 'volume', change: 6 }, 'k');
  assert.match(calls.at(-1)[2], /\+ 6\)$/, 'no helper: osascript as before');
  await r2.run({ type: 'volume', mute: 'toggle' }, 'k');
  assert.match(calls.at(-1)[2], /output muted/);
  assert.equal(calls.filter(c => c[0] === 'swiftc').length, 1, 'a failed compile is not retried');
});
