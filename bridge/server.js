#!/usr/bin/env node
// Helm bridge: lets the iPad app (../app) drive the headphones and a few Mac actions over the LAN.
// Headphone commands go through Hush's bin/hush CLI, so the Hush menu-bar app still does the Bluetooth work.
//   node bridge/server.js          serve on :7733
//   node bridge/server.js --pair   write app/src/config.json (host, port, token) for the iPad build
// Every request needs `Authorization: Bearer <token>`; the token lives in ~/Library/Application Support/Helm/token.
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = p => fileURLToPath(new URL(p, import.meta.url));
const CLI = process.env.HUSH_CLI || join(homedir(), 'Documents/projects/lab/hush/bin/hush');
const PORT = Number(process.env.HELM_PORT ?? 7733);
const TOKEN_FILE = process.env.HELM_TOKEN_FILE || join(homedir(), 'Library/Application Support/Helm/token');
// Tests swap the Mac side for a stub so nothing touches real volume or apps.
const MAC = process.env.HELM_FAKE_MAC ? fakeMac() : realMac();

function token() {
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf8').trim();
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  const t = randomBytes(24).toString('base64url');
  writeFileSync(TOKEN_FILE, t);
  chmodSync(TOKEN_FILE, 0o600);
  return t;
}

// Allow-listed headphone commands, mirroring src/commands.ts. Anything else is rejected before it reaches a process.
const HUSH = {
  anc: /^(10|[0-9]|up|down|cycle)$/,
  eq: /^(flat|(bass|mid|treble)\/-?(10|[0-9]))$/,
  selfvoice: /^(off|low|medium|high)$/,
  switch: /^[^/]{1,64}$/,
  callmode: /^(on|off)$/,
  conversation: /^(on|off)$/,
};

export function parseHush(cmd) {
  const [name, ...rest] = String(cmd ?? '').split('/');
  const arg = rest.join('/');
  if (!HUSH[name]?.test(arg)) return null;
  return [name, ...arg.split('/')];
}

const osa = async script => (await run('osascript', ['-e', script])).stdout.trim();

function realMac() {
  let lastMic = 75;
  return {
    async state() {
      const [vol, mic] = (await osa('set s to get volume settings\nreturn (output volume of s as text) & "," & (input volume of s as text)')).split(',').map(Number);
      return { volume: vol, micMuted: mic === 0 };
    },
    actions: {
      async mic() {
        const mic = Number(await osa('input volume of (get volume settings)'));
        if (mic > 0) lastMic = mic;
        await osa(`set volume input volume ${mic > 0 ? 0 : lastMic}`);
      },
      'volume-up': () => osa('set volume output volume ((output volume of (get volume settings)) + 6)'),
      'volume-down': () => osa('set volume output volume ((output volume of (get volume settings)) - 6)'),
      claude: () => run('open', ['-a', 'Claude']),
      'sleep-display': () => run('pmset', ['displaysleepnow']),
    },
  };
}

function fakeMac() {
  const s = { volume: 50, micMuted: false, opened: [] };
  return {
    state: async () => ({ volume: s.volume, micMuted: s.micMuted }),
    actions: {
      mic: async () => { s.micMuted = !s.micMuted; },
      'volume-up': async () => { s.volume = Math.min(100, s.volume + 6); },
      'volume-down': async () => { s.volume = Math.max(0, s.volume - 6); },
      claude: async () => { s.opened.push('Claude'); },
      'sleep-display': async () => {},
    },
  };
}

async function state() {
  const [headphones, mac] = await Promise.all([
    run(CLI, ['status', '--json'], { timeout: 15000 }).then(r => JSON.parse(r.stdout)).catch(e => ({ status: 'unavailable', error: e.message })),
    MAC.state().catch(e => ({ error: e.message })),
  ]);
  return { headphones, mac };
}

const readBody = req => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 4096) req.destroy(); });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

export function serve({ port = PORT, secret = token() } = {}) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const authed = h => { const got = Buffer.from(h ?? ''); return got.length === expected.length && timingSafeEqual(got, expected); };
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  const server = createServer(async (req, res) => {
    if (!authed(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
    try {
      if (req.method === 'GET' && req.url === '/state') return send(res, 200, await state());
      if (req.method === 'POST' && req.url === '/hush') {
        const args = parseHush((await readBody(req)).cmd);
        if (!args) return send(res, 400, { error: 'command not allowed' });
        await run(CLI, args, { timeout: 15000 });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && req.url === '/mac') {
        const action = MAC.actions[(await readBody(req)).action];
        if (!action) return send(res, 400, { error: 'unknown action' });
        await action();
        return send(res, 200, { ok: true, mac: await MAC.state() });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  });
  return new Promise(resolve => server.listen(port, '0.0.0.0', () => resolve(server)));
}

async function pair() {
  const host = `${(await run('scutil', ['--get', 'LocalHostName'])).stdout.trim()}.local`;
  const out = here('../app/src/config.json');
  writeFileSync(out, JSON.stringify({ host, port: PORT, token: token() }, null, 2) + '\n');
  console.log(`wrote ${out} → http://${host}:${PORT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--pair')) await pair();
  else { await serve(); console.log(`helm bridge on :${PORT}`); }
}
