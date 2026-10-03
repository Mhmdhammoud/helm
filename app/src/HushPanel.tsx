import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import type { Client } from './api';
import { Backdrop } from './Backdrop';
import { Dial } from './Dial';
import { HushButton, HushCard, HushRing, HushSegmented, HushToggle } from './HushControls';
import { Symbol } from './Symbol';
import type { Action, Device, Headphones, State } from './types';
import { C, SPRING } from './theme';

const SELF_VOICE = ['off', 'low', 'medium', 'high'] as const;
const PRESETS = ['0', '5', '10'] as const;
const PRESET_LABELS = { 0: 'Off', 5: 'Half', 10: 'Full' } as const;
const BANDS = ['bass', 'mid', 'treble'] as const;
const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
const hours = (h: number) => (h >= 1 ? `About ${Math.round(h)} hours left` : `About ${Math.max(1, Math.round(h * 60))} minutes left`);

/** Best guess at an SF Symbol for a paired device, from its name. */
function deviceSymbol(d: Device) {
  const n = d.name.toLowerCase();
  if (/iphone|phone|pixel|galaxy/.test(n)) return 'iphone';
  if (/ipad|tablet/.test(n)) return 'ipad.landscape';
  if (/imac|mac ?mini|mac ?studio|mac ?pro|desktop|\bpc\b/.test(n)) return 'desktopcomputer';
  if (/tv/.test(n)) return 'appletv';
  return 'laptopcomputer';
}

