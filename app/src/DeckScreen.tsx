import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, useWindowDimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import type { Client } from './api';
import { Dial } from './Dial';
import { Fader } from './Fader';
import { KeyEditor } from './Editor';
import { KeyTile, type DragProps, type Feedback } from './KeyTile';
import { layout, place, spanOf } from './grid';
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
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  // The slot under a dragged key (-1: none) and where the root and grid sit, all read on the UI thread.
  const hover = useSharedValue(-1);
  const org = useSharedValue({ rx: 0, ry: 0, gx: 0, gy: 0 });
  const rootRef = useRef<View>(null);
  const gridRef = useRef<View>(null);
  const origin = useRef({ root: { x: 0, y: 0 }, grid: { x: 0, y: 0 } });
  const flashKey = (slot: string, ok: boolean) => setFeedback(f => ({ ...f, [slot]: { n: (f[slot]?.n ?? 0) + 1, ok } }));

  const pageId = deck.pages.some(p => p.id === stack.at(-1)) ? stack.at(-1)! : deck.pages[0].id;
  const page = deck.pages.find(p => p.id === pageId)!;
  const keys = usePageKeys(api, page, editing);
  const { cols, rows } = deck.grid;
  const win = useWindowDimensions();
  const portrait = win.height > win.width;

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

  const startDrag = (k: Key, from?: string) => {
    rootRef.current?.measureInWindow((x, y) => { origin.current.root = { x, y }; org.value = { ...org.value, rx: x, ry: y }; });
    gridRef.current?.measureInWindow((x, y) => { origin.current.grid = { x, y }; org.value = { ...org.value, gx: x, gy: y }; });
    dragRef.current = { k, from }; // a hold released at once ends before the next render
    setDrag({ k, from });
  };
  const slotAt = (px: number, py: number) => {
    const { x, y } = origin.current.grid;
    const c = Math.floor((px - x) / (size + gap));
    const r = Math.floor((py - y) / (size + gap));
    return c >= 0 && c < cols && r >= 0 && r < rows ? String(r * cols + c) : null;
  };
  const drop = (slot: string | null, px = 0, py = 0) => {
    const d = dragRef.current;
    setDrag(null);
    hover.value = -1;
    // A grid key dropped on the library panel (right of the grid) is removed.
    // (Right of the grid in landscape, below it in portrait.)
    if (d?.from != null && slot == null && (px > origin.current.grid.x + cols * (size + gap) || py > origin.current.grid.y + rows * (size + gap))) {
      setKey(d.from, null);
      return;
    }
    if (!d || slot == null || slot === d.from) return;
    // Single keys swap (or replace, from the library); widgets need free room.
    const keys = place(page.keys, cols, rows, d.k, slot, d.from);
    if (!keys) return setFlash(`Not enough room there for a ${spanOf(d.k).w}×${spanOf(d.k).h} widget.`);
    updatePage({ keys });
    flashKey(`${page.id}/${slot}`, true);
  };
  // Gesture handlers for a draggable key (a grid key in edit mode, or a library key when `from` is unset).
  // Keys skip re-rendering when nothing they show changed (KeyTile is memoised), so their handlers must never
  // hold an old render's deck: each slot gets stable handlers that call this render's functions.
  const latest = useRef({ press: (_: string) => {}, longPress: (_: string) => {}, remove: (_: string) => {}, drop: (_s: string | null, _x?: number, _y?: number) => {} });
  const perSlot = useRef<Record<string, { press: () => void; longPress: () => void; remove: () => void }>>({});
  const handlers = (slot: string) => (perSlot.current[slot] ??= {
    press: () => latest.current.press(slot),
    longPress: () => latest.current.longPress(slot),
    remove: () => latest.current.remove(slot),
  });

  // Follows the finger on the UI thread: moves the floating key and marks the slot under it.
  const moveDrag = (x: number, y: number) => {
    'worklet';
    const o = org.value;
    const cell = size + gap;
    dx.value = x - o.rx;
    dy.value = y - o.ry;
    const c = Math.floor((x - o.gx) / cell), r = Math.floor((y - o.gy) / cell);
    hover.value = c >= 0 && c < cols && r >= 0 && r < rows ? r * cols + c : -1;
  };
  const dragProps = (k: Key, from?: string, holdMs = 300): DragProps => ({
    holdMs,
    move: moveDrag,
    onStart: () => startDrag(k, from),
    onEnd: (x, y, canceled) => {
      if (!canceled) return latest.current.drop(slotAt(x, y), x, y);
      setDrag(null);
      hover.value = -1;
    },
  });

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
    if (a.type === 'back') setStack(s => (s.length > 1 ? s.slice(0, -1) : [deck.pages[0].id]));
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

  latest.current = {
    press,
    longPress: slot => {
      const k = keys[slot];
      if (!editing) k?.hold ? fire(k, k.hold, `${page.id}/${slot}`, `${page.id}/${slot}:hold`) : setEditing(true);
    },
    remove: slot => setKey(slot, null),
    drop,
  };
  const gap = 16;
  const grid = useMemo(() => layout(keys, cols, rows), [keys, cols, rows]);
  // Portrait: the keys take about half the screen and the controls tray gets the rest (no dead bands).
  const availH = portrait ? win.height * (editing ? 0.42 : 0.5) : area.h;
  const size = Math.floor(Math.min((area.w - gap * (cols - 1)) / cols, (availH - gap * (rows - 1)) / rows));
  const dials = deck.dials ?? [];

  const floating = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }, { translateY: dy.value }, { scale: 1.08 }] }));

  const editTools = editing && (
            <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={st.topRight}>
              <Pill symbol="square.grid.3x3" label={`${cols} × ${rows}`} onPress={() => {
                // A smaller grid hides keys past its last slot (they're kept), so say so before switching.
                const options = [...GRIDS.map(g => {
                  const hidden = Object.keys(page.keys).filter(i => +i >= g.cols * g.rows).length;
                  return `${g.cols} × ${g.rows}${hidden ? ` (hides ${hidden} key${hidden > 1 ? 's' : ''})` : ''}`;
                }), 'Cancel'];
                ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: GRIDS.length, title: 'Grid size' },
                  i => i < GRIDS.length && setDeck({ ...deck, grid: GRIDS[i] }));
              }} />
              <Pill symbol={deck.autoProfile ? 'bolt.fill' : 'bolt.slash'} label={deck.autoProfile ? 'Follow apps' : 'Fixed page'}
                onPress={() => setDeck({ ...deck, autoProfile: !deck.autoProfile })} />
            </Animated.View>
  );

  const tabs = [
    ...(stack.length > 1 ? [{ id: '__back', label: 'Back', symbol: 'chevron.backward' }] : []),
    ...deck.pages.map(p => ({ id: p.id, label: p.name, symbol: p.app ? 'bolt.fill' : undefined })),
  ];

  return (
    <View style={st.root} ref={rootRef}>
      <View style={st.top}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.tabScroll} contentContainerStyle={st.tabsRow}>
          <PageTabs tabs={tabs} current={pageId}
            onPress={id => (id === '__back' ? setStack(s => s.slice(0, -1)) : (auto.current = null, setStack([id])))}
            onLongPress={id => editing && id !== '__back' && pageMenu(id)} />
          {editing && <Pill symbol="plus" label="Page" onPress={addPage} />}
        </ScrollView>
        <View style={st.topRight}>
          {!portrait && editTools}
          <Pill symbol="desktopcomputer" label={macName} dot={error ? C.danger : C.ok} onPress={onMacs} />
          <Pill label={editing ? 'Done' : 'Edit'} strong={editing} onPress={() => { setEditing(e => !e); setPicked(null); }} />
        </View>
      </View>
      {/* Portrait has no room for the edit tools in the top bar; they get their own row. */}
      {portrait && editTools && <View style={st.toolsRow}>{editTools}</View>}

      <View style={[st.main, portrait && st.mainPortrait]}>
        <View style={[st.grid, portrait && { flex: 0, height: size > 0 ? rows * size + gap * (rows - 1) : availH }, !!error && st.offline]}
          onLayout={e => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {size > 0 && (
            // Absolutely placed so widgets can span slots; a slot under a widget isn't drawn.
            <Animated.View ref={gridRef} key={`${page.id}:${cols}x${rows}`} entering={FadeIn.duration(220)}
              style={{ width: cols * size + (cols - 1) * gap, height: rows * size + (rows - 1) * gap }}>
              {Array.from({ length: cols * rows }, (_, i) => {
                const slot = String(i);
                if (grid.owner[i] != null && grid.owner[i] !== slot) return null;
                const k = grid.owner[i] === slot ? keys[slot] : undefined;
                const { w, h } = spanOf(k);
                const slotId = `${page.id}/${slot}`;
                const lifted = drag?.from === slot;
                return (
                  // Never flattened: if this view only appeared when the drag starts (opacity), the native tree
                  // would re-parent the key mid-gesture and cancel the drag.
                  <View key={slot} collapsable={false}
                    style={{ position: 'absolute', left: (i % cols) * (size + gap), top: Math.floor(i / cols) * (size + gap), opacity: lifted ? 0.25 : 1 }}>
                    <KeyTile id={slotId} k={k} size={size} width={w * size + (w - 1) * gap} height={h * size + (h - 1) * gap} api={api} state={state}
                      editing={editing && !drag} picked={false} hover={lifted ? undefined : hover} index={i} feedback={feedback[slotId]}
                      drag={editing && k && page.keys[slot] ? dragProps(page.keys[slot], slot) : undefined}
                      onPress={handlers(slot).press} onLongPress={handlers(slot).longPress} onRemove={page.keys[slot] ? handlers(slot).remove : undefined} />
                  </View>
                );
              })}
            </Animated.View>
          )}
        </View>

        {editing ? (
          <Library api={api} state={state} style={portrait ? st.libraryPortrait : undefined} drag={k => dragProps(k, undefined, 150)} />
        ) : (dials.length > 0) && (
          // Landscape: a column to the right of the keys. Portrait: a row under them.
          <View style={portrait ? st.stripRow : st.strip}>
            {(dials.includes('volume') || dials.includes('anc')) && (
              <View style={portrait ? st.dialsRow : st.dials}>
                {dials.includes('volume') && (
                  // Double-tap mutes and unmutes; turning it unmutes too, since it moves by the volume keys.
                  <View collapsable={false} style={{ opacity: state?.mac?.muted ? 0.5 : 1 }}>
                    <Dial value={Math.round((state?.mac?.volume ?? 0) / 5)} min={0} max={20} size={portrait ? 230 : 180}
                      label={state?.mac?.muted ? 'MUTED' : 'VOLUME'}
                      format={v => (v === Math.round((state?.mac?.volume ?? 0) / 5) ? String(state?.mac?.volume ?? 0) : String(v * 5))}
                      onChange={v => api.run({ type: 'volume', set: v * 5 }).catch(() => {})}
                      onDoubleTap={() => api.run({ type: 'volume', mute: 'toggle' }).catch(() => {})} />
                  </View>
                )}
                {dials.includes('anc') && state?.headphones && (
                  // Headphones off: show it dimmed and inert rather than a misleading "0".
                  <Pressable disabled={state.headphones.status === 'connected'} onPress={() => onOpenApp('hush')}
                    style={state.headphones.status !== 'connected' && st.inert}>
                    <View pointerEvents={state.headphones.status === 'connected' ? 'auto' : 'none'}>
                    <Dial value={state.headphones.anc?.level ?? 0} min={0} max={10} size={portrait ? 230 : 180}
                      label={state.headphones.status === 'connected' ? 'NOISE' : 'HEADPHONES OFF'}
                      format={state.headphones.status === 'connected' ? undefined : () => '–'}
                      onChange={v => api.run({ type: 'hush', cmd: `anc/${v}` }).catch(() => {})} />
                    </View>
                  </Pressable>
                )}
              </View>
            )}
            {dials.includes('brightness') && (
              // macOS can't report brightness, so the fader keeps its own position and nudges the Mac per step.
              <Fader label="BRIGHTNESS" height={portrait ? 200 : Math.min(420, area.h)} format={() => ''}
                onStep={d => {
                  const action = { type: 'media' as const, key: d > 0 ? 'brightness-up' as const : 'brightness-down' as const };
                  api.run(Math.abs(d) === 1 ? action : { type: 'multi', steps: Array(Math.abs(d)).fill(action), delayMs: 0 }).catch(() => {});
                }} />
            )}
          </View>
        )}
      </View>

      {error && !editing && !flash ? (
        <Pressable onPress={refresh} style={({ pressed }) => [st.retry, pressed && { opacity: 0.6 }]}>
          <Symbol name="arrow.clockwise" size={13} weight="semibold" color={C.danger} />
          <Text style={st.retryText}>Can't reach {macName} · Retry</Text>
        </Pressable>
      ) : editSlot == null && (
      <Text style={[st.status, flash && st.err]} numberOfLines={1}>
        {flash ?? (editing
          ? drag ? (drag.from != null ? 'Drop on a slot to move it (a key there swaps places), or on the library to remove it.' : 'Drop it on any slot.') : 'Tap a key to change it  ·  hold and drag to move it  ·  hold a page for options'
          : !state ? `Connecting to ${macName}…` : state.mac?.app ? `${state.mac.app} is in front` : '')}
      </Text>
      )}

      {drag && (() => {
        const { w, h } = spanOf(drag.k);
        const W = w * size + (w - 1) * gap, H = h * size + (h - 1) * gap;
        // Held by its top-left slot, the one it drops into.
        return (
          <Animated.View pointerEvents="none" style={[st.floating, { width: W, height: H, marginLeft: -size / 2, marginTop: -size / 2 }, floating]}>
            <KeyTile id="drag" k={drag.k} size={size} width={W} height={H} api={api} state={state} editing={false} picked onPress={() => {}} onLongPress={() => {}} />
          </Animated.View>
        );
      })()}

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
  tab: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: 18, borderRadius: 16 },
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
  dialsRow: { flexDirection: 'row', alignItems: 'center', gap: 28 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 28 },
  stripRow: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40, marginTop: 24, paddingVertical: 24,
    borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
  },
  offline: { opacity: 0.45 },
  retry: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: 'rgba(232,160,160,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: C.danger },
  retryText: { color: C.danger, fontSize: 14, fontWeight: '600' },
  mainPortrait: { flexDirection: 'column' },
  toolsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: -10, marginBottom: 12 },
  libraryPortrait: { width: '100%', flex: 1, marginTop: 16 },
  inert: { opacity: 0.5 },
  floating: { position: 'absolute', left: 0, top: 0, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 16 } },
  status: { color: C.dim, fontSize: 13, textAlign: 'center', marginTop: 12, minHeight: 18, letterSpacing: 0.2 },
});
