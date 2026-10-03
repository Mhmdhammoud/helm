// Drives the bridge over HTTP with a recording `exec`, so nothing runs on the Mac.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { appIcon, dimmable, hotkeyScript, makeRunner, parseHush } from './actions.js';
import { cpuLoad, macBattery, memoryUsed } from './features.js';
import { defaultDeck, saveDeck, validateDeck } from './deck.js';
import { makeOsa } from './runner.js';
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
    if (cmd === 'pgrep') return '4242';
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
  const hushState = join(dir, 'hush-state.json');
  writeFileSync(hushState, JSON.stringify({ status: 'connected', battery: 30, anc: { level: 7 } }));
  const h = { calls, exec, dir, hushState, volume: 44 };
  return h;
}

async function start(t, opts = {}) {
  const h = harness();
  // Each clock read moves 6s on, so back-to-back pairing starts in a test aren't throttled.
  let clock = Date.now();
  const server = await serve({ port: 0, exec: h.exec, hushState: [h.hushState], supportDir: h.dir, name: 'Mac mini', watch: false, now: () => (clock += 6000), notifier: '', ...opts });
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

test('the Mission Control shortcut opens Mission Control (macOS ignores a synthetic ctrl-up)', async t => {
  const { run, calls } = await start(t);
  await run({ type: 'hotkey', key: 'up', mods: ['ctrl'] });
  assert.deepEqual(calls.at(-1), ['open', '-a', 'Mission Control']);
});

test('widgets: the system widget samples all Mac stats, weather comes from Open-Meteo for the key\'s place', async t => {
  const urls = [];
  const fetch = async url => {
    urls.push(url);
    const body = url.includes('geocoding')
      ? { results: [{ name: 'Paris', latitude: 48.85, longitude: 2.35 }] }
      : { current: { temperature_2m: 17.6, weather_code: 3, is_day: 1 }, daily: { temperature_2m_max: [21.2], temperature_2m_min: [11.4] } };
    return { ok: true, json: async () => body };
  };
  const { call } = await start(t, { fetch });
  const deck = (await call('GET', '/deck')).body;
  deck.pages[0].keys = { 0: { title: 'Weather', action: { type: 'open', target: 'Weather' }, live: 'weather', place: 'Paris', span: { w: 2, h: 1 } }, 2: { action: { type: 'open', target: 'Activity Monitor' }, live: 'system' } };
  assert.equal((await call('PUT', '/deck', deck)).status, 200);
  const s = (await call('GET', '/state')).body;
  assert.deepEqual(s.weather, { place: 'Paris', temp: 18, code: 3, day: true, hi: 21, lo: 11 });
  assert.equal(typeof s.cpu, 'number');
  assert.equal(typeof s.memory, 'number');
  assert.ok(s.macBattery);
  assert.match(urls[0], /name=Paris/);
  await call('GET', '/state');
  assert.equal(urls.length, 2, 'the forecast is cached');
  deck.pages[0].keys[0].span = { w: 9, h: 1 };
  assert.equal((await call('PUT', '/deck', deck)).status, 400, 'span is bounded');
});

test('storage lists the Mac\'s disk first, with free space under total', async () => {
  const { drives } = await import('./features.js');
  const list = await drives();
  assert.ok(list.length >= 1);
  assert.ok(list[0].total > list[0].free && list[0].free > 0);
});

test('brightness is offered only when a screen can take it', () => {
  assert.equal(dimmable('XMO G340-CWQB:\n  Main Display: Yes\n  Connection Type: DisplayPort'), false);
  assert.equal(dimmable('Color LCD:\n  Display Type: Built-in Liquid Retina XDR Display\n  Connection Type: Internal'), true);
  assert.equal(dimmable('Studio Display:\n  Main Display: Yes'), true);
  assert.equal(dimmable('Apple M4:\n  Bus: Built-In\nDisplays:\n  XMO G340-CWQB:\n    Main Display: Yes'), false, 'the GPU line is not a screen');
});

test('thermal: the sensors helper is built once and its reading reported', async () => {
  const h = harness();
  const exec = async (cmd, args) => {
    if (cmd === 'swiftc') { h.calls.push([cmd, ...args]); return writeFileSync(args.at(-1), ''); }
    if (cmd.endsWith('bin/sensors1')) return '{"cpu":77.7,"fans":[{"rpm":1673,"min":1000,"max":4900}]}';
    return h.exec(cmd, args);
  };
  saveDeck(join(h.dir, 'deck.json'), { grid: { cols: 2, rows: 1 }, pages: [{ id: 'a', keys: { 0: { action: { type: 'open', target: 'x' }, live: 'thermal' } } }] });
  const { makeFeatures } = await import('./features.js');
  const f = makeFeatures({ exec, supportDir: h.dir, deckFile: join(h.dir, 'deck.json') });
  assert.deepEqual((await f.state()).thermal, { cpu: 78, fans: [{ rpm: 1673, min: 1000, max: 4900 }] });
  assert.equal(h.calls.filter(c => c[0] === 'swiftc' && /sensors\.swift$/.test(c[2])).length, 1);
});

test('pairing: the code is posted through Helm Bridge when there is one, AppleScript if that fails', async t => {
  const h = harness();
  let allowed = true;
  const exec = async (cmd, args) => {
    if (args[0] === '--notify') { h.calls.push([cmd, ...args]); if (!allowed) throw new Error('not allowed'); return ''; }
    return h.exec(cmd, args);
  };
  const server = await serve({ port: 0, exec, hushState: [h.hushState], supportDir: h.dir, watch: false, notifier: '/x/helm-bridge', now: (() => { let c = 0; return () => (c += 6000); })() });
  t.after(() => server.close());
  const pairStart = async () => { await fetch(`http://127.0.0.1:${server.address().port}/pair/start`, { method: 'POST' }); await new Promise(r => setTimeout(r, 10)); };
  await pairStart();
  assert.deepEqual(h.calls.map(c => c[0]), ['/x/helm-bridge']);
  assert.match(h.calls[0][3], /^Enter \d{6} on your iPad$/);
  allowed = false;
  await pairStart();
  assert.deepEqual(h.calls.slice(1).map(c => c[0]), ['/x/helm-bridge', 'osascript']);
});

test('pairing: new codes are throttled and 15 wrong guesses lock pairing for 15 minutes', async t => {
  let clock = 1e12;
  const { call, calls } = await start(t, { now: () => clock });
  clock += 6000;
  const startCode = async () => { clock += 6000; await call('POST', '/pair/start', null, ''); return calls.findLast(c => /display notification/.test(c[2] ?? ''))[3]; };
  await startCode();
  assert.equal((await call('POST', '/pair/start', null, '')).status, 400, 'a second code within 5s is refused');
  for (let round = 0; round < 3; round++) {
    const code = await startCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await call('POST', '/pair', { code: wrong }, '');
  }
  const code = await startCode().catch(() => null);
  assert.equal(code, calls.findLast(c => /display notification/.test(c[2] ?? ''))?.[3], 'no new code was issued');
  const r = await call('POST', '/pair/start', null, '');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /paused for 15 minutes/);
  clock += 15 * 60_000 + 1;
  assert.equal((await call('POST', '/pair/start', null, '')).status, 200, 'unlocks after 15 minutes');
});

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
  assert.match(last()[0], /bin\/mediakey3$/);
  assert.equal(last()[1], '0', 'volume up is a real volume key, so the HUD shows');
  await run({ type: 'system', what: 'sleep-display' });
  assert.deepEqual(last(), ['pmset', 'displaysleepnow']);

  await run({ type: 'mic' });
  assert.match(last()[2], /set volume input volume 0/);

  await run({ type: 'hush', cmd: 'anc/10' });
  assert.deepEqual(last(), ['open', '-g', '-b', 'app.hush.macos', 'hush://anc/10']);
  assert.equal((await run({ type: 'hush', cmd: 'anc/99' })).status, 400);
  assert.equal((await run({ type: 'system', what: 'reboot' })).status, 400);

  const n = calls.length;
  await run({ type: 'page', page: 'zoom' });
  assert.equal(calls.length, n, 'navigation runs nothing on the Mac');
});

