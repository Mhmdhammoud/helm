// Live Mac info for keys (now playing, CPU, memory, battery, weather) and the running-apps page.
// Everything is sampled lazily when an iPad asks, at most every 2s, and only for sources the deck uses.
import { makeOsa } from './runner.js';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, rmSync } from 'node:fs';
import { readdir, realpath, statfs } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { realExec, swiftHelper } from './actions.js';
import { loadDeck } from './deck.js';

const TTL = 2000;
const WEATHER_TTL = 15 * 60_000;
const WEATHER_RETRY = 2 * 60_000;
const WEATHER_PREFS = join(process.env.HOME ?? '', 'Library/Group Containers/group.com.apple.weather/Library/Preferences/group.com.apple.weather.plist');

/** Last resort for where the weather is: the city in the Mac's time zone ("Europe/Istanbul" → "Istanbul"). */
export const homePlace = (tz = Intl.DateTimeFormat().resolvedOptions().timeZone) => tz?.split('/').pop()?.replace(/_/g, ' ') || null;
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

/**
 * Drives with their space in bytes: the Mac's own disk first (its data volume, where the files are, named like
 * the startup disk), then anything mounted under /Volumes. Tiny volumes (installer images) are left out.
 */
export async function drives(volumes = '/Volumes') {
  let home = 'Mac';
  const extra = [];
  for (const name of await readdir(volumes).catch(() => [])) {
    const path = join(volumes, name);
    const real = await realpath(path).catch(() => null);
    if (real === '/') home = name;
    else if (real) extra.push([name, path]);
  }
  const out = [];
  for (const [name, path] of [[home, '/System/Volumes/Data'], ...extra]) {
    const s = await statfs(path).catch(() => null);
    if (!s || s.blocks * s.bsize < 1e9) continue;
    out.push({ name, total: s.blocks * s.bsize, free: s.bavail * s.bsize });
  }
  return out;
}

export function makeFeatures({ exec = realExec, supportDir, deckFile, now = Date.now, fetch = globalThis.fetch }) {
  // Its own long-lived osascript for the now-playing poll, so a slow Music/Spotify query never queues
  // behind (or delays) a key press on the actions runner. Tests with a recording exec see one-shot calls.
  const osa = exec === realExec ? makeOsa({ exec }) : (script, args = []) => exec('osascript', ['-e', script, ...args]);
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
      const out = await osa(PLAYERS[app]).catch(() => '');
      const [state, title, artist, id, url] = out.split('\t');
      if (!title) continue;
      const t = { app, title, artist: artist || null, playing: state === 'playing', id, url };
      if (!best || (t.playing && !best.playing)) best = t;
    }
    if (!best) return null;
    const { id, url, ...rest } = best;
    return { ...rest, art: await artwork(best.app, id, url) };
  }

  // Open-Meteo: free, no key. The place is geocoded once per name; the forecast is kept 15 minutes.
  let weatherCache = null; // { place, at, value }
  const getJson = async url => {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`weather: HTTP ${r.status}`);
    return r.json();
  };
  // When no key names a place, follow the Weather app: the city last opened there ("LocationID:lat:lon" in its prefs),
  // named from its saved cities. Read through `defaults`/`plutil`, so no location permission is needed.
  let appPlace = null; // { at, value }
  async function weatherAppPlace() {
    if (appPlace && now() - appPlace.at < 60_000) return appPlace.value;
    let value = null;
    try {
      const [, lat, lon] = (await exec('defaults', ['read', 'com.apple.weather', 'modules.location.lastViewedLocation'])).trim().split(':');
      if (lat && lon) {
        const same = appPlace?.value?.lat === +lat && appPlace?.value?.lon === +lon;
        value = { name: same ? appPlace.value.name : await placeName(lat, lon), lat: +lat, lon: +lon };
      }
    } catch {}
    appPlace = { at: now(), value };
    return value;
  }

  // The Weather app's own name for a saved city; its city list is in a group container that a login item may not
  // be allowed to read, so otherwise ask Apple's geocoder (bridge/placename.swift).
  async function placeName(lat, lon) {
    try {
      const cities = JSON.parse(await exec('plutil', ['-extract', 'Cities', 'json', '-o', '-', WEATHER_PREFS]));
      const city = cities.find(c => Math.abs(c.Lat - lat) < 1e-3 && Math.abs(c.Lon - lon) < 1e-3);
      if (city) return city.Name;
    } catch {}
    try {
      const bin = await swiftHelper(supportDir, 'placename1', 'placename.swift', exec);
      const name = bin && (await exec(bin, [lat, lon])).trim();
      if (name) return name;
    } catch {}
    return 'My Location';
  }

  /** `place` is a city name to look up, or { name, lat, lon } from the Weather app. */
  async function weather(place) {
    if (!place) return null;
    const id = JSON.stringify(place);
    if (weatherCache?.place === id && now() - weatherCache.at < (weatherCache.value ? WEATHER_TTL : WEATHER_RETRY)) return weatherCache.value;
    let value = null;
    try {
      const geo = typeof place === 'object' ? { name: place.name, latitude: place.lat, longitude: place.lon }
        : (await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(place)}`)).results?.[0];
      if (geo) {
        const f = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}` +
          '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto');
        value = {
          place: geo.name,
          temp: Math.round(f.current.temperature_2m),
          code: f.current.weather_code,
          day: f.current.is_day === 1,
          hi: Math.round(f.daily.temperature_2m_max[0]),
          lo: Math.round(f.daily.temperature_2m_min[0]),
        };
      }
    } catch {}
    weatherCache = { place: id, at: now(), value };
    return value;
  }

  async function sample(want, place) {
    const out = {};
    const jobs = [];
    if (want.has('nowplaying')) jobs.push(nowPlaying().then(v => { out.nowPlaying = v; }, () => { out.nowPlaying = null; }));
    // The system widget shows all three Mac stats.
    if (want.has('system')) ['cpu', 'memory', 'macbattery'].forEach(w => want.add(w));
    if (want.has('weather')) jobs.push((async () => { out.weather = await weather(place || await weatherAppPlace() || homePlace()); })());
    if (want.has('storage')) jobs.push(drives().then(v => { out.storage = v; }, () => {}));
    // Chip temperature and fans, from a small Swift helper (bridge/sensors.swift) built on first use.
    if (want.has('thermal')) {
      jobs.push(swiftHelper(supportDir, 'sensors1', 'sensors.swift', exec)
        .then(bin => bin && exec(bin, []))
        .then(o => { if (o) { const t = JSON.parse(o); out.thermal = { cpu: t.cpu == null ? null : Math.round(t.cpu), fans: t.fans ?? [] }; } }, () => {}));
    }
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
      let keys;
      try { keys = loadDeck(deckFile).pages.flatMap(p => Object.values(p.keys ?? {})); } catch { return Promise.resolve({}); }
      const want = new Set(keys.map(k => k.live));
      want.add('storage'); // cheap (statfs), and lets the library preview the storage widget with real numbers
      // ponytail: one weather place per deck (the first weather key's), add per-key places if people want several cities.
      const place = keys.find(k => k.live === 'weather' && k.place)?.place;
      const key = [...want].sort().join() + (place ?? '');
      if (!cache || now() - cache.at >= TTL || cache.key !== key) cache = { at: now(), key, promise: sample(want, place) };
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
