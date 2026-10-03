import React, { useEffect, useRef, useState } from 'react';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { Client } from './api';
import { Symbol, defaultSymbol } from './Symbol';
import type { Key, State } from './types';
import { C, SPRING } from './theme';
import { WIDGET_LIVE, WidgetFace, weatherLook } from './Widget';

/** `title` replaces the key's title, `face` replaces its icon with big text, `art` is a GET /artwork version shown behind it. */
type LiveView = { sub?: string; on?: boolean; alert?: boolean; level?: number; title?: string; face?: string; art?: string };
const gauge = (n: number | undefined) => (n == null ? {} : { sub: `${n}%`, level: n / 100, alert: n >= 90 });

/** What a live key shows right now: a status line, a gauge level, and whether it's lit. */
export function liveView(k: Key, state: State | null, id: string): LiveView {
  const mac = state?.mac;
  const hp = state?.headphones;
  const online = hp?.status === 'connected';
  switch (k.live) {
    case 'mic':
      return mac?.micMuted ? { sub: 'Muted', alert: true } : { sub: 'Live' };
    case 'volume':
      return { sub: mac?.muted ? 'Muted' : mac?.volume != null ? `${mac.volume}%` : undefined, level: mac?.muted ? 0 : (mac?.volume ?? 0) / 100 };
    case 'battery':
      return online && hp.battery != null
        ? { sub: `${hp.battery}%`, level: hp.battery / 100, alert: hp.battery <= 20 }
        : { sub: hp ? 'Offline' : undefined };
    case 'anc':
      return online && hp.anc ? { sub: `Noise ${hp.anc.level}`, level: hp.anc.level / 10 } : { sub: hp ? 'Offline' : undefined };
    case 'toggle':
      return { on: !!state?.toggles?.[id] };
    case 'nowplaying': {
      const np = state?.nowPlaying;
      if (!np) return { sub: state ? 'Nothing playing' : undefined };
      return { title: np.title, sub: np.playing ? (np.artist ?? np.app) : `Paused${np.artist ? ` · ${np.artist}` : ''}`, art: np.art ?? undefined };
    }
    case 'cpu':
      return gauge(state?.cpu);
    case 'memory':
      return gauge(state?.memory);
    case 'macbattery': {
      const b = state?.macBattery;
      if (!b) return {};
      if (b.percent == null) return { sub: 'AC' };
      return { sub: `${b.percent}%${b.charging ? ' ⚡︎' : ''}`, level: b.percent / 100, alert: b.percent <= 20 && !b.charging };
    }
    case 'system':
      return { ...gauge(state?.cpu), sub: state?.cpu == null ? undefined : `CPU ${state.cpu}% · ${state.memory ?? '–'}%` };
    case 'weather': {
      const w = state?.weather;
      return w ? { face: `${w.temp}°`, sub: weatherLook(w).label } : { sub: w === null ? 'Unavailable' : undefined };
    }
    case 'clock': {
      const now = new Date();
      return { face: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), sub: now.toLocaleDateString([], { weekday: 'short', day: 'numeric' }) };
    }
    default:
      return {};
  }
}

/** Re-renders at each minute boundary while `on`, so clock keys tick without the bridge. */
function useMinuteTick(on: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!on) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => { t = setTimeout(() => { setT(n => n + 1); next(); }, 60_000 - (Date.now() % 60_000) + 50); };
    next();
    return () => clearTimeout(t);
  }, [on]);
}

/** Hold-then-drag: the pan activates after `holdMs` without moving, so quick swipes still scroll the library. */
export type DragProps = {
  holdMs: number;
  /** A worklet: runs on the UI thread for every movement, so dragging never waits on React. */
  move: (x: number, y: number) => void;
  onStart: (x: number, y: number) => void;
  /** `canceled`: the system took the touch away; put the key back. */
  onEnd: (x: number, y: number, canceled: boolean) => void;
};

/** Result of the last press, so the key can flash: `n` changes on every press. */
export type Feedback = { n: number; ok: boolean };

