// Small controls for the Hush panel, in the Hush house style (silver on black, machined metal).
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Canvas, Circle, LinearGradient, Path, Shadow, Skia, SweepGradient, vec } from 'react-native-skia';
import { Symbol } from './Symbol';
import { C, SPRING } from './theme';

/** Translucent panel over the backdrop: faint white fill and a hairline edge. */
export function HushCard({ title, action, children, style }: {
  title?: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[st.card, style]}>
      {title && (
        <View style={st.cardHead}>
          <Text style={st.cardTitle}>{title}</Text>
          {action && (
            <Pressable onPress={action.onPress} hitSlop={14} style={({ pressed }) => [st.cardAction, pressed && st.pressed]}>
              <Text style={st.cardActionText}>{action.label}</Text>
            </Pressable>
          )}
        </View>
      )}
      {children}
    </View>
  );
}

/** Thin battery ring with the percentage in the middle (port of Hush's Ring). */
export function HushRing({ value, size = 52 }: { value: number | null; size?: number }) {
  const w = Math.max(2, size * 0.05);
  const { track, arc } = useMemo(() => {
    const rect = Skia.XYWHRect(w, w, size - w * 2, size - w * 2);
    return {
      track: Skia.PathBuilder.Make().addArc(rect, 0, 360).build(),
      arc: Skia.PathBuilder.Make().addArc(rect, -90, ((value ?? 0) / 100) * 360).build(),
    };
  }, [value, size, w]);
  const low = value != null && value <= 20;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`Battery ${value ?? 'unknown'}%`}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Path path={track} style="stroke" strokeWidth={w} color="rgba(255,255,255,0.1)" />
        {value != null && value > 0 && (
          <Path path={arc} style="stroke" strokeWidth={w} strokeCap="round" color={low ? C.danger : C.silver}>
            <Shadow dx={0} dy={0} blur={3} color={low ? 'rgba(232,160,160,0.5)' : 'rgba(255,255,255,0.35)'} />
          </Path>
        )}
      </Canvas>
      <View style={[StyleSheet.absoluteFill, st.center]}>
        <Text style={[st.ringText, { fontSize: size * 0.28 }]}>
          {value ?? '–'}
          <Text style={[st.ringPct, { fontSize: size * 0.16 }]}>%</Text>
        </Text>
      </View>
    </View>
  );
}

/** Pill selector with a silver thumb that springs to the chosen option. */
export function HushSegmented<T extends string>({ options, value, onChange, labels, disabled }: {
  options: readonly T[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  disabled?: boolean;
}) {
  const [w, setW] = useState(0);
  const seg = w / options.length;
  const idx = value == null ? -1 : options.indexOf(value);
  const x = useSharedValue(0);
  const shown = useSharedValue(0);
  useEffect(() => {
    if (idx >= 0) {
      // First placement jumps; later changes slide.
      x.value = shown.value ? withSpring(idx * seg, SPRING) : idx * seg;
    }
    shown.value = withSpring(idx >= 0 && seg > 0 ? 1 : 0, SPRING);
  }, [idx, seg, x, shown]);
  const thumb = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateX: x.value }] }));

  return (
    <View style={[st.segRow, disabled && st.disabled]} onLayout={e => setW(e.nativeEvent.layout.width - 6)} pointerEvents={disabled ? 'none' : 'auto'}>
      <Animated.View style={[st.segThumb, { width: seg }, thumb]} />
      {options.map((o, i) => (
        <Pressable key={o} onPress={() => onChange(o)} style={st.seg} accessibilityRole="button" accessibilityState={{ selected: i === idx }}>
          <Text style={[st.segText, i === idx && st.segTextOn]}>{labels?.[o] ?? o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Labelled row with a silver switch; the thumb springs across. */
export function HushToggle({ label, hint, value, onChange, disabled }: {
  label: string;
  hint?: string;
  value: boolean | null | undefined;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    on.value = withSpring(value ? 1 : 0, SPRING);
  }, [value, on]);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], ['rgba(255,255,255,0.1)', C.silver]),
  }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * 22 }],
    backgroundColor: interpolateColor(on.value, [0, 1], ['#9aa0a8', C.bg]),
  }));
  return (
    <Pressable
      onPress={() => value != null && onChange(!value)}
      disabled={disabled}
      style={({ pressed }) => [st.toggleRow, disabled && st.disabled, pressed && st.pressed]}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value, disabled }}>
      <View style={st.flex}>
        <Text style={st.toggleLabel}>{label}</Text>
        {hint && <Text style={st.toggleHint}>{hint}</Text>}
      </View>
      <Animated.View style={[st.track, track]}>
        <Animated.View style={[st.thumb, thumb]} />
      </Animated.View>
    </Pressable>
  );
}

/** Small machined metal button: brushed disc, SF Symbol, label underneath. Presses in on touch. */
export function HushButton({ symbol, label, onPress, on, size = 64 }: {
  symbol: string;
  label: string;
  onPress: () => void;
  on?: boolean;
  size?: number;
}) {
  const press = useSharedValue(0);
  const face = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.06 }] }));
  const c = size / 2;
  const r = c - 6;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => { press.value = withSpring(1, SPRING); }}
      onPressOut={() => { press.value = withSpring(0, SPRING); }}
      style={st.button}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Animated.View style={[{ width: size, height: size }, st.center, face]}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Circle cx={c} cy={c} r={r}>
            {on ? (
              <SweepGradient c={vec(c, c)} colors={['#b8bdc5', '#f4f6f9', '#c3c8cf', '#ffffff', '#b8bdc5', '#e3e6ea', '#b8bdc5']} />
            ) : (
              <SweepGradient c={vec(c, c)} colors={['#2a2c30', '#6d7178', '#33363b', '#80848b', '#2a2c30', '#5b5f66', '#2a2c30']} />
            )}
            <Shadow dx={0} dy={3} blur={6} color="rgba(0,0,0,0.8)" />
          </Circle>
          <Circle cx={c} cy={c} r={r - 0.75} style="stroke" strokeWidth={1.5}>
            <LinearGradient start={vec(c, c - r)} end={vec(c, c + r)} colors={['rgba(255,255,255,0.5)', 'rgba(255,255,255,0.03)', 'rgba(0,0,0,0.5)']} />
          </Circle>
        </Canvas>
        <Symbol name={symbol} size={size * 0.3} weight="medium" color={on ? C.bg : C.text} />
      </Animated.View>
      <Text style={st.buttonLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    padding: 22,
    gap: 16,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: C.label, fontSize: 12, letterSpacing: 2, fontWeight: '600' },
  cardAction: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  cardActionText: { color: C.silver, fontSize: 13, fontWeight: '500' },
  ringText: { color: C.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  ringPct: { color: C.secondary, fontWeight: '500' },
  segRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 14,
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  segThumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    borderRadius: 11,
    backgroundColor: C.silver,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  seg: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  segText: { color: C.secondary, fontSize: 15, fontWeight: '500', textTransform: 'capitalize' },
  segTextOn: { color: C.bg, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 4 },
  toggleLabel: { color: C.text, fontSize: 17, fontWeight: '500' },
  toggleHint: { color: C.dim, fontSize: 13, marginTop: 3 },
  track: { width: 52, height: 30, borderRadius: 15, padding: 3 },
  thumb: { width: 24, height: 24, borderRadius: 12 },
  button: { alignItems: 'center', gap: 8 },
  buttonLabel: { color: C.secondary, fontSize: 12, fontWeight: '500' },
});
