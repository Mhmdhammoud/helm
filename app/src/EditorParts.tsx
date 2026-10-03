import React, { useEffect, useState } from 'react';
import { type LayoutRectangle, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Canvas, Circle, LinearGradient, vec } from 'react-native-skia';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Symbol } from './Symbol';
import type { Mod } from './types';
import { C, KEY_COLORS, SPRING } from './theme';

/** Small caps heading over each group of controls. */
export function Heading({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={st.headingRow}>
      <Text style={st.heading}>{children}</Text>
      {right}
    </View>
  );
}

export const Input = (p: React.ComponentProps<typeof TextInput>) => (
  <TextInput placeholderTextColor={C.dim} autoCapitalize="none" autoCorrect={false} keyboardAppearance="dark" {...p}
    style={[st.input, p.multiline && st.multi, p.style]} />
);

/** A square tile with an SF Symbol over a short label: the building block of every picker here. */
export function IconTile({ symbol, label, on, onPress, compact, children }: {
  symbol?: string;
  label: string;
  on?: boolean;
  onPress: () => void;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }} accessibilityLabel={label}
      style={({ pressed }) => [st.tile, compact && st.tileCompact, on && st.tileOn, pressed && st.pressed]}>
      {children ?? <Symbol name={symbol!} size={compact ? 18 : 22} weight="medium" color={on ? C.bg : C.text} />}
      <Text style={[st.tileLabel, compact && st.tileLabelCompact, on && st.tileLabelOn]} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

