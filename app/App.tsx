/**
 * Helm: a Stream Deck for your Macs, on the iPad. Pair with any Mac running ../bridge,
 * then press keys to run actions there. Hush (headphones) lives inside as a full-screen panel.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
import { client, useLive, useMacs } from './src/api';
import { Backdrop } from './src/Backdrop';
import { DeckScreen } from './src/DeckScreen';
import { HushPanel } from './src/HushPanel';
import { Pairing } from './src/Pairing';
import { Splash } from './src/Splash';
import type { Deck } from './src/types';
import { C } from './src/theme';

export default function App() {
  const macs = useMacs();
  const [showMacs, setShowMacs] = useState(false);
  const [panel, setPanel] = useState<'hush' | null>(null);
  const [deck, setDeckState] = useState<Deck | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const api = useMemo(() => (macs.current ? client(macs.current) : null), [macs.current]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useLive(api);

  useEffect(() => {
    setDeckState(null);
    setDeckError(null);
    api?.deck().then(setDeckState, e => setDeckError(e.status === 401 ? 'This Mac no longer knows this iPad. Pair again.' : e.message));
  }, [api]);

  // Edits show instantly; the Mac copy is saved half a second after the last change.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setDeck = (d: Deck) => {
    setDeckState(d);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => api?.saveDeck(d).catch(e => setDeckError(`Couldn't save: ${e.message}`)), 500);
  };

  let screen: React.ReactNode;
  if (!macs.loaded) screen = null;
  else if (!macs.current || showMacs) {
    screen = (
      <Pairing
        macs={macs.macs}
        onPaired={m => { macs.add(m); setShowMacs(false); }}
        onSelect={host => { macs.select(host); setShowMacs(false); }}
        onForget={macs.forget}
        onClose={macs.current ? () => setShowMacs(false) : undefined}
      />
    );
  } else if (!deck) {
    screen = (
      <View style={st.center}>
        {deckError ? <Text style={st.msg} onPress={() => setShowMacs(true)}>{deckError}{'\n\n'}Tap to choose a Mac</Text> : <ActivityIndicator color={C.silver} />}
      </View>
    );
  } else {
    screen = (
      <>
        <DeckScreen api={api!} deck={deck} setDeck={setDeck} state={live.state} error={live.error ?? deckError}
          macName={macs.current.name} onMacs={() => setShowMacs(true)} onOpenApp={setPanel} refresh={live.refresh} />
        {panel === 'hush' && <HushPanel api={api!} state={live.state} error={live.error} refresh={live.refresh} onClose={() => setPanel(null)} />}
      </>
    );
  }

  return (
    <View style={st.root}>
      <StatusBar hidden />
      <Backdrop />
      {screen}
      <Splash ready={macs.loaded && (!macs.current || !!deck || !!deckError)} />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  msg: { color: C.secondary, fontSize: 17, textAlign: 'center' },
});
