import React, { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import type { Client } from './api';
import { Dial } from './Dial';
import { Fader } from './Fader';
import { KeyEditor } from './Editor';
import { KeyTile, type Feedback } from './KeyTile';
import { usePageKeys } from './running';
import { Library } from './Library';
import { Symbol } from './Symbol';
import type { Action, Deck, Key, State } from './types';
import { C, SPRING } from './theme';

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
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  // Dragging a key (from the grid or the library): it follows the finger and drops on a slot.
  const [drag, setDrag] = useState<{ k: Key; from?: string } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const rootRef = useRef<View>(null);
  const gridRef = useRef<View>(null);
  const origin = useRef({ root: { x: 0, y: 0 }, grid: { x: 0, y: 0 } });
  const flashKey = (slot: string, ok: boolean) => setFeedback(f => ({ ...f, [slot]: { n: (f[slot]?.n ?? 0) + 1, ok } }));

  const pageId = deck.pages.some(p => p.id === stack.at(-1)) ? stack.at(-1)! : deck.pages[0].id;
  const page = deck.pages.find(p => p.id === pageId)!;
  const keys = usePageKeys(api, page, editing);
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

  const firstEmpty = () => Array.from({ length: cols * rows }, (_, i) => String(i)).find(i => !page.keys[i]);
  const addKey = (k: Key, slot = firstEmpty()) => {
    if (slot == null) return setFlash('This page is full. Add a page or make the grid bigger.');
    setKey(slot, k);
    flashKey(`${page.id}/${slot}`, true);
  };

  const startDrag = (k: Key, from?: string) => {
    rootRef.current?.measureInWindow((x, y) => { origin.current.root = { x, y }; });
    gridRef.current?.measureInWindow((x, y) => { origin.current.grid = { x, y }; });
    setDrag({ k, from });
  };
  const slotAt = (px: number, py: number) => {
    const { x, y } = origin.current.grid;
    const c = Math.floor((px - x) / (size + gap));
    const r = Math.floor((py - y) / (size + gap));
    return c >= 0 && c < cols && r >= 0 && r < rows ? String(r * cols + c) : null;
  };
  const drop = (slot: string | null, px = 0) => {
    const d = dragRef.current;
    setDrag(null);
    setHover(null);
    // A grid key dropped on the library panel (right of the grid) is removed.
    if (d?.from != null && slot == null && px > origin.current.grid.x + cols * (size + gap)) {
      setKey(d.from, null);
      return;
    }
    if (!d || slot == null || slot === d.from) return;
    const keys = { ...page.keys };
    if (d.from != null) {
      // Moving within the page swaps with whatever was there.
      const there = keys[slot];
      if (there) keys[d.from] = there; else delete keys[d.from];
    }
    keys[slot] = d.k;
    updatePage({ keys });
    flashKey(`${page.id}/${slot}`, true);
  };
  const dropRef = useRef(drop);
  dropRef.current = drop;
  const slotAtRef = useRef(slotAt);
  const lastTouch = useRef({ x: 0, y: 0 });
  slotAtRef.current = slotAt;

  // Takes over the touch from the pressed key/library tile once a drag has started.
  const dragPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: () => dragRef.current != null,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (e) => {
        const { pageX, pageY } = e.nativeEvent;
        lastTouch.current = { x: pageX, y: pageY };
        dx.value = pageX - origin.current.root.x;
        dy.value = pageY - origin.current.root.y;
        setHover(slotAtRef.current(pageX, pageY));
      },
      onPanResponderRelease: (e) => dropRef.current(slotAtRef.current(e.nativeEvent.pageX, e.nativeEvent.pageY), e.nativeEvent.pageX),
      // Releasing over the library's native scroll view arrives as a terminate, not a release.
      onPanResponderTerminate: () => dropRef.current(slotAtRef.current(lastTouch.current.x, lastTouch.current.y), lastTouch.current.x),
    }),
  ).current;

  const press = (slot: string) => {
    const k = keys[slot];
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
    if (k) fire(k, k.action, `${page.id}/${slot}`);
  };

  // A held key runs its `hold` action under its own id, so a held toggle keeps separate state.
  const fire = (k: Key, a: Action, slotId: string, runId = slotId) => {
    navigate(a);
    api.run(a, runId).then(() => { flashKey(slotId, true); refresh(); }, e => { flashKey(slotId, false); setFlash(`${k.title || 'Key'}: ${e.message}`); });
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
    const options = ['Rename', p.app ? `Unbind from ${p.app}` : 'Open with an app…',
      p.kind === 'running' ? 'Use my own keys' : 'Show open apps', 'Delete page', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: 3, cancelButtonIndex: 4, title: p.name }, i => {
      const patch = (q: object) => setDeck({ ...deck, pages: deck.pages.map(x => (x.id === id ? { ...x, ...q } : x)) });
      if (i === 0) Alert.prompt('Rename page', undefined, name => name?.trim() && patch({ name: name.trim() }), 'plain-text', p.name);
      if (i === 1) {
        if (p.app) patch({ app: undefined });
        else Alert.prompt('Open this page with an app', `While this app is in front on the Mac, Helm shows "${p.name}". Use the app's name as the Mac shows it.`,
          app => app?.trim() && patch({ app: app.trim() }), 'plain-text', state?.mac?.app ?? '');
      }
      if (i === 2) patch({ kind: p.kind === 'running' ? undefined : 'running' });
      if (i === 3 && deck.pages.length > 1) {
        setDeck({ ...deck, pages: deck.pages.filter(x => x.id !== id) });
        setStack([deck.pages.find(x => x.id !== id)!.id]);
      }
    });
  };

  const addPage = () =>
    Alert.prompt('New page', undefined, name => {
      if (!name?.trim()) return;
      const id = uid();
      setDeck({ ...deck, pages: [...deck.pages, { id, name: name.trim(), keys: { 0: { title: 'Back', action: { type: 'back' } } } }] });
      setStack(s => [...s, id]);
    });

  const gap = 16;
  const size = Math.floor(Math.min((area.w - gap * (cols - 1)) / cols, (area.h - gap * (rows - 1)) / rows));
  const dials = deck.dials ?? [];

  const floating = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }, { translateY: dy.value }, { scale: 1.08 }] }));

  const tabs = [
    ...(stack.length > 1 ? [{ id: '__back', label: 'Back', symbol: 'chevron.backward' }] : []),
    ...deck.pages.map(p => ({ id: p.id, label: p.name, symbol: p.app ? 'bolt.fill' : undefined })),
  ];

  return (
    <View style={st.root} ref={rootRef} {...dragPan.panHandlers}>
      <View style={st.top}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.tabScroll} contentContainerStyle={st.tabsRow}>
          <PageTabs tabs={tabs} current={pageId}
            onPress={id => (id === '__back' ? setStack(s => s.slice(0, -1)) : (auto.current = null, setStack([id])))}
            onLongPress={id => editing && id !== '__back' && pageMenu(id)} />
          {editing && <Pill symbol="plus" label="Page" onPress={addPage} />}
        </ScrollView>
        <View style={st.topRight}>
          {editing && (
            <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={st.topRight}>
              <Pill symbol="square.grid.3x3" label={`${cols} × ${rows}`} onPress={() => {
                const i = GRIDS.findIndex(g => g.cols === cols && g.rows === rows);
                setDeck({ ...deck, grid: GRIDS[(i + 1) % GRIDS.length] });
              }} />
              <Pill symbol={deck.autoProfile ? 'bolt.fill' : 'bolt.slash'} label={deck.autoProfile ? 'Follow apps' : 'Fixed page'}
                onPress={() => setDeck({ ...deck, autoProfile: !deck.autoProfile })} />
            </Animated.View>
          )}
          <Pill symbol="desktopcomputer" label={macName} dot={error ? C.danger : C.ok} onPress={onMacs} />
          <Pill label={editing ? 'Done' : 'Edit'} strong={editing} onPress={() => { setEditing(e => !e); setPicked(null); }} />
        </View>
      </View>

      <View style={st.main}>
        <View style={st.grid} onLayout={e => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {size > 0 && (
            <Animated.View ref={gridRef} key={`${page.id}:${cols}x${rows}`} entering={FadeIn.duration(220)} style={{ gap }}>
              {Array.from({ length: rows }, (_, r) => (
                <View key={r} style={[st.gridRow, { gap }]}>
                  {Array.from({ length: cols }, (_, c) => {
                    const slot = String(r * cols + c);
                    const slotId = `${page.id}/${slot}`;
                    const lifted = drag?.from === slot;
                    return (
                      <View key={slot} style={lifted && st.lifted}>
                        <KeyTile id={slotId} k={keys[slot]} size={size} api={api} state={state}
                          editing={editing && !drag} picked={hover === slot && !lifted} feedback={feedback[slotId]} onPress={() => press(slot)}
                          onLongPress={() => {
                            const held = keys[slot]?.hold;
                            if (!editing) return held ? fire(keys[slot], held, slotId, `${slotId}:hold`) : setEditing(true);
                            if (page.keys[slot]) startDrag(page.keys[slot], slot);
                          }} />
                      </View>
                    );
                  })}
                </View>
              ))}
            </Animated.View>
          )}
        </View>

        {editing ? (
          <Library api={api} state={state} dragging={!!drag} onAdd={k => addKey(k)} onDragStart={k => startDrag(k)} />
        ) : dials.length > 0 && (
          <View style={st.dials}>
            {dials.includes('volume') && (
              <Dial value={Math.round((state?.mac?.volume ?? 0) / 5)} min={0} max={20} size={180} label="VOLUME"
                format={v => String(v * 5)} onChange={v => api.run({ type: 'volume', set: v * 5 }).catch(() => {})} />
            )}
            {dials.includes('anc') && state?.headphones && (
              <Dial value={state.headphones.anc?.level ?? 0} min={0} max={10} size={180} label="NOISE"
                onChange={v => api.run({ type: 'hush', cmd: `anc/${v}` }).catch(() => {})} />
            )}
          </View>
        )}
        {!editing && dials.includes('brightness') && (
          <View style={st.dials}>
            {/* macOS can't report brightness, so the fader keeps its own position and nudges the Mac per step. */}
            <Fader label="BRIGHTNESS" height={Math.min(420, area.h)} format={v => `${Math.round((v / 16) * 100)}`}
              onStep={d => {
                const action = { type: 'media' as const, key: d > 0 ? 'brightness-up' as const : 'brightness-down' as const };
                api.run(Math.abs(d) === 1 ? action : { type: 'multi', steps: Array(Math.abs(d)).fill(action), delayMs: 0 }).catch(() => {});
              }} />
          </View>
        )}
      </View>

      <Text style={[st.status, flash && st.err]} numberOfLines={1}>
        {flash ?? (editing
          ? drag ? (drag.from != null ? 'Drop on a slot to move it (a key there swaps places), or on the library to remove it.' : 'Drop it on any slot.') : 'Tap a key to change it  ·  hold and drag to move it  ·  hold a page for options'
          : error ? `Can't reach ${macName}: ${error}` : state?.mac?.app ? `${state.mac.app} is in front` : '')}
      </Text>

      {drag && (
        <Animated.View pointerEvents="none" style={[st.floating, { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }, floating]}>
          <KeyTile id="drag" k={drag.k} size={size} api={api} state={state} editing={false} picked onPress={() => {}} onLongPress={() => {}} />
        </Animated.View>
      )}

      {editSlot != null && (
        <KeyEditor initial={page.keys[editSlot] ?? null} api={api} pages={deck.pages} state={state}
          onCancel={() => setEditSlot(null)}
          onSave={k => { setKey(editSlot, k); setEditSlot(null); }}
          onClear={() => { setKey(editSlot, null); setEditSlot(null); }} />
      )}
    </View>
  );
}

