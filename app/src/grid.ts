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
 * Two single keys swap when one is moved onto the other. Otherwise whatever `k` lands on moves out of the way,
 * like the iOS home screen: each displaced key goes to the nearest spot it fits, trying the slot `k` left first.
 * Returns the new keys, or null if `k` runs off the grid or a displaced key has nowhere to go.
 */
export function place(keys: Keys, cols: number, rows: number, k: Key, slot: string, from?: string): Keys | null {
  const next = { ...keys };
  if (from != null) delete next[from];
  const single = (x?: Key) => !!x && spanOf(x).w === 1 && spanOf(x).h === 1;
  if (from != null && single(k) && single(next[slot])) {
    next[from] = next[slot];
    next[slot] = k;
    return next;
  }
  const cells = region(+slot, k, cols, rows);
  if (!cells) return null;
  const { owner } = layout(next, cols, rows);
  const displaced = [...new Set(cells.map(c => owner[c]).filter((o): o is string => o != null))];
  const moved = displaced.map(d => [d, next[d]] as const);
  displaced.forEach(d => delete next[d]);
  next[slot] = k;
  for (const [was, key] of moved) {
    const taken = layout(next, cols, rows).owner;
    const fits = (s: number) => region(s, key, cols, rows)?.every(c => taken[c] == null) ?? false;
    const r0 = Math.floor(+was / cols), c0 = +was % cols;
    const order = Array.from({ length: cols * rows }, (_, i) => i)
      .sort((a, b) => Math.abs(Math.floor(a / cols) - r0) + Math.abs((a % cols) - c0) - (Math.abs(Math.floor(b / cols) - r0) + Math.abs((b % cols) - c0)) || a - b);
    const spot = [...(from != null ? [+from] : []), ...order].find(fits);
    if (spot == null) return null;
    next[String(spot)] = key;
  }
  return next;
}
