import { layout, place } from '../src/grid';
import type { Key } from '../src/types';

const key = (title: string, w = 1, h = 1): Key => ({ title, action: { type: 'open', target: title }, ...(w > 1 || h > 1 ? { span: { w, h } } : {}) });

test('a widget covers its slots; one that no longer fits or overlaps is hidden', () => {
  const keys = { 0: key('Clock', 2, 1), 1: key('Hidden under the clock'), 3: key('Too wide', 2, 1), 4: key('Weather', 2, 2) };
  const { shown, owner } = layout(keys, 4, 3);
  expect(shown).toEqual(['0', '4']);
  expect(owner).toEqual({ 0: '0', 1: '0', 4: '4', 5: '4', 8: '4', 9: '4' });
});

test('single keys swap when moved; anything else pushes what it lands on to the nearest free spot', () => {
  const A = key('A'), B = key('B'), C = key('C'), W = key('Weather', 2, 1);
  // Moving one single key onto another swaps them.
  expect(place({ 0: A, 1: B }, 4, 2, A, '1', '0')).toEqual({ 0: B, 1: A });
  // A key from the library pushes the one there aside instead of replacing it.
  expect(place({ 0: A, 1: B }, 4, 2, C, '1')).toEqual({ 0: A, 1: C, 2: B });
  // A widget moved onto two keys: they move out, the first into the slot the widget left.
  expect(place({ 0: A, 1: B, 6: W }, 4, 2, W, '0', '6')).toEqual({ 0: W, 6: A, 2: B });
  // A single key moved onto a widget pushes the widget to the nearest place it fits.
  expect(place({ 0: W, 3: A }, 4, 2, A, '0', '3')).toEqual({ 0: A, 1: W });
  // Off the grid, or no room left for what it displaces: refused.
  expect(place({}, 4, 2, W, '3')).toBeNull();
  expect(place({ 0: A, 1: B, 2: C, 3: key('D'), 4: key('E'), 5: key('F'), 6: key('G') }, 4, 2, W, '0')).toBeNull();
});
