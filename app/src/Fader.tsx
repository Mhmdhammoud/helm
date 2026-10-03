import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, withSpring } from 'react-native-reanimated';
import { Canvas, Group, LinearGradient, Path, RoundedRect, Shadow, Skia, vec } from 'react-native-skia';
import { C, SPRING } from './theme';

/**
 * DJ-mixer style vertical fader: a recessed slot with a scale and a machined cap you push up and down.
 * Moves in whole steps; `onStep(+1 | -1)` fires once per step crossed (throttled), so it works for
 * controls the Mac can only nudge (brightness keys) as well as absolute ones via `value`.
 */
export function Fader({ value, steps = 16, height = 300, width = 84, label, format, onStep }: {
  /** Current position in steps, if the Mac can report it; otherwise the fader keeps its own. */
  value?: number | null;
  steps?: number;
  height?: number;
  width?: number;
  label: string;
  format?: (step: number) => string;
  onStep: (delta: number, step: number) => void;
}) {
  const capH = 44;
  const top = capH / 2 + 6;
  const travel = height - top * 2;
  const [step, setStep] = useState(value ?? Math.round(steps / 2));
  const pos = useSharedValue(step);
  const r = useRef({ step, steps, onStep, from: 0, busyUntil: 0 });
  r.current.steps = steps;
  r.current.onStep = onStep;

  // Follow the Mac when it reports a value, except while (or just after) the user is moving the cap.
  useEffect(() => {
    if (value == null || Date.now() < r.current.busyUntil) return;
    r.current.step = value;
    setStep(value);
    pos.value = withSpring(value, SPRING);
  }, [value, pos]);

  // At most one step command per 60ms; queued deltas are summed so nothing is lost.
  const queued = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const send = (d: number) => {
    queued.current += d;
    if (timer.current) return;
    const flush = () => {
      const q = queued.current;
      queued.current = 0;
      if (!q) return void (timer.current = null);
      r.current.onStep(q, r.current.step);
      timer.current = setTimeout(flush, 60);
    };
    flush();
  };

  const pan = usePanGesture({
    minDistance: 0,
    enableTrackpadTwoFingerGesture: true, // mouse wheel and trackpad scrolling move it too
    runOnJS: true,
    onBegin: () => { r.current.from = r.current.step; },
    onUpdate: e => {
      const { steps: n } = r.current;
      const v = Math.min(n, Math.max(0, r.current.from - (e.translationY / travel) * n));
      pos.value = v;
      r.current.busyUntil = Date.now() + 1500;
      const s = Math.round(v);
      if (s !== r.current.step) {
        send(s - r.current.step);
        r.current.step = s;
        setStep(s);
      }
    },
    onFinalize: () => {
      pos.value = withSpring(r.current.step, SPRING);
      r.current.busyUntil = Date.now() + 1500;
    },
  });

  const cx = width / 2;
  const slot = Skia.RRectXY(Skia.XYWHRect(cx - 4, top, 8, travel), 4, 4);
  const ticks = (() => {
    const b = Skia.PathBuilder.Make();
    for (let i = 0; i <= steps; i++) {
      const y = top + travel - (i / steps) * travel;
      const long = i % 4 === 0;
      b.moveTo(cx - 16 - (long ? 8 : 4), y).lineTo(cx - 16, y);
      b.moveTo(cx + 16, y).lineTo(cx + 16 + (long ? 8 : 4), y);
    }
    return b.build();
  })();
  const capY = useDerivedValue(() => top + travel - (pos.value / steps) * travel - capH / 2);
  const capTransform = useDerivedValue(() => [{ translateY: capY.value }]);
  const fill = useDerivedValue(() => Skia.RRectXY(Skia.XYWHRect(cx - 2, capY.value + capH / 2, 4, top + travel - capY.value - capH / 2), 2, 2));

  return (
    <View style={st.wrap}>
      <GestureDetector gesture={pan}>
      <View style={{ width, height }} accessibilityRole="adjustable" accessibilityLabel={`${label} ${step}`}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e => {
          const d = e.nativeEvent.actionName === 'increment' ? 1 : -1;
          const s = Math.min(steps, Math.max(0, r.current.step + d));
          if (s === r.current.step) return;
          send(d);
          r.current.step = s;
          setStep(s);
          pos.value = withSpring(s, SPRING);
        }}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Path path={ticks} style="stroke" strokeWidth={1.2} color="#ffffff30" />
          {/* recessed slot */}
          <RoundedRect rect={slot} color="#050607">
            <Shadow dx={0} dy={1} blur={2} color="#000000" inner />
          </RoundedRect>
          <RoundedRect rect={fill} color={C.silver}>
            <Shadow dx={0} dy={0} blur={6} color="#ffffff66" />
          </RoundedRect>
          {/* machined cap with a grip line */}
          <Group transform={capTransform}>
            <RoundedRect x={cx - 26} y={0} width={52} height={capH} r={8}>
              <LinearGradient start={vec(0, 0)} end={vec(0, capH)} colors={['#e9ecf0', '#a9aeb6', '#7d828a', '#c3c8cf']} positions={[0, 0.45, 0.55, 1]} />
              <Shadow dx={0} dy={6} blur={10} color="#000000cc" />
            </RoundedRect>
            <RoundedRect x={cx - 26} y={0} width={52} height={capH} r={8} style="stroke" strokeWidth={1} color="#ffffff55" />
            <RoundedRect x={cx - 20} y={capH / 2 - 1} width={40} height={2} r={1} color="#1a1c1f" />
          </Group>
        </Canvas>
      </View>
      </GestureDetector>
      {(format ? format(step) : String(step)) !== '' && <Text style={st.value}>{format ? format(step) : step}</Text>}
      <Text style={st.label}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 2 },
  value: { color: C.text, fontSize: 22, fontWeight: '200', fontVariant: ['tabular-nums'], marginTop: 6 },
  label: { color: C.label, fontSize: 10, letterSpacing: 2, fontWeight: '600' },
});
