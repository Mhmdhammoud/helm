#!/usr/bin/env node
// Helm bridge: the Mac side of the Helm iPad deck. Stores the deck, runs key actions, reports live state.
//   node bridge/server.js               serve on :7733 and advertise as _helm._tcp (Bonjour)
//   node bridge/server.js --install     run at login (LaunchAgent); --uninstall removes it
//   node bridge/server.js --unpair-all  forget every paired iPad
// The iPad finds this Mac over Bonjour and pairs with a 6-digit code shown here as a notification;
// after that every request carries that iPad's own bearer token. Live state is pushed over a WebSocket on /live.
// Anyone with the token can run scripts on this Mac, as with any Stream Deck: keep it on your own network.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { appIcon, listApps, makeRunner, realExec } from './actions.js';
import { BadRequest, loadDeck, saveDeck, validateDeck } from './deck.js';
import { makeFeatures } from './features.js';

const SUPPORT = process.env.HELM_SUPPORT_DIR || join(homedir(), 'Library/Application Support/Helm');
const PORT = Number(process.env.HELM_PORT ?? 7733);
const HUSH_CLI = process.env.HUSH_CLI || join(homedir(), 'Documents/projects/lab/hush/bin/hush');

// Paired iPads: sha256(token) → { device, pairedAt }. Tokens themselves are never stored.
const sha = t => createHash('sha256').update(t).digest('hex');
const loadTokens = file => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
function saveTokens(file, tokens) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(tokens, null, 2));
  chmodSync(file, 0o600);
}

const readBody = req => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 1_000_000) req.destroy(); });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

const sleep = ms => new Promise(r => setTimeout(r, ms).unref());

// Stable bridge id, so a paired iPad can find this Mac again after its address changes.
function bridgeId(supportDir) {
  const file = join(supportDir, 'id');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const id = randomBytes(8).toString('hex');
  mkdirSync(supportDir, { recursive: true });
  writeFileSync(file, id);
  return id;
}

// Minimal RFC 6455 server side: handshake plus unmasked frames out (1 text, 8 close, 9 ping).
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(op, data = '') {
  const payload = Buffer.from(data);
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n])
    : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x80 | op, 127]), Buffer.alloc(8)]);
  if (n >= 65536) head.writeBigUInt64BE(BigInt(n), 2);
  return Buffer.concat([head, payload]);
}
const closeFrame = (code, reason) => frame(8, Buffer.concat([Buffer.from([code >> 8, code & 255]), Buffer.from(reason)]));

// ponytail: volume/mic come from one long-lived JXA loop (~3% CPU) instead of spawning osascript 5x/s (~15%).
// It duplicates the volume read in actions.js macState(); move it there if that file grows a watcher.
// It exits by itself once orphaned (getppid() === 1), so a killed bridge never leaves it running.
const WATCH_JXA = `ObjC.import('unistd'); const a = Application.currentApplication(); a.includeStandardAdditions = true; let last = '';
while ($.getppid() !== 1) { const s = a.getVolumeSettings(); const l = [s.outputVolume, s.outputMuted, s.inputVolume].join(',');
  if (l !== last) { console.log(l); last = l; } delay(0.1); }`;
function watchVolume(onChange) {
  let p, stopped = false;
  const start = () => {
    p = spawn('osascript', ['-l', 'JavaScript', '-e', WATCH_JXA], { stdio: ['ignore', 'ignore', 'pipe'] });
    createInterface({ input: p.stderr }).on('line', l => {
      const [vol, muted, mic] = l.split(',');
      onChange({ volume: Number(vol), muted: muted === 'true', micMuted: Number(mic) === 0 });
    });
    p.on('exit', () => { if (!stopped) setTimeout(start, 1000).unref(); });
  };
  start();
  return () => { stopped = true; p.kill(); };
}

