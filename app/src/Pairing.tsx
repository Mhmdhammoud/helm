import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { browse, pairFinish, pairStart } from './api';
import type { Mac } from './types';
import { C } from './theme';
import { s } from './ui';

type Found = { name: string; host: string; port: number };

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
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      await pairStart(m);
      setCode('');
      setPairing(m);
    } catch (e: any) {
      setError(`Couldn't reach ${m.name}: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (c: string) => {
    if (!pairing || c.length !== 6) return;
    setBusy(true);
    try {
      onPaired(await pairFinish(pairing, c));
      setPairing(null);
    } catch (e: any) {
      setError(e.message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const manual = () =>
    Alert.prompt('Add a Mac by address', 'Its hostname or IP, e.g. Mac-mini.local', host =>
      host?.trim() && start({ name: host.trim(), host: host.trim(), port: 7733 }));

  const paired = new Set(macs.map(m => m.host));
  const unpaired = found.filter(f => !paired.has(f.host));

  if (pairing) {
    return (
      <View style={[st.root, st.pairing]}>
        <Text style={s.title}>Pair with {pairing.name}</Text>
        <Text style={[s.sub, st.gap]}>Enter the 6-digit code shown on the Mac.</Text>
        <TextInput
          style={st.code}
          value={code}
          onChangeText={t => { const c = t.replace(/\D/g, '').slice(0, 6); setCode(c); if (c.length === 6) finish(c); }}
          keyboardType="number-pad"
          autoFocus
          maxLength={6}
          placeholder="••••••"
          placeholderTextColor={C.dim}
        />
        {busy && <ActivityIndicator color={C.silver} />}
        {error && <Text style={st.error}>{error}</Text>}
        <Pressable onPress={() => { setPairing(null); setError(null); }} style={st.gap}>
          <Text style={st.link}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={st.root}>
      <View style={st.header}>
        <View>
          <Text style={s.title}>Macs</Text>
          <Text style={s.sub}>Run the Helm bridge on a Mac and it shows up here.</Text>
        </View>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={st.link}>Done</Text>
          </Pressable>
        )}
      </View>

      {macs.length > 0 && <Text style={st.label}>PAIRED</Text>}
      {macs.map(m => (
        <Pressable
          key={m.host}
          style={({ pressed }) => [st.row, pressed && s.pressed]}
          onPress={() => onSelect(m.host)}
          onLongPress={() => Alert.alert(`Forget ${m.name}?`, 'You will need to pair again.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Forget', style: 'destructive', onPress: () => onForget(m.host) },
          ])}>
          <Text style={st.rowText}>{m.name}</Text>
          <Text style={st.rowHint}>{found.some(f => f.host === m.host) ? 'online' : m.host}</Text>
        </Pressable>
      ))}

      <Text style={st.label}>ON THIS NETWORK</Text>
      {unpaired.map(m => (
        <Pressable key={m.host} style={({ pressed }) => [st.row, pressed && s.pressed]} onPress={() => start(m)}>
          <Text style={st.rowText}>{m.name}</Text>
          <Text style={st.rowHint}>Pair</Text>
        </Pressable>
      ))}
      {!unpaired.length && <Text style={st.rowHint}>{found.length ? 'Every Mac found is already paired.' : 'Looking for Macs…'}</Text>}
      {busy && <ActivityIndicator color={C.silver} />}
      {error && <Text style={st.error}>{error}</Text>}
      <Pressable onPress={manual} style={st.gap}>
        <Text style={st.link}>Add by address…</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 64, paddingTop: 48, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  label: { color: C.label, fontSize: 12, letterSpacing: 2, fontWeight: '600', marginTop: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: C.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
    maxWidth: 640,
  },
  rowText: { color: C.text, fontSize: 19 },
  rowHint: { color: C.dim, fontSize: 15 },
  link: { color: C.silver, fontSize: 17 },
  gap: { marginTop: 20 },
  // Top-aligned so the on-screen keyboard never covers the code field.
  pairing: { alignItems: 'center', paddingTop: 72 },
  code: { color: C.text, fontSize: 56, letterSpacing: 16, fontWeight: '200', marginVertical: 16, textAlign: 'center', minWidth: 360 },
  error: { color: '#e8a0a0', fontSize: 15, marginTop: 8 },
});
