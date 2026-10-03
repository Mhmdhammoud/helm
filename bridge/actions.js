// Runs deck actions on the Mac. All process spawning goes through `exec(cmd, args)` so tests can record it.
// User text and names reach AppleScript as argv, never spliced into script source.
import { execFile, spawn as spawnProc } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BadRequest } from './deck.js';
import { makeOsa } from './runner.js';

const pexec = promisify(execFile);
export const realExec = async (cmd, args, timeout = 30000) => (await pexec(cmd, args, { timeout })).stdout.trim();

// Named keys need `key code`; anything else is typed as a character.
const KEY_CODES = {
  return: 36, enter: 76, tab: 48, space: 49, delete: 51, 'forward-delete': 117, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};
const MODS = { cmd: 'command down', shift: 'shift down', opt: 'option down', alt: 'option down', ctrl: 'control down' };
// NX_KEYTYPE_* codes. Brightness keys only reach built-in and Apple displays; macOS can't dim third-party monitors.
const SOUND = { up: 0, down: 1, mute: 7 };
const MEDIA = { play: 16, next: 17, previous: 18, 'brightness-up': 2, 'brightness-down': 3 };
const HUSH = {
  anc: /^(10|[0-9]|up|down|cycle)$/,
  eq: /^(flat|(bass|mid|treble)\/-?(10|[0-9]))$/,
  selfvoice: /^(off|low|medium|high)$/,
  switch: /^[^/]{1,64}$/,
  callmode: /^(on|off)$/,
  conversation: /^(on|off)$/,
};

/** Splits a hush:// command (`anc/7`, `eq/bass/-3`) into CLI args, or null if it isn't allowed. */
export function parseHush(cmd) {
  const [name, ...rest] = String(cmd ?? '').split('/');
  const arg = rest.join('/');
  return HUSH[name]?.test(arg) ? [name, ...arg.split('/')] : null;
}

export function hotkeyScript(key, mods = []) {
  const k = String(key ?? '').toLowerCase();
  const using = mods.map(m => MODS[m]).filter(Boolean);
  const press = k in KEY_CODES ? `key code ${KEY_CODES[k]}` : 'keystroke (item 1 of argv)';
  return `on run argv\ntell application "System Events" to ${press}${using.length ? ` using {${using.join(', ')}}` : ''}\nend run`;
}

