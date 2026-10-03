// Runs deck actions on the Mac. All process spawning goes through `exec(cmd, args)` so tests can record it.
// User text and names reach AppleScript as argv, never spliced into script source.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BadRequest } from './deck.js';

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
const osa = (exec, script, ...args) => exec('osascript', ['-e', script, ...args]);

export function makeRunner({ exec = realExec, hushCli, supportDir }) {
  const toggles = {}; // "page/slot" → on?
  let lastMic = 75;

  async function mediaKey(name) {
    const bin = join(supportDir, 'bin/mediakey');
    if (!existsSync(bin)) {
      mkdirSync(join(supportDir, 'bin'), { recursive: true });
      await exec('swiftc', ['-O', fileURLToPath(new URL('./mediakey.swift', import.meta.url)), '-o', bin], 120000);
    }
    await exec(bin, [String(MEDIA[name])]);
  }

  async function run(a, id) {
    switch (a.type) {
      case 'hotkey':
        return osa(exec, hotkeyScript(a.key, a.mods), String(a.key ?? ''));
      case 'open': {
        const t = String(a.target ?? '');
        return exec('open', t.includes('/') || t.includes(':') ? [t] : ['-a', t]);
      }
      case 'text':
        return osa(exec, PASTE, String(a.text ?? ''));
      case 'media':
        if (!Object.hasOwn(MEDIA, a.key)) throw new BadRequest(`unknown media key: ${a.key}`);
        return mediaKey(a.key);
      case 'volume':
        if (a.mute === 'toggle') return osa(exec, 'set volume output muted (not (output muted of (get volume settings)))');
        if (a.set != null) return osa(exec, `set volume output volume ${Math.max(0, Math.min(100, Number(a.set) || 0))}`);
        return osa(exec, `set volume output volume ((output volume of (get volume settings)) + ${Math.round(Number(a.change) || 0)})`);
      case 'shortcut':
        return exec('shortcuts', ['run', String(a.name ?? '')], 120000);
      case 'script':
        return exec('/bin/zsh', ['-lc', String(a.command ?? '')], 60000);
      case 'mic': {
        const mic = Number(await osa(exec, 'input volume of (get volume settings)'));
        if (mic > 0) lastMic = mic;
        return osa(exec, `set volume input volume ${mic > 0 ? 0 : lastMic}`);
      }
      case 'system':
        if (a.what === 'lock') return osa(exec, hotkeyScript('q', ['ctrl', 'cmd']), 'q');
        if (a.what === 'sleep-display') return exec('pmset', ['displaysleepnow']);
        if (a.what === 'screensaver') return exec('open', ['-a', 'ScreenSaverEngine']);
        throw new BadRequest(`unknown system action: ${a.what}`);
      case 'hush': {
        const args = parseHush(a.cmd);
        if (!args) throw new BadRequest(`hush command not allowed: ${a.cmd}`);
        return exec(hushCli, args);
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
    const [vol, muted, mic] = (await osa(exec, 'set s to get volume settings\nreturn (output volume of s as text) & "," & (output muted of s as text) & "," & (input volume of s as text)')).split(',');
    const front = await exec('/bin/zsh', ['-c', 'lsappinfo info -only name "$(lsappinfo front)"']).catch(() => '');
    return {
      volume: Number(vol),
      muted: muted === 'true',
      micMuted: Number(mic) === 0,
      app: /"LSDisplayName"="(.*)"/.exec(front)?.[1] ?? null,
    };
  }

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
