import { valueAt } from '../src/dialMath';

// 100pt dial, centre (50, 50). The arc starts bottom-left (135°) and runs clockwise 270° to bottom-right.
const at = (deg: number, min = 0, max = 10) => {
  const r = (deg * Math.PI) / 180;
  return valueAt(50 + Math.cos(r) * 40, 50 + Math.sin(r) * 40, 100, min, max);
};

test('maps the arc onto the range', () => {
  expect(at(135)).toBe(0); // start
  expect(at(270)).toBe(5); // top
  expect(at(45)).toBe(10); // end
  expect(at(270, -10, 10)).toBe(0); // bipolar centre
});

test('dead zone at the bottom snaps to the nearer end', () => {
  expect(at(100)).toBe(0); // just right of the start (bottom-left side)
  expect(at(80)).toBe(10); // just left of the end (bottom-right side)
});
