import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { Client } from './api';
import { Symbol } from './Symbol';
import type { Key, State, Weather } from './types';
import { C } from './theme';

/** WMO weather code → icon and words (Open-Meteo's codes). */
export function weatherLook(w: Pick<Weather, 'code' | 'day'>): { icon: string; label: string } {
  const c = w.code;
  if (c === 0) return { icon: w.day ? 'sun' : 'moon', label: 'Clear' };
  if (c <= 2) return { icon: w.day ? 'cloud-sun' : 'cloud-moon', label: 'Partly cloudy' };
  if (c === 3) return { icon: 'cloud', label: 'Cloudy' };
  if (c <= 48) return { icon: 'cloud-fog', label: 'Fog' };
  if (c <= 57) return { icon: 'cloud-drizzle', label: 'Drizzle' };
  if (c <= 67 || (c >= 80 && c <= 82)) return { icon: 'cloud-rain', label: 'Rain' };
  if (c <= 77 || c === 85 || c === 86) return { icon: 'cloud-snow', label: 'Snow' };
  return { icon: 'cloud-lightning', label: 'Thunderstorms' };
}

/** Widget kinds that get a big face when a key spans several slots. */
export const WIDGET_LIVE = ['clock', 'weather', 'system', 'nowplaying'] as const;

/** The face of a key that spans several slots: `width`×`height` points, `unit` is one slot's size. */
export function WidgetFace({ k, state, api, width, height, unit }: { k: Key; state: State | null; api: Client; width: number; height: number; unit: number }) {
  const tall = height > unit * 1.5; // 2×2 and up stack; 2×1 lays out in a row
  const pad = unit * 0.12;
  const big = Math.min(height * (tall ? 0.28 : 0.42), width * 0.22);
  const small = Math.max(12, unit * 0.1);

  switch (k.live) {
    case 'clock': {
      const now = new Date();
      return (
        <View style={[st.fill, st.center, { padding: pad }]}>
          <Text style={[st.thin, { fontSize: big * 1.15 }]} numberOfLines={1} adjustsFontSizeToFit>
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={[st.dim, { fontSize: small * 1.1 }]} numberOfLines={1}>
            {now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: tall ? 'long' : 'short' })}
          </Text>
        </View>
      );
    }
    case 'weather': {
      const w = state?.weather;
      // undefined: not fetched yet (a library preview); null: the fetch failed.
      if (!w) return <Empty text={w === null ? 'Weather unavailable' : 'Weather'} size={small} />;
      const look = weatherLook(w);
      return (
        <View style={[st.fill, tall ? st.center : st.row, { padding: pad, gap: pad }]}>
          <Symbol name={look.icon} size={big * (tall ? 1.1 : 0.9)} weight="light" color={C.text} />
          <View style={tall ? st.centerText : undefined}>
            <Text style={[st.thin, { fontSize: big }]} numberOfLines={1}>{w.temp}°</Text>
            <Text style={[st.text, { fontSize: small }]} numberOfLines={1}>{look.label}</Text>
            <Text style={[st.dim, { fontSize: small * 0.9 }]} numberOfLines={1}>H {w.hi}°  L {w.lo}°  ·  {w.place}</Text>
          </View>
        </View>
      );
    }
    case 'system': {
      const b = state?.macBattery;
      const rows: [string, number | undefined, boolean][] = [
        ['CPU', state?.cpu, (state?.cpu ?? 0) >= 90],
        ['Memory', state?.memory, (state?.memory ?? 0) >= 90],
        ...(b?.percent != null ? [[b.charging ? 'Battery ⚡︎' : 'Battery', b.percent, b.percent <= 20 && !b.charging] as [string, number, boolean]] : []),
      ];
      return (
        <View style={[st.fill, { padding: pad * 1.2, justifyContent: 'center', gap: tall ? pad : pad * 0.5 }]}>
          {rows.map(([label, v, alert]) => (
            <View key={label} style={{ gap: 4 }}>
              <View style={st.between}>
                <Text style={[st.label, { fontSize: small * 0.85 }]}>{label.toUpperCase()}</Text>
                <Text style={[st.text, { fontSize: small, color: alert ? C.danger : C.text }]}>{v == null ? '–' : `${v}%`}</Text>
              </View>
              <View style={[st.track, { height: Math.max(3, unit * 0.025) }]}>
                <View style={[st.bar, { width: `${Math.min(100, v ?? 0)}%`, backgroundColor: alert ? C.danger : C.silver }]} />
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'nowplaying': {
      const np = state?.nowPlaying;
      if (!np) return <Empty text={state ? 'Nothing playing' : '–'} size={small} />;
      const art = np.art ? <Image source={api.artwork(np.art)} style={tall ? StyleSheet.absoluteFill : { width: height - pad * 2, height: height - pad * 2, borderRadius: unit * 0.1 }} /> : null;
      const words = (
        <View style={{ flex: tall ? 0 : 1, gap: 2 }}>
          <Text style={[st.text, { fontSize: small * 1.25, fontWeight: '600' }]} numberOfLines={1}>{np.title}</Text>
          <Text style={[st.dim, { fontSize: small }]} numberOfLines={1}>{np.playing ? (np.artist ?? np.app) : `Paused${np.artist ? ` · ${np.artist}` : ''}`}</Text>
        </View>
      );
      return tall ? (
        <View style={st.fill}>
          {art}
          <View style={[st.fill, st.shade, { padding: pad, justifyContent: 'flex-end' }]}>{words}</View>
        </View>
      ) : (
        <View style={[st.fill, st.row, { padding: pad, gap: pad }]}>
          {art}
          {words}
        </View>
      );
    }
    default:
      return null;
  }
}

function Empty({ text, size }: { text: string; size: number }) {
  return <View style={[st.fill, st.center]}><Text style={[st.dim, { fontSize: size }]}>{text}</Text></View>;
}

const st = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  center: { alignItems: 'center', justifyContent: 'center' },
  centerText: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  thin: { color: C.text, fontWeight: '200', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  text: { color: C.text, fontWeight: '500', fontVariant: ['tabular-nums'] },
  dim: { color: C.dim, fontWeight: '500' },
  label: { color: C.label, fontWeight: '700', letterSpacing: 1.4 },
  track: { borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 2 },
  shade: { experimental_backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 35%, rgba(0,0,0,0.85) 100%)' },
});
