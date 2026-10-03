import type { Key } from './types';

type Keys = Record<string, Key>;

export const spanOf = (k?: Key | null) => ({ w: k?.span?.w ?? 1, h: k?.span?.h ?? 1 });

/** Slots a key at `slot` would cover, or null if it runs off the grid. */
function region(slot: number, k: Key, cols: number, rows: number) {
  const { w, h } = spanOf(k);
  const c = slot % cols, r = Math.floor(slot / cols);
  if (c + w > cols || r + h > rows) return null;
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push((r + y) * cols + c + x);
  return out;
}

/**
 * Which keys show and which slots each one covers. Keys are placed in slot order; one that runs off the grid
 * (after the grid shrank) or overlaps an earlier key is hidden rather than drawn on top.
 */
export function layout(keys: Keys, cols: number, rows: number) {
  const owner: Record<number, string> = {};
  const shown: string[] = [];
  for (const slot of Object.keys(keys).sort((a, b) => +a - +b)) {
    const cells = region(+slot, keys[slot], cols, rows);
    if (!cells || cells.some(c => owner[c] != null)) continue;
    cells.forEach(c => { owner[c] = slot; });
    shown.push(slot);
  }
  return { shown, owner };
}

/**
 * Drops `k` with its top-left on `slot`, moving it from `from` (a grid slot) or adding it (from the library).
 * Single keys keep the old feel: dropped on another single key they swap (move) or replace it (add).
 * Anything involving a widget needs the room to be free. Returns the new keys, or null if it doesn't fit.
 */
export function place(keys: Keys, cols: number, rows: number, k: Key, slot: string, from?: string): Keys | null {
  const next = { ...keys };
  if (from != null) delete next[from];
  const there = next[slot];
  const single = (x?: Key) => !!x && spanOf(x).w === 1 && spanOf(x).h === 1;
  if (single(k) && single(there)) {
    if (from != null) next[from] = there;
    next[slot] = k;
    return next;
  }
  const cells = region(+slot, k, cols, rows);
  if (!cells) return null;
  const { owner } = layout(next, cols, rows);
  if (cells.some(c => owner[c] != null)) return null;
  next[slot] = k;
  return next;
}