/** Full-screen Hush controls, opened from a deck key ("Hush panel" action). */
export function HushPanel({ api, state, error, onClose, refresh }: {
  api: Client;
  state: State | null;
  error: string | null;
  onClose: () => void;
  refresh: () => void;
}) {
  // Optimistic overrides: the switch moves the moment you tap it; the device catches up on the next poll.
  const [opt, setOpt] = useState<Partial<Headphones>>({});
  const optTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { optTimer.current && clearTimeout(optTimer.current); }, []);
  const h = state?.headphones ? { ...state.headphones, ...opt } : null;
  const m = state?.mac ?? {};
  const connected = h?.status === 'connected';
  const live = connected && !error;
  const win = useWindowDimensions();
  const portrait = win.height > win.width;

  const hush = (cmd: string, patch?: Partial<Headphones>) => {
    if (patch) {
      setOpt(o => ({ ...o, ...patch }));
      optTimer.current && clearTimeout(optTimer.current);
      optTimer.current = setTimeout(() => setOpt({}), 2500);
    }
    api.run({ type: 'hush', cmd }).then(patch ? refresh : undefined, () => {});
  };
  // Dials throttle themselves (one write per 80ms), so they send straight through.
  const dial = (cmd: string) => api.run({ type: 'hush', cmd }).catch(() => {});
  const run = (a: Action) => api.run(a).then(refresh, () => {});

  // Open: slide up and fade in on a spring. Close: quick fade down, then unmount.
  const show = useSharedValue(0);
  useEffect(() => {
    show.value = withSpring(1, SPRING);
  }, [show]);
  const close = () => {
    show.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) });
    setTimeout(onClose, 200);
  };
  const enter = useAnimatedStyle(() => ({ opacity: show.value }));
  const rise = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - show.value) * 48 }, { scale: 0.98 + show.value * 0.02 }] }));

  const level = h?.anc?.level ?? 0;
  const status = error
    ? `Can’t reach the Mac · ${error}`
    : !state
      ? 'Connecting…'
      : !state.headphones
        ? 'Hush isn’t set up on this Mac'
        : connected
          ? h?.hoursRemaining != null ? hours(h.hoursRemaining) : 'Connected'
          : h?.status === 'connecting'
            ? 'Looking for your headphones…'
            : 'Headphones are off or out of range';

  return (
    <Animated.View style={[StyleSheet.absoluteFill, st.scrim, enter]}>
      <Backdrop />
      <Animated.View style={[st.root, rise]}>
        {/* header */}
        <View style={st.header}>
          {connected ? <HushRing value={h?.battery ?? null} size={60} /> : (
            <View style={st.offlineBadge}><Symbol name="headphones" size={26} weight="light" color={C.dim} /></View>
          )}
          <View style={st.flex}>
            <Text style={st.name} numberOfLines={1}>{connected && h?.name ? h.name : 'Hush'}</Text>
            <View style={st.subRow}>
              <View style={[st.dot, { backgroundColor: live ? C.ok : error ? C.danger : C.dim }]} />
              <Text style={st.sub} numberOfLines={1}>{status}</Text>
              {live && h?.inCall && (
                <View style={st.callPill}>
                  <Symbol name="phone.fill" size={12} weight="semibold" color={C.bg} />
                  <Text style={st.callText}>On a call</Text>
                </View>
              )}
            </View>
          </View>
          <Pressable onPress={close} hitSlop={16} style={({ pressed }) => [st.close, pressed && st.pressed]} accessibilityRole="button" accessibilityLabel="Close">
            <Symbol name="xmark" size={17} weight="semibold" color={C.silver} />
          </Pressable>
        </View>

        <View style={[st.body, portrait && st.bodyPortrait]}>
          {/* hero: noise cancelling (a full-width row in portrait) */}
          <HushCard style={portrait ? st.heroPortrait : st.hero}>
            <View style={[st.center, !live && st.off]} pointerEvents={live ? 'auto' : 'none'}>
              <Dial value={level} min={0} max={10} size={portrait ? 260 : 320} label="NOISE CANCELLING" onChange={v => dial(`anc/${v}`)} />
            </View>
            <View style={portrait ? st.heroSide : undefined}>
            <View style={st.presets}>
              <HushSegmented
                options={PRESETS}
                value={live ? PRESETS.find(p => Number(p) === level) : null}
                labels={PRESET_LABELS}
                disabled={!live}
                onChange={p => hush(`anc/${p}`, { anc: { level: Number(p), enabled: p !== '0' } })}
              />
            </View>
            <Text style={st.heroHint}>{!live ? 'Turn your headphones on to adjust' : level === 0 ? 'Noise cancelling is off' : level === 10 ? 'Blocking as much as possible' : 'Turn to block more or less of the room'}</Text>
            </View>
          </HushCard>

          <View style={st.rest}>

          {/* sound */}
          <View style={st.col}>
            <HushCard title="SOUND" action={live ? { label: 'Flat', onPress: () => hush('eq/flat', { eq: { bass: 0, mid: 0, treble: 0 } }) } : undefined}>
              <View style={[st.eq, !live && st.off]} pointerEvents={live ? 'auto' : 'none'}>
                {BANDS.map(band => (
                  <Dial key={band} value={h?.eq?.[band] ?? 0} min={-10} max={10} size={116} bipolar
                    label={band.toUpperCase()} format={signed} onChange={v => dial(`eq/${band}/${v}`)} />
                ))}
              </View>
            </HushCard>
            <HushCard title="HEAR YOURSELF ON CALLS">
              <HushSegmented options={SELF_VOICE} value={h?.selfVoice} disabled={!live}
                onChange={v => hush(`selfvoice/${v}`, { selfVoice: v })} />
            </HushCard>
            <HushCard title="MODES" style={st.toggles}>
              <HushToggle label="Conversation mode" hint="Hear the room without taking them off" value={h?.conversation} disabled={!live}
                onChange={v => hush(`conversation/${v ? 'on' : 'off'}`, { conversation: v })} />
              <View style={st.rule} />
              <HushToggle label="Call mode" hint="During calls: full noise cancelling, and you hear yourself" value={h?.callMode} disabled={!h || !!error}
                onChange={v => hush(`callmode/${v ? 'on' : 'off'}`, { callMode: v })} />
            </HushCard>
          </View>

          {/* devices + mac */}
          <View style={st.side}>
            <HushCard title="LISTEN ON" style={st.flex}>
              <ScrollView contentContainerStyle={st.devices} showsVerticalScrollIndicator={false}>
                {(h?.devices ?? []).length === 0 && (
                  <Text style={st.empty}>{connected ? 'No other devices paired yet' : 'Devices show up here when your headphones are on'}</Text>
                )}
                {(h?.devices ?? []).map(d => ({ ...d, connected: d.connected && live })).map(d => (
                  <Pressable key={d.mac} disabled={d.connected || !live} onPress={() => hush(`switch/${d.name}`)}
                    style={({ pressed }) => [st.device, d.connected && st.deviceOn, !live && st.off, pressed && st.pressed]}>
                    <Symbol name={deviceSymbol(d)} size={22} weight="regular" color={d.connected ? C.bg : C.secondary} />
                    <View style={st.flex}>
                      <Text style={[st.deviceName, d.connected && st.textOn]} numberOfLines={1}>{d.name}</Text>
                      <Text style={[st.deviceHint, d.connected && st.textOnDim]}>
                        {!live ? 'Remembered' : d.connected ? 'Playing here' : 'Tap to switch'}{d.isHost ? ' · this Mac' : ''}
                      </Text>
                    </View>
                    {d.connected && <Symbol name="checkmark" size={16} weight="semibold" color={C.bg} />}
                  </Pressable>
                ))}
              </ScrollView>
            </HushCard>
            <HushCard title={m.volume != null ? `THIS MAC · VOLUME ${m.volume}` : 'THIS MAC'}>
              <View style={[st.buttons, !!error && st.off]} pointerEvents={error ? 'none' : 'auto'}>
                <HushButton symbol={m.micMuted ? 'mic.slash.fill' : 'mic.fill'} label={m.micMuted ? 'Mic off' : 'Mic on'} on={!!m.micMuted} onPress={() => run({ type: 'mic' })} />
                <HushButton symbol="speaker.wave.1.fill" label="Quieter" onPress={() => run({ type: 'volume', change: -6 })} />
                <HushButton symbol="speaker.wave.3.fill" label="Louder" onPress={() => run({ type: 'volume', change: 6 })} />
                <HushButton symbol="moon.fill" label="Sleep screen" onPress={() => run({ type: 'system', what: 'sleep-display' })} />
              </View>
            </HushCard>
          </View>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  off: { opacity: 0.32 },
  // Mostly hides the deck underneath; the metal backdrop still glows through.
  // Opaque: its own metal backdrop over a solid base, so the deck never shows through.
  scrim: { backgroundColor: C.bg },
  root: { flex: 1, paddingHorizontal: 36, paddingTop: 28, paddingBottom: 28, gap: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  offlineBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  name: { color: C.text, fontSize: 30, fontWeight: '300', letterSpacing: 0.3 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  sub: { color: C.secondary, fontSize: 15, flexShrink: 1 },
  callPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 4,
    paddingRight: 10,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.silver,
    marginLeft: 6,
  },
  callText: { color: C.bg, fontSize: 13, fontWeight: '600' },
  close: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  body: { flex: 1, flexDirection: 'row', gap: 20 },
  bodyPortrait: { flexDirection: 'column' },
  rest: { flex: 2.1, flexDirection: 'row', gap: 20 },
  heroPortrait: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 8 },
  heroSide: { gap: 18, alignItems: 'center' },
  hero: { flex: 1.1, alignItems: 'center', justifyContent: 'center', gap: 22 },
  presets: { alignSelf: 'stretch', paddingHorizontal: 12 },
  heroHint: { color: C.dim, fontSize: 14 },
  col: { flex: 1.15, gap: 20 },
  eq: { flexDirection: 'row', justifyContent: 'space-between' },
  toggles: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 2 },
  side: { flex: 0.95, gap: 20 },
  devices: { gap: 10 },
  empty: { color: C.dim, fontSize: 15, lineHeight: 21 },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  deviceOn: { backgroundColor: C.silver, borderColor: C.silver },
  deviceName: { color: C.text, fontSize: 16, fontWeight: '500' },
  deviceHint: { color: C.dim, fontSize: 12, marginTop: 2 },
  textOn: { color: C.bg },
  textOnDim: { color: 'rgba(11,12,14,0.6)' },
  buttons: { flexDirection: 'row', justifyContent: 'space-between' },
});
