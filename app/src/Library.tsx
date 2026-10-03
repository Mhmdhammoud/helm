import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInRight, FadeOutRight } from 'react-native-reanimated';
import type { Client } from './api';
import { KeyTile } from './KeyTile';
import { Symbol } from './Symbol';
import type { Key, State } from './types';
import { C } from './theme';

const k = (title: string, action: Key['action'], extra: Partial<Key> = {}): Key => ({ title, action, ...extra });

/** Ready-made keys, grouped the way people look for them. */
const SECTIONS: { title: string; keys: Key[] }[] = [
  {
    title: 'Media',
    keys: [
      k('Play', { type: 'media', key: 'play' }),
      k('Previous', { type: 'media', key: 'previous' }),
      k('Next', { type: 'media', key: 'next' }),
      k('Quieter', { type: 'volume', change: -6 }),
      k('Louder', { type: 'volume', change: 6 }, { live: 'volume' }),
      k('Mute', { type: 'volume', mute: 'toggle' }),
    ],
  },
  {
    title: 'Live',
    keys: [
      k('Now playing', { type: 'media', key: 'play' }, { icon: { symbol: 'helm:now-playing' }, live: 'nowplaying', hold: { type: 'media', key: 'next' } }),
      k('Clock', { type: 'open', target: 'Clock' }, { icon: { symbol: 'clock' }, live: 'clock' }),
      k('CPU', { type: 'open', target: 'Activity Monitor' }, { icon: { symbol: 'cpu' }, live: 'cpu' }),
      k('Memory', { type: 'open', target: 'Activity Monitor' }, { icon: { symbol: 'memory-stick' }, live: 'memory' }),
      k('Battery', { type: 'open', target: 'x-apple.systempreferences:com.apple.Battery-Settings.extension' }, { icon: { symbol: 'battery' }, live: 'macbattery' }),
      k('Headphones', { type: 'app', app: 'hush' }, { live: 'battery' }),
    ],
  },
  {
    title: 'Mac',
    keys: [
      k('Mic', { type: 'mic' }, { live: 'mic' }),
      k('Screenshot', { type: 'hotkey', key: '4', mods: ['cmd', 'shift'] }, { icon: { symbol: 'camera.viewfinder' } }),
      k('Spotlight', { type: 'hotkey', key: 'space', mods: ['cmd'] }, { icon: { symbol: 'magnifyingglass' } }),
      k('Mission Control', { type: 'hotkey', key: 'up', mods: ['ctrl'] }, { icon: { symbol: 'rectangle.3.group' } }),
      k('Lock', { type: 'system', what: 'lock' }),
      k('Display off', { type: 'system', what: 'sleep-display' }),
      k('Copy', { type: 'hotkey', key: 'c', mods: ['cmd'] }, { icon: { symbol: 'doc.on.doc' } }),
      k('Paste', { type: 'hotkey', key: 'v', mods: ['cmd'] }, { icon: { symbol: 'doc.on.clipboard' } }),
      k('Undo', { type: 'hotkey', key: 'z', mods: ['cmd'] }, { icon: { symbol: 'arrow.uturn.backward' } }),
    ],
  },
  {
    title: 'Headphones',
    keys: [
      k('Hush', { type: 'app', app: 'hush' }, { live: 'battery' }),
      k('Max quiet', { type: 'hush', cmd: 'anc/10' }, { icon: { symbol: 'ear.trianglebadge.exclamationmark' }, live: 'anc' }),
      k('Hear room', { type: 'hush', cmd: 'anc/0' }, { icon: { symbol: 'ear' } }),
      k('Cycle quiet', { type: 'hush', cmd: 'anc/cycle' }, { icon: { symbol: 'dial.medium' } }),
      k('Conversation', { type: 'toggle', on: { type: 'hush', cmd: 'conversation/on' }, off: { type: 'hush', cmd: 'conversation/off' } }, { live: 'toggle', icon: { symbol: 'person.wave.2' } }),
    ],
  },
  {
    title: 'Meetings',
    keys: [
      k('Zoom mute', { type: 'hotkey', key: 'a', mods: ['cmd', 'shift'] }, { icon: { symbol: 'mic.slash' } }),
      k('Zoom video', { type: 'hotkey', key: 'v', mods: ['cmd', 'shift'] }, { icon: { symbol: 'video' } }),
      k('Meet mute', { type: 'hotkey', key: 'd', mods: ['cmd'] }, { icon: { symbol: 'mic.slash.circle' } }),
      k('Meet video', { type: 'hotkey', key: 'e', mods: ['cmd'] }, { icon: { symbol: 'video.circle' } }),
    ],
  },
];

