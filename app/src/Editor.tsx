import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import type { Client } from './api';
import { Backdrop } from './Backdrop';
import { KeyTile, type Feedback } from './KeyTile';
import { ICONS, Symbol, defaultSymbol } from './Symbol';
import type { State, Action, ActionType, Key, Live, Mod, Page } from './types';
import { C, SPRING } from './theme';
import { spanOf } from './grid';
import { WIDGET_LIVE } from './Widget';
import { Advanced, Heading, IconTile, Input, Keycap, MODS, NAMED_KEYS, Options, Segmented, Suggest, Swatches, capFor, st as p } from './EditorParts';

type TypeDef = { type: ActionType; label: string; symbol: string; make: (pages: Page[]) => Action };
const GROUPS: { title: string; nested: boolean; types: TypeDef[] }[] = [
  {
    title: 'Mac',
    nested: true,
    types: [
      { type: 'open', label: 'Open', symbol: 'arrow.up.forward.app', make: () => ({ type: 'open', target: '' }) },
      { type: 'hotkey', label: 'Key combo', symbol: 'command', make: () => ({ type: 'hotkey', key: '', mods: ['cmd'] }) },
      { type: 'text', label: 'Type text', symbol: 'text.cursor', make: () => ({ type: 'text', text: '' }) },
      { type: 'media', label: 'Media', symbol: 'playpause.fill', make: () => ({ type: 'media', key: 'play' }) },
      { type: 'volume', label: 'Volume', symbol: 'speaker.wave.2.fill', make: () => ({ type: 'volume', change: 6 }) },
      { type: 'mic', label: 'Microphone', symbol: 'mic.fill', make: () => ({ type: 'mic' }) },
      { type: 'shortcut', label: 'Shortcut', symbol: 'square.stack.3d.up.fill', make: () => ({ type: 'shortcut', name: '' }) },
      { type: 'script', label: 'Run command', symbol: 'apple.terminal', make: () => ({ type: 'script', command: '' }) },
      { type: 'system', label: 'System', symbol: 'lock.fill', make: () => ({ type: 'system', what: 'lock' }) },
    ],
  },
  {
    title: 'Hush',
    nested: true,
    types: [
      { type: 'hush', label: 'Headphones', symbol: 'headphones', make: () => ({ type: 'hush', cmd: 'anc/10' }) },
      { type: 'app', label: 'Hush panel', symbol: 'slider.horizontal.3', make: () => ({ type: 'app', app: 'hush' }) },
    ],
  },
  {
    title: 'Deck',
    nested: false,
    types: [
      { type: 'page', label: 'Go to page', symbol: 'square.grid.2x2', make: pages => ({ type: 'page', page: pages[0]?.id ?? '' }) },
      { type: 'back', label: 'Back', symbol: 'chevron.backward', make: () => ({ type: 'back' }) },
      { type: 'multi', label: 'Several steps', symbol: 'list.bullet.rectangle', make: () => ({ type: 'multi', steps: [], delayMs: 100 }) },
      { type: 'toggle', label: 'On / off', symbol: 'switch.2', make: () => ({ type: 'toggle', on: { type: 'hush', cmd: 'anc/10' }, off: { type: 'hush', cmd: 'anc/0' } }) },
    ],
  },
];

const HUSH_PRESETS: { value: string; label: string; symbol: string }[] = [
  { value: 'anc/10', label: 'Noise cancelling: max', symbol: 'circle.fill' },
  { value: 'anc/5', label: 'Noise cancelling: half', symbol: 'circle.lefthalf.filled' },
  { value: 'anc/0', label: 'Noise cancelling: off', symbol: 'circle' },
  { value: 'anc/cycle', label: 'Cycle noise cancelling', symbol: 'arrow.triangle.2.circlepath' },
  { value: 'anc/up', label: 'More noise cancelling', symbol: 'plus.circle' },
  { value: 'anc/down', label: 'Less noise cancelling', symbol: 'minus.circle' },
  { value: 'conversation/on', label: 'Conversation mode on', symbol: 'person.wave.2.fill' },
  { value: 'conversation/off', label: 'Conversation mode off', symbol: 'person.fill.xmark' },
  { value: 'selfvoice/low', label: 'Hear my voice: low', symbol: 'waveform' },
  { value: 'selfvoice/off', label: 'Hear my voice: off', symbol: 'waveform.slash' },
  { value: 'eq/flat', label: 'Reset sound to flat', symbol: 'slider.horizontal.3' },
  { value: 'switch/iPhone', label: 'Switch to iPhone', symbol: 'iphone' },
  { value: 'switch/Mac', label: 'Switch to Mac', symbol: 'laptopcomputer' },
];

