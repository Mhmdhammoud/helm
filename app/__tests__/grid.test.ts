import { layout, place } from '../src/grid';
import type { Key } from '../src/types';

const key = (title: string, w = 1, h = 1): Key => ({ title, action: { type: 'open', target: title }, ...(w > 1 || h > 1 ? { span: { w, h } } : {}) });

test('a widget covers its slots; one that no longer fits or overlaps is hidden', () => {
  const keys = { 0: key('Clock', 2, 1), 1: key('Hidden under the clock'), 3: key('Too wide', 2, 1), 4: key('Weather', 2, 2) };
  const { shown, owner } = layout(keys, 4, 3);
  expect(shown).toEqual(['0', '4']);
  expect(owner).toEqual({ 0: '0', 1: '0', 4: '4', 5: '4', 8: '4', 9: '4' });
});

test('single keys swap when moved and replace when added; widgets need free room', () => {
  const keys = { 0: key('A'), 1: key('B') };
  expect(place(keys, 4, 2, keys[0], '1', '0')).toEqual({ 0: keys[1], 1: keys[0] });
  expect(place(keys, 4, 2, key('C'), '1')).toEqual({ 0: keys[0], 1: key('C') });
  const w = key('Weather', 2, 1);
  expect(place(keys, 4, 2, w, '0')).toBeNull();
  expect(place(keys, 4, 2, w, '3')).toBeNull(); // runs off the right edge
  expect(place(keys, 4, 2, w, '2')).toEqual({ ...keys, 2: w });
  // A widget can move onto slots it already covers.
  const placed = { 2: w };
  expect(place(placed, 4, 2, w, '1', '2')).toEqual({ 1: w });
  // A single key can't land on a widget.
  expect(place({ ...placed, 0: keys[0] }, 4, 2, keys[0], '3', '0')).toBeNull();
});
