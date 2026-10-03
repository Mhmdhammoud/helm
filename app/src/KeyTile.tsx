import React, { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, DashPathEffect, LinearGradient, Path, RoundedRect, Shadow, Skia, vec } from 'react-native-skia';
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

type LiveView = { sub?: string; on?: boolean; alert?: boolean; level?: number };

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
    default:
      return {};
  }
}

/** Result of the last press, so the key can flash: `n` changes on every press. */
export type Feedback = { n: number; ok: boolean };

/** One Stream Deck key: a machined face with a glyph, live status, press physics and a run flash. */
export function KeyTile({ k, id, size, api, state, editing, picked, feedback, onPress, onLongPress }: {
  k?: Key;
  id: string;
  size: number;
  api: Client;
  state: State | null;
  editing: boolean;
  picked: boolean;
  feedback?: Feedback;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const live = k ? liveView(k, state, id) : {};
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

  const rect = Skia.XYWHRect(1, 1, size - 2, size - 2);
  const outline = Skia.PathBuilder.Make().addRRect(Skia.RRectXY(rect, radius, radius)).build();
  const lit = live.on;
  const tint = k?.color;
  const glyph = lit ? C.bg : live.alert ? C.danger : C.text;
  const iconSize = size * 0.3;
  const level = live.level;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      onPressIn={() => { press.value = withSpring(1, SPRING); }}
      onPressOut={() => { press.value = withSpring(0, SPRING); }}
      accessibilityRole="button"
      accessibilityLabel={k ? [k.title, live.sub].filter(Boolean).join(', ') : 'Empty key'}>
      <Animated.View style={[{ width: size, height: size }, body]}>
        <Canvas style={StyleSheet.absoluteFill}>
          {k ? (
            <>
              <RoundedRect rect={rect} r={radius}>
                <LinearGradient start={vec(0, 0)} end={vec(0, size)} colors={lit ? ['#f1f3f6', '#b9bfc7'] : ['#22252a', '#121316']} />
                <Shadow dx={0} dy={size * 0.04} blur={size * 0.08} color="#000000aa" />
              </RoundedRect>
              {tint && !lit && (
                <RoundedRect rect={rect} r={radius}>
                  <LinearGradient start={vec(0, 0)} end={vec(size, size)} colors={[`${tint}66`, `${tint}1f`]} />
                </RoundedRect>
              )}
              {/* bevel: light catches the top edge, the bottom falls away */}
              <Path path={outline} style="stroke" strokeWidth={1.2}>
                <LinearGradient start={vec(0, 0)} end={vec(0, size)} colors={[lit ? '#ffffffcc' : '#ffffff40', '#ffffff08', '#00000060']} />
              </Path>
              {live.alert && <Path path={outline} style="stroke" strokeWidth={2} color={C.danger} />}
              {picked && <Path path={outline} style="stroke" strokeWidth={3} color={C.silver} />}
              {level != null && (
                <>
                  <RoundedRect x={size * 0.22} y={size * 0.86} width={size * 0.56} height={3} r={1.5} color={lit ? '#00000022' : '#ffffff18'} />
                  <RoundedRect x={size * 0.22} y={size * 0.86} width={Math.max(3, size * 0.56 * Math.min(1, level))} height={3} r={1.5}
                    color={live.alert ? C.danger : lit ? C.bg : C.silver} />
                </>
              )}
            </>
          ) : (
            <Path path={outline} style="stroke" strokeWidth={1.2} color={editing ? '#ffffff38' : '#ffffff12'}>
              <DashPathEffect intervals={[6, 6]} />
            </Path>
          )}
        </Canvas>

        <Animated.View style={[StyleSheet.absoluteFill, ring]} pointerEvents="none">
          <Canvas style={StyleSheet.absoluteFill}>
            <Path path={outline} style="stroke" strokeWidth={2.5} color={feedback?.ok === false ? C.danger : C.silver}>
              <Shadow dx={0} dy={0} blur={8} color={feedback?.ok === false ? C.danger : '#ffffffaa'} />
            </Path>
          </Canvas>
        </Animated.View>

        <View style={[StyleSheet.absoluteFill, st.content, { padding: size * 0.08 }]} pointerEvents="none">
          {k ? (
            <>
              {k.icon?.app ? (
                <Image source={api.icon(k.icon.app)} style={{ width: size * 0.42, height: size * 0.42 }} />
              ) : k.icon?.symbol || !k.icon?.emoji ? (
                <Symbol name={k.icon?.symbol ?? defaultSymbol(k.action, state?.mac)} size={iconSize} weight="medium" color={glyph} bounce={feedback?.n ?? 0} />
              ) : (
                <Text style={{ fontSize: iconSize * 1.1 }}>{k.icon.emoji}</Text>
              )}
              {!!k.title && (
                <Text style={[st.title, { color: lit ? C.bg : C.text, fontSize: Math.max(12, size * 0.105) }]} numberOfLines={1}>{k.title}</Text>
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
  );
}

const st = StyleSheet.create({
  content: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  title: { fontWeight: '600', marginTop: 4, letterSpacing: 0.2 },
  sub: { fontWeight: '500', fontVariant: ['tabular-nums'] },
});