/** One Stream Deck key: a machined face with a glyph, live status, press physics and a run flash. */
export function KeyTile({ k, id, size, width, height, api, state, editing, picked, hover, index, feedback, drag, titles = false, onPress, onLongPress }: {
  k?: Key;
  id: string;
  /** One slot's size; `width`/`height` (default `size`) are the key's own, larger for widgets. */
  size: number;
  width?: number;
  height?: number;
  api: Client;
  state: State | null;
  editing: boolean;
  picked: boolean;
  /** Lit while a dragged key is over slot `index` (a shared value, so it updates without re-rendering). */
  hover?: SharedValue<number>;
  index?: number;
  feedback?: Feedback;
  /** Show key names (the library); deck keys are icons plus any live reading. */
  titles?: boolean;
  /** Makes the key draggable (edit mode, library). */
  drag?: DragProps;
  onPress: () => void;
  onLongPress: () => void;
}) {
  useMinuteTick(k?.live === 'clock');
  const live: LiveView = k ? liveView(k, state, id) : {};
  const W = width ?? size;
  const H = height ?? size;
  // An app key with nothing live is just its icon: the icon already is a rounded square, so it fills the key.
  const appOnly = !titles && !!k?.icon?.app && !k.live && !k.color;
  const widget = !!k && (W > size * 1.2 || H > size * 1.2) && (WIDGET_LIVE as readonly string[]).includes(k.live ?? '');
  const radius = size * 0.22;
  const press = useSharedValue(0);
  const wiggle = useSharedValue(0);
  const flash = useSharedValue(0);

  // Edit mode: the iOS home-screen jiggle, with a per-key phase so the grid doesn't move in lockstep.
  useEffect(() => {
    if (editing && k) {
      const phase = (id.length * 37 + Number(id.split('/').pop())) % 5;
      wiggle.value = withRepeat(
        withSequence(withTiming(1, { duration: 130 + phase * 6, easing: Easing.inOut(Easing.sin) }), withTiming(-1, { duration: 130 + phase * 6, easing: Easing.inOut(Easing.sin) })),
        -1,
        true,
      );
    } else {
      cancelAnimation(wiggle);
      wiggle.value = withTiming(0, { duration: 120 });
    }
  }, [editing, k, id, wiggle]);

  useEffect(() => {
    if (!feedback) return;
    flash.value = 0;
    flash.value = withSequence(withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }), withTiming(0, { duration: 600 }));
  }, [feedback?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = useAnimatedStyle(() => {
    const over = picked || (hover != null && hover.value === index);
    return { transform: [{ scale: 1 - press.value * 0.06 + (over ? 0.04 : 0) }, { rotateZ: `${wiggle.value * 1.4}deg` }] };
  });
  const overRing = useAnimatedStyle(() => ({ opacity: picked || (hover != null && hover.value === index) ? 1 : 0 }));
  const ring = useAnimatedStyle(() => ({ opacity: flash.value }));

  const dragRef = useRef(drag);
  dragRef.current = drag;
  // Pick-up and drop go to React; every movement in between stays on the UI thread.
  const start = (x: number, y: number) => dragRef.current?.onStart(x, y);
  const end = (x: number, y: number, canceled: boolean) => dragRef.current?.onEnd(x, y, canceled);
  const move = drag?.move;
  const pan = usePanGesture({
    enabled: !!drag,
    activateAfterLongPress: drag?.holdMs ?? 300,
    onActivate: e => {
      'worklet';
      move?.(e.absoluteX, e.absoluteY);
      scheduleOnRN(start, e.absoluteX, e.absoluteY);
    },
    onUpdate: e => {
      'worklet';
      move?.(e.absoluteX, e.absoluteY);
    },
    onDeactivate: e => {
      'worklet';
      scheduleOnRN(end, e.absoluteX, e.absoluteY, e.canceled);
    },
  });

  const lit = live.on;
  const tint = k?.color;
  const glyph = lit ? C.bg : live.alert ? C.danger : C.text;
  const iconSize = size * (titles || live.sub ? 0.3 : 0.4);
  const level = live.level;

  return (
    <GestureDetector gesture={pan}>
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={!editing && k?.hold ? 500 : 350}
      onPressIn={() => { press.value = withSpring(1, SPRING); }}
      onPressOut={() => { press.value = withSpring(0, SPRING); }}
      accessibilityRole="button"
      accessibilityLabel={k ? [live.title ?? k.title, live.sub].filter(Boolean).join(', ') : 'Empty key'}>
      <Animated.View style={[{ width: W, height: H }, body]}>
        {/* Plain views, not Skia: a page of keys (and the library's dozens) appears at once instead of canvas by canvas. */}
        {k && appOnly ? null : k ? (
          <>
            <View style={[StyleSheet.absoluteFill, st.plate, { borderRadius: radius, shadowRadius: size * 0.05, shadowOffset: { width: 0, height: size * 0.04 } },
              lit ? st.faceLit : st.faceDark]} />
            {tint && !lit && <View style={[StyleSheet.absoluteFill, { borderRadius: radius, experimental_backgroundImage: `linear-gradient(135deg, ${tint}66, ${tint}1f)` }]} />}
            {/* bevel: light catches the top edge, the bottom falls away */}
            <View style={[StyleSheet.absoluteFill, st.bevel, { borderRadius: radius }, lit && st.bevelLit]} />
            {live.alert && <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 2, borderColor: C.danger }]} />}
            {level != null && !widget && (
              <View style={[st.levelTrack, { left: W * 0.22, top: H * 0.86, width: W * 0.56, backgroundColor: lit ? '#00000022' : '#ffffff18' }]}>
                <View style={[st.levelBar, { width: `${Math.max(5, 100 * Math.min(1, level))}%`, backgroundColor: live.alert ? C.danger : lit ? C.bg : C.silver }]} />
              </View>
            )}
          </>
        ) : (
          // Outside edit mode an empty slot is just a faint well; the dashed "drop here" outline is for editing.
          <View style={[StyleSheet.absoluteFill, { borderRadius: radius }, editing ? st.emptyEdit : st.empty]} />
        )}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 3, borderColor: C.silver }, overRing]} />

        {live.art && !widget && (
          <View style={[st.art, { width: W - 4, height: H - 4, borderRadius: radius - 1 }]} pointerEvents="none">
            <Image source={api.artwork(live.art)} style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, st.artShade]} />
          </View>
        )}

        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, ring, st.ring, { borderRadius: radius },
          feedback?.ok === false ? { borderColor: C.danger, shadowColor: C.danger } : null]} />

        {widget && k && (
          <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]} pointerEvents="none">
            <WidgetFace k={k} state={state} api={api} width={W} height={H} unit={size} />
          </View>
        )}
        <View style={[StyleSheet.absoluteFill, st.content, live.art && st.contentArt, { padding: size * 0.08 }, level != null && { paddingBottom: size * 0.2 }]} pointerEvents="none">
          {widget ? null : appOnly && k?.icon?.app ? (
            // macOS icons leave ~10% transparent margin around the shape; scale past it so the shape meets the key's edges.
            <Image source={api.icon(k.icon.app)} style={{ width: W * 1.2, height: H * 1.2 }} />
          ) : k ? (
            <>
              {live.face ? (
                <Text style={[st.face, { color: glyph, fontSize: size * 0.24 }]} numberOfLines={1} adjustsFontSizeToFit>{live.face}</Text>
              ) : live.art ? null : k.icon?.app ? (
                <Image source={api.icon(k.icon.app)} style={{ width: size * 0.42, height: size * 0.42 }} />
              ) : k.icon?.symbol || !k.icon?.emoji ? (
                <Symbol name={k.icon?.symbol ?? defaultSymbol(k.action, state?.mac)} size={iconSize} weight="medium" color={glyph} bounce={feedback?.n ?? 0} />
              ) : (
                <Text style={{ fontSize: iconSize * 1.1 }}>{k.icon.emoji}</Text>
              )}
              {!!(live.title ?? (titles ? k.title : undefined)) && (
                <Text style={[st.title, { color: lit ? C.bg : C.text, fontSize: Math.max(12, size * 0.105) }]} numberOfLines={1}>{live.title ?? k.title}</Text>
              )}
              {live.sub && (
                <Text style={[st.sub, { color: lit ? '#3a3f46' : live.alert ? C.danger : C.dim, fontSize: Math.max(11, size * 0.085) }]} numberOfLines={1}>
                  {live.sub}
                </Text>
              )}
            </>
          ) : (
            editing && <Symbol name="plus" size={size * 0.18} weight="light" color={C.dim} />
          )}
        </View>
      </Animated.View>
    </Pressable>
    </GestureDetector>
  );
}