/** Page tabs in one capsule; a silver puck springs to the current page. */
function PageTabs({ tabs, current, onPress, onLongPress }: {
  tabs: { id: string; label: string; symbol?: string }[];
  current: string;
  onPress: (id: string) => void;
  onLongPress: (id: string) => void;
}) {
  const [frames, setFrames] = useState<Record<string, { x: number; w: number }>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const f = frames[current];
  useEffect(() => {
    if (!f) return;
    const first = w.value === 0;
    x.value = first ? f.x : withSpring(f.x, SPRING);
    w.value = first ? f.w : withSpring(f.w, SPRING);
  }, [f?.x, f?.w]); // eslint-disable-line react-hooks/exhaustive-deps
  const puck = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: w.value }));

  return (
    <View style={st.capsule}>
      <Animated.View style={[st.puck, puck]} />
      {tabs.map(t => {
        const on = t.id === current;
        return (
          <Pressable key={t.id} onPress={() => onPress(t.id)} onLongPress={() => onLongPress(t.id)} hitSlop={6}
            onLayout={e => { const { x: lx, width } = e.nativeEvent.layout; setFrames(fr => ({ ...fr, [t.id]: { x: lx, w: width } })); }}
            style={st.tab}>
            {t.symbol && <Symbol name={t.symbol} size={13} weight="semibold" color={on ? C.bg : C.secondary} />}
            <Text style={[st.tabText, on && st.tabTextOn]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small translucent capsule button used across the top bar. */
function Pill({ label, symbol, dot, strong, onPress }: { label: string; symbol?: string; dot?: string; strong?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [st.pill, strong && st.pillStrong, pressed && { opacity: 0.6 }]}>
      {symbol && <Symbol name={symbol} size={14} weight="medium" color={strong ? C.bg : C.secondary} />}
      <Text style={[st.pillText, strong && st.tabTextOn]} numberOfLines={1}>{label}</Text>
      {dot && <View style={[st.dot, { backgroundColor: dot }]} />}
    </Pressable>
  );
}

const glass = { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline };

const st = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 36, paddingTop: 26, paddingBottom: 14 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, gap: 16 },
  tabScroll: { flexGrow: 0, flexShrink: 1 },
  tabsRow: { gap: 10, alignItems: 'center' },
  capsule: { flexDirection: 'row', padding: 4, borderRadius: 20, ...glass },
  puck: { position: 'absolute', top: 4, bottom: 4, left: 0, borderRadius: 16, backgroundColor: C.silver },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 8, paddingHorizontal: 18, borderRadius: 16 },
  tabText: { color: C.secondary, fontSize: 15, fontWeight: '600' },
  tabTextOn: { color: C.bg },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 40, paddingHorizontal: 16, borderRadius: 20, ...glass },
  pillStrong: { backgroundColor: C.silver, borderColor: C.silver },
  pillText: { color: C.text, fontSize: 15, fontWeight: '600', maxWidth: 180 },
  dot: { width: 7, height: 7, borderRadius: 4, marginLeft: 6 },
  err: { color: C.danger },
  main: { flex: 1, flexDirection: 'row', gap: 32 },
  grid: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  gridRow: { flexDirection: 'row', justifyContent: 'center' },
  dials: { justifyContent: 'center', gap: 28 },
  lifted: { opacity: 0.25 },
  floating: { position: 'absolute', left: 0, top: 0, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 16 } },
  status: { color: C.dim, fontSize: 13, textAlign: 'center', marginTop: 12, minHeight: 18, letterSpacing: 0.2 },
});
