import { angleAt, clamp, turn } from '../src/dialMath';

test('angleAt measures clockwise from +x in screen coordinates', () => {
  expect(angleAt(10, 0, 0, 0)).toBe(0);
  expect(angleAt(0, 10, 0, 0)).toBe(90); // straight down
  expect(angleAt(0, -10, 0, 0)).toBe(-90); // straight up
});

test('turn takes the short way round, across the ±180° seam', () => {
  expect(turn(10, 30)).toBe(20);
  expect(turn(30, 10)).toBe(-20);
  expect(turn(170, -170)).toBe(20); // clockwise across the seam
  expect(turn(-170, 170)).toBe(-20);
  expect(turn(0, 180)).toBe(180);
});

test('clamp', () => {
  expect(clamp(12, 0, 10)).toBe(10);
  expect(clamp(-1, 0, 10)).toBe(0);
  expect(clamp(4.5, 0, 10)).toBe(4.5);
});
