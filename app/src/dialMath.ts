export const START = 135; // degrees clockwise from +x, same geometry as the Mac knob
export const SWEEP = 270;

/** Value under a touch at (x, y) on a dial of `size`. The dead zone at the bottom splits between the two ends. */
export function valueAt(x: number, y: number, size: number, min: number, max: number) {
  let a = (Math.atan2(y - size / 2, x - size / 2) * 180) / Math.PI - START;
  a = ((a % 360) + 360) % 360;
  if (a > SWEEP) a = a > SWEEP + (360 - SWEEP) / 2 ? 0 : SWEEP;
  return Math.round(min + (a / SWEEP) * (max - min));
}

