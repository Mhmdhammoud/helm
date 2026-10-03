import React, { useEffect, useRef, useState } from 'react';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, DashPathEffect, Group, LinearGradient, Path, RoundedRect, Shadow, Skia, vec } from 'react-native-skia';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
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
  onStart: (x: number, y: number) => void;
  onMove: (x: number, y: number) => void;
  /** `canceled`: the system took the touch away; put the key back. */
  onEnd: (x: number, y: number, canceled: boolean) => void;
};

/** Result of the last press, so the key can flash: `n` changes on every press. */
export type Feedback = { n: number; ok: boolean };

/** One Stream Deck key: a machined face with a glyph, live status, press physics and a run flash. */
export function KeyTile({ k, id, size, width, height, api, state, editing, picked, feedback, drag, titles = false, onPress, onLongPress }: {
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

  const body = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.06 + (picked ? 0.04 : 0) }, { rotateZ: `${wiggle.value * 1.4}deg` }],
  }));
  const ring = useAnimatedStyle(() => ({ opacity: flash.value }));

  const dragRef = useRef(drag);
  dragRef.current = drag;
  const pan = usePanGesture({
    enabled: !!drag,
    activateAfterLongPress: drag?.holdMs ?? 300,
    runOnJS: true,
    onActivate: e => dragRef.current?.onStart(e.absoluteX, e.absoluteY),
    onUpdate: e => dragRef.current?.onMove(e.absoluteX, e.absoluteY),
    onDeactivate: e => dragRef.current?.onEnd(e.absoluteX, e.absoluteY, e.canceled),
  });

  // Canvases overhang the key by `pad` so shadows and glows fade out instead of clipping.
  const pad = Math.round(size * 0.14);
  const canvas = { position: 'absolute' as const, left: -pad, top: -pad, width: W + pad * 2, height: H + pad * 2 };
  const rect = Skia.XYWHRect(1, 1, W - 2, H - 2);
  const rrect = Skia.RRectXY(rect, radius, radius);
  const outline = Skia.PathBuilder.Make().addRRect(rrect).build();
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
        <Canvas style={canvas}>
          <Group transform={[{ translateX: pad }, { translateY: pad }]}>
          {k && appOnly ? (
            picked ? <Path path={outline} style="stroke" strokeWidth={3} color={C.silver} /> : null
          ) : k ? (
            <>
              <RoundedRect rect={rrect}>
                <LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={lit ? ['#f1f3f6', '#b9bfc7'] : ['#22252a', '#121316']} />
                <Shadow dx={0} dy={size * 0.04} blur={size * 0.08} color="#000000aa" />
              </RoundedRect>
              {tint && !lit && (
                <RoundedRect rect={rrect}>
                  <LinearGradient start={vec(0, 0)} end={vec(W, H)} colors={[`${tint}66`, `${tint}1f`]} />
                </RoundedRect>
              )}
              {/* bevel: light catches the top edge, the bottom falls away */}
              <Path path={outline} style="stroke" strokeWidth={1.2}>
                <LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={[lit ? '#ffffffcc' : '#ffffff40', '#ffffff08', '#00000060']} />
              </Path>
              {live.alert && <Path path={outline} style="stroke" strokeWidth={2} color={C.danger} />}
              {picked && <Path path={outline} style="stroke" strokeWidth={3} color={C.silver} />}
              {level != null && !widget && (
                <>
                  <RoundedRect x={size * 0.22} y={size * 0.86} width={size * 0.56} height={3} r={1.5} color={lit ? '#00000022' : '#ffffff18'} />
                  <RoundedRect x={size * 0.22} y={size * 0.86} width={Math.max(3, size * 0.56 * Math.min(1, level))} height={3} r={1.5}
                    color={live.alert ? C.danger : lit ? C.bg : C.silver} />
                </>
              )}
            </>
          ) : (
            // Outside edit mode an empty slot is just a faint well; the dashed "drop here" outline is for editing.
            editing ? (
              <Path path={outline} style="stroke" strokeWidth={1.2} color="#ffffff38">
                <DashPathEffect intervals={[6, 6]} />
              </Path>
            ) : (
              <RoundedRect rect={rrect} color="rgba(255,255,255,0.02)" />
            )
          )}
          </Group>
        </Canvas>

        {live.art && !widget && (
          <View style={[st.art, { width: W - 4, height: H - 4, borderRadius: radius - 1 }]} pointerEvents="none">
            <Image source={api.artwork(live.art)} style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, st.artShade]} />
          </View>
        )}

        <Animated.View style={[StyleSheet.absoluteFill, ring]} pointerEvents="none">
          <Canvas style={canvas}>
            <Group transform={[{ translateX: pad }, { translateY: pad }]}>
            <Path path={outline} style="stroke" strokeWidth={2.5} color={feedback?.ok === false ? C.danger : C.silver}>
              <Shadow dx={0} dy={0} blur={8} color={feedback?.ok === false ? C.danger : '#ffffffaa'} />
            </Path>
            </Group>
          </Canvas>
        </Animated.View>

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
});