export function serve({
  port = PORT, exec = realExec, hushCli = HUSH_CLI, supportDir = SUPPORT, name = 'Mac',
  pollMs = 1000, heartbeatMs = 5000, runWaitMs = 250, watch = true,
} = {}) {
  const deckFile = join(supportDir, 'deck.json');
  const tokensFile = join(supportDir, 'tokens.json');
  const id = bridgeId(supportDir);
  const runner = makeRunner({ exec, hushCli, supportDir });
  const features = makeFeatures({ exec, supportDir, deckFile });
  const authed = h => /^Bearer .+/.test(h ?? '') && !!loadTokens(tokensFile)[sha(h.slice(7))];

  // One pairing code at a time, valid 2 minutes, burned after 5 wrong guesses.
  let pairing = null;
  const unauthed = {
    'GET /hello': () => ({ app: 'helm', name, id }),
    'POST /pair/start': async () => {
      pairing = { code: String(randomInt(0, 1e6)).padStart(6, '0'), expires: Date.now() + 120_000, tries: 0 };
      console.log(`pairing code: ${pairing.code}`);
      await exec('osascript', ['-e', 'on run argv\ndisplay notification ("Enter " & item 1 of argv & " on your iPad") with title "Helm pairing"\nend run', pairing.code]).catch(() => {});
      return { name };
    },
    'POST /pair': async req => {
      const { code, device } = await readBody(req);
      if (!pairing || Date.now() > pairing.expires) throw new BadRequest('no pairing in progress; start again');
      if (String(code) !== pairing.code) {
        if (++pairing.tries >= 5) pairing = null;
        throw new BadRequest('wrong code');
      }
      pairing = null;
      const t = randomBytes(32).toString('base64url');
      saveTokens(tokensFile, { ...loadTokens(tokensFile), [sha(t)]: { device: String(device ?? 'iPad').slice(0, 64), pairedAt: new Date().toISOString() } });
      return { token: t, name, id };
    },
  };
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  const headphones = () => existsSync(hushCli)
    ? exec(hushCli, ['status', '--json'], 15000).then(JSON.parse).catch(e => ({ status: 'unavailable', error: e.message }))
    : Promise.resolve(null);

  // Live push: each top-level state key (mac, headphones, toggles, live sources) is re-sent only when it changes.
  const clients = new Set();
  const snapshot = {};
  const sent = {};
  const broadcast = msg => { const f = frame(1, JSON.stringify(msg)); for (const c of clients) c.write(f); };
  const publish = (key, value) => {
    const json = JSON.stringify(value);
    snapshot[key] = value;
    if (sent[key] !== json) { sent[key] = json; broadcast({ t: 'state', state: { [key]: value } }); }
  };
  // Reads overlap (timer, key press, new client); an older, slower read never overwrites a newer one.
  let seq = 0;
  const newest = {};
  const poll = async (key, read) => {
    const s = ++seq;
    const v = await read();
    if (s > (newest[key] ?? 0)) { newest[key] = s; publish(key, v); }
  };
  let extraKeys = [];
  const refresh = () => Promise.all([
    poll('mac', () => runner.macState().catch(e => ({ error: e.message }))),
    poll('headphones', headphones),
    features.state().then(extra => {
      for (const k of extraKeys) if (!(k in extra)) publish(k, null); // the deck stopped using that source
      extraKeys = Object.keys(extra);
      for (const k of extraKeys) publish(k, extra[k]);
    }, () => {}),
  ]).then(() => publish('toggles', runner.toggles));

  let looping = false;
  async function hub() {
    if (looping) return;
    looping = true;
    const stopWatch = watch && watchVolume(v => { newest.mac = ++seq; publish('mac', { ...snapshot.mac, ...v }); });
    const beat = setInterval(() => {
      for (const c of clients) {
        if (!authed(c.auth)) { c.end(closeFrame(4001, 'unauthorized')); clients.delete(c); continue; }
        if (!c.alive) { c.destroy(); clients.delete(c); continue; } // no pong since the last beat
        c.alive = false;
        c.write(frame(9));
        c.write(frame(1, '{"t":"hb"}'));
      }
    }, heartbeatMs).unref();
    while (clients.size) {
      await sleep(pollMs);
      await refresh();
    }
    clearInterval(beat);
    if (stopWatch) stopWatch();
    looping = false;
  }

  const routes = {
    'GET /deck': () => loadDeck(deckFile),
    'PUT /deck': async req => saveDeck(deckFile, await readBody(req)),
    'POST /run': async req => {
      const { action, id } = await readBody(req);
      validateDeck({ grid: { cols: 2, rows: 1 }, pages: [{ id: 'run', keys: { 0: { action } } }] });
      const done = runner.run(action, String(id ?? 'run'));
      const echo = () => clients.size && refresh(); // push the effect at once instead of on the next poll
      done.then(echo, e => { console.log(`run ${action?.type}: ${e.message}`); echo(); });
      // Answer when the action finishes or after runWaitMs, whichever is first. Quick actions still report
      // their errors; slow ones (shortcuts, scripts, app launches) finish in the background and show up on /live.
      const finished = await Promise.race([done.then(() => true), sleep(runWaitMs).then(() => false)]);
      return finished ? { ok: true, toggles: runner.toggles } : { ok: true, pending: true, toggles: runner.toggles };
    },
    'GET /state': async () => {
      const [mac, hp, extra] = await Promise.all([runner.macState().catch(e => ({ error: e.message })), headphones(), features.state()]);
      return { mac, headphones: hp, toggles: runner.toggles, ...extra };
    },
    'GET /apps': () => listApps(),
    'GET /shortcuts': async () => (await exec('shortcuts', ['list'])).split('\n').filter(Boolean),
    'GET /running': () => features.running(),
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      const open = unauthed[`${req.method} ${url.pathname}`];
      if (open) return send(res, 200, await open(req));
      if (!authed(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/icon') {
        const file = await appIcon(url.searchParams.get('app') ?? '', supportDir, exec);
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400' });
        return createReadStream(file).pipe(res);
      }
      if (req.method === 'GET' && url.pathname === '/artwork') return features.artwork(res);
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) return send(res, 404, { error: 'not found' });
      send(res, 200, await route(req));
    } catch (e) {
      send(res, e instanceof BadRequest || e instanceof SyntaxError ? 400 : 500, { error: e.message });
    }
  });

  server.on('upgrade', async (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (new URL(req.url, 'http://x').pathname !== '/live' || !key) return socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    if (!authed(req.headers.authorization)) return socket.end('HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n');
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    Object.assign(socket, { auth: req.headers.authorization, alive: true });
    // Client frames carry nothing we need: any bytes (pong, text) prove it's alive, a close frame ends it.
    let buf = Buffer.alloc(0);
    socket.on('data', b => {
      socket.alive = true;
      buf = Buffer.concat([buf, b]);
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
        if (len === 127) return socket.destroy(); // nothing we accept is that big
        at += buf[1] & 0x80 ? 4 : 0; // mask key
        if (buf.length < at + len) return;
        if ((buf[0] & 0x0f) === 8) return socket.end(frame(8));
        buf = buf.subarray(at + len);
      }
    });
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => socket.destroy());
    await refresh();
    if (socket.destroyed) return;
    socket.write(frame(1, JSON.stringify({ t: 'state', state: snapshot })));
    clients.add(socket);
    hub();
  });
  return new Promise(resolve => server.listen(port, '0.0.0.0', () => resolve(server)));
}

