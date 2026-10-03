import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Canvas, Circle, Group, LinearGradient, Path, RadialGradient, Shadow, Skia, SweepGradient, vec } from 'react-native-skia';
import { C } from './theme';
import { START, SWEEP, angleAt, clamp, turn } from './dialMath';

type Props = {
  value: number;
  min: number;
  max: number;
  size: number;
  label: string;
  onChange: (v: number) => void;
  /** Arc grows from the middle (EQ) instead of from min (ANC). */
  bipolar?: boolean;
  format?: (v: number) => string;
  /** Double-tap action (volume: mute on/off). Without it, double-tap centres a bipolar dial. */
  onDoubleTap?: () => void;
};

// Softer than the app SPRING so the indicator visibly settles into its detent.
const DETENT = { damping: 16, stiffness: 240, mass: 0.6 };
const SETTLE_MS = 1500; // after release, trust the device again
const SEND_MS = 80; // at most one onChange per 80ms

/**
 * Machined touch knob (the Hush knob, scaled up for fingers).
 * Grab the rim and turn it, or put a finger on the face and slide up/right to increase.
 * Movement is relative from touch-down (never jumps to the finger), the indicator follows
 * continuously with a soft pull toward each whole step, and springs into the step on release.
 * Double-tap centres a bipolar dial.
 */
