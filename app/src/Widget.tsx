import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { Client } from './api';
import { Symbol } from './Symbol';
import type { Drive, Key, State, Weather } from './types';
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
export const WIDGET_LIVE = ['clock', 'weather', 'system', 'nowplaying', 'storage'] as const;

/** 23.6 GB, 1.2 TB: whole numbers from 10 up. */
export function bytes(n: number) {
  const tb = n >= 1e12;
  const v = n / (tb ? 1e12 : 1e9);
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${tb ? 'TB' : 'GB'}`;
}

/** A drive as a ring: the filled part is used space; red when less than a tenth is left. */
function Donut({ d, size }: { d: Drive; size: number }) {
  const w = Math.max(4, size * 0.12);
  const r = (size - w) / 2;
  const len = 2 * Math.PI * r;
  const used = 1 - d.free / d.total;
  const low = d.free / d.total < 0.1;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.1)" strokeWidth={w} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={low ? C.danger : C.silver} strokeWidth={w} fill="none" strokeLinecap="round"
        strokeDasharray={`${len * used} ${len}`} />
    </Svg>
  );
}

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
    case 'storage': {
      const list = state?.storage;
      if (!list?.length) return <Empty text={state ? 'Storage' : '–'} size={small} />;
      // One drive gets a big ring with words beside it; several share the space, a ring and name each.
      if (list.length === 1 || (!tall && width < unit * 2.5)) {
        const d = list[0];
        const ring = Math.min(height - pad * 2, width * 0.42);
        return (
          <View style={[st.fill, st.row, { padding: pad, gap: pad }]}>
            <Donut d={d} size={ring} />
            <View style={{ flex: 1 }}>
              <Text style={[st.thin, { fontSize: big * 0.7 }]} numberOfLines={1} adjustsFontSizeToFit>{bytes(d.free)}</Text>
              <Text style={[st.text, { fontSize: small }]} numberOfLines={1}>free of {bytes(d.total)}</Text>
              <Text style={[st.dim, { fontSize: small * 0.9 }]} numberOfLines={1}>{d.name}</Text>
            </View>
          </View>
        );
      }
      // Several drives: one cell each (side by side, or a 2×2 grid when tall), ring with the numbers beside it.
      const shown = list.slice(0, tall ? 4 : 3);
      const perRow = tall ? Math.min(2, shown.length) : shown.length;
      const rowsN = Math.ceil(shown.length / perRow);
      const cellW = (width - pad * (perRow + 1)) / perRow;
      const cellH = (height - pad * (rowsN + 1)) / rowsN;
      const ring = Math.min(cellH, cellW * 0.42);
      return (
        <View style={[st.fill, { padding: pad, gap: pad, flexDirection: 'row', flexWrap: 'wrap' }]}>
          {shown.map(d => (
            <View key={d.name} style={{ width: cellW, height: cellH, flexDirection: 'row', alignItems: 'center', gap: pad * 0.6 }}>
              <Donut d={d} size={ring} />
              <View style={{ flex: 1 }}>
                <Text style={[st.text, { fontSize: small * 1.15 }]} numberOfLines={1} adjustsFontSizeToFit>{bytes(d.free)} free</Text>
                <Text style={[st.dim, { fontSize: small * 0.85 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{d.name}</Text>
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