// Apps people usually want first; everything else is reachable through search.
const FAVOURITE_APPS = ['Safari', 'Google Chrome', 'Arc', 'Mail', 'Messages', 'Slack', 'zoom.us', 'Notes', 'Calendar', 'Music',
  'Spotify', 'Finder', 'Terminal', 'Visual Studio Code', 'Cursor', 'Xcode', 'Figma', 'Notion', 'Claude', 'ChatGPT', 'System Settings'];

/**
 * Edit-mode side panel of ready-made keys. Tap one to drop it into the next empty slot,
 * or hold and drag it onto any slot.
 */
export function Library({ api, state, dragging, onAdd, onDragStart }: {
  api: Client;
  state: State | null;
  onAdd: (k: Key) => void;
  onDragStart: (k: Key) => void;
  /** While a key is being dragged the list must not scroll, or it steals the touch. */
  dragging: boolean;
}) {
  const [apps, setApps] = useState<string[]>([]);
  const [shortcuts, setShortcuts] = useState<string[]>([]);
  const [running, setRunning] = useState<string[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    api.apps().then(setApps, () => {});
    api.shortcuts().then(setShortcuts, () => {});
    api.running().then(r => setRunning(r.map(a => a.name)), () => {});
  }, [api]);

  const query = q.trim().toLowerCase();
  const sections = useMemo(() => {
    const appList = query
      ? apps.filter(a => a.toLowerCase().includes(query)).slice(0, 24)
      // What's open on the Mac first (so your own tools, like cmux, are right there), then common apps.
      : [...new Set([...running, ...FAVOURITE_APPS.filter(a => apps.includes(a))])];
    const all = [
      { title: 'Apps', keys: appList.map(a => k(a.replace(/\.us$/, ''), { type: 'open', target: a }, { icon: { app: a } })) },
      ...SECTIONS,
      { title: 'Shortcuts', keys: shortcuts.map(s => k(s, { type: 'shortcut', name: s })) },
    ];
    return all
      .map(s => ({ ...s, keys: query && s.title !== 'Apps' ? s.keys.filter(x => x.title?.toLowerCase().includes(query)) : s.keys }))
      .filter(s => s.keys.length);
  }, [apps, shortcuts, running, query]);

  return (
    <Animated.View entering={FadeInRight.duration(220)} exiting={FadeOutRight.duration(160)} style={st.panel}>
      <View style={st.search}>
        <Symbol name="magnifyingglass" size={14} color={C.dim} />
        <TextInput value={q} onChangeText={setQ} placeholder="Apps, actions, shortcuts" placeholderTextColor={C.dim}
          style={st.input} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
      </View>
      <ScrollView scrollEnabled={!dragging} contentContainerStyle={st.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {sections.map(s => (
          <View key={s.title} style={st.section}>
            <Text style={st.title}>{s.title.toUpperCase()}</Text>
            <View style={st.grid}>
              {s.keys.map((key, i) => (
                <KeyTile key={`${s.title}${i}`} id={`lib/${s.title}/${i}`} k={key} size={76} api={api} state={state}
                  editing={false} picked={false} onPress={() => onAdd(key)} onLongPress={() => onDragStart(key)} />
              ))}
            </View>
          </View>
        ))}
        {!sections.length && <Text style={st.empty}>Nothing matches “{q}”.</Text>}
      </ScrollView>
      <Text style={st.hint}>Tap to add · hold and drag onto a slot</Text>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  panel: {
    width: 300,
    borderRadius: 24,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.hairline,
  },
  search: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.35)' },
  input: { flex: 1, color: C.text, fontSize: 15 },
  body: { paddingVertical: 12, gap: 18 },
  section: { gap: 10 },
  title: { color: C.label, fontSize: 11, letterSpacing: 1.6, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  empty: { color: C.dim, fontSize: 14, textAlign: 'center', marginTop: 20 },
  hint: { color: C.dim, fontSize: 12, textAlign: 'center', marginTop: 6 },
});