export function Dial({ value, min, max, size, label, onChange, bipolar, format = String, onDoubleTap }: Props) {
  const doubleTap = useRef(onDoubleTap);
  doubleTap.current = onDoubleTap;
  const range = max - min;
  const [step, setStep] = useState(value);
  const pos = useSharedValue(value); // continuous position, drives the drawing on the UI thread
  const pulse = useSharedValue(0); // flashes the arc glow on each detent

  const c = size / 2;
  const arcW = Math.max(2.5, size * 0.014);
  const ringR = c - Math.max(5, size * 0.035);
  const bodyR = c * 0.68;

  const live = useRef({ step, cur: value, value, min, max, range, onChange, bodyR, c, size });
  Object.assign(live.current, { value, min, max, range, onChange, bodyR, c, size });

  // Device echoes are ignored while touched and until SETTLE_MS after release, then we resync.
  const touching = useRef(false);
  const busyUntil = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sync = () => {
    const v = live.current.value;
    live.current.step = live.current.cur = v;
    setStep(v);
    pos.value = withSpring(v, DETENT);
  };
  useEffect(() => {
    if (!touching.current && Date.now() >= busyUntil.current) sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Throttle: first change goes out at once, then one per SEND_MS, always ending on the latest.
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commit = (v: number) => {
    pending.current = v;
    if (timer.current) return;
    const flush = () => {
      if (pending.current == null) return void (timer.current = undefined);
      live.current.onChange(pending.current);
      pending.current = null;
      timer.current = setTimeout(flush, SEND_MS);
    };
    flush();
  };
  useEffect(() => () => { timer.current && clearTimeout(timer.current); settle.current && clearTimeout(settle.current); }, []);

  /** Set the continuous position; a whole-step crossing is a detent. */
  const moveTo = (v: number, animate: boolean) => {
    const L = live.current;
    L.cur = clamp(v, L.min, L.max);
    const n = Math.round(L.cur);
    pos.value = animate ? withSpring(n, DETENT) : L.cur;
    if (n !== L.step) {
      L.step = n;
      setStep(n);
      pulse.value = withSequence(withTiming(1, { duration: 40 }), withTiming(0, { duration: 260 }));
      commit(n);
    }
  };
  const release = () => {
    touching.current = false;
    busyUntil.current = Date.now() + SETTLE_MS;
    settle.current && clearTimeout(settle.current);
    settle.current = setTimeout(sync, SETTLE_MS);
  };
  const act = useRef({ moveTo, release });
  act.current = { moveTo, release };

  // Per-touch tracking for the pan below.
  const t = useRef({ mode: 'turn' as 'turn' | 'slide', cx: 0, cy: 0, lastAngle: 0, lastDx: 0, lastDy: 0 });
  const bipolarRef = useRef(bipolar);
  bipolarRef.current = bipolar;
  const pan = usePanGesture({
    minDistance: 0,
    runOnJS: true,
    onBegin: e => {
      const L = live.current;
      const g = t.current;
      touching.current = true;
      settle.current && clearTimeout(settle.current);
      g.cx = e.absoluteX - e.x + L.c;
      g.cy = e.absoluteY - e.y + L.c;
      g.mode = Math.hypot(e.x - L.c, e.y - L.c) > L.bodyR * 0.85 ? 'turn' : 'slide';
      g.lastAngle = angleAt(e.absoluteX, e.absoluteY, g.cx, g.cy);
      g.lastDx = g.lastDy = 0;
    },
    onUpdate: e => {
      const L = live.current;
      const g = t.current;
      let delta: number;
      if (g.mode === 'turn') {
        const a = angleAt(e.absoluteX, e.absoluteY, g.cx, g.cy);
        // Right at the centre the angle is noise; just track it without moving.
        delta = Math.hypot(e.absoluteX - g.cx, e.absoluteY - g.cy) < L.c * 0.2 ? 0 : (turn(g.lastAngle, a) / SWEEP) * L.range;
        g.lastAngle = a;
      } else {
        // Up or right increases; a long, calm throw for the whole range.
        delta = ((e.translationX - g.lastDx - (e.translationY - g.lastDy)) / Math.max(240, L.size * 1.5)) * L.range;
      }
      g.lastDx = e.translationX;
      g.lastDy = e.translationY;
      if (delta) act.current.moveTo(L.cur + delta, false);
    },
    onFinalize: () => {
      act.current.moveTo(live.current.step, true);
      act.current.release();
    },
  });
  // Recognised alongside the pan, so the knob still turns from the first touch.
  const twoTaps = useTapGesture({
    numberOfTaps: 2,
    enabled: !!onDoubleTap || !!bipolar,
    runOnJS: true,
    onActivate: () => {
      const L = live.current;
      if (doubleTap.current) doubleTap.current();
      else if (bipolarRef.current) { act.current.moveTo((L.min + L.max) / 2, true); act.current.release(); }
    },
  });
  const gesture = useSimultaneousGestures(pan, twoTaps);

  // Static geometry.
  const { track, ticks, majors } = useMemo(() => {
    const rect = Skia.XYWHRect(c - ringR, c - ringR, ringR * 2, ringR * 2);
    const steps = range > 30 ? 30 : range;
    const t = Skia.PathBuilder.Make();
    const m = Skia.PathBuilder.Make();
    const r1 = ringR - arcW * 2.2;
    for (let i = 0; i <= steps; i++) {
      const a = ((START + (i / steps) * SWEEP) * Math.PI) / 180;
      const major = i === 0 || i === steps || (bipolar && i === steps / 2) || (!bipolar && steps % 5 === 0 && i % 5 === 0);
      const r2 = r1 - (major ? arcW * 2.4 : arcW * 1.4);
      (major ? m : t).moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1).lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
    }
    return {
      track: Skia.PathBuilder.Make().addArc(rect, START, SWEEP).build(),
      ticks: t.build(),
      majors: m.build(),
    };
  }, [c, ringR, arcW, range, bipolar]);

  // Shown position: a soft magnetic pull toward the nearest step, so turning feels notched
  // without ever jumping (continuous at the half-step, slope 1.6 there, flat at the step).
  const shown = useDerivedValue(() => {
    const n = Math.round(pos.value);
    const d = pos.value - n;
    return n + Math.sign(d) * 0.5 * Math.pow(Math.abs(d) * 2, 1.6);
  });
  const angle = useDerivedValue(() => START + ((shown.value - min) / range) * SWEEP);
  const arc = useDerivedValue(() => {
    const base = bipolar ? START + SWEEP / 2 : START;
    const rect = Skia.XYWHRect(c - ringR, c - ringR, ringR * 2, ringR * 2);
    return Skia.PathBuilder.Make()
      .addArc(rect, Math.min(base, angle.value), Math.max(0.01, Math.abs(angle.value - base)))
      .build();
  });
  const indicator = useDerivedValue(() => {
    const rad = (angle.value * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return Skia.PathBuilder.Make()
      .moveTo(c + cos * bodyR * 0.84, c + sin * bodyR * 0.84)
      .lineTo(c + cos * bodyR * 0.96, c + sin * bodyR * 0.96)
      .build();
  });
  const tip = useDerivedValue(() => {
    const rad = (angle.value * Math.PI) / 180;
    return vec(c + Math.cos(rad) * ringR, c + Math.sin(rad) * ringR);
  });
  const glow = useDerivedValue(() => size * 0.012 + pulse.value * size * 0.03);
  const glowColor = useDerivedValue(() => `rgba(255,255,255,${0.35 + pulse.value * 0.4})`);

  const wellR = bodyR * 0.8;
  const accessibilityActions = [{ name: 'increment' as const }, { name: 'decrement' as const }];

  return (
    <GestureDetector gesture={gesture}>
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(step) }}
      accessibilityActions={onDoubleTap ? [...accessibilityActions, { name: 'activate' }] : accessibilityActions}
      onAccessibilityAction={e => {
        if (e.nativeEvent.actionName === 'activate') return onDoubleTap?.();
        moveTo(step + (e.nativeEvent.actionName === 'increment' ? 1 : -1), true);
        release();
      }}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* ring: track, tick scale, glowing silver value arc */}
        <Path path={track} style="stroke" strokeWidth={arcW} strokeCap="round" color="rgba(255,255,255,0.08)" />
        <Path path={ticks} style="stroke" strokeWidth={Math.max(1, arcW * 0.35)} color="rgba(255,255,255,0.22)" />
        <Path path={majors} style="stroke" strokeWidth={Math.max(1.2, arcW * 0.45)} color="rgba(255,255,255,0.45)" />
        <Path path={arc} style="stroke" strokeWidth={arcW} strokeCap="round" color={C.silver}>
          <Shadow dx={0} dy={0} blur={glow} color={glowColor} />
        </Path>
        <Circle c={tip} r={arcW * 0.9} color="#ffffff">
          <Shadow dx={0} dy={0} blur={glow} color={glowColor} />
        </Circle>

        {/* body: drop shadow, brushed conic sheen, top light, bevelled edge */}
        <Group>
          <Circle cx={c} cy={c} r={bodyR}>
            <SweepGradient c={vec(c, c)} colors={['#3a3d42', '#c9ced6', '#4a4e54', '#e6e9ee', '#3a3d42', '#aeb3bb', '#3a3d42']} />
            <Shadow dx={0} dy={size * 0.03} blur={size * 0.05} color="rgba(0,0,0,0.85)" />
          </Circle>
          <Circle cx={c} cy={c} r={bodyR}>
            <RadialGradient c={vec(c, c - bodyR * 0.55)} r={bodyR * 1.35} colors={['rgba(255,255,255,0.22)', 'rgba(0,0,0,0.45)']} />
          </Circle>
          <Circle cx={c} cy={c} r={bodyR - 0.75} style="stroke" strokeWidth={1.5}>
            <LinearGradient start={vec(c, c - bodyR)} end={vec(c, c + bodyR)} colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.04)', 'rgba(0,0,0,0.5)']} />
          </Circle>
        </Group>

        {/* inner well, recessed */}
        <Circle cx={c} cy={c} r={wellR}>
          <RadialGradient c={vec(c, c + wellR * 0.3)} r={wellR * 1.1} colors={['#1d2024', '#0e0f11']} />
          <Shadow dx={0} dy={size * 0.008} blur={size * 0.016} color="rgba(0,0,0,0.9)" inner />
        </Circle>
        <Circle cx={c} cy={c} r={wellR} style="stroke" strokeWidth={1}>
          <LinearGradient start={vec(c, c - wellR)} end={vec(c, c + wellR)} colors={['rgba(0,0,0,0.6)', 'rgba(255,255,255,0.18)']} />
        </Circle>

        <Path path={indicator} style="stroke" strokeWidth={Math.max(2, size * 0.011)} strokeCap="round" color="#ffffff">
          <Shadow dx={0} dy={0} blur={size * 0.008} color="rgba(255,255,255,0.6)" />
        </Path>
      </Canvas>
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <Text style={[styles.value, { fontSize: wellR * 0.5 }]}>{format(step)}</Text>
        <Text style={[styles.label, { fontSize: Math.max(10, wellR * 0.15), letterSpacing: Math.max(1, wellR * 0.02), maxWidth: wellR * 1.6 }]}
          numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {label}
        </Text>
      </View>
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  value: { color: C.text, fontWeight: '200', fontVariant: ['tabular-nums'] },
  label: { color: C.label, fontWeight: '600', marginTop: 1 },
});
