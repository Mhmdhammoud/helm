// The deck: pages of keys, edited on the iPad and stored on the Mac so it survives reinstalls.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Bad input from the iPad (HTTP 400), as opposed to something failing on the Mac. */
export class BadRequest extends Error {}

export const ACTION_TYPES = [
  'hotkey', 'open', 'text', 'media', 'volume', 'shortcut', 'script', 'mic', 'system',
  'hush', 'page', 'back', 'app', 'multi', 'toggle',
];
export const LIVE = ['mic', 'volume', 'battery', 'anc', 'toggle'];

const key = (title, action, extra = {}) => ({ title, action, ...extra });

/** First-run deck: something useful on every page, and one of each action type to copy from. */
export function defaultDeck() {
  return {
    version: 1,
    grid: { cols: 6, rows: 4 },
    autoProfile: true,
    dials: ['volume', 'anc'],
    pages: [
      {
        id: 'main',
        name: 'Main',
        keys: {
          0: key('Claude', { type: 'open', target: 'Claude' }, { icon: { app: 'Claude' } }),
          1: key('Safari', { type: 'open', target: 'Safari' }, { icon: { app: 'Safari' } }),
          2: key('Terminal', { type: 'open', target: 'Terminal' }, { icon: { app: 'Terminal' } }),
          3: key('Mic', { type: 'mic' }, { live: 'mic' }),
          4: key('Hush', { type: 'app', app: 'hush' }, { live: 'battery' }),
          5: key('Zoom', { type: 'page', page: 'zoom' }, { color: '#1f3b73' }),
          6: key('Prev', { type: 'media', key: 'previous' }),
          7: key('Play', { type: 'media', key: 'play' }),
          8: key('Next', { type: 'media', key: 'next' }),
          9: key('Vol −', { type: 'volume', change: -6 }),
          10: key('Vol +', { type: 'volume', change: 6 }),
          11: key('Mute', { type: 'volume', mute: 'toggle' }),
          12: key('Screenshot', { type: 'hotkey', key: '4', mods: ['cmd', 'shift'] }),
          13: key('Spotlight', { type: 'hotkey', key: 'space', mods: ['cmd'] }),
          14: key('Focus', { type: 'multi', steps: [{ type: 'hush', cmd: 'anc/10' }, { type: 'open', target: 'https://music.youtube.com' }], delayMs: 200 }, { color: '#3b2a5c' }),
          15: key('Shrug', { type: 'text', text: '¯\\_(ツ)_/¯' }),
          16: key('Lock', { type: 'system', what: 'lock' }),
          17: key('Display', { type: 'system', what: 'sleep-display' }),
        },
      },
      {
        id: 'zoom',
        name: 'Zoom',
        app: 'zoom.us',
        keys: {
          0: key('Back', { type: 'back' }),
          1: key('Mute', { type: 'hotkey', key: 'a', mods: ['cmd', 'shift'] }, { color: '#5c1f1f' }),
          2: key('Video', { type: 'hotkey', key: 'v', mods: ['cmd', 'shift'] }),
          3: key('Share', { type: 'hotkey', key: 's', mods: ['cmd', 'shift'] }),
          4: key('Chat', { type: 'hotkey', key: 'h', mods: ['cmd', 'shift'] }),
          5: key('Leave', { type: 'hotkey', key: 'w', mods: ['cmd'] }, { color: '#5c1f1f' }),
          6: key('Call ANC', { type: 'toggle', on: { type: 'hush', cmd: 'anc/10' }, off: { type: 'hush', cmd: 'anc/5' } }, { live: 'toggle' }),
        },
      },
    ],
  };
}

function checkAction(a, path) {
  if (!a || typeof a !== 'object' || !ACTION_TYPES.includes(a.type)) throw new BadRequest(`${path}: unknown action type`);
  if (a.type === 'multi') {
    if (!Array.isArray(a.steps) || a.steps.length > 20) throw new BadRequest(`${path}: steps must be a list (max 20)`);
    a.steps.forEach((s, i) => checkAction(s, `${path}.steps[${i}]`));
  }
  if (a.type === 'toggle') {
    checkAction(a.on, `${path}.on`);
    checkAction(a.off, `${path}.off`);
  }
}

/** Throws on a deck the iPad shouldn't be able to save; returns it unchanged otherwise. */
export function validateDeck(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.pages) || !d.pages.length) throw new BadRequest('deck needs pages');
  const { cols, rows } = d.grid ?? {};
  if (!(cols >= 2 && cols <= 10 && rows >= 1 && rows <= 8)) throw new BadRequest('grid must be 2–10 × 1–8');
  const ids = new Set();
  for (const p of d.pages) {
    if (typeof p.id !== 'string' || !p.id || ids.has(p.id)) throw new BadRequest('page ids must be unique strings');
    ids.add(p.id);
    for (const [slot, k] of Object.entries(p.keys ?? {})) {
      checkAction(k?.action, `${p.id}[${slot}]`);
      if (k.live && !LIVE.includes(k.live)) throw new BadRequest(`${p.id}[${slot}]: unknown live source`);
    }
  }
  return d;
}

export function loadDeck(file) {
  if (!existsSync(file)) return saveDeck(file, defaultDeck());
  return validateDeck(JSON.parse(readFileSync(file, 'utf8')));
}

export function saveDeck(file, deck) {
  validateDeck(deck);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(deck, null, 2));
  renameSync(`${file}.tmp`, file);
  return deck;
}

export function findKey(deck, page, slot) {
  return deck.pages.find(p => p.id === page)?.keys?.[slot] ?? null;
}
