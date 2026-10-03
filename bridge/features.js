// Live Mac info for keys (now playing, CPU, memory, battery) and the running-apps page.
// Everything is sampled lazily when an iPad asks, at most every 2s, and only for sources the deck uses.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, rmSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { realExec } from './actions.js';
import { loadDeck } from './deck.js';

const TTL = 2000;
// Player apps are only queried while running: a `tell` would launch them, or ask where Spotify is if it isn't installed.
const PLAYERS = {
  Spotify: `tell application "Spotify"
if player state is stopped then return ""
set t to current track
return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & (id of t) & tab & (artwork url of t)
end tell`,
  Music: `tell application "Music"
if player state is stopped then return ""
set t to current track
return (player state as text) & tab & (name of t) & tab & (artist of t) & tab & (persistent ID of t)
end tell`,
};
const MUSIC_ART = `on run argv
tell application "Music" to set d to raw data of artwork 1 of current track
set f to open for access (POSIX file (item 1 of argv)) with write permission
set eof f to 0
write d to f
close access f
end run`;
const RUNNING = `ObjC.import('AppKit');
function run() {
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  const out = [];
  for (let i = 0; i < apps.count; i++) {
    const a = apps.objectAtIndex(i);
    if (Number(a.activationPolicy) === 0 && a.bundleURL.path.js) out.push({ name: a.localizedName.js, path: a.bundleURL.path.js });
  }
  return JSON.stringify(out);
}`;

/** CPU busy % across all cores since the previous call's snapshot. */
export function cpuLoad(prev, next) {
  const sum = cs => cs.reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { idle: 0, total: 0 });
  const p = sum(prev), n = sum(next);
  const total = n.total - p.total;
  return total > 0 ? Math.round(100 * (1 - (n.idle - p.idle) / total)) : 0;
}

// ponytail: active + wired + compressed pages, close to Activity Monitor's "Memory Used" (it also subtracts purgeable).
export function memoryUsed(vmStat, total = totalmem()) {
  const page = Number(/page size of (\d+)/.exec(vmStat)?.[1] ?? 16384);
  const n = label => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vmStat)?.[1] ?? 0);
  return Math.round((100 * page * (n('Pages active') + n('Pages wired down') + n('Pages occupied by compressor'))) / total);
}

/** `pmset -g batt` → { percent, charging, ac }; percent is null on Macs without a battery. */
export function macBattery(pmset) {
  const m = /InternalBattery[^\t]*\t(\d+)%;\s*([^;]+);/.exec(pmset);
  return { percent: m ? Number(m[1]) : null, charging: m ? /^(charging|finishing charge)/.test(m[2]) : false, ac: /'AC Power'/.test(pmset) };
}

export function makeFeatures({ exec = realExec, supportDir, deckFile, now = Date.now }) {
  const artFile = join(supportDir, 'artwork.png');
  let cache = null; // { at, key, promise }
  let prevCpu = []; // first sample: average since boot
  let art = { track: null, id: null }; // artwork currently on disk, by track

  async function artwork(app, trackId, url) {
    if (art.track === `${app}:${trackId}`) return art.id;
    art = { track: `${app}:${trackId}`, id: null }; // one try per track, even if it fails
    const raw = `${artFile}.raw`;
    try {
      if (app === 'Music') await exec('osascript', ['-e', MUSIC_ART, raw]);
      else if (/^https:\/\//.test(url)) await exec('curl', ['-sfL', '--max-time', '10', '-o', raw, url]);
      else return null;
      await exec('sips', ['-s', 'format', 'png', '-Z', '300', raw, '--out', artFile]);
      art.id = createHash('sha1').update(art.track).digest('hex').slice(0, 12);
    } catch {
      rmSync(artFile, { force: true });
    } finally {
      rmSync(raw, { force: true });
    }
    return art.id;
  }

  async function nowPlaying() {
    const running = new Set((await exec('ps', ['-axco', 'comm'])).split('\n').map(s => s.trim()));
    let best = null;
    for (const app of Object.keys(PLAYERS).filter(a => running.has(a))) {
      const out = await exec('osascript', ['-e', PLAYERS[app]], 5000).catch(() => '');
      const [state, title, artist, id, url] = out.split('\t');
      if (!title) continue;
      const t = { app, title, artist: artist || null, playing: state === 'playing', id, url };
      if (!best || (t.playing && !best.playing)) best = t;
    }
    if (!best) return null;
    const { id, url, ...rest } = best;
    return { ...rest, art: await artwork(best.app, id, url) };
  }

  async function sample(want) {
    const out = {};
    const jobs = [];
    if (want.has('nowplaying')) jobs.push(nowPlaying().then(v => { out.nowPlaying = v; }, () => { out.nowPlaying = null; }));
    if (want.has('cpu')) {
      const next = cpus();
      out.cpu = cpuLoad(prevCpu, next);
      prevCpu = next;
    }
    if (want.has('memory')) jobs.push(exec('vm_stat', []).then(s => { out.memory = memoryUsed(s); }, () => {}));
    if (want.has('macbattery')) jobs.push(exec('pmset', ['-g', 'batt']).then(s => { out.macBattery = macBattery(s); }, () => {}));
    await Promise.all(jobs);
    return out;
  }

  return {
    /** Extra /state fields for the live sources this deck uses, cached for 2s. */
    state() {
      let want;
      try { want = new Set(loadDeck(deckFile).pages.flatMap(p => Object.values(p.keys ?? {}).map(k => k.live))); } catch { return Promise.resolve({}); }
      const key = [...want].sort().join();
      if (!cache || now() - cache.at >= TTL || cache.key !== key) cache = { at: now(), key, promise: sample(want) };
      return cache.promise;
    },
    /** Streams the current track's artwork PNG (GET /artwork). */
    artwork(res) {
      if (!art.id || !existsSync(artFile)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400' });
      createReadStream(artFile).pipe(res);
    },
    /** Running GUI apps, in launch order: [{ name, path }]. */
    running: async () => JSON.parse(await exec('osascript', ['-l', 'JavaScript', '-e', RUNNING])),
  };
}
