// The deck: pages of keys, edited on the iPad and stored on the Mac so it survives reinstalls.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Bad input from the iPad (HTTP 400), as opposed to something failing on the Mac. */
export class BadRequest extends Error {}

export const ACTION_TYPES = [
  'hotkey', 'open', 'text', 'media', 'volume', 'shortcut', 'script', 'mic', 'system',
  'hush', 'page', 'back', 'app', 'multi', 'toggle', 'fans',
];
export const LIVE = ['mic', 'volume', 'battery', 'anc', 'toggle', 'nowplaying', 'cpu', 'memory', 'macbattery', 'clock', 'system', 'weather', 'storage', 'thermal'];

/** First-run deck: one empty page. Nothing is preset; people add keys from the library in Edit. */
export function defaultDeck() {
  return {
    version: 1,
    grid: { cols: 6, rows: 4 },
    autoProfile: true,
    dials: ['volume'],
    pages: [{ id: 'main', name: 'Main', keys: {} }],
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
    if (p.kind != null && p.kind !== 'running') throw new BadRequest(`${p.id}: unknown page kind`);
    for (const [slot, k] of Object.entries(p.keys ?? {})) {
      checkAction(k?.action, `${p.id}[${slot}]`);
      if (k.hold != null) checkAction(k.hold, `${p.id}[${slot}].hold`);
      if (k.live && !LIVE.includes(k.live)) throw new BadRequest(`${p.id}[${slot}]: unknown live source`);
      // Widgets span slots from their own slot rightwards and down. One that no longer fits the grid is hidden, not refused.
      if (k.span != null && !(Number.isInteger(k.span.w) && Number.isInteger(k.span.h) && k.span.w >= 1 && k.span.w <= 4 && k.span.h >= 1 && k.span.h <= 3)) {
        throw new BadRequest(`${p.id}[${slot}]: span must be 1–4 wide and 1–3 tall`);
      }
      if (k.place != null && (typeof k.place !== 'string' || k.place.length > 80)) throw new BadRequest(`${p.id}[${slot}]: place must be a short name`);
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