test('multi runs steps in order; toggle alternates per key', async t => {
  const { run, calls } = await start(t);
  await run({ type: 'multi', delayMs: 1, steps: [{ type: 'open', target: 'Notes' }, { type: 'hush', cmd: 'anc/0' }] });
  assert.deepEqual(calls.slice(-2).map(c => c.slice(-1)[0]), ['Notes', 'hush://anc/0']);

  const toggle = { type: 'toggle', on: { type: 'hush', cmd: 'anc/10' }, off: { type: 'hush', cmd: 'anc/5' } };
  let r = await run(toggle, 'zoom/6');
  assert.equal(calls.at(-1).at(-1), 'hush://anc/10');
  assert.equal(r.body.toggles['zoom/6'], true);
  r = await run(toggle, 'zoom/6');
  assert.equal(calls.at(-1).at(-1), 'hush://anc/5');
  assert.equal(r.body.toggles['zoom/6'], false);
});

test('state reports Mac, front app and headphones', async t => {
  const { call } = await start(t);
  const s = (await call('GET', '/state')).body;
  assert.deepEqual(s.mac, { volume: 44, muted: false, micMuted: false, app: 'zoom.us', dimmable: false });
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
  assert.deepEqual(first.state.mac, { volume: 44, muted: false, micMuted: false, app: 'zoom.us', dimmable: false });
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
    if (cmd.endsWith('bin/mediakey3')) { await new Promise(r => setTimeout(r, 2)); return ''; }
    if (cmd === 'osascript' && args[1].startsWith('output volume')) return String(current);
    return '';
  };
  const keys = () => calls.filter(c => c[0].endsWith('bin/mediakey3')).map(c => c[1]);
  const r = makeRunner({ exec, supportDir: dir });

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
  const r2 = makeRunner({ exec, supportDir: dir2 });
  await r2.run({ type: 'volume', change: 6 }, 'k');
  assert.match(calls.at(-1)[2], /\+ 6\)$/, 'no helper: osascript as before');
  await r2.run({ type: 'volume', mute: 'toggle' }, 'k');
  assert.match(calls.at(-1)[2], /output muted/);
  assert.equal(calls.filter(c => c[0] === 'swiftc').length, 1, 'a failed compile is not retried');
});