// ponytail: pastes via the clipboard (handles any Unicode); restores plain-text clipboards only.
const PASTE = `on run argv
set old to missing value
try
set old to the clipboard as text
end try
set the clipboard to (item 1 of argv)
tell application "System Events" to keystroke "v" using command down
delay 0.3
if old is not missing value then set the clipboard to old
end run`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// AppleScript goes through one long-lived osascript (runner.js) on the real Mac; an injected `exec` (tests)
// sees it as plain `osascript -e script args…` calls, as does anyone passing their own `osa`.
export function makeRunner({
  exec = realExec, supportDir,
  osa = exec === realExec ? makeOsa({ exec }) : (script, args) => exec('osascript', ['-e', script, ...args]),
}) {
  const as = (script, ...args) => osa(script, args);
  const toggles = {}; // "page/slot" → on?
  let lastMic = 75;

  // Compiled once on first use; null if that failed (no Xcode tools), and callers fall back to osascript.
  let helper;
  function mediakeyBin() {
    const bin = join(supportDir, 'bin/mediakey3'); // v3: stdin (long-running) mode with a launch warm-up
    if (existsSync(bin)) return Promise.resolve(bin);
    helper ??= (async () => {
      mkdirSync(join(supportDir, 'bin'), { recursive: true });
      await exec('swiftc', ['-O', fileURLToPath(new URL('./mediakey.swift', import.meta.url)), '-o', bin], 120000);
      return bin;
    })().catch(() => null);
    return helper;
  }
  // With the real exec the helper stays running (stdin mode) so a press is ~2ms instead of a ~100ms launch.
  // Tests (recording exec) and any failure of the long-running helper use one-shot `mediakey <code>`.
  let keyProc = null;
  const keyWaiters = [];
  function keyHelper(bin) {
    if (keyProc) return keyProc;
    const p = spawnProc(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    p.unref?.(); p.stdin.unref?.(); p.stdout.unref?.();
    p.stdin.on('error', () => {});
    createInterface({ input: p.stdout }).on('line', l => keyWaiters.shift()?.(l === 'ok'));
    const gone = () => { if (keyProc === p) keyProc = null; keyWaiters.splice(0).forEach(w => w(false)); };
    p.on('exit', gone);
    p.on('error', gone);
    return (keyProc = p);
  }
  /** Posts one system media-key press; false if the helper isn't available. */
  async function postKey(code) {
    const bin = await mediakeyBin();
    if (!bin) return false;
    if (exec === realExec) {
      const ok = await new Promise(resolve => {
        // A stuck helper is killed (which also fails anything queued behind it) so replies never misalign.
        const t = setTimeout(() => { keyProc?.kill(); resolve(false); }, 2000);
        keyWaiters.push(v => { clearTimeout(t); resolve(v); });
        keyHelper(bin).stdin.write(`${code}\n`);
      });
      if (ok) return true;
    }
    try { await exec(bin, [String(code)]); return true; } catch { return false; }
  }
  async function mediaKey(name) {
    if (!(await postKey(MEDIA[name]))) throw new Error('media keys need the mediakey helper (Xcode command line tools)');
  }

  // Volume goes through the real volume keys so macOS shows its volume HUD; one key step is 1/16.
  let volGen = 0; // latest-wins: a newer volume request abandons an older one mid-loop
  async function volume(a) {
    const gen = ++volGen;
    if (a.mute === 'toggle') {
      if (await postKey(SOUND.mute)) return;
      return as('set volume output muted (not (output muted of (get volume settings)))');
    }
    let steps;
    if (a.set != null) {
      const target = Math.max(0, Math.min(100, Number(a.set) || 0));
      const current = Number(await as('output volume of (get volume settings)'));
      // Key presses move along macOS's 16-step grid; the first press from an off-grid level only snaps to it.
      const t = Math.round(target / 6.25);
      let c = current / 6.25;
      if (Math.abs(c - Math.round(c)) < 0.1) c = Math.round(c); // osascript rounds to whole percents: 31 is grid line 5
      steps = Math.max(-16, Math.min(16, t > c ? t - Math.floor(c) : t < c ? t - Math.ceil(c) : 0));
      if (!steps) return target === current ? undefined : as(`set volume output volume ${target}`);
      if (gen !== volGen) return;
    } else {
      const change = Math.round(Number(a.change) || 0);
      if (!change) return;
      steps = Math.sign(change) * Math.max(1, Math.round(Math.abs(change) / 6.25));
    }
    for (let i = 0; i < Math.abs(steps); i++) {
      if (gen !== volGen) return;
      if (!(await postKey(steps > 0 ? SOUND.up : SOUND.down))) {
        if (i) return; // the helper died mid-way; leave it where it got to
        return a.set != null
          ? as(`set volume output volume ${Math.max(0, Math.min(100, Number(a.set) || 0))}`)
          : as(`set volume output volume ((output volume of (get volume settings)) + ${Math.round(Number(a.change) || 0)})`);
      }
    }
  }

  async function run(a, id) {
    switch (a.type) {
      case 'hotkey':
        // macOS ignores a synthetic ctrl-up, so Mission Control's shortcut opens the app instead.
        if (String(a.key).toLowerCase() === 'up' && a.mods?.length === 1 && a.mods[0] === 'ctrl') return exec('open', ['-a', 'Mission Control']);
        return as(hotkeyScript(a.key, a.mods), String(a.key ?? ''));
      case 'open': {
        const t = String(a.target ?? '');
        return exec('open', t.includes('/') || t.includes(':') ? [t] : ['-a', t]);
      }
      case 'text':
        return as(PASTE, String(a.text ?? ''));
      case 'media':
        if (!Object.hasOwn(MEDIA, a.key)) throw new BadRequest(`unknown media key: ${a.key}`);
        return mediaKey(a.key);
      case 'volume':
        return volume(a);
      case 'shortcut':
        return exec('shortcuts', ['run', String(a.name ?? '')], 120000);
      case 'script':
        return exec('/bin/zsh', ['-lc', String(a.command ?? '')], 60000);
      case 'mic': {
        const mic = Number(await as('input volume of (get volume settings)'));
        if (mic > 0) lastMic = mic;
        return as(`set volume input volume ${mic > 0 ? 0 : lastMic}`);
      }
      case 'system':
        if (a.what === 'lock') return as(hotkeyScript('q', ['ctrl', 'cmd']), 'q');
        if (a.what === 'sleep-display') return exec('pmset', ['displaysleepnow']);
        if (a.what === 'screensaver') return exec('open', ['-a', 'ScreenSaverEngine']);
        throw new BadRequest(`unknown system action: ${a.what}`);
      case 'hush': {
        const args = parseHush(a.cmd);
        if (!args) throw new BadRequest(`hush command not allowed: ${a.cmd}`);
        // Same hush:// commands the Hush CLI and Shortcuts use, delivered to the installed app.
        return exec('open', ['-g', '-b', 'app.hush.macos', `hush://${args.join('/')}`]);
      }
      case 'multi':
        for (const [i, step] of a.steps.entries()) {
          if (i) await sleep(a.delayMs ?? 100);
          await run(step, `${id}/${i}`);
        }
        return;
      case 'toggle': {
        const on = !toggles[id];
        await run(on ? a.on : a.off, id);
        toggles[id] = on;
        return;
      }
      case 'page':
      case 'back':
      case 'app':
        return; // navigation happens on the iPad
      default:
        throw new BadRequest(`unknown action: ${a.type}`);
    }
  }

  async function macState() {
    const [vol, muted, mic] = (await as('set s to get volume settings\nreturn (output volume of s as text) & "," & (output muted of s as text) & "," & (input volume of s as text)')).split(',');
    const front = await exec('/bin/zsh', ['-c', 'lsappinfo info -only name "$(lsappinfo front)"']).catch(() => '');
    return {
      volume: Number(vol),
      muted: muted === 'true',
      micMuted: Number(mic) === 0,
      app: /"LSDisplayName"="(.*)"/.exec(front)?.[1] ?? null,
    };
  }

  // Start the key helper now so the first press doesn't pay for its launch.
  if (exec === realExec) mediakeyBin().then(bin => bin && keyHelper(bin));
  return { run, toggles, macState };
}

// ponytail: scans the standard app folders; apps elsewhere can still be opened by typing their name.
export function listApps() {
  const dirs = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', join(homedir(), 'Applications')];
  const names = new Set();
  for (const d of dirs) {
    try { for (const f of readdirSync(d)) if (f.endsWith('.app')) names.add(f.slice(0, -4)); } catch {}
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

const ICON = `ObjC.import('AppKit');
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const path = argv[0].startsWith('/') ? $(argv[0]) : ws.fullPathForApplication(argv[0]);
  if (!path || !path.js) throw new Error('no such app');
  const img = ws.iconForFile(path);
  const S = 256;
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, S, S, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
  img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, S, S), $.NSZeroRect, $.NSCompositingOperationCopy, 1);
  $.NSGraphicsContext.restoreGraphicsState;
  rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(argv[1], true);
}`;

/** Path to a cached 256px PNG of an app's icon (by name or .app path), rendering it on first request. */
export async function appIcon(name, supportDir, exec = realExec) {
  const safe = String(name).replace(/^\/.*\/|\.app$/g, '').replace(/[^\w .+-]/g, '_').slice(0, 80);
  const file = join(supportDir, 'icons', `${safe}.png`);
  if (!existsSync(file)) {
    mkdirSync(join(supportDir, 'icons'), { recursive: true });
    await exec('osascript', ['-l', 'JavaScript', '-e', ICON, String(name), file]);
  }
  return file;
}
