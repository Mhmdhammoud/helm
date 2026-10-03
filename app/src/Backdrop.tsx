import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Blur, Canvas, Fill, Shader, Skia } from 'react-native-skia';
import {
  Easing,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// Brushed-metal noise field, shared with Hush. `calm` 0 = turbulent silver grain, 1 = still graphite.
// Time is fed as two angles (wrapped at 2π) that orbit through noise space, so
// the loop is seamless and coordinates stay small (safe at half precision).
const effect = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float a1;     // slow orbit angle, 0..2π
uniform float a2;     // fast orbit angle, 0..2π
uniform float calm;   // eased anc 0..1
uniform float seed;   // 0..63 grain frame index

// sine-free hash (Hoskins), fine for small inputs
float2 hash2(float2 p) {
  float3 p3 = fract(float3(p.xyx) * float3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}
float hash1(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// gradient noise with quintic fade: no visible cell grid
float gnoise(float2 p) {
  float2 i = floor(p);
  float2 f = p - i;
  float2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash2(i), f);
  float b = dot(hash2(i + float2(1, 0)), f - float2(1, 0));
  float c = dot(hash2(i + float2(0, 1)), f - float2(0, 1));
  float d = dot(hash2(i + float2(1, 1)), f - float2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); // ~[-0.7, 0.7]
}

// 4-octave fBm, rotated per octave to break axis alignment
float fbm(float2 p, float rough) {
  const float2x2 R = float2x2(0.80, 0.60, -0.60, 0.80);
  float s = 0.0, amp = 0.5;
  for (int k = 0; k < 4; k++) {
    s += amp * gnoise(p);
    p = R * p * 2.03 + float2(1.7, 9.2);
    amp *= rough;
  }
  return s;
}

half4 main(float2 xy) {
  float chaos = 1.0 - calm;
  float c2 = chaos * chaos;
  float2 uv = xy / res.y;               // 0..~1
  float2 p = (uv - 0.5) * mix(2.2, 3.4, chaos);
  p.x *= mix(0.55, 0.8, chaos);         // slight horizontal stretch: brushed grain

  // orbiting time offsets (seamless when angles wrap)
  float2 o1 = float2(cos(a1), sin(a1)) * 1.3;
  float2 o2 = float2(cos(a2), sin(a2)) * 0.9;

  float rough = mix(0.42, 0.62, chaos);
  float2 q = float2(fbm(p + o1, rough), fbm(p + float2(5.2, 1.3) - o1.yx, rough));
  float warp = mix(0.6, 2.6, chaos);
  float h = fbm(p + warp * q + o2 * chaos + o1 * 0.4, rough); // ~[-0.6, 0.6]
  h = h * 0.5 + 0.5 + 0.15 * q.x;

  // palette
  float3 graphite = float3(0.030, 0.032, 0.037);
  float3 steel    = float3(0.20, 0.21, 0.235);
  float3 silver   = float3(0.80, 0.82, 0.86);

  // body: dark graphite, lifted toward steel by the field
  float body = smoothstep(0.15, 0.95, h);
  float3 col = mix(graphite, steel, body * mix(0.5, 0.8, chaos));

  // specular ridges: thin bright contours of the height field (liquid metal)
  float ridgeW = mix(3.5, 22.0, chaos);
  float ridge = exp(-pow((h - 0.62) * ridgeW, 2.0));
  float ridge2 = exp(-pow((h - 0.40) * ridgeW * 1.4, 2.0));
  col += silver * (ridge * mix(0.07, 0.85, chaos) + ridge2 * 0.35 * c2);

  // calm shimmer: a broad, slow diagonal sheen drifting across the surface
  float sweep = dot(uv, float2(0.75, 0.45)) - (0.55 + 0.45 * sin(a1));
  float sheen = exp(-sweep * sweep * 7.0) * (0.55 + 0.45 * body);
  col += silver * sheen * mix(0.11, 0.03, chaos);

  // brushed hairlines: fine anisotropic streaks, always present, faint
  float hair = gnoise(float2(xy.x * 0.012, xy.y * 0.9)) * 0.5 + 0.5;
  col += (hair - 0.5) * (0.02 + 0.06 * sheen) * (0.5 + 0.5 * calm);

  // grain + silver flecks, mostly at low ANC
  float g = hash1(xy + seed * float2(17.13, 31.71));
  col += (g - 0.5) * mix(0.012, 0.11, chaos);
  float fleck = smoothstep(1.0 - 0.035 * c2, 1.0, g) * smoothstep(0.35, 0.8, h);
  col += silver * fleck * 1.4 * c2;

  // vignette
  float2 v = xy / res - 0.5;
  col *= 1.0 - dot(v, v) * 0.9;

  return half4(half3(clamp(col, 0.0, 1.0)), 1.0);
}`)!;

const TAU = Math.PI * 2;

// Which mounted backdrop is on top (the most recently mounted one).
let stack: number[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
function useIsTopBackdrop() {
  const [id] = React.useState(() => nextId++);
  const top = React.useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => stack[stack.length - 1] === id,
  );
  useEffect(() => {
    stack = [...stack, id];
    listeners.forEach(l => l());
    return () => { stack = stack.filter(x => x !== id); listeners.forEach(l => l()); };
  }, [id]);
  return top;
}

/** Full-screen backdrop: the noise field, blurred, under a scrim so keys stay legible. */
export function Backdrop({ calm: anc = 0.85, blur = 18 }: { calm?: number; blur?: number }) {
  const { width, height } = useWindowDimensions();
  const calm = useSharedValue(anc);
  const a1 = useSharedValue(0);
  const a2 = useSharedValue(0);
  const seed = useSharedValue(0);

  useEffect(() => {
    calm.value = withTiming(Math.min(1, Math.max(0, anc)), {
      duration: 1400,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [anc, calm]);

  // Integrate phase on the UI thread: speed follows `calm`, so changing ANC
  // changes the tempo without any jump in the field.
  // Helm sits on screen all day, so the field only advances ~20 times a second (it's blurred and slow;
  // more is invisible) and only the topmost backdrop moves: an open panel freezes the one under it.
  const acc = useSharedValue(0);
  const top = useIsTopBackdrop();
  const frame = useFrameCallback(({ timeSincePreviousFrame }) => {
    'worklet';
    acc.value += Math.min(timeSincePreviousFrame ?? 16, 64) / 1000;
    if (acc.value < 0.05) return;
    const dt = acc.value;
    acc.value = 0;
    const chaos = 1 - calm.value;
    a1.value = (a1.value + dt * (0.035 + 0.12 * chaos * chaos)) % TAU;
    a2.value = (a2.value + dt * (0.03 + 0.35 * chaos)) % TAU;
    seed.value = (seed.value + 1) % 64;
  }, false);
  useEffect(() => frame.setActive(top), [top, frame]);

  const uniforms = useDerivedValue(() => ({
    res: [width, height],
    a1: a1.value,
    a2: a2.value,
    calm: calm.value,
    seed: seed.value,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <Canvas style={{ width, height }}>
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
        {/* Soften the metal so it reads as atmosphere behind the controls, not texture. */}
        <Blur blur={blur} mode="clamp" />
      </Fill>
    </Canvas>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,7,9,0.55)' }]} />
    </View>
  );
}