// A fake long-lived osascript for makeOsa: `reply(cmd)` answers each command line (or returns undefined to hang).
function fakeOsa({ reply = c => ({ id: c.id, ok: true, out: `ran ${c.script}` }), crashOn } = {}) {
  const procs = [], exec = [], lines = [];
  let busy = 0, maxBusy = 0;
  const spawn = (cmd, args) => {
    assert.deepEqual([cmd, args[0], args[1]], ['osascript', '-l', 'JavaScript']);
    const p = new EventEmitter();
    p.stdout = new PassThrough();
    p.killed = false;
    p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit', null, 'SIGTERM')); };
    p.stdin = new Writable({
      write(chunk, _, done) {
        const line = chunk.toString();
        lines.push(line);
        const c = JSON.parse(line);
        maxBusy = Math.max(maxBusy, ++busy);
        if (crashOn?.(c)) { busy--; setImmediate(() => p.emit('exit', null, 'SIGSEGV')); return done(); }
        const r = reply(c);
        if (r) setTimeout(() => { busy--; p.stdout.write(`${JSON.stringify(r)}\n`); }, 2);
        done();
      },
    });
    procs.push(p);
    return p;
  };
  const execFn = async (cmd, args) => { exec.push([cmd, ...args]); return 'one-shot'; };
  return { spawn, exec: execFn, procs, execCalls: exec, lines, maxBusy: () => maxBusy };
}

test('runner: command roundtrip over one process, script errors are not retried', async () => {
  const f = fakeOsa({ reply: c => (c.script === 'bad' ? { id: c.id, ok: false, error: 'syntax error' } : { id: c.id, ok: true, out: c.args.join('|') }) });
  const osa = makeOsa({ exec: f.exec, spawn: f.spawn });
  assert.equal(await osa('s', ['مرحبا', 'b']), 'مرحبا|b');
  assert.match(f.lines[0], /^[\x00-\x7e]*\n$/, 'the wire is ASCII-only');
  await assert.rejects(osa('bad'), /syntax error/);
  assert.equal(await osa('s', [1, 2]), '1|2', 'args become strings');
  assert.equal(f.procs.length, 1, 'one process for everything');
  assert.equal(f.execCalls.length, 0, 'no one-shot osascript');
});

test('runner: a crash mid-command is reported (never run twice), then a fresh process takes over', async () => {
  let crashes = 1;
  const f = fakeOsa({ crashOn: () => crashes-- > 0 });
  const osa = makeOsa({ exec: f.exec, spawn: f.spawn });
  await assert.rejects(osa('hotkey', ['a']), /may not have run/);
  assert.deepEqual(f.execCalls, [], 'not retried: the keystroke may already have happened');
  assert.equal(await osa('again'), 'ran again');
  assert.equal(f.procs.length, 2, 'restarted');
});

test('runner: a hung command times out and is killed, not retried', async () => {
  let hang = true;
  const f = fakeOsa({ reply: c => (hang ? ((hang = false), undefined) : { id: c.id, ok: true, out: 'fast' }) });
  const osa = makeOsa({ exec: f.exec, spawn: f.spawn, timeoutMs: 20 });
  const t0 = Date.now();
  await assert.rejects(osa('slow'), /timed out/);
  assert.ok(Date.now() - t0 < 500);
  assert.ok(f.procs[0].killed, 'the stuck process is killed');
  assert.deepEqual(f.execCalls, []);
  assert.equal(await osa('next'), 'fast');
  assert.equal(f.procs.length, 2);
});

test('runner: commands run one at a time, in order, even across a crash', async () => {
  const f = fakeOsa({ crashOn: c => c.script === 'b' });
  const osa = makeOsa({ exec: f.exec, spawn: f.spawn });
  const done = [];
  await Promise.all(['a', 'b', 'c', 'd'].map(s => osa(s).then(out => done.push([s, out]), () => done.push([s, 'failed']))));
  assert.deepEqual(done, [['a', 'ran a'], ['b', 'failed'], ['c', 'ran c'], ['d', 'ran d']]);
  assert.deepEqual(f.lines.map(l => JSON.parse(l).script), ['a', 'b', 'c', 'd']);
  assert.equal(f.maxBusy(), 1, 'never more than one command in flight');
});

test('makeRunner sends AppleScript through an injected osa', async () => {
  const calls = [];
  const r = makeRunner({ exec: async () => '', supportDir: mkdtempSync(join(tmpdir(), 'helm-')), osa: async (s, a) => (calls.push([s, ...a]), s.startsWith('input volume') ? '60' : '') });
  await r.run({ type: 'hotkey', key: 'a', mods: ['cmd'] }, 'k');
  await r.run({ type: 'mic' }, 'k');
  assert.match(calls[0][0], /keystroke/);
  assert.equal(calls[0][1], 'a');
  assert.deepEqual(calls.slice(1).map(c => c[0]), ['input volume of (get volume settings)', 'set volume input volume 0']);
});
