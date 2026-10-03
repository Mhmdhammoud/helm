// Worklets: the knob's gestures run these on the UI thread.
export const START = 135; // degrees clockwise from +x, same geometry as the Mac knob
export const SWEEP = 270;

/** Angle of (x, y) around (cx, cy), in degrees clockwise from +x (screen coordinates). */
export function angleAt(x: number, y: number, cx: number, cy: number) {
  'worklet';
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}

/** Signed shortest turn from angle `a` to angle `b`, in (-180, 180]. Clockwise is positive. */
export function turn(a: number, b: number) {
  'worklet';
  const d = (((b - a) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

export function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}
