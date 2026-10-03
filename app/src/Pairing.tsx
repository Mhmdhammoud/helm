import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { browse, pairFinish, pairStart } from './api';
import { Backdrop } from './Backdrop';
import { PairingGlow } from './PairingGlow';
import { Symbol } from './Symbol';
import type { Mac } from './types';
import { C, SPRING } from './theme';

type Found = { name: string; host: string; port: number };

/** Best guess at which Mac this is, from its name. */
export function macSymbol(name: string): string {
  if (/mini/i.test(name)) return 'macmini';
  if (/book|laptop|air/i.test(name)) return 'laptopcomputer';
  if (/studio/i.test(name)) return 'macstudio';
  if (/mac ?pro/i.test(name)) return 'macpro.gen3';
  return 'desktopcomputer';
}

// The bridge's errors are terse; say what to do instead.
const friendly = (msg: string) =>
  /wrong code/i.test(msg) ? "That code doesn't match. Check the Mac and try again."
  : /no pairing/i.test(msg) ? 'The code has expired. Go back and start again.'
  : msg;

/** Lists Macs running the Helm bridge (Bonjour) and pairs with one using the code it shows. */
export function Pairing({ macs, onPaired, onSelect, onForget, onClose }: {
  macs: Mac[];
  onPaired: (m: Mac) => void;
  onSelect: (host: string) => void;
  onForget: (host: string) => void;
  onClose?: () => void;
}) {
  const [found, setFound] = useState<Found[]>([]);
  const [pairing, setPairing] = useState<Found | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const scan = () => browse(2500).then(f => alive && setFound(f), () => {});
    scan();
    const t = setInterval(scan, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const start = async (m: Found) => {
    setError(null);
    setStarting(m.host);
    try {
      await pairStart(m);
      setPairing(m);
    } catch (e: any) {
      setError(`Couldn't reach ${m.name}: ${e.message}`);
    } finally {
      setStarting(null);
    }
  };

  const manual = () =>
    Alert.prompt('Add a Mac by address', 'Its hostname or IP, e.g. Mac-mini.local', host =>
      host?.trim() && start({ name: host.trim(), host: host.trim(), port: 7733 }));

  const forget = (m: Mac) =>
    Alert.alert(`Forget ${m.name}?`, 'You will need to pair again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: () => onForget(m.host) },
    ]);

  const paired = new Set(macs.map(m => m.host));
  const unpaired = found.filter(f => !paired.has(f.host));
  const online = (host: string) => found.some(f => f.host === host);

  return (
    <View style={st.root}>
      <Backdrop calm={0.6} />
      {pairing ? (
        <CodeEntry mac={pairing} onPaired={onPaired} onCancel={() => setPairing(null)} />
      ) : (
        <ScrollView contentContainerStyle={st.list}>
          <View style={st.hero}>
            <View>
              <Text style={st.wordmark}>HELM</Text>
              <Text style={st.tagline}>A Stream Deck for your Macs.</Text>
            </View>
            {onClose && (
              <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => [st.done, pressed && st.pressed]}>
                <Text style={st.doneText}>Done</Text>
              </Pressable>
            )}
          </View>

          {macs.length > 0 && (
            <>
              <Text style={st.label}>YOUR MACS</Text>
              <View style={st.cards}>
                {macs.map(m => (
                  <MacCard key={m.host} name={m.name} detail={online(m.host) ? 'Online' : m.host} online={online(m.host)} cta="Connect"
                    onPress={() => onSelect(m.host)} onLongPress={() => forget(m)} />
                ))}
              </View>
            </>
          )}

          <View style={st.labelRow}>
            <Text style={st.label}>ON THIS NETWORK</Text>
            <ActivityIndicator size="small" color={C.dim} />
          </View>
          <View style={st.cards}>
            {unpaired.map(m => (
              <MacCard key={m.host} name={m.name} detail="Ready to pair" online cta="Pair" busy={starting === m.host} onPress={() => start(m)} />
            ))}
            <Pressable onPress={manual} style={({ pressed }) => [st.card, st.addCard, pressed && st.pressed]}>
              <Symbol name="plus" size={30} weight="light" color={C.secondary} />
              <Text style={st.addText}>Add by address</Text>
              {starting && !unpaired.some(u => u.host === starting) && <ActivityIndicator color={C.silver} />}
            </Pressable>
          </View>
          <Text style={st.hint}>
            {unpaired.length
              ? 'Tap a Mac to pair. It will show a six-digit code.'
              : found.length
                ? 'Every Mac on this network is already paired.'
                : 'Looking for Macs… Run the Helm bridge on a Mac and it appears here.'}
            {macs.length > 0 ? '  Touch and hold one of your Macs to forget it.' : ''}
          </Text>
          {error && <Text style={st.error}>{error}</Text>}
        </ScrollView>
      )}
    </View>
  );
}

