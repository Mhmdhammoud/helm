import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Fill, Shader, Skia } from 'react-native-skia';
import { Easing, useDerivedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';

// Ported from Hush: silver light hugging a panel's inner edge while it waits,
// a soft breathing rim plus two comet highlights orbiting the rounded rectangle.
const effect = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float t;       // seconds, wrapped
uniform float alpha;   // fade in/out
uniform float radius;  // corner radius

float sdRoundBox(float2 p, float2 b, float r) {
  float2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

half4 main(float2 xy) {
  float2 c = res * 0.5;
  float d = -sdRoundBox(xy - c, c - 1.0, radius); // distance inside the edge, 0 at the rim
  float rim = exp(-d * 0.07);                       // soft inner glow
  float line = exp(-d * 0.9);                       // crisp edge line

  // Position around the perimeter as an angle; two comets chase each other.
  float a = atan(xy.y - c.y, xy.x - c.x);
  float phase = t * 1.2;
  float c1 = pow(0.5 + 0.5 * cos(a - phase), 12.0);
  float c2 = pow(0.5 + 0.5 * cos(a - phase + 3.14159), 12.0);
  float comets = c1 + 0.6 * c2;

  float breathe = 0.55 + 0.45 * sin(t * 2.0);
  float glow = rim * (0.18 + 0.2 * breathe) + (rim * 1.2 + line * 1.2) * comets;
  float3 silver = float3(0.86, 0.88, 0.92);
  float k = clamp(glow, 0.0, 1.0) * alpha;
  return half4(half3(silver * k), half(k));
}`)!;

export function PairingGlow({ active, width, height, radius = 16 }: { active: boolean; width: number; height: number; radius?: number }) {
  const t = useSharedValue(0);
  const alpha = useSharedValue(0);
  useEffect(() => {
    alpha.value = withTiming(active ? 1 : 0, { duration: active ? 500 : 700, easing: Easing.inOut(Easing.cubic) });
  }, [active, alpha]);
  const frame = useFrameCallback(f => {
    t.value = (t.value + (f.timeSincePreviousFrame ?? 16) / 1000) % 1000;
  }, false);
  useEffect(() => {
    if (active) return frame.setActive(true);
    const id = setTimeout(() => frame.setActive(false), 800); // let the fade-out play
    return () => clearTimeout(id);
  }, [active, frame]);
  const uniforms = useDerivedValue(() => ({ res: [width, height], t: t.value, alpha: alpha.value, radius }));
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
