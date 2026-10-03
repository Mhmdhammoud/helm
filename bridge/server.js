#!/usr/bin/env node
// Helm bridge: the Mac side of the Helm iPad deck. Stores the deck, runs key actions, reports live state.
//   node bridge/server.js               serve on :7733 and advertise as _helm._tcp (Bonjour)
//   node bridge/server.js --install     run at login (LaunchAgent); --uninstall removes it
//   node bridge/server.js --unpair-all  forget every paired iPad
// The iPad finds this Mac over Bonjour and pairs with a 6-digit code shown here as a notification;
// after that every request carries that iPad's own bearer token.
// Anyone with the token can run scripts on this Mac, as with any Stream Deck: keep it on your own network.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appIcon, listApps, makeRunner, realExec } from './actions.js';
import { BadRequest, loadDeck, saveDeck, validateDeck } from './deck.js';

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

export function serve({ port = PORT, exec = realExec, hushCli = HUSH_CLI, supportDir = SUPPORT, name = 'Mac' } = {}) {
  const deckFile = join(supportDir, 'deck.json');
  const tokensFile = join(supportDir, 'tokens.json');
  const runner = makeRunner({ exec, hushCli, supportDir });
  const authed = h => /^Bearer .+/.test(h ?? '') && !!loadTokens(tokensFile)[sha(h.slice(7))];

  // One pairing code at a time, valid 2 minutes, burned after 5 wrong guesses.
  let pairing = null;
  const unauthed = {
    'GET /hello': () => ({ app: 'helm', name }),
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
      return { token: t, name };
    },
  };
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  const headphones = () => existsSync(hushCli)
    ? exec(hushCli, ['status', '--json'], 15000).then(JSON.parse).catch(e => ({ status: 'unavailable', error: e.message }))
    : Promise.resolve(null);

  const routes = {
    'GET /deck': () => loadDeck(deckFile),
    'PUT /deck': async req => saveDeck(deckFile, await readBody(req)),
    'POST /run': async req => {
      const { action, id } = await readBody(req);
      validateDeck({ grid: { cols: 2, rows: 1 }, pages: [{ id: 'run', keys: { 0: { action } } }] });
      await runner.run(action, String(id ?? 'run'));
      return { ok: true, toggles: runner.toggles };
    },
    'GET /state': async () => {
      const [mac, hp] = await Promise.all([runner.macState().catch(e => ({ error: e.message })), headphones()]);
      return { mac, headphones: hp, toggles: runner.toggles };
    },
    'GET /apps': () => listApps(),
    'GET /shortcuts': async () => (await exec('shortcuts', ['list'])).split('\n').filter(Boolean),
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
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) return send(res, 404, { error: 'not found' });
      send(res, 200, await route(req));
    } catch (e) {
      send(res, e instanceof BadRequest || e instanceof SyntaxError ? 400 : 500, { error: e.message });
    }
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