function MacCard({ name, detail, online, cta, busy, onPress, onLongPress }: {
  name: string;
  detail: string;
  online: boolean;
  cta: string;
  busy?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const press = useSharedValue(0);
  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.04 }] }));
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={450} accessibilityRole="button" accessibilityLabel={`${name}, ${detail}. ${cta}`}
      onPressIn={() => { press.value = withSpring(1, SPRING); }} onPressOut={() => { press.value = withSpring(0, SPRING); }}>
      <Animated.View style={[st.card, body]}>
        <View style={st.cardTop}>
          <Symbol name={macSymbol(name)} size={52} weight="light" color={C.text} />
          <View style={[st.dot, online && st.dotOn]} />
        </View>
        <View>
          <Text style={st.cardName} numberOfLines={1}>{name}</Text>
          <Text style={st.cardDetail} numberOfLines={1}>{detail}</Text>
        </View>
        <View style={st.cta}>
          {busy ? <ActivityIndicator size="small" color={C.bg} /> : <Text style={st.ctaText}>{cta}</Text>}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const PANEL_W = 620;
const PANEL_H = 400;

/** Six digit boxes driven by one hidden field. Shakes on a wrong code, lights up on success. */
function CodeEntry({ mac, onPaired, onCancel }: { mac: Found; onPaired: (m: Mac) => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  const shake = useSharedValue(0);
  const caret = useSharedValue(1);
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withSpring(1, SPRING);
    caret.value = withRepeat(withSequence(withTiming(0, { duration: 500 }), withTiming(1, { duration: 500 })), -1);
  }, [enter, caret]);

  const finish = async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const m = await pairFinish(mac, c);
      setDone(true);
      setTimeout(() => onPaired(m), 900); // let the success state land
    } catch (e: any) {
      setError(friendly(e.message));
      setCode('');
      shake.value = withSequence(
        withTiming(-16, { duration: 50, easing: Easing.out(Easing.quad) }),
        withRepeat(withTiming(16, { duration: 80, easing: Easing.inOut(Easing.quad) }), 4, true),
        withSpring(0, SPRING),
      );
    } finally {
      setBusy(false);
    }
  };

  const panel = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * 40 }] }));
  const row = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const caretStyle = useAnimatedStyle(() => ({ opacity: caret.value }));
  const active = Math.min(code.length, 5);

  return (
    <View style={st.codeRoot}>
      <Animated.View style={[st.panel, panel]}>
        <PairingGlow active={!done} width={PANEL_W} height={PANEL_H} radius={32} />
        <Symbol name={done ? 'checkmark.circle.fill' : macSymbol(mac.name)} size={44} weight="light" color={done ? C.ok : C.text} bounce={done ? 1 : 0} />
        <Text style={st.codeTitle}>{done ? `Paired with ${mac.name}` : `Pair with ${mac.name}`}</Text>
        <Text style={st.codeSub}>{done ? 'Opening your deck…' : 'Enter the six-digit code shown on the Mac.'}</Text>

        <Pressable onPress={() => input.current?.focus()} accessibilityLabel="Pairing code">
          <Animated.View style={[st.boxes, row]}>
            {Array.from({ length: 6 }, (_, i) => {
              const isActive = !done && !busy && i === active && code.length < 6;
              return (
                <View key={i} style={[st.box, isActive && st.boxActive, done && st.boxDone]}>
                  {code[i] ? (
                    <Text style={[st.digit, done && st.digitDone]}>{code[i]}</Text>
                  ) : (
                    isActive && <Animated.View style={[st.caret, caretStyle]} />
                  )}
                </View>
              );
            })}
          </Animated.View>
          <TextInput
            ref={input}
            style={st.hidden}
            value={code}
            onChangeText={t => {
              const c = t.replace(/\D/g, '').slice(0, 6);
              setCode(c);
              if (c.length === 6) finish(c);
            }}
            editable={!busy && !done}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            keyboardAppearance="dark"
            caretHidden
            autoFocus
            maxLength={6}
          />
        </Pressable>

        <View style={st.status}>
          {busy ? <ActivityIndicator color={C.silver} /> : error ? <Text style={st.error}>{error}</Text> : null}
        </View>
      </Animated.View>
      {!done && (
        <Pressable onPress={onCancel} hitSlop={12} style={({ pressed }) => [st.cancel, pressed && st.pressed]}>
          <Text style={st.cancelText}>Cancel</Text>
        </Pressable>
      )}
    </View>
  );
}

