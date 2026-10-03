import React, { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Client } from './api';
import { Dial } from './Dial';
import { KeyEditor } from './Editor';
import { KeyTile } from './KeyTile';
import type { Action, Deck, Key, State } from './types';
import { C } from './theme';

const GRIDS = [{ cols: 4, rows: 3 }, { cols: 5, rows: 3 }, { cols: 6, rows: 4 }, { cols: 8, rows: 4 }];
const uid = () => Math.random().toString(36).slice(2, 8);

/** The Stream Deck: page tabs, a key grid, and a dial strip. Edit mode turns taps into editing. */
export function DeckScreen({ api, deck, setDeck, state, error, macName, onMacs, onOpenApp, refresh }: {
  api: Client;
  deck: Deck;
  setDeck: (d: Deck) => void;
  state: State | null;
  error: string | null;
  macName: string;
  onMacs: () => void;
  onOpenApp: (app: 'hush') => void;
  refresh: () => void;
}) {
  const [stack, setStack] = useState<string[]>([deck.pages[0].id]);
  const [editing, setEditing] = useState(false);
  const [editSlot, setEditSlot] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [flash, setFlash] = useState<string | null>(null);

  const pageId = deck.pages.some(p => p.id === stack.at(-1)) ? stack.at(-1)! : deck.pages[0].id;
  const page = deck.pages.find(p => p.id === pageId)!;
  const { cols, rows } = deck.grid;

  // Profiles: a page bound to an app opens while that app is in front, and closes when it isn't.
  const auto = useRef<string | null>(null);
  const front = state?.mac?.app?.toLowerCase();
  useEffect(() => {
    if (!deck.autoProfile || editing || !front) return;
    const match = deck.pages.find(p => p.app?.toLowerCase() === front);
    if (match && match.id !== pageId) {
      auto.current = match.id;
      setStack(s => [...s, match.id]);
    } else if (!match && auto.current === pageId) {
      auto.current = null;
      setStack(s => (s.length > 1 ? s.slice(0, -1) : s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [front]);

  const updatePage = (patch: Partial<typeof page>) =>
    setDeck({ ...deck, pages: deck.pages.map(p => (p.id === page.id ? { ...p, ...patch } : p)) });
  const setKey = (slot: string, k: Key | null) => {
    const keys = { ...page.keys };
    if (k) keys[slot] = k; else delete keys[slot];
    updatePage({ keys });
  };

  const press = (slot: string) => {
    const k = page.keys[slot];
    if (editing) {
      if (picked) {
        // Second tap of a move: swap the two slots.
        const keys = { ...page.keys };
        const a = keys[picked];
        const b = keys[slot];
        if (b) keys[picked] = b; else delete keys[picked];
        if (a) keys[slot] = a; else delete keys[slot];
        updatePage({ keys });
        setPicked(null);
      } else setEditSlot(slot);
      return;
    }
    if (!k) return;
    navigate(k.action);
    api.run(k.action, `${page.id}/${slot}`).then(refresh, e => setFlash(`${k.title || 'Key'}: ${e.message}`));
  };

  const navigate = (a: Action) => {
    if (a.type === 'page') { auto.current = null; setStack(s => [...s, a.page]); }
    if (a.type === 'back') setStack(s => (s.length > 1 ? s.slice(0, -1) : s));
    if (a.type === 'app') onOpenApp(a.app);
  };

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const pageMenu = (id: string) => {
    const p = deck.pages.find(x => x.id === id)!;
    const options = ['Rename', p.app ? `Unbind from ${p.app}` : 'Open with an app…', 'Delete page', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: 2, cancelButtonIndex: 3, title: p.name }, i => {
      const patch = (q: object) => setDeck({ ...deck, pages: deck.pages.map(x => (x.id === id ? { ...x, ...q } : x)) });
      if (i === 0) Alert.prompt('Rename page', undefined, name => name?.trim() && patch({ name: name.trim() }), 'plain-text', p.name);
      if (i === 1) {
        if (p.app) patch({ app: undefined });
        else Alert.prompt('Open this page with an app', `While this app is in front on the Mac, Helm shows "${p.name}". Use the app's name as the Mac shows it.`,
          app => app?.trim() && patch({ app: app.trim() }), 'plain-text', state?.mac?.app ?? '');
      }
      if (i === 2 && deck.pages.length > 1) {
        setDeck({ ...deck, pages: deck.pages.filter(x => x.id !== id) });
        setStack([deck.pages.find(x => x.id !== id)!.id]);
      }
    });
  };

  const addPage = () =>
    Alert.prompt('New page', undefined, name => {
      if (!name?.trim()) return;
      const id = uid();
      setDeck({ ...deck, pages: [...deck.pages, { id, name: name.trim(), keys: { 0: { title: 'Back', icon: { emoji: '↩️' }, action: { type: 'back' } } } }] });
      setStack(s => [...s, id]);
    });

  const gap = 16;
  const size = Math.floor(Math.min((area.w - gap * (cols - 1)) / cols, (area.h - gap * (rows - 1)) / rows));
  const dials = deck.dials ?? [];

  return (
    <View style={st.root}>
      <View style={st.top}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabs}>
          {stack.length > 1 && (
            <Pressable onPress={() => setStack(s => s.slice(0, -1))} style={st.tab}><Text style={st.tabText}>‹ Back</Text></Pressable>
          )}
          {deck.pages.map(p => (
            <Pressable key={p.id} onPress={() => { auto.current = null; setStack([p.id]); }} onLongPress={() => editing && pageMenu(p.id)}
              style={[st.tab, p.id === pageId && st.tabOn]}>
              <Text style={[st.tabText, p.id === pageId && st.tabTextOn]}>{p.name}{p.app ? ' ⚡︎' : ''}</Text>
            </Pressable>
          ))}
          {editing && <Pressable onPress={addPage} style={st.tab}><Text style={st.tabText}>+ Page</Text></Pressable>}
        </ScrollView>
        <View style={st.topRight}>
          {editing && (
            <Pressable onPress={() => {
              const i = GRIDS.findIndex(g => g.cols === cols && g.rows === rows);
              setDeck({ ...deck, grid: GRIDS[(i + 1) % GRIDS.length] });
            }}><Text style={st.action}>{cols}×{rows}</Text></Pressable>
          )}
          {editing && (
            <Pressable onPress={() => setDeck({ ...deck, autoProfile: !deck.autoProfile })}>
              <Text style={st.action}>Profiles {deck.autoProfile ? 'on' : 'off'}</Text>
            </Pressable>
          )}
          <Pressable onPress={onMacs}><Text style={[st.action, error && st.err]}>{error ? '⚠︎ ' : '● '}{macName}</Text></Pressable>
          <Pressable onPress={() => { setEditing(e => !e); setPicked(null); }}>
            <Text style={[st.action, st.bold]}>{editing ? 'Done' : 'Edit'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={st.main}>
        <View style={st.grid} onLayout={e => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {size > 0 && Array.from({ length: rows }, (_, r) => (
            <View key={r} style={[st.gridRow, { gap }]}>
              {Array.from({ length: cols }, (_, c) => {
                const slot = String(r * cols + c);
                return (
                  <KeyTile key={slot} id={`${page.id}/${slot}`} k={page.keys[slot]} size={size} api={api} state={state}
                    editing={editing} picked={picked === slot} onPress={() => press(slot)}
                    onLongPress={() => (editing ? setPicked(page.keys[slot] ? slot : null) : setEditing(true))} />
                );
              })}
            </View>
          ))}
        </View>

        {dials.length > 0 && (
          <View style={st.dials}>
            {dials.includes('volume') && (
              <Dial value={Math.round((state?.mac?.volume ?? 0) / 5)} min={0} max={20} size={170} label="VOLUME"
                format={v => String(v * 5)} onChange={v => api.run({ type: 'volume', set: v * 5 }).catch(() => {})} />
            )}
            {dials.includes('anc') && state?.headphones && (
              <Dial value={state.headphones.anc?.level ?? 0} min={0} max={10} size={170} label="NOISE"
                onChange={v => api.run({ type: 'hush', cmd: `anc/${v}` }).catch(() => {})} />
            )}
          </View>
        )}
      </View>

      <Text style={st.status} numberOfLines={1}>
        {flash ?? (editing
          ? picked ? 'Tap another slot to swap with it.' : 'Tap a key to edit it · long-press a key to move it · long-press a page tab for options'
          : error ? `Can't reach ${macName}: ${error}` : state?.mac?.app ? `${state.mac.app} is in front` : '')}
      </Text>

      {editSlot != null && (
        <KeyEditor initial={page.keys[editSlot] ?? null} api={api} pages={deck.pages}
          onCancel={() => setEditSlot(null)}
          onSave={k => { setKey(editSlot, k); setEditSlot(null); }}
          onClear={() => { setKey(editSlot, null); setEditSlot(null); }} />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 32, paddingTop: 24, paddingBottom: 12 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16 },
  tabs: { gap: 8, alignItems: 'center' },
  tab: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12, backgroundColor: C.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline },
  tabOn: { backgroundColor: C.silver, borderColor: C.silver },
  tabText: { color: C.secondary, fontSize: 16, fontWeight: '500' },
  tabTextOn: { color: C.bg },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  action: { color: C.silver, fontSize: 16 },
  bold: { fontWeight: '600' },
  err: { color: '#e8a0a0' },
  main: { flex: 1, flexDirection: 'row', gap: 28 },
  grid: { flex: 1, justifyContent: 'center', gap: 16 },
  gridRow: { flexDirection: 'row', justifyContent: 'center' },
  dials: { justifyContent: 'center', gap: 24 },
  status: { color: C.dim, fontSize: 14, textAlign: 'center', marginTop: 10, minHeight: 18 },
});
