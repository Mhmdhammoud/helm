import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Client } from './api';
import type { Action, ActionType, Key, Live, Mod, Page } from './types';
import { C, KEY_COLORS } from './theme';
import { Chip, s } from './ui';

const TYPES: { type: ActionType; label: string; make: (pages: Page[]) => Action; nested?: boolean }[] = [
  { type: 'open', label: 'Open app / URL', make: () => ({ type: 'open', target: '' }), nested: true },
  { type: 'hotkey', label: 'Hotkey', make: () => ({ type: 'hotkey', key: '', mods: ['cmd'] }), nested: true },
  { type: 'text', label: 'Type text', make: () => ({ type: 'text', text: '' }), nested: true },
  { type: 'media', label: 'Media', make: () => ({ type: 'media', key: 'play' }), nested: true },
  { type: 'volume', label: 'Volume', make: () => ({ type: 'volume', change: 6 }), nested: true },
  { type: 'mic', label: 'Mic mute', make: () => ({ type: 'mic' }), nested: true },
  { type: 'shortcut', label: 'Shortcut', make: () => ({ type: 'shortcut', name: '' }), nested: true },
  { type: 'script', label: 'Script', make: () => ({ type: 'script', command: '' }), nested: true },
  { type: 'system', label: 'System', make: () => ({ type: 'system', what: 'lock' }), nested: true },
  { type: 'hush', label: 'Hush', make: () => ({ type: 'hush', cmd: 'anc/10' }), nested: true },
  { type: 'app', label: 'Hush panel', make: () => ({ type: 'app', app: 'hush' }) },
  { type: 'page', label: 'Go to page', make: pages => ({ type: 'page', page: pages[0]?.id ?? '' }) },
  { type: 'back', label: 'Back', make: () => ({ type: 'back' }) },
  { type: 'multi', label: 'Multi action', make: () => ({ type: 'multi', steps: [], delayMs: 100 }) },
  { type: 'toggle', label: 'Toggle', make: () => ({ type: 'toggle', on: { type: 'hush', cmd: 'anc/10' }, off: { type: 'hush', cmd: 'anc/0' } }) },
];
const MODS: { mod: Mod; label: string }[] = [{ mod: 'cmd', label: '⌘' }, { mod: 'shift', label: '⇧' }, { mod: 'opt', label: '⌥' }, { mod: 'ctrl', label: '⌃' }];
const NAMED_KEYS = ['return', 'escape', 'tab', 'space', 'delete', 'left', 'right', 'up', 'down', 'f1', 'f5', 'f12'];
const HUSH_PRESETS = ['anc/0', 'anc/5', 'anc/10', 'anc/cycle', 'conversation/on', 'conversation/off', 'selfvoice/low', 'eq/flat', 'switch/iPhone', 'switch/Mac'];
const LIVES: (Live | null)[] = [null, 'mic', 'volume', 'battery', 'anc', 'toggle'];

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