const glass = {
  backgroundColor: 'rgba(16,17,20,0.72)',
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: 'rgba(255,255,255,0.18)',
} as const;

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  pressed: { opacity: 0.6 },
  list: { paddingHorizontal: 64, paddingTop: 56, paddingBottom: 48 },
  hero: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 44 },
  wordmark: { color: C.text, fontSize: 64, fontWeight: '200', letterSpacing: 22 },
  tagline: { color: C.secondary, fontSize: 17, marginTop: 6, letterSpacing: 0.3 },
  done: { ...glass, paddingVertical: 9, paddingHorizontal: 20, borderRadius: 999 },
  doneText: { color: C.text, fontSize: 16, fontWeight: '600' },

  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { color: C.label, fontSize: 12, letterSpacing: 2, fontWeight: '700', marginVertical: 16 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginBottom: 20 },
  card: { ...glass, width: 236, height: 220, borderRadius: 26, padding: 20, justifyContent: 'space-between' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 6, backgroundColor: 'rgba(255,255,255,0.22)' },
  dotOn: { backgroundColor: C.ok, shadowColor: C.ok, shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  cardName: { color: C.text, fontSize: 19, fontWeight: '600' },
  cardDetail: { color: C.dim, fontSize: 14, marginTop: 2 },
  cta: { alignSelf: 'flex-start', minWidth: 84, alignItems: 'center', backgroundColor: C.silver, paddingVertical: 7, paddingHorizontal: 18, borderRadius: 999 },
  ctaText: { color: C.bg, fontSize: 15, fontWeight: '600' },
  addCard: { alignItems: 'center', justifyContent: 'center', gap: 10, borderStyle: 'dashed', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(16,17,20,0.4)' },
  addText: { color: C.secondary, fontSize: 16, fontWeight: '500' },
  hint: { color: C.dim, fontSize: 15 },
  error: { color: C.danger, fontSize: 15, marginTop: 8, textAlign: 'center' },

  // Top-aligned so the on-screen keyboard never covers the code.
  codeRoot: { flex: 1, alignItems: 'center', paddingTop: 48 },
  panel: { ...glass, width: PANEL_W, height: PANEL_H, borderRadius: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  codeTitle: { color: C.text, fontSize: 28, fontWeight: '300', marginTop: 12 },
  codeSub: { color: C.secondary, fontSize: 16, marginTop: 6, marginBottom: 28 },
  boxes: { flexDirection: 'row', gap: 12 },
  box: {
    width: 64,
    height: 80,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  boxActive: { borderColor: C.silver, shadowColor: '#ffffff', shadowOpacity: 0.55, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  boxDone: { backgroundColor: C.silver, borderColor: C.silver },
  digit: { color: C.text, fontSize: 40, fontWeight: '300', fontVariant: ['tabular-nums'] },
  digitDone: { color: C.bg },
  caret: { width: 2, height: 36, borderRadius: 1, backgroundColor: C.silver },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  status: { height: 44, justifyContent: 'center', marginTop: 12 },
  cancel: { marginTop: 24, paddingVertical: 8, paddingHorizontal: 18 },
  cancelText: { color: C.silver, fontSize: 17 },
});
