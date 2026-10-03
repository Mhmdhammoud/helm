import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlendColor, Blur, Canvas, Group, ImageShader, Image as SkiaImage, Rect, Shader, Skia, useImage } from 'react-native-skia';
import Animated, { interpolate, useAnimatedStyle, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { PairingGlow } from './PairingGlow';
import { C } from './theme';

/** Mark box in points. Must match the SplashMark image view in ios/Helm/LaunchScreen.storyboard (200x200, centred, aspect-fit). */
const MARK = 200;
const PAD = 60; // canvas overhang so the halo fades out instead of clipping
const INTRO = 800; // wave + sheen; also the minimum time on screen
const EXIT = 500;

// Light that only lives on the mark's own pixels: a broad diagonal front lights the keys in a
// wave, a thin silver sheen trails it, and `glow` lifts everything while we breathe.
const fx = Skia.RuntimeEffect.Make(`
uniform shader img;
uniform float4 box;   // x, y, w, h of the mark
uniform float wave;   // front position along the diagonal, ~-0.4..1.4
uniform float glow;   // 0..1 breathing lift

half4 main(float2 xy) {
  half4 m = img.eval(xy);
  float2 uv = (xy - box.xy) / box.zw;
  float d = (uv.x + uv.y) * 0.5;
  float front = exp(-pow((d - wave) * 6.0, 2.0));
  float s = dot(uv, float2(0.87, 0.5)) - (wave * 1.25 - 0.2);
  float sheen = exp(-s * s * 600.0);
  float k = clamp(front * 0.6 + sheen * 0.85 + glow * 0.14, 0.0, 1.0) * float(m.a);
  return half4(half3(0.9, 0.92, 0.95) * k, k);
}`)!;

const src = require('../assets/brand/splash-mark.png');

/**
 * Launch intro. Frame one is pixel-identical to the native launch screen (same image from the
 * asset catalog, same box), then the keys light in a wave and the mark lifts away to reveal the
 * deck. Holds a calm breathing state until `ready`; never blocks for longer than it has to.
 */
export function Splash({ ready }: { ready: boolean }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const img = useImage(src);
  const [introDone, setIntroDone] = useState(reduce);
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(false);
  const intro = useSharedValue(reduce ? 1 : 0); // linear progress 0..1
  const exit = useSharedValue(0); // linear progress 0..1
  const breath = useSharedValue(0);
  const breathT = useSharedValue(0);
  const waiting = useSharedValue(0);
  const leaving = useSharedValue(0);
  const exitMs = reduce ? 350 : EXIT;

  // One clock for the whole sequence. dt is clamped so a stall (first shader compiles, the deck
  // mounting underneath) pauses the animation instead of skipping it.
  useFrameCallback(({ timeSincePreviousFrame }) => {
    'worklet';
    const dt = Math.min(timeSincePreviousFrame ?? 16, 34);
    if (intro.value < 1) {
      intro.value = Math.min(1, intro.value + dt / INTRO);
      if (intro.value === 1) scheduleOnRN(setIntroDone, true);
    }
    breathT.value = waiting.value ? breathT.value + dt : 0;
    const target = waiting.value ? 0.5 - 0.5 * Math.cos((breathT.value / 1600) * Math.PI) : 0;
    breath.value += (target - breath.value) * Math.min(1, dt / 160);
    if (leaving.value && exit.value < 1) {
      exit.value = Math.min(1, exit.value + dt / exitMs);
      if (exit.value === 1) scheduleOnRN(setDone, true);
    }
  });

  // Still loading after the intro: breathe until ready. Ready: lift away.
  useEffect(() => {
    waiting.value = introDone && !ready ? 1 : 0;
    if (introDone && ready) {
      leaving.value = 1;
      setExiting(true);
    }
  }, [introDone, ready, waiting, leaving]);

  const ease = (x: number) => {
    'worklet';
    return x * x * (3 - 2 * x);
  };
  const bg = useAnimatedStyle(() => ({ opacity: 1 - ease(interpolate(exit.value, [0.2, 1], [0, 1], 'clamp')) }));
  const mark = useAnimatedStyle(() => ({
    opacity: 1 - ease(interpolate(exit.value, [0, 0.75], [0, 1], 'clamp')),
    transform: [{ scale: reduce ? 1 : 1 + 0.16 * exit.value * exit.value }],
  }));
  const edge = useAnimatedStyle(() => ({ opacity: 0.6 * (1 - exit.value) }));
  const uniforms = useDerivedValue(() => ({
    box: [PAD, PAD, MARK, MARK],
    wave: interpolate(ease(intro.value), [0, 1], [-0.4, 1.4]),
    glow: breath.value,
  }));
  const halo = useDerivedValue(() => 0.28 * Math.sin(Math.PI * intro.value) + 0.35 * breath.value + 0.4 * Math.sin(Math.PI * exit.value));

  if (done) return null;
  const canvas = { position: 'absolute' as const, left: -PAD, top: -PAD, width: MARK + PAD * 2, height: MARK + PAD * 2 };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={exiting ? 'none' : 'auto'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }, bg]} />
      {!reduce && (
        <Animated.View style={[StyleSheet.absoluteFill, edge]} pointerEvents="none">
          <PairingGlow active={!exiting} width={width} height={height} radius={18} />
        </Animated.View>
      )}
      <View style={[StyleSheet.absoluteFill, st.center]} pointerEvents="none">
        <Animated.View style={[{ width: MARK, height: MARK }, mark]}>
          {!reduce && img && (
            <Canvas style={canvas}>
              <Group opacity={halo}>
                <SkiaImage image={img} fit="contain" x={PAD} y={PAD} width={MARK} height={MARK}>
                  <BlendColor color={C.silver} mode="srcIn" />
                  <Blur blur={22} />
                </SkiaImage>
              </Group>
            </Canvas>
          )}
          {/* The asset-catalog copy draws on the first frame; the Skia copy above/below may load a beat later. */}
          <Image source={{ uri: 'SplashMark' }} style={{ width: MARK, height: MARK }} resizeMode="contain" fadeDuration={0} />
          {!reduce && img && (
            <Canvas style={canvas}>
              <Rect x={PAD} y={PAD} width={MARK} height={MARK}>
                <Shader source={fx} uniforms={uniforms}>
                  <ImageShader image={img} fit="contain" rect={Skia.XYWHRect(PAD, PAD, MARK, MARK)} />
                </Shader>
              </Rect>
            </Canvas>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