const LIVES: { value: Live | undefined; label: string }[] = [
  { value: undefined, label: 'None' },
  { value: 'mic', label: 'Mic' },
  { value: 'volume', label: 'Volume' },
  { value: 'battery', label: 'Headphone battery' },
  { value: 'anc', label: 'Noise cancelling' },
  { value: 'toggle', label: 'Toggle state' },
  { value: 'nowplaying', label: 'Now playing' },
  { value: 'clock', label: 'Clock' },
  { value: 'cpu', label: 'CPU' },
  { value: 'memory', label: 'Memory' },
  { value: 'macbattery', label: 'Mac battery' },
  { value: 'system', label: 'CPU, memory, battery' },
  { value: 'weather', label: 'Weather' },
];

// Widget sizes, in slots: wide and big faces for the live kinds that have them.
const SIZES = [
  { value: '1x1', label: '1 × 1' },
  { value: '2x1', label: '2 × 1' },
  { value: '3x1', label: '3 × 1' },
  { value: '2x2', label: '2 × 2' },
  { value: '3x2', label: '3 × 2' },
];

// The curated picker list lives with the icon set; grouped here in its own order.
const ICON_GROUPS = [...new Set(ICONS.map(i => i.group))].map(g => ({ group: g, icons: ICONS.filter(i => i.group === g) }));

// Loaded once per session from the Mac, for the app and shortcut suggestions.
const lists: Record<string, Promise<string[]> | undefined> = {};
function useList(name: 'apps' | 'shortcuts', api: Client) {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    lists[name] ??= api[name]().catch(() => []);
    lists[name]!.then(setItems);
  }, [name, api]);
  return items;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={st.group}>
      <Heading>{title}</Heading>
      {children}
    </View>
  );
}

// Apps people swap between; only the installed ones are offered, and only when there's a choice.
const APP_KINDS: Record<string, string[]> = {
  Browsers: ['Safari', 'Google Chrome', 'Arc', 'Firefox', 'Brave Browser', 'Microsoft Edge', 'Opera', 'Vivaldi', 'Orion', 'Zen', 'Dia', 'Chromium', 'Comet'],
  Terminals: ['Terminal', 'iTerm', 'cmux', 'Ghostty', 'Warp', 'WezTerm', 'Alacritty', 'kitty', 'Hyper'],
};