const LAUNCH_AGENT = join(homedir(), 'Library/LaunchAgents/app.helm.bridge.plist');

async function install() {
  mkdirSync(dirname(LAUNCH_AGENT), { recursive: true });
  const log = join(SUPPORT, 'bridge.log');
  writeFileSync(LAUNCH_AGENT, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.helm.bridge</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${fileURLToPath(import.meta.url)}</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string><key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`);
  await uninstall(true);
  await realExec('launchctl', ['bootstrap', `gui/${process.getuid()}`, LAUNCH_AGENT]);
  console.log(`Helm bridge installed; it starts at login. Log: ${log}`);
}

async function uninstall(quiet) {
  await realExec('launchctl', ['bootout', `gui/${process.getuid()}/app.helm.bridge`]).catch(() => {});
  if (!quiet) { rmSync(LAUNCH_AGENT, { force: true }); console.log('Helm bridge uninstalled.'); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--install') await install();
  else if (arg === '--uninstall') await uninstall();
  else if (arg === '--unpair-all') { rmSync(join(SUPPORT, 'tokens.json'), { force: true }); console.log('Forgot every paired iPad.'); }
  else {
    const name = await realExec('scutil', ['--get', 'ComputerName']).catch(() => 'Mac');
    await serve({ name });
    // dns-sd ships with macOS; it keeps the Bonjour record alive for as long as it runs.
    const ad = spawn('dns-sd', ['-R', name, '_helm._tcp', 'local', String(PORT)], { stdio: 'ignore' });
    process.on('exit', () => ad.kill());
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
    console.log(`helm bridge "${name}" on :${PORT}`);
  }
}