/** A wide option row (icon left, label right) for small sets like media keys or system actions. */
export function Options<T extends string | number>({ items, value, onChange }: {
  items: { value: T; label: string; symbol: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <View style={st.options}>
      {items.map(i => {
        const on = i.value === value;
        return (
          <Pressable key={String(i.value)} onPress={() => onChange(i.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={({ pressed }) => [st.option, on && st.tileOn, pressed && st.pressed]}>
            <Symbol name={i.symbol} size={18} weight="medium" color={on ? C.bg : C.text} />
            <Text style={[st.optionLabel, on && st.tileLabelOn]} numberOfLines={1}>{i.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pill selector with a silver thumb that springs to the chosen segment. Segments size to their labels. */
export function Segmented<T>({ items, value, onChange }: { items: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const [boxes, setBoxes] = useState<Record<number, LayoutRectangle>>({});
  const idx = Math.max(0, items.findIndex(i => i.value === value));
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const box = boxes[idx];
  useEffect(() => {
    if (!box) return;
    const first = w.value === 0;
    x.value = first ? box.x : withSpring(box.x, SPRING);
    y.value = first ? box.y : withSpring(box.y, SPRING);
    w.value = first ? box.width : withSpring(box.width, SPRING);
  }, [box, x, y, w]);
  // Wraps onto more rows when the labels don't fit; the thumb follows in both directions.
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }], width: w.value, opacity: w.value ? 1 : 0 }));
  return (
    <View style={st.seg}>
      <Animated.View style={[st.segThumb, box && { height: box.height }, thumb]} />
      {items.map((it, i) => (
        <Pressable key={it.label} onPress={() => onChange(it.value)} accessibilityRole="button" accessibilityState={{ selected: i === idx }}
          onLayout={e => { const l = e.nativeEvent.layout; setBoxes(b => ({ ...b, [i]: l })); }} style={st.segItem}>
          <Text style={[st.segText, i === idx && st.segTextOn]} numberOfLines={1}>{it.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Round swatches that show each tint blended over the metal key face, the way the key will look. */
export function Swatches({ value, onChange }: { value: string | undefined; onChange: (c: string | undefined) => void }) {
  const d = 40;
  return (
    <View style={st.swatches}>
      {KEY_COLORS.map(c => {
        const on = (value ?? null) === c;
        return (
          <Pressable key={String(c)} onPress={() => onChange(c ?? undefined)} accessibilityRole="button" accessibilityLabel={c ? `Colour ${c}` : 'No colour'}
            accessibilityState={{ selected: on }} style={[st.swatchRing, on && st.swatchRingOn]}>
            <Canvas style={{ width: d, height: d }}>
              <Circle cx={d / 2} cy={d / 2} r={d / 2}>
                <LinearGradient start={vec(0, 0)} end={vec(0, d)} colors={['#2a2d33', '#121316']} />
              </Circle>
              {c && (
                <Circle cx={d / 2} cy={d / 2} r={d / 2}>
                  <LinearGradient start={vec(0, 0)} end={vec(d, d)} colors={[`${c}cc`, `${c}44`]} />
                </Circle>
              )}
              <Circle cx={d / 2} cy={d / 2} r={d / 2 - 0.5} style="stroke" strokeWidth={1}>
                <LinearGradient start={vec(0, 0)} end={vec(0, d)} colors={['#ffffff55', '#ffffff08']} />
              </Circle>
            </Canvas>
          </Pressable>
        );
      })}
    </View>
  );
}

// Mac menus list modifiers in this order, so keycaps do too.
export const MODS: { mod: Mod; glyph: string; name: string }[] = [
  { mod: 'ctrl', glyph: '⌃', name: 'Control' },
  { mod: 'opt', glyph: '⌥', name: 'Option' },
  { mod: 'shift', glyph: '⇧', name: 'Shift' },
  { mod: 'cmd', glyph: '⌘', name: 'Command' },
];
export const NAMED_KEYS: { key: string; cap: string; name: string }[] = [
  { key: 'return', cap: '↩', name: 'Return' },
  { key: 'escape', cap: 'esc', name: 'Escape' },
  { key: 'tab', cap: '⇥', name: 'Tab' },
  { key: 'space', cap: 'space', name: 'Space' },
  { key: 'delete', cap: '⌫', name: 'Delete' },
  { key: 'left', cap: '←', name: 'Left' },
  { key: 'right', cap: '→', name: 'Right' },
  { key: 'up', cap: '↑', name: 'Up' },
  { key: 'down', cap: '↓', name: 'Down' },
  { key: 'f1', cap: 'F1', name: 'F1' },
  { key: 'f5', cap: 'F5', name: 'F5' },
  { key: 'f12', cap: 'F12', name: 'F12' },
];
export const capFor = (key: string) =>
  NAMED_KEYS.find(n => n.key === key.toLowerCase())?.cap ?? (/^f\d+$/i.test(key) ? key.toUpperCase() : key.length === 1 ? key.toUpperCase() : key);

/** One physical-looking key: lit when it's part of the combination. */
export function Keycap({ cap, on, big, onPress, label }: { cap: string; on?: boolean; big?: boolean; onPress?: () => void; label?: string }) {
  const body = (
    <View style={[st.cap, big && st.capBig, on && st.capOn]}>
      <Text style={[st.capText, big && st.capTextBig, cap.length > 2 && (big ? st.capWordBig : st.capWord), on && st.capTextOn]}>{cap}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? cap} accessibilityState={{ selected: !!on }}
      style={({ pressed }) => pressed && st.pressed}>
      {body}
    </Pressable>
  );
}

/** Disclosure row that reveals its children; for the rarely-needed raw fields. */
export function Advanced({ initiallyOpen, children }: { initiallyOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!initiallyOpen);
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => { turn.value = withSpring(open ? 1 : 0, SPRING); }, [open, turn]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotateZ: `${turn.value * 90}deg` }] }));
  return (
    <View style={st.adv}>
      <Pressable onPress={() => setOpen(o => !o)} style={st.advHead} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Animated.View style={chevron}><Symbol name="chevron.right" size={11} weight="semibold" color={C.dim} /></Animated.View>
        <Text style={st.advText}>Advanced</Text>
      </Pressable>
      {open && children}
    </View>
  );
}

/** Text suggestions (apps, shortcuts) as quiet pills under a field. */
export function Suggest({ list, query, onPick }: { list: string[]; query: string; onPick: (v: string) => void }) {
  const q = query.toLowerCase();
  const hits = list.filter(x => x.toLowerCase().includes(q) && x !== query).slice(0, 10);
  if (!hits.length) return null;
  return (
    <View style={st.suggest}>
      {hits.map(h => (
        <Pressable key={h} onPress={() => onPick(h)} style={({ pressed }) => [st.pill, pressed && st.pressed]}>
          <Text style={st.pillText} numberOfLines={1}>{h}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const st = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  heading: { color: C.label, fontSize: 12, letterSpacing: 1.6, fontWeight: '700', textTransform: 'uppercase' },
  input: {
    color: C.text,
    fontSize: 17,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  multi: { minHeight: 96, textAlignVertical: 'top' },
  pressed: { opacity: 0.6 },

  tile: {
    width: 96,
    height: 84,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  tileCompact: { width: 78, height: 66, borderRadius: 14, gap: 3 },
  tileOn: { backgroundColor: C.silver, borderColor: C.silver },
  tileLabel: { color: C.secondary, fontSize: 12, fontWeight: '500', textAlign: 'center' },
  tileLabelCompact: { fontSize: 11 },
  tileLabelOn: { color: C.bg },

  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  optionLabel: { color: C.text, fontSize: 15, fontWeight: '500' },

  seg: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    padding: 3,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  segThumb: { position: 'absolute', top: 0, left: 0, borderRadius: 10, backgroundColor: C.silver },
  segItem: { paddingVertical: 9, paddingHorizontal: 14 },
  segText: { color: C.secondary, fontSize: 14, fontWeight: '500' },
  segTextOn: { color: C.bg },

  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatchRing: { padding: 3, borderRadius: 26, borderWidth: 2, borderColor: 'transparent' },
  swatchRingOn: { borderColor: C.silver },

  cap: {
    minWidth: 46,
    height: 46,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1b1d21',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    borderBottomWidth: 3,
    borderBottomColor: '#050506',
  },
  capBig: { minWidth: 72, height: 72, borderRadius: 14, paddingHorizontal: 16, borderBottomWidth: 4 },
  capOn: { backgroundColor: C.silver, borderColor: '#ffffff', borderBottomColor: '#7d838b' },
  capText: { color: C.text, fontSize: 20, fontWeight: '400' },
  capTextBig: { fontSize: 32, fontWeight: '300' },
  capWord: { fontSize: 14, fontWeight: '500' },
  capWordBig: { fontSize: 20, fontWeight: '400' },
  capTextOn: { color: C.bg },

  adv: { gap: 12 },
  advHead: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  advText: { color: C.dim, fontSize: 14, fontWeight: '500' },

  suggest: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pill: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  pillText: { color: C.secondary, fontSize: 14 },
});