/** Configures one action: a type picker, then the fields for that type. Nested inside steps and toggles. */
export function ActionForm({ action, onChange, api, pages, nested }: {
  action: Action;
  onChange: (a: Action) => void;
  api: Client;
  pages: Page[];
  nested?: boolean;
}) {
  const apps = useList('apps', api);
  const shortcuts = useList('shortcuts', api);
  const a = action as any;
  const set = (patch: object) => onChange({ ...a, ...patch });

  return (
    <View style={st.form}>
      {GROUPS.filter(g => !nested || g.nested).map(g => (
        <View key={g.title} style={st.typeGroup}>
          <Text style={st.typeGroupTitle}>{g.title}</Text>
          <View style={st.grid}>
            {g.types.filter(t => !nested || t.type !== 'app').map(t => (
              <IconTile key={t.type} symbol={t.symbol} label={t.label} compact={nested} on={action.type === t.type}
                onPress={() => action.type !== t.type && onChange(t.make(pages))} />
            ))}
          </View>
        </View>
      ))}

      {action.type === 'open' && (
        <Group title="App, file or website">
          <Input value={action.target} onChangeText={target => set({ target })} placeholder="Safari, ~/Notes.md, https://…" />
          <Suggest list={apps} query={action.target} onPick={target => set({ target })} />
          {Object.entries(APP_KINDS).map(([kind, names]) => {
            const installed = names.filter(n => apps.includes(n));
            return installed.length > 1 && (
              <View key={kind} style={st.kind}>
                <Text style={st.kindTitle}>{kind}</Text>
                <View style={st.kindRow}>
                  {installed.map(n => (
                    <Pressable key={n} onPress={() => set({ target: n })} accessibilityLabel={`Open ${n}`}
                      style={({ pressed }) => [st.kindApp, action.target === n && st.kindOn, pressed && { opacity: 0.6 }]}>
                      <Image source={api.icon(n)} style={st.appIcon} />
                      <Text style={st.kindName} numberOfLines={1}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
        </Group>
      )}
      {action.type === 'hotkey' && <HotkeyForm keyName={action.key} mods={action.mods} set={set} />}
      {action.type === 'text' && (
        <Group title="Text to type">
          <Input value={action.text} onChangeText={text => set({ text })} multiline placeholder="Pasted on the Mac, so any language and emoji work." />
        </Group>
      )}
      {action.type === 'media' && (
        <Group title="Media key">
          <Options value={action.key} onChange={key => set({ key })} items={[
            { value: 'previous', label: 'Previous', symbol: 'backward.fill' },
            { value: 'play', label: 'Play / pause', symbol: 'playpause.fill' },
            { value: 'next', label: 'Next', symbol: 'forward.fill' },
            { value: 'brightness-down', label: 'Dimmer', symbol: 'sun.min.fill' },
            { value: 'brightness-up', label: 'Brighter', symbol: 'sun.max.fill' },
          ]} />
        </Group>
      )}
      {action.type === 'volume' && (
        <Group title="Volume">
          <Options value={action.mute === 'toggle' ? 'mute' : action.change === -6 ? 'down' : action.change === 6 ? 'up' : undefined}
            onChange={v => onChange(v === 'mute' ? { type: 'volume', mute: 'toggle' } : { type: 'volume', change: v === 'down' ? -6 : 6 })}
            items={[
              { value: 'down', label: 'Turn down', symbol: 'speaker.wave.1.fill' },
              { value: 'up', label: 'Turn up', symbol: 'speaker.wave.3.fill' },
              { value: 'mute', label: 'Mute / unmute', symbol: 'speaker.slash.fill' },
            ]} />
        </Group>
      )}
      {action.type === 'mic' && <Text style={st.note}>Mutes the Mac's microphone, or turns it back on.</Text>}
      {action.type === 'shortcut' && (
        <Group title="Shortcut from the Shortcuts app">
          <Input value={action.name} onChangeText={name => set({ name })} placeholder="Shortcut name" />
          <Suggest list={shortcuts} query={action.name} onPick={name => set({ name })} />
        </Group>
      )}
      {action.type === 'script' && (
        <Group title="Terminal command">
          <Input value={action.command} onChangeText={command => set({ command })} multiline style={st.mono} placeholder="open -a Music && say hello" />
          <Text style={st.note}>Runs in zsh as you, on the Mac.</Text>
        </Group>
      )}
      {action.type === 'system' && (
        <Group title="System">
          <Options value={action.what} onChange={what => set({ what })} items={[
            { value: 'lock', label: 'Lock screen', symbol: 'lock.fill' },
            { value: 'sleep-display', label: 'Turn off display', symbol: 'moon.fill' },
            { value: 'screensaver', label: 'Screen saver', symbol: 'sparkles.tv' },
          ]} />
        </Group>
      )}
      {action.type === 'hush' && (
        <Group title="Headphones">
          <Options value={action.cmd} onChange={cmd => set({ cmd })} items={HUSH_PRESETS} />
          <Advanced initiallyOpen={!HUSH_PRESETS.some(h => h.value === action.cmd)}>
            <Input value={action.cmd} onChangeText={cmd => set({ cmd })} placeholder="anc/7, eq/bass/-3, switch/iPad" style={st.mono} />
          </Advanced>
        </Group>
      )}
      {action.type === 'app' && <Text style={st.note}>Opens the Hush headphone controls on this iPad.</Text>}
      {action.type === 'page' && (
        <Group title="Page">
          <Options value={action.page} onChange={page => set({ page })} items={pages.map(pg => ({ value: pg.id, label: pg.name, symbol: 'square.grid.2x2' }))} />
        </Group>
      )}
      {action.type === 'back' && <Text style={st.note}>Returns to the page you came from.</Text>}
      {action.type === 'multi' && (
        <Group title="Steps, in order">
          <View style={st.steps}>
            {action.steps.map((step, i) => (
              <View key={i} style={st.card}>
                <View style={st.cardHead}>
                  <Text style={st.cardTitle}>Step {i + 1}</Text>
                  <Pressable onPress={() => set({ steps: action.steps.filter((_, j) => j !== i) })} hitSlop={10} accessibilityLabel={`Remove step ${i + 1}`}>
                    <Symbol name="minus.circle.fill" size={20} color={C.danger} />
                  </Pressable>
                </View>
                <ActionForm action={step} api={api} pages={pages} nested
                  onChange={n => set({ steps: action.steps.map((x, j) => (j === i ? n : x)) })} />
              </View>
            ))}
            <View style={st.stepFoot}>
              <Pressable onPress={() => set({ steps: [...action.steps, { type: 'open', target: '' }] })}
                style={({ pressed }) => [st.ghost, pressed && p.pressed]}>
                <Symbol name="plus" size={14} weight="semibold" color={C.text} />
                <Text style={st.ghostText}>Add step</Text>
              </Pressable>
              <Text style={st.note}>Wait</Text>
              <Input value={String(action.delayMs ?? 100)} onChangeText={t => set({ delayMs: Number(t.replace(/\D/g, '')) || 0 })}
                keyboardType="number-pad" style={st.delay} />
              <Text style={st.note}>ms between steps</Text>
            </View>
          </View>
        </Group>
      )}
      {action.type === 'toggle' && (
        <>
          <Group title="First press">
            <View style={st.card}><ActionForm action={action.on} api={api} pages={pages} nested onChange={on => set({ on })} /></View>
          </Group>
          <Group title="Second press">
            <View style={st.card}><ActionForm action={action.off} api={api} pages={pages} nested onChange={off => set({ off })} /></View>
          </Group>
        </>
      )}
    </View>
  );
}

function HotkeyForm({ keyName, mods, set }: { keyName: string; mods: Mod[]; set: (p: object) => void }) {
  const held = MODS.filter(m => mods.includes(m.mod));
  return (
    <Group title="Key combo">
      <View style={st.combo}>
        {held.map(m => <Keycap key={m.mod} cap={m.glyph} on big />)}
        {held.length > 0 && <Text style={st.plus}>+</Text>}
        <Keycap cap={keyName ? capFor(keyName) : '?'} on={!!keyName} big />
      </View>
      <View style={st.capRow}>
        {MODS.map(m => (
          <Keycap key={m.mod} cap={m.glyph} label={m.name} on={mods.includes(m.mod)}
            onPress={() => set({ mods: mods.includes(m.mod) ? mods.filter(x => x !== m.mod) : [...mods, m.mod] })} />
        ))}
        <Input value={NAMED_KEYS.some(n => n.key === keyName) ? '' : keyName} onChangeText={key => set({ key: key.slice(-1) })}
          placeholder="Type a key" style={st.keyInput} />
      </View>
      <View style={st.capRow}>
        {NAMED_KEYS.map(n => <Keycap key={n.key} cap={n.cap} label={n.name} on={keyName === n.key} onPress={() => set({ key: n.key })} />)}
      </View>
    </Group>
  );
}

function IconCell({ on, onPress, label, wide, children }: { on: boolean; onPress: () => void; label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}
      style={({ pressed }) => [st.cell, wide && st.cellWide, on && p.tileOn, pressed && p.pressed]}>
      {children}
    </Pressable>
  );
}

/** Edits one key in a two-pane sheet: a live preview on the left, everything it does on the right. */
function usePortrait() {
  const w = useWindowDimensions();
  return w.height > w.width;
}

export function KeyEditor({ initial, api, pages, state = null, onSave, onClear, onCancel }: {
  initial: Key | null;
  /** Live Mac/headphone state, so the preview shows real readings. */
  state?: State | null;
  api: Client;
  pages: Page[];
  onSave: (k: Key) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const portrait = usePortrait();
  const [k, setK] = useState<Key>(initial ?? { title: '', action: { type: 'open', target: '' } });
  const [feedback, setFeedback] = useState<Feedback>();
  const [result, setResult] = useState<string | null>(null);
  const set = (patch: Partial<Key>) => setK(x => ({ ...x, ...patch }));
  const apps = useList('apps', api);
  const { width, height } = useWindowDimensions();

  // Slides up on a spring; slides down before handing control back.
  const shown = useSharedValue(0);
  useEffect(() => { shown.value = withSpring(1, SPRING); }, [shown]);
  const close = (then: () => void) => {
    shown.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) });
    setTimeout(then, 220);
  };
  const scrim = useAnimatedStyle(() => ({ opacity: shown.value }));
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - shown.value) * height }] }));

  const setAction = (action: Action) => {
    const patch: Partial<Key> = { action };
    // Sensible defaults so a new key looks right without extra taps.
    if (action.type === 'open' && apps.includes(action.target) && (!k.title || k.title === (k.action as any).target)) {
      patch.title = action.target;
      patch.icon = { app: action.target };
    }
    if (action.type === 'mic') patch.live = 'mic';
    if (action.type === 'toggle') patch.live = 'toggle';
    if (action.type === 'app') patch.live = 'battery';
    setK(x => ({ ...x, ...patch }));
  };

  const test = () => {
    setResult(null);
    api.run(k.action).then(
      () => { setFeedback(f => ({ n: (f?.n ?? 0) + 1, ok: true })); setResult('Ran on the Mac'); },
      e => { setFeedback(f => ({ n: (f?.n ?? 0) + 1, ok: false })); setResult(e.message); },
    );
  };

  const target = k.action.type === 'open' ? k.action.target : '';
  const knownApp = !!target && apps.includes(target);
  // Widgets shrink their slots so the preview keeps the pane's size.
  const previewUnit = (portrait ? 150 : 200) / Math.max(1, spanOf(k).w * 0.75, spanOf(k).h);
  const kind = k.icon?.app ? 'app' : k.icon?.symbol ? 'symbol' : k.icon?.emoji ? 'emoji' : 'auto';
  const sheetW = Math.min(1180, width - 48);
  const sheetH = height - 48;

  return (
    <Modal visible transparent animationType="none" supportedOrientations={['landscape', 'portrait']} onRequestClose={() => close(onCancel)}>
      <Animated.View style={[StyleSheet.absoluteFill, st.scrim, scrim]} />
      <View style={st.center} pointerEvents="box-none">
        <Animated.View style={[st.sheet, { width: sheetW, height: sheetH }, sheet]}>
          <View style={st.header}>
            <Pressable onPress={() => close(onCancel)} hitSlop={12}><Text style={st.link}>Cancel</Text></Pressable>
            <Text style={st.headerTitle}>{initial ? 'Edit key' : 'New key'}</Text>
            <Pressable onPress={() => close(() => onSave(k))} hitSlop={12} style={({ pressed }) => [st.save, pressed && p.pressed]}>
              <Text style={st.saveText}>Save</Text>
            </Pressable>
          </View>

          <View style={[st.panes, portrait && st.panesPortrait]}>
            <View style={portrait ? st.leftPortrait : st.left}>
              <Backdrop calm={0.7} />
              <View style={portrait ? st.previewPortrait : st.preview}>
                <KeyTile k={k} id="editor/0" size={previewUnit} width={spanOf(k).w * previewUnit + (spanOf(k).w - 1) * 8} height={spanOf(k).h * previewUnit + (spanOf(k).h - 1) * 8}
                  api={api} state={state} editing={false} picked={false} feedback={feedback}
                  onPress={test} onLongPress={() => {}} />
              </View>
              <View style={portrait ? st.infoPortrait : st.info}>
              <Input value={k.title ?? ''} onChangeText={title => set({ title })} placeholder="Key name" autoCapitalize="words" style={st.title} />
              <View style={st.leftActions}>
                <Pressable onPress={test} style={({ pressed }) => [st.try, pressed && p.pressed]}>
                  <Symbol name="play.fill" size={14} color={C.text} />
                  <Text style={st.tryText}>Try it on the Mac</Text>
                </Pressable>
                <Text style={[st.result, feedback?.ok === false && st.resultBad]} numberOfLines={2}>{result ?? ' '}</Text>
              </View>
              <View style={st.flex} />
              {initial && (
                <Pressable onPress={() => close(onClear)} style={({ pressed }) => [st.clear, pressed && p.pressed]}>
                  <Symbol name="trash" size={14} color={C.danger} />
                  <Text style={st.clearText}>Clear this key</Text>
                </Pressable>
              )}
              </View>
            </View>

            <ScrollView style={st.flex} contentContainerStyle={st.right} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <Group title="What it does">
                <ActionForm action={k.action} onChange={setAction} api={api} pages={pages} />
              </Group>

              <Group title="When held">
                <Options items={[{ value: 'none', label: 'Nothing extra', symbol: 'circle-slash' }, { value: 'set', label: 'Do something else', symbol: 'hand' }]}
                  value={k.hold ? 'set' : 'none'}
                  onChange={v => set({ hold: v === 'set' ? (k.hold ?? { type: 'media', key: 'next' }) : undefined })} />
                {k.hold && <ActionForm action={k.hold} onChange={hold => set({ hold })} api={api} pages={pages} nested />}
                {k.hold && <Text style={st.note}>Hold the key for half a second to run this instead.</Text>}
              </Group>

              <View style={st.divider} />

              <Group title="Icon">
                <View style={st.icons}>
                  <IconCell wide label="Automatic" on={kind === 'auto'} onPress={() => set({ icon: undefined })}>
                    <Symbol name={defaultSymbol(k.action)} size={18} color={kind === 'auto' ? C.bg : C.text} />
                    <Text style={[st.cellLabel, kind === 'auto' && p.tileLabelOn]}>Auto</Text>
                  </IconCell>
                  {knownApp && (
                    <IconCell wide label="App icon" on={kind === 'app'} onPress={() => set({ icon: { app: target } })}>
                      <Image source={api.icon(target)} style={st.appIcon} />
                      <Text style={[st.cellLabel, kind === 'app' && p.tileLabelOn]}>App</Text>
                    </IconCell>
                  )}
                  <IconCell wide label="Emoji" on={kind === 'emoji'} onPress={() => set({ icon: { emoji: k.icon?.emoji || '⭐️' } })}>
                    <Text style={st.emojiCell}>{k.icon?.emoji || '😀'}</Text>
                    <Text style={[st.cellLabel, kind === 'emoji' && p.tileLabelOn]}>Emoji</Text>
                  </IconCell>
                </View>
                {kind === 'emoji' && (
                  <Input value={k.icon?.emoji ?? ''} onChangeText={emoji => set({ icon: { emoji } })} placeholder="Type or pick an emoji"
                    style={st.emojiInput} />
                )}
                {ICON_GROUPS.map(g => (
                  <View key={g.group} style={st.iconGroup}>
                    <Text style={st.typeGroupTitle}>{g.group}</Text>
                    <View style={st.icons}>
                      {g.icons.map(i => (
                        <IconCell key={i.id} label={i.label} on={k.icon?.symbol === i.id} onPress={() => set({ icon: { symbol: i.id } })}>
                          <Symbol name={i.id} size={20} color={k.icon?.symbol === i.id ? C.bg : C.text} />
                        </IconCell>
                      ))}
                    </View>
                  </View>
                ))}
              </Group>

              <Group title="Colour">
                <Swatches value={k.color} onChange={color => set({ color })} />
              </Group>

              <Group title="Live status">
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <Segmented items={LIVES} value={k.live} onChange={live => set({ live })} />
                </ScrollView>
                <Text style={st.note}>Shows a live reading on the key.</Text>
              </Group>

              {(WIDGET_LIVE as readonly string[]).includes(k.live ?? '') && (
                <Group title="Size">
                  <Segmented items={SIZES} value={`${spanOf(k).w}x${spanOf(k).h}`} onChange={v => {
                    const [w, h] = v.split('x').map(Number);
                    set({ span: w === 1 && h === 1 ? undefined : { w, h } });
                  }} />
                  <Text style={st.note}>Bigger keys become widgets. They need free slots to the right and below.</Text>
                </Group>
              )}
              {k.live === 'weather' && (
                <Group title="City">
                  <Input value={k.place ?? ''} onChangeText={place => set({ place: place || undefined })} placeholder="Your Mac's time-zone city" autoCapitalize="words" />
                </Group>
              )}
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.78)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sheet: {
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#0e0f12',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '600' },
  link: { color: C.silver, fontSize: 17 },
  save: { backgroundColor: C.silver, paddingVertical: 7, paddingHorizontal: 18, borderRadius: 999 },
  saveText: { color: C.bg, fontSize: 16, fontWeight: '600' },
  panes: { flex: 1, flexDirection: 'row' },
  panesPortrait: { flexDirection: 'column' },
  // Portrait: the preview becomes a compact row above the settings.
  leftPortrait: {
    flexDirection: 'row', alignItems: 'center', gap: 28, paddingVertical: 20, paddingHorizontal: 32, overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
  },
  previewPortrait: { width: 150, height: 150 },
  info: { flex: 1, alignSelf: 'stretch', alignItems: 'center' },
  infoPortrait: { flex: 1, alignItems: 'center' },

  left: {
    width: 360,
    alignItems: 'center',
    paddingTop: 44,
    paddingBottom: 24,
    paddingHorizontal: 32,
    overflow: 'hidden',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  preview: { width: 200, height: 200, marginBottom: 28 },
  title: { alignSelf: 'stretch', textAlign: 'left', paddingHorizontal: 16, fontSize: 20, fontWeight: '500', backgroundColor: 'rgba(0,0,0,0.35)' },
  leftActions: { alignItems: 'center', gap: 10, marginTop: 18 },
  try: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999 },
  tryText: { color: C.text, fontSize: 15, fontWeight: '600' },
  result: { color: C.dim, fontSize: 13, textAlign: 'center' },
  resultBad: { color: C.danger },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 8, paddingHorizontal: 14 },
  clearText: { color: C.danger, fontSize: 15 },

  right: { padding: 32, gap: 32, paddingBottom: 80 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.hairline },
  group: { gap: 0 },
  form: { gap: 22 },
  typeGroup: { gap: 10 },
  typeGroupTitle: { color: C.dim, fontSize: 13, fontWeight: '500' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  note: { color: C.dim, fontSize: 14, marginTop: 10 },
  mono: { fontFamily: 'Menlo', fontSize: 14 },

  combo: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  plus: { color: C.dim, fontSize: 24, fontWeight: '200' },
  capRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 },
  keyInput: { width: 130, height: 46, paddingVertical: 0 },

  steps: { gap: 12 },
  card: { padding: 16, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, gap: 12 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: '600' },
  stepFoot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, marginRight: 12 },
  ghostText: { color: C.text, fontSize: 15, fontWeight: '500' },
  delay: { width: 76, textAlign: 'center', paddingVertical: 8, marginTop: 0 },

  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconGroup: { gap: 8, marginTop: 16 },
  cell: {
    width: 54,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  cellWide: { width: 76, height: 68, gap: 4 },
  cellLabel: { color: C.dim, fontSize: 11, fontWeight: '600' },
  appIcon: { width: 28, height: 28 },
  kind: { marginTop: 14, gap: 8 },
  kindTitle: { color: C.label, fontSize: 11, letterSpacing: 1.4, fontWeight: '600', textTransform: 'uppercase' },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindApp: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingLeft: 6, paddingRight: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline },
  kindOn: { borderColor: C.silver, backgroundColor: 'rgba(255,255,255,0.12)' },
  kindName: { color: C.text, fontSize: 14, maxWidth: 140 },
  emojiCell: { fontSize: 20 },
  emojiInput: { marginTop: 12, width: 260, fontSize: 22 },
});
