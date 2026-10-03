import React, { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Client } from './api';
import { Dial } from './Dial';
import type { Action, State } from './types';
import { C } from './theme';
import { Battery, Chip, Section, Tile, s } from './ui';

const SELF_VOICE = ['off', 'low', 'medium', 'high'] as const;
const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

/** Full-screen Hush controls, opened from a deck key ("Hush panel" action). */
export function HushPanel({ api, state, error, onClose, refresh }: {
  api: Client;
  state: State | null;
  error: string | null;
  onClose: () => void;
  refresh: () => void;
}) {
  const h = state?.headphones;
  const m = state?.mac ?? {};
  const connected = h?.status === 'connected';

  // Latest-wins per command family, so dragging a dial sends at most one command per 120ms.
  const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const hush = useCallback((cmd: string) => {
    const key = cmd.split('/').slice(0, cmd.startsWith('eq/') ? 2 : 1).join('/');
    clearTimeout(pending.current[key]);
    pending.current[key] = setTimeout(() => api.run({ type: 'hush', cmd }).then(refresh, () => {}), 120);
  }, [api, refresh]);
  const run = (a: Action) => api.run(a).then(refresh, () => {});

  return (
    <View style={st.root}>
      <View style={st.header}>
        <View>
          <Text style={s.title}>{connected ? h?.name : 'Hush'}</Text>
          <Text style={s.sub}>
            {error
              ? `Can't reach the Mac (${error})`
              : !h
                ? 'Hush isn’t installed on this Mac'
                : connected
                  ? `${h.battery}% battery${h.hoursRemaining != null ? ` · ~${h.hoursRemaining}h left` : ''}${h.inCall ? ' · in a call' : ''}`
                  : `Headphones ${h.status}${h.error ? `: ${h.error}` : ''}`}
          </Text>
        </View>
        <View style={st.headerRight}>
          {connected && <Battery value={h?.battery ?? 0} />}
          <Pressable onPress={onClose} hitSlop={16}><Text style={st.done}>Done</Text></Pressable>
        </View>
      </View>

      <View style={st.body}>
        <View style={[st.col, s.center]}>
          <Dial value={h?.anc?.level ?? 0} min={0} max={10} size={320} label="NOISE CANCELLING" onChange={v => hush(`anc/${v}`)} />
          <View style={s.row}>
            {[0, 5, 10].map(v => <Chip key={v} label={String(v)} on={h?.anc?.level === v} onPress={() => hush(`anc/${v}`)} />)}
          </View>
        </View>

        <View style={st.col}>
          <Section title="EQUALISER" action={{ label: 'Flat', onPress: () => hush('eq/flat') }}>
            <View style={s.row}>
              {(['bass', 'mid', 'treble'] as const).map(band => (
                <Dial key={band} value={h?.eq?.[band] ?? 0} min={-10} max={10} size={108} bipolar
                  label={band.toUpperCase()} format={signed} onChange={v => hush(`eq/${band}/${v}`)} />
              ))}
            </View>
          </Section>
          <Section title="SELF VOICE">
            <View style={s.row}>
              {SELF_VOICE.map(v => <Chip key={v} label={v} on={h?.selfVoice === v} onPress={() => hush(`selfvoice/${v}`)} grow />)}
            </View>
          </Section>
          <View style={s.row}>
            <Tile label="Conversation" hint="hear the room" on={!!h?.conversation} onPress={() => hush(`conversation/${h?.conversation ? 'off' : 'on'}`)} />
            <Tile label="Call mode" hint="max ANC in calls" on={!!h?.callMode} onPress={() => hush(`callmode/${h?.callMode ? 'off' : 'on'}`)} />
          </View>
        </View>

        <View style={st.col}>
          <Section title="LISTEN ON">
            {(h?.devices ?? []).map(d => (
              <Pressable key={d.mac} onPress={() => hush(`switch/${d.name}`)} style={[st.device, d.connected && st.deviceOn]}>
                <Text style={[st.deviceText, d.connected && s.textOn]}>{d.connected ? '●' : '○'}  {d.name}</Text>
                {d.isHost && <Text style={[s.hint, d.connected && s.textOn]}>Mac</Text>}
              </Pressable>
            ))}
          </Section>
          <Section title={`MAC${m.volume != null ? ` · VOLUME ${m.volume}` : ''}`}>
            <View style={s.wrap}>
              <Tile label={m.micMuted ? 'Mic off' : 'Mic on'} on={!!m.micMuted} onPress={() => run({ type: 'mic' })} />
              <Tile label="Claude" hint="open" onPress={() => run({ type: 'open', target: 'Claude' })} />
              <Tile label="Volume −" onPress={() => run({ type: 'volume', change: -6 })} />
              <Tile label="Volume +" onPress={() => run({ type: 'volume', change: 6 })} />
              <Tile label="Display" hint="sleep" onPress={() => run({ type: 'system', what: 'sleep-display' })} />
            </View>
          </Section>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: C.bg, paddingHorizontal: 40, paddingTop: 32, paddingBottom: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  done: { color: C.silver, fontSize: 18, fontWeight: '600' },
  body: { flex: 1, flexDirection: 'row', gap: 32 },
  col: { flex: 1, gap: 20 },
  device: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: C.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  deviceOn: { backgroundColor: C.silver },
  deviceText: { color: C.text, fontSize: 17 },
});