const st = StyleSheet.create({
  content: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  contentArt: { justifyContent: 'flex-end' },
  art: { position: 'absolute', left: 2, top: 2, overflow: 'hidden' },
  artShade: { experimental_backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 30%, rgba(0,0,0,0.85) 100%)' },
  face: { fontWeight: '600', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  title: { fontWeight: '600', marginTop: 4, letterSpacing: 0.2 },
  sub: { fontWeight: '500', fontVariant: ['tabular-nums'] },
  plate: { shadowColor: '#000', shadowOpacity: 0.65 },
  faceDark: { backgroundColor: '#1a1c20', experimental_backgroundImage: 'linear-gradient(to bottom, #22252a, #121316)' },
  faceLit: { backgroundColor: '#d5d9de', experimental_backgroundImage: 'linear-gradient(to bottom, #f1f3f6, #b9bfc7)' },
  bevel: { borderWidth: 1.2, borderTopColor: 'rgba(255,255,255,0.25)', borderLeftColor: 'rgba(255,255,255,0.1)', borderRightColor: 'rgba(255,255,255,0.1)', borderBottomColor: 'rgba(0,0,0,0.38)' },
  bevelLit: { borderTopColor: 'rgba(255,255,255,0.8)' },
  levelTrack: { position: 'absolute', height: 3, borderRadius: 1.5, overflow: 'hidden' },
  levelBar: { height: '100%', borderRadius: 1.5 },
  empty: { backgroundColor: 'rgba(255,255,255,0.02)' },
  emptyEdit: { borderWidth: 1.2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.22)' },
  ring: { borderWidth: 2.5, borderColor: C.silver, shadowColor: '#fff', shadowOpacity: 0.7, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
});
