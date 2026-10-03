import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, Path, Skia } from 'react-native-skia';
import { C } from './theme';

export function Section({ title, action, children }: { title: string; action?: { label: string; onPress: () => void }; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        {action && (
          <Pressable onPress={action.onPress} hitSlop={12}>
            <Text style={s.sectionAction}>{action.label}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

export function Chip({ label, on, onPress, grow }: { label: string; on?: boolean; onPress: () => void; grow?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.chip, grow && s.grow, on && s.on, pressed && s.pressed]}>
      <Text style={[s.chipText, on && s.textOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function Tile({ label, hint, on, onPress }: { label: string; hint?: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.tile, on && s.on, pressed && s.pressed]}>
      <Text style={[s.tileText, on && s.textOn]}>{label}</Text>
      {hint && <Text style={[s.hint, on && s.textOn]}>{hint}</Text>}
    </Pressable>
  );
}

export function Battery({ value, size = 56 }: { value: number; size?: number }) {
  const rect = Skia.XYWHRect(4, 4, size - 8, size - 8);
  const track = Skia.PathBuilder.Make();
  track.addArc(rect, 0, 360);
  const arc = Skia.PathBuilder.Make();
  arc.addArc(rect, -90, (value / 100) * 360);
  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Path path={track.build()} style="stroke" strokeWidth={4} color="#ffffff1a" />
        <Path path={arc.build()} style="stroke" strokeWidth={4} strokeCap="round" color={value <= 20 ? '#e8a0a0' : C.silver} />
      </Canvas>
      <View style={[StyleSheet.absoluteFill, s.center]}>
        <Text style={s.batteryText}>{value}</Text>
      </View>
    </View>
  );
}

export const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  grow: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  section: { gap: 12 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { color: C.label, fontSize: 12, letterSpacing: 2, fontWeight: '600' },
  sectionAction: { color: C.silver, fontSize: 14 },
  chip: {
    minWidth: 56,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
    backgroundColor: C.raised,
  },
  on: { backgroundColor: C.silver, borderColor: C.silver },
  chipText: { color: C.secondary, fontSize: 16, fontWeight: '500', textTransform: 'capitalize' },
  textOn: { color: C.bg },
  pressed: { opacity: 0.6 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 76,
    padding: 16,
    borderRadius: 18,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
    backgroundColor: C.raised,
  },
  tileText: { color: C.text, fontSize: 18, fontWeight: '500' },
  hint: { color: C.dim, fontSize: 13, marginTop: 2 },
  title: { color: C.text, fontSize: 34, fontWeight: '300' },
  sub: { color: C.secondary, fontSize: 15, marginTop: 4 },
  input: {
    color: C.text,
    fontSize: 17,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: C.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  batteryText: { color: C.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