function Suggest({ list, query, onPick }: { list: string[]; query: string; onPick: (v: string) => void }) {
  const q = query.toLowerCase();
  const hits = list.filter(x => x.toLowerCase().includes(q) && x !== query).slice(0, 10);
  if (!hits.length) return null;
  return <View style={s.wrap}>{hits.map(h => <Chip key={h} label={h} onPress={() => onPick(h)} />)}</View>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={st.field}>
      <Text style={st.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const Input = (p: React.ComponentProps<typeof TextInput>) => (
  <TextInput placeholderTextColor={C.dim} autoCapitalize="none" autoCorrect={false} {...p} style={[s.input, p.multiline && st.multi, p.style]} />
);

export function ActionForm({ action, onChange, api, pages, nested }: {
  action: Action;
  onChange: (a: Action) => void;
  api: Client;
  pages: Page[];
  nested?: boolean;
}) {
  const apps = useList('apps', api);
  const shortcuts = useList('shortcuts', api);
  const types = nested ? TYPES.filter(t => t.nested) : TYPES;
  const a = action as any;
  const set = (patch: object) => onChange({ ...a, ...patch });

  return (
    <View style={st.form}>
      <View style={s.wrap}>
        {types.map(t => <Chip key={t.type} label={t.label} on={action.type === t.type} onPress={() => action.type !== t.type && onChange(t.make(pages))} />)}
      </View>

      {action.type === 'open' && (
        <Field label="App name, file path or URL">
          <Input value={action.target} onChangeText={target => set({ target })} placeholder="Safari, ~/Notes.md, https://…" />
          <Suggest list={apps} query={action.target} onPick={target => set({ target })} />
        </Field>
      )}
      {action.type === 'hotkey' && (
        <Field label="Keys">
          <View style={s.wrap}>
            {MODS.map(m => (
              <Chip key={m.mod} label={m.label} on={action.mods.includes(m.mod)}
                onPress={() => set({ mods: action.mods.includes(m.mod) ? action.mods.filter(x => x !== m.mod) : [...action.mods, m.mod] })} />
            ))}
            <Input value={action.key} onChangeText={key => set({ key })} placeholder="key (a, 4, return…)" style={st.keyInput} />
          </View>
          <View style={s.wrap}>{NAMED_KEYS.map(k => <Chip key={k} label={k} on={action.key === k} onPress={() => set({ key: k })} />)}</View>
        </Field>
      )}
      {action.type === 'text' && (
        <Field label="Text to type (pasted, so any language works)">
          <Input value={action.text} onChangeText={text => set({ text })} multiline />
        </Field>
      )}
      {action.type === 'media' && (
        <View style={s.wrap}>
          {(['previous', 'play', 'next'] as const).map(k => <Chip key={k} label={k === 'play' ? 'play / pause' : k} on={action.key === k} onPress={() => set({ key: k })} />)}
        </View>
      )}
      {action.type === 'volume' && (
        <View style={s.wrap}>
          <Chip label="Down" on={action.change === -6} onPress={() => onChange({ type: 'volume', change: -6 })} />
          <Chip label="Up" on={action.change === 6} onPress={() => onChange({ type: 'volume', change: 6 })} />
          <Chip label="Mute" on={action.mute === 'toggle'} onPress={() => onChange({ type: 'volume', mute: 'toggle' })} />
        </View>
      )}
      {action.type === 'shortcut' && (
        <Field label="Shortcut (from the Shortcuts app on the Mac)">
          <Input value={action.name} onChangeText={name => set({ name })} />
          <Suggest list={shortcuts} query={action.name} onPick={name => set({ name })} />
        </Field>
      )}
      {action.type === 'script' && (
        <Field label="Shell command (zsh, runs as you on the Mac)">
          <Input value={action.command} onChangeText={command => set({ command })} multiline style={st.mono} />
        </Field>
      )}
      {action.type === 'system' && (
        <View style={s.wrap}>
          {(['lock', 'sleep-display', 'screensaver'] as const).map(w => <Chip key={w} label={w.replace('-', ' ')} on={action.what === w} onPress={() => set({ what: w })} />)}
        </View>
      )}
      {action.type === 'hush' && (
        <Field label="Hush command">
          <Input value={action.cmd} onChangeText={cmd => set({ cmd })} placeholder="anc/10" />
          <View style={s.wrap}>{HUSH_PRESETS.map(p => <Chip key={p} label={p} on={action.cmd === p} onPress={() => set({ cmd: p })} />)}</View>
        </Field>
      )}
      {action.type === 'page' && (
        <View style={s.wrap}>{pages.map(p => <Chip key={p.id} label={p.name} on={action.page === p.id} onPress={() => set({ page: p.id })} />)}</View>
      )}
      {action.type === 'multi' && (
        <Field label="Steps, run in order">
          {action.steps.map((step, i) => (
            <View key={i} style={st.step}>
              <View style={st.stepHead}>
                <Text style={st.fieldLabel}>STEP {i + 1}</Text>
                <Pressable onPress={() => set({ steps: action.steps.filter((_, j) => j !== i) })} hitSlop={10}>
                  <Text style={st.remove}>Remove</Text>
                </Pressable>
              </View>
              <ActionForm action={step} api={api} pages={pages} nested
                onChange={n => set({ steps: action.steps.map((x, j) => (j === i ? n : x)) })} />
            </View>
          ))}
          <View style={s.wrap}>
            <Chip label="+ Add step" onPress={() => set({ steps: [...action.steps, { type: 'open', target: '' }] })} />
            <Input value={String(action.delayMs ?? 100)} onChangeText={t => set({ delayMs: Number(t.replace(/\D/g, '')) || 0 })} keyboardType="number-pad" style={st.keyInput} />
            <Text style={st.fieldLabel}>ms between steps</Text>
          </View>
        </Field>
      )}
      {action.type === 'toggle' && (
        <>
          <Field label="FIRST PRESS">
            <View style={st.step}><ActionForm action={action.on} api={api} pages={pages} nested onChange={on => set({ on })} /></View>
          </Field>
          <Field label="SECOND PRESS">
            <View style={st.step}><ActionForm action={action.off} api={api} pages={pages} nested onChange={off => set({ off })} /></View>
          </Field>
        </>
      )}
    </View>
  );
}

/** Edits one key. Save writes it back into the page; Clear removes it. */
export function KeyEditor({ initial, api, pages, onSave, onClear, onCancel }: {
  initial: Key | null;
  api: Client;
  pages: Page[];
  onSave: (k: Key) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const [k, setK] = useState<Key>(initial ?? { title: '', icon: { emoji: '⭐️' }, action: { type: 'open', target: '' } });
  const set = (patch: Partial<Key>) => setK(x => ({ ...x, ...patch }));
  const apps = useList('apps', api);

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

  return (
    <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={onCancel}>
      <View style={st.sheet}>
        <View style={st.header}>
          <Pressable onPress={onCancel} hitSlop={12}><Text style={st.link}>Cancel</Text></Pressable>
          <Text style={st.headerTitle}>{initial ? 'Edit key' : 'New key'}</Text>
          <Pressable onPress={() => onSave(k)} hitSlop={12}><Text style={[st.link, st.bold]}>Save</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <View style={s.row}>
            <Field label="Title">
              <Input value={k.title ?? ''} onChangeText={title => set({ title })} placeholder="Label under the icon" />
            </Field>
            <Field label="Icon (emoji)">
              <Input value={k.icon?.emoji ?? ''} onChangeText={emoji => set({ icon: { emoji } })} style={st.emoji} />
            </Field>
          </View>
          {k.action.type === 'open' && !!k.action.target && apps.includes(k.action.target) && (
            <Chip label={k.icon?.app ? 'Using the app icon' : 'Use the app icon'} on={!!k.icon?.app}
              onPress={() => set({ icon: k.icon?.app ? { emoji: '⭐️' } : { app: (k.action as any).target } })} />
          )}
          <Field label="Colour">
            <View style={s.wrap}>
              {KEY_COLORS.map(c => (
                <Pressable key={String(c)} onPress={() => set({ color: c ?? undefined })}
                  style={[st.swatch, { backgroundColor: c ?? C.raised }, (k.color ?? null) === c && st.swatchOn]} />
              ))}
            </View>
          </Field>
          <Field label="Live status">
            <View style={s.wrap}>
              {LIVES.map(l => <Chip key={String(l)} label={l ?? 'none'} on={(k.live ?? null) === l} onPress={() => set({ live: l ?? undefined })} />)}
            </View>
          </Field>
          <Field label="Action">
            <ActionForm action={k.action} onChange={setAction} api={api} pages={pages} />
          </Field>
          <Pressable onPress={() => api.run(k.action).catch(() => {})} style={st.gap}><Text style={st.link}>Test on the Mac</Text></Pressable>
          {initial && <Pressable onPress={onClear} style={st.gap}><Text style={st.remove}>Clear this key</Text></Pressable>}
        </ScrollView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#101114' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.hairline },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '600' },
  body: { padding: 24, gap: 20, paddingBottom: 80 },
  form: { gap: 14 },
  field: { gap: 8, flex: 1 },
  fieldLabel: { color: C.label, fontSize: 12, letterSpacing: 1.5, fontWeight: '600', textTransform: 'uppercase' },
  multi: { minHeight: 90, textAlignVertical: 'top' },
  mono: { fontFamily: 'Menlo', fontSize: 14 },
  keyInput: { minWidth: 120 },
  emoji: { fontSize: 24, textAlign: 'center' },
  step: { padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, gap: 10 },
  stepHead: { flexDirection: 'row', justifyContent: 'space-between' },
  swatch: { width: 40, height: 40, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline },
  swatchOn: { borderColor: C.silver, borderWidth: 3 },
  link: { color: C.silver, fontSize: 17 },
  bold: { fontWeight: '600' },
  remove: { color: '#e8a0a0', fontSize: 16 },
  gap: { marginTop: 4 },
});
