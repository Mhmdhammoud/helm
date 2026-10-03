import React from 'react';
import { Image, Pressable, StyleSheet, Text } from 'react-native';
import type { Client } from './api';
import type { Key, State } from './types';
import { C } from './theme';

/** What a live key shows right now: overrides the title and highlights the key. */
export function liveView(k: Key, state: State | null, id: string): { sub?: string; on?: boolean; alert?: boolean } {
  const mac = state?.mac;
  const hp = state?.headphones;
  switch (k.live) {
    case 'mic':
      return mac?.micMuted ? { sub: 'muted', alert: true } : { sub: 'on' };
    case 'volume':
      return { sub: mac?.muted ? 'muted' : mac?.volume != null ? `${mac.volume}` : undefined };
    case 'battery':
      return { sub: hp?.status === 'connected' && hp.battery != null ? `${hp.battery}%` : hp ? 'offline' : undefined, alert: (hp?.battery ?? 100) <= 20 };
    case 'anc':
      return { sub: hp?.anc ? `ANC ${hp.anc.level}` : undefined };
    case 'toggle':
      return { on: !!state?.toggles?.[id] };
    default:
      return {};
  }
}

export function KeyTile({ k, id, size, api, state, editing, picked, onPress, onLongPress }: {
  k?: Key;
  id: string;
  size: number;
  api: Client;
  state: State | null;
  editing: boolean;
  picked: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const live = k ? liveView(k, state, id) : {};
  const iconSize = size * 0.42;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        st.key,
        { width: size, height: size, borderRadius: size * 0.2 },
        k?.color ? { backgroundColor: k.color } : null,
        !k && st.empty,
        live.on && st.on,
        live.alert && st.alert,
        editing && st.editing,
        picked && st.picked,
        pressed && { transform: [{ scale: 0.94 }], opacity: 0.85 },
      ]}>
      {k && (
        <>
          {k.icon?.app ? (
            <Image source={api.icon(k.icon.app)} style={{ width: iconSize, height: iconSize }} />
          ) : (
            <Text style={{ fontSize: iconSize * 0.8 }}>{k.icon?.emoji ?? '⬜️'}</Text>
          )}
          {!!k.title && <Text style={[st.title, live.on && st.textOn, { fontSize: Math.max(12, size * 0.11) }]} numberOfLines={1}>{k.title}</Text>}
          {live.sub && <Text style={[st.sub, live.on && st.textOn, { fontSize: Math.max(11, size * 0.09) }]} numberOfLines={1}>{live.sub}</Text>}
        </>
      )}
      {!k && editing && <Text style={st.plus}>+</Text>}
    </Pressable>
  );
}

const st = StyleSheet.create({
  key: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
    gap: 4,
    padding: 6,
  },
  empty: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: '#ffffff14' },
  on: { backgroundColor: C.silver, borderColor: C.silver },
  alert: { borderColor: '#e8a0a0', borderWidth: 2 },
  editing: { borderColor: '#ffffff40', borderStyle: 'dashed', borderWidth: 1 },
  picked: { borderColor: C.silver, borderWidth: 3, borderStyle: 'solid' },
  title: { color: C.text, fontWeight: '500' },
  sub: { color: C.dim, fontVariant: ['tabular-nums'] },
  textOn: { color: C.bg },
  plus: { color: C.dim, fontSize: 28, fontWeight: '200' },
});
