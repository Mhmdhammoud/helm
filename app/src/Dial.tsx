import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { Canvas, Circle, Path, Skia, SweepGradient, vec } from 'react-native-skia';
import { C } from './theme';
import { START, SWEEP, valueAt } from './dialMath';


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
};

/** Touch dial: put a finger anywhere on it and turn. Snaps to whole steps; ignores server echoes while touched. */
export function Dial({ value, min, max, size, label, onChange, bipolar, format = String }: Props) {
  const [local, setLocal] = useState(value);
  const busyUntil = useRef(0);
  const live = useRef({ local, min, max, onChange });
  live.current = { local, min, max, onChange };

  useEffect(() => {
    if (Date.now() >= busyUntil.current) setLocal(value);
  }, [value]);

  const pan = useMemo(() => {
    const fromTouch = (x: number, y: number) => valueAt(x, y, size, live.current.min, live.current.max);
    const move = (e: any) => {
      busyUntil.current = Date.now() + 2500;
      const v = fromTouch(e.nativeEvent.locationX, e.nativeEvent.locationY);
      if (v !== live.current.local) {
        live.current.local = v;
        setLocal(v);
        live.current.onChange(v);
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: move,
      onPanResponderMove: move,
      onPanResponderRelease: () => { busyUntil.current = Date.now() + 2500; },
    });
  }, [size]);

  const stroke = Math.max(6, size * 0.045);
  const r = size / 2 - stroke;
  const { track, arc, ticks } = useMemo(() => {
    const rect = Skia.XYWHRect(stroke, stroke, r * 2, r * 2);
    const frac = (local - min) / (max - min);
    const mid = bipolar ? 0.5 : 0;
    const t = Skia.PathBuilder.Make();
    t.addArc(rect, START, SWEEP);
    const a = Skia.PathBuilder.Make();
    const from = START + SWEEP * Math.min(mid, frac);
    a.addArc(rect, from, Math.max(0.5, SWEEP * Math.abs(frac - mid)));
    const k = Skia.PathBuilder.Make();
    for (let i = 0; i <= max - min; i++) {
      const ang = ((START + (SWEEP * i) / (max - min)) * Math.PI) / 180;
      const r1 = r - stroke * 1.4;
      const r2 = r - stroke * (i % 5 === 0 ? 2.6 : 2);
      k.moveTo(size / 2 + Math.cos(ang) * r1, size / 2 + Math.sin(ang) * r1);
      k.lineTo(size / 2 + Math.cos(ang) * r2, size / 2 + Math.sin(ang) * r2);
    }
    return { track: t.build(), arc: a.build(), ticks: k.build() };
  }, [local, min, max, r, stroke, size, bipolar]);

  const knob = useMemo(() => {
    const ang = ((START + (SWEEP * (local - min)) / (max - min)) * Math.PI) / 180;
    return vec(size / 2 + Math.cos(ang) * r, size / 2 + Math.sin(ang) * r);
  }, [local, min, max, r, size]);

  return (
    <View style={{ width: size, height: size }} {...pan.panHandlers} accessibilityLabel={`${label} ${local}`}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Circle cx={size / 2} cy={size / 2} r={r - stroke * 3.2} color="#15171a" />
        <Path path={ticks} style="stroke" strokeWidth={1.5} color={C.hairline} />
        <Path path={track} style="stroke" strokeWidth={stroke} strokeCap="round" color="#ffffff14" />
        <Path path={arc} style="stroke" strokeWidth={stroke} strokeCap="round">
          <SweepGradient c={vec(size / 2, size / 2)} colors={['#8d939b', C.silver, '#ffffff', '#8d939b']} />
        </Path>
        <Circle c={knob} r={stroke * 0.95} color="#ffffff" />
      </Canvas>
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <Text style={[styles.value, { fontSize: size * 0.24 }]}>{format(local)}</Text>
        <Text style={[styles.label, { fontSize: Math.max(10, size * 0.045) }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  value: { color: C.text, fontWeight: '200', fontVariant: ['tabular-nums'] },
  label: { color: C.label, letterSpacing: 2, fontWeight: '600', marginTop: 2 },
});
