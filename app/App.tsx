/**
 * Helm: an iPad control surface for the desk. Talks to ../bridge on the Mac, which drives the
 * Hush headphones through hush/bin/hush and runs a few allow-listed Mac actions.
 */
import React from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Canvas, Path, Skia } from 'react-native-skia';
import { useBridge } from './src/api';
import { Dial } from './src/Dial';
import { C } from './src/theme';

const SELF_VOICE = ['off', 'low', 'medium', 'high'] as const;
const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

export default function App() {
  const { state, error, hush, mac, host } = useBridge();
  const h = state?.headphones;
  const connected = h?.status === 'connected';
  const m = state?.mac ?? {};

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{connected ? h?.name : 'Helm'}</Text>
          <Text style={styles.sub}>
            {error
              ? `Can't reach the bridge on ${host} (${error})`
              : !state
                ? 'Connecting…'
                : connected
                  ? `${h?.battery}% battery${h?.hoursRemaining != null ? ` · ~${h.hoursRemaining}h left` : ''}${h?.inCall ? ' · in a call' : ''}`
                  : `Headphones ${h?.status}${h?.error ? `: ${h.error}` : ''}`}
          </Text>
        </View>
        {connected && <Battery value={h?.battery ?? 0} />}
      </View>

      <View style={styles.body}>
        <View style={[styles.col, styles.center]}>
          <Dial
            value={h?.anc?.level ?? 0}
            min={0}
            max={10}
            size={320}
            label="NOISE CANCELLING"
            onChange={v => hush(`anc/${v}`)}
          />
          <View style={styles.row}>
            {[0, 5, 10].map(v => (
              <Chip key={v} label={String(v)} on={h?.anc?.level === v} onPress={() => hush(`anc/${v}`)} />
            ))}
          </View>
        </View>

        <View style={styles.col}>
          <Section title="EQUALISER" action={{ label: 'Flat', onPress: () => hush('eq/flat') }}>
            <View style={styles.row}>
              {(['bass', 'mid', 'treble'] as const).map(band => (
                <Dial
                  key={band}
                  value={h?.eq?.[band] ?? 0}
                  min={-10}
                  max={10}
                  size={108}
                  bipolar
                  label={band.toUpperCase()}
                  format={signed}
                  onChange={v => hush(`eq/${band}/${v}`)}
                />
              ))}
            </View>
          </Section>
          <Section title="SELF VOICE">
            <View style={styles.row}>
              {SELF_VOICE.map(v => (
                <Chip key={v} label={v} on={h?.selfVoice === v} onPress={() => hush(`selfvoice/${v}`)} grow />
              ))}
            </View>
          </Section>
          <View style={styles.row}>
            <Tile
              label="Conversation"
              hint="hear the room"
              on={!!h?.conversation}
              onPress={() => hush(`conversation/${h?.conversation ? 'off' : 'on'}`)}
            />
            <Tile
              label="Call mode"
              hint="max ANC in calls"
              on={!!h?.callMode}
              onPress={() => hush(`callmode/${h?.callMode ? 'off' : 'on'}`)}
            />
          </View>
        </View>

        <View style={styles.col}>
          <Section title="LISTEN ON">
            {(h?.devices ?? []).map(d => (
              <Pressable key={d.mac} onPress={() => hush(`switch/${d.name}`)} style={[styles.device, d.connected && styles.deviceOn]}>
                <Text style={[styles.deviceText, d.connected && styles.textOn]}>
                  {d.connected ? '●' : '○'}  {d.name}
                </Text>
                {d.isHost && <Text style={[styles.hint, d.connected && styles.textOn]}>Mac</Text>}
              </Pressable>
            ))}
          </Section>
          <Section title={`MAC${m.volume != null ? ` · VOLUME ${m.volume}` : ''}`}>
            <View style={styles.grid}>
              <Tile label={m.micMuted ? 'Mic off' : 'Mic on'} on={!!m.micMuted} onPress={() => mac('mic')} />
              <Tile label="Claude" hint="open" onPress={() => mac('claude')} />
              <Tile label="Volume −" onPress={() => mac('volume-down')} />
              <Tile label="Volume +" onPress={() => mac('volume-up')} />
              <Tile label="Display" hint="sleep" onPress={() => mac('sleep-display')} />
            </View>
          </Section>
        </View>
      </View>
    </View>
  );
}

function Battery({ value }: { value: number }) {
  const size = 56;
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
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text style={styles.batteryText}>{value}</Text>
      </View>
    </View>
  );
}

function Section({ title, action, children }: { title: string; action?: { label: string; onPress: () => void }; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action && (
          <Pressable onPress={action.onPress} hitSlop={12}>
            <Text style={styles.sectionAction}>{action.label}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

function Chip({ label, on, onPress, grow }: { label: string; on?: boolean; onPress: () => void; grow?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, grow && styles.grow, on && styles.chipOn, pressed && styles.pressed]}>
      <Text style={[styles.chipText, on && styles.textOn]}>{label}</Text>
    </Pressable>
  );
}

function Tile({ label, hint, on, onPress }: { label: string; hint?: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, on && styles.chipOn, pressed && styles.pressed]}>
      <Text style={[styles.tileText, on && styles.textOn]}>{label}</Text>
      {hint && <Text style={[styles.hint, on && styles.textOn]}>{hint}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 40, paddingTop: 32, paddingBottom: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { color: C.text, fontSize: 34, fontWeight: '300' },
  sub: { color: C.secondary, fontSize: 15, marginTop: 4 },
  body: { flex: 1, flexDirection: 'row', gap: 32 },
  col: { flex: 1, gap: 20 },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  grow: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  section: { gap: 12 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { color: C.label, fontSize: 12, letterSpacing: 2, fontWeight: '600' },
  sectionAction: { color: C.silver, fontSize: 14 },
  chip: {
    minWidth: 64,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
    backgroundColor: '#15171a',
  },
  chipOn: { backgroundColor: C.silver, borderColor: C.silver },
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
    backgroundColor: '#15171a',
  },
  tileText: { color: C.text, fontSize: 18, fontWeight: '500' },
  hint: { color: C.dim, fontSize: 13, marginTop: 2 },
  device: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: '#15171a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  deviceOn: { backgroundColor: C.silver },
  deviceText: { color: C.text, fontSize: 17 },
  batteryText: { color: C.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
