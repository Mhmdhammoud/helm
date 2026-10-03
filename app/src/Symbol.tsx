import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import * as Lucide from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { HELM_ICONS, HELM_LABELS } from './HelmIcons';
import type { Action, Mod } from './types';

type Weight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
type Props = { name: string; size?: number; weight?: Weight; color?: string; bounce?: number; style?: ViewStyle };

const STROKE: Record<Weight, number> = { light: 1.5, regular: 1.75, medium: 2, semibold: 2.25, bold: 2.5 };

// SF Symbol names that older decks and callers still use → Lucide / "helm:" ids.
const SF: Record<string, string> = {
  'apple.terminal': 'square-terminal', 'terminal.fill': 'square-terminal',
  'arrow.clockwise': 'rotate-cw', 'arrow.up': 'arrow-up', 'arrow.down': 'arrow-down', 'arrow.left': 'arrow-left', 'arrow.right': 'arrow-right',
  'arrow.triangle.2.circlepath': 'helm:noise-cycle', 'dial.medium': 'helm:noise-cycle',
  'arrow.up.forward.app': 'square-arrow-out-up-right', 'arrow.uturn.backward': 'undo-2',
  'backward.fill': 'skip-back', 'forward.fill': 'skip-forward', 'play.fill': 'play', 'pause.fill': 'pause', 'playpause.fill': 'helm:play-pause',
  'bell.fill': 'bell', 'bolt.fill': 'zap', 'bolt.slash': 'zap-off', 'camera.fill': 'camera', 'camera.viewfinder': 'helm:screenshot',
  checkmark: 'check', 'checkmark.circle.fill': 'circle-check', 'chevron.backward': 'chevron-left', 'chevron.right': 'chevron-right',
  'chevron.left.forwardslash.chevron.right': 'code-xml', command: 'command',
  'circle.fill': 'helm:noise-max', 'circle.lefthalf.filled': 'contrast', circle: 'helm:noise-off',
  'ear.trianglebadge.exclamationmark': 'helm:noise-max', ear: 'helm:noise-off',
  doc: 'file', 'doc.fill': 'file', 'doc.on.clipboard': 'clipboard-paste', 'doc.on.doc': 'copy',
  'envelope.fill': 'mail', 'fan.fill': 'fan', 'folder.fill': 'folder', 'gearshape.fill': 'settings', 'hammer.fill': 'hammer',
  'heart.fill': 'heart', 'text.cursor': 'text-cursor-input', 'sun.min.fill': 'sun-dim', 'house.fill': 'house', 'lightbulb.fill': 'lightbulb', 'star.fill': 'star', 'sun.max.fill': 'sun',
  'thermometer.medium': 'thermometer', 'music.note': 'music', 'message.fill': 'message-circle', 'phone.fill': 'phone',
  'person.fill': 'user', 'person.2.fill': 'users', 'person.wave.2': 'helm:conversation', 'person.wave.2.fill': 'helm:conversation',
  'person.fill.xmark': 'user-x', waveform: 'helm:hear-yourself', 'waveform.slash': 'ear-off',
  'plus.circle': 'circle-plus', 'minus.circle': 'circle-minus', 'minus.circle.fill': 'circle-minus', plus: 'plus', xmark: 'x', trash: 'trash-2',
  'list.bullet.rectangle': 'helm:multi', 'switch.2': 'helm:toggle', 'square.grid.2x2': 'helm:page-link', 'square.grid.3x3': 'grid-3x3',
  'square.stack.3d.up.fill': 'layers', 'rectangle.3.group': 'helm:mission-control', 'slider.horizontal.3': 'sliders-horizontal',
  'lock.fill': 'lock', 'moon.fill': 'moon', 'sparkles.tv': 'sparkles', power: 'power', display: 'monitor', keyboard: 'keyboard',
  calendar: 'calendar', cpu: 'cpu', safari: 'compass', magnifyingglass: 'search', headphones: 'headphones',
  'mic.fill': 'mic', 'mic.slash': 'mic-off', 'mic.slash.fill': 'mic-off', 'mic.slash.circle': 'helm:meeting-mute',
  video: 'video', 'video.fill': 'video', 'video.circle': 'helm:meeting-video-off',
  'speaker.slash.fill': 'volume-x', 'speaker.wave.1.fill': 'volume-1', 'speaker.wave.2.fill': 'volume-2', 'speaker.wave.3.fill': 'volume-2',
  iphone: 'smartphone', 'ipad.landscape': 'tablet', laptopcomputer: 'laptop', desktopcomputer: 'monitor', appletv: 'tv',
  macmini: 'helm:mac-mini', macstudio: 'helm:mac-mini', 'macpro.gen3': 'pc-case',
};

// Lucide already draws these precisely; the helm: ids exist so callers can ask by intent.
const ALIASES: Record<string, string> = { 'helm:cpu': 'cpu', 'helm:memory': 'memory-stick', 'helm:clock': 'clock' };

const pascal = (id: string) => id.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
// ponytail: the Lucide barrel bundles every icon (~1.9k) so any kebab id works; switch to per-icon imports if bundle size matters.
const lucide = Lucide as unknown as Record<string, LucideIcon | undefined>;

/** The component for an icon id: Lucide kebab-case, "helm:<id>", or a legacy SF Symbol name. */
export function iconComponent(name: string): LucideIcon | undefined {
  const id = ALIASES[name] ?? SF[name] ?? name;
  return id.startsWith('helm:') ? HELM_ICONS[id.slice(5)] : lucide[pascal(id)];
}

/** An icon. Bump `bounce` to replay a small spring bounce. */
export function Symbol({ name, size = 28, weight = 'regular', color = '#fff', bounce = 0, style }: Props) {
  const Icon = iconComponent(name) ?? Lucide.SquareDashed;
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const last = useRef(bounce);
  useEffect(() => {
    if (bounce === last.current) return;
    last.current = bounce;
    if (bounce <= 0) return;
    scale.value = withSequence(withTiming(0.8, { duration: 80 }), withSpring(1, { damping: 7, stiffness: 320 }));
    rotate.value = withSequence(withTiming(-8, { duration: 80 }), withSpring(0, { damping: 6, stiffness: 260 }));
  }, [bounce, scale, rotate]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { rotate: `${rotate.value}deg` }] }));
  // SF Symbols at point size N read about 1.2N wide; match that so existing layouts keep their weight.
  return (
    <View style={StyleSheet.flatten([{ width: size * 1.5, height: size * 1.5, alignItems: 'center', justifyContent: 'center' }, style])}>
      <Animated.View style={anim}>
        <Icon size={size * 1.2} color={color} strokeWidth={STROKE[weight]} />
      </Animated.View>
    </View>
  );
}

const sameMods = (a: Mod[], b: Mod[]) => a.length === b.length && b.every(m => a.includes(m));
const HOTKEYS: { key: string; mods: Mod[]; icon: string }[] = [
  { key: '4', mods: ['cmd', 'shift'], icon: 'helm:screenshot' },
  { key: '3', mods: ['cmd', 'shift'], icon: 'camera' },
  { key: 'up', mods: ['ctrl'], icon: 'helm:mission-control' },
  { key: 'space', mods: ['cmd'], icon: 'search' },
  { key: 'c', mods: ['cmd'], icon: 'copy' },
  { key: 'x', mods: ['cmd'], icon: 'scissors' },
  { key: 'v', mods: ['cmd'], icon: 'clipboard-paste' },
  { key: 'z', mods: ['cmd'], icon: 'undo-2' },
  { key: 'z', mods: ['cmd', 'shift'], icon: 'redo-2' },
  { key: 's', mods: ['cmd'], icon: 'save' },
  { key: 'q', mods: ['cmd'], icon: 'power' },
  { key: 'tab', mods: ['cmd'], icon: 'app-window' },
];

function hushSymbol(cmd: string): string {
  const [what, arg = ''] = cmd.split('/');
  if (what === 'anc') return arg === 'cycle' ? 'helm:noise-cycle' : arg === '0' || arg === 'down' ? 'helm:noise-off' : 'helm:noise-max';
  return { conversation: 'helm:conversation', selfvoice: 'helm:hear-yourself', switch: 'helm:switch-device', eq: 'sliders-horizontal' }[what] ?? 'headphones';
}

/** The glyph a key shows when it has no icon of its own. */
export function defaultSymbol(a: Action, live?: { micMuted?: boolean; muted?: boolean }): string {
  switch (a.type) {
    case 'open':
      return /^[a-z][a-z0-9+.-]*:/i.test(a.target) ? 'globe' : /^[~/]/.test(a.target) ? 'file' : 'square-arrow-out-up-right';
    case 'hotkey':
      return HOTKEYS.find(h => h.key === a.key.toLowerCase() && sameMods(a.mods, h.mods))?.icon ?? 'command';
    case 'text': return 'text-cursor-input';
    case 'media': return { play: 'helm:play-pause', next: 'skip-forward', previous: 'skip-back', 'brightness-up': 'sun', 'brightness-down': 'sun-dim' }[a.key];
    case 'volume':
      if (a.mute || live?.muted) return 'volume-x';
      return (a.change ?? 0) < 0 ? 'volume-1' : 'volume-2';
    case 'mic': return live?.micMuted ? 'mic-off' : 'mic';
    case 'shortcut': return 'layers';
    case 'script': return 'square-terminal';
    case 'system': return { lock: 'lock', 'sleep-display': 'helm:display-sleep', screensaver: 'sparkles' }[a.what];
    case 'hush': return hushSymbol(a.cmd);
    case 'app': return 'helm:hush';
    case 'page': return 'helm:page-link';
    case 'back': return 'helm:page-back';
    case 'multi': return 'helm:multi';
    case 'toggle': return 'helm:toggle';
  }
}

const group = (g: string, entries: [string, string][]) => entries.map(([id, label]) => ({ id, label, group: g }));

/** Curated picker for the key editor. */
export const ICONS: { id: string; label: string; group: string }[] = [
  ...group('Media', [
    ['play', 'Play'], ['pause', 'Pause'], ['helm:play-pause', 'Play / pause'], ['skip-back', 'Previous'], ['skip-forward', 'Next'],
    ['volume-2', 'Volume'], ['volume-x', 'Mute'], ['music', 'Music'], ['helm:now-playing', 'Now playing'], ['mic', 'Mic'], ['mic-off', 'Mic off'],
    ['headphones', 'Headphones'], ['radio', 'Radio'], ['podcast', 'Podcast'],
  ]),
  ...group('System', [
    ['lock', 'Lock'], ['moon', 'Moon'], ['sun', 'Sun'], ['power', 'Power'], ['settings', 'Settings'], ['monitor', 'Display'],
    ['keyboard', 'Keyboard'], ['command', 'Command'], ['camera', 'Camera'], ['zap', 'Bolt'], ['search', 'Search'], ['battery-medium', 'Battery'],
    ['wifi', 'Wi-Fi'], ['bluetooth', 'Bluetooth'], ['copy', 'Copy'], ['clipboard-paste', 'Paste'], ['undo-2', 'Undo'], ['trash-2', 'Trash'],
  ]),
  ...group('Apps & dev', [
    ['globe', 'Web'], ['compass', 'Browser'], ['folder', 'Folder'], ['file', 'File'], ['square-terminal', 'Terminal'], ['code-xml', 'Code'],
    ['git-branch', 'Git'], ['hammer', 'Build'], ['bug', 'Debug'], ['cpu', 'CPU'], ['memory-stick', 'Memory'], ['clock', 'Clock'],
    ['timer', 'Timer'], ['layers', 'Shortcut'],
  ]),
  ...group('Communication', [
    ['mail', 'Mail'], ['message-circle', 'Messages'], ['phone', 'Phone'], ['bell', 'Notifications'], ['calendar', 'Calendar'], ['user', 'Person'],
    ['users', 'People'], ['at-sign', 'Mention'],
  ]),
  ...group('Meetings', [['video', 'Video'], ['video-off', 'Video off'], ['phone-off', 'Hang up'], ['hand', 'Raise hand'], ['screen-share', 'Share screen']]),
  ...group('Home', [
    ['house', 'Home'], ['lightbulb', 'Light'], ['fan', 'Fan'], ['thermometer', 'Temperature'], ['coffee', 'Coffee'], ['star', 'Star'], ['heart', 'Heart'],
  ]),
  ...group('Arrows', [
    ['arrow-up', 'Up'], ['arrow-down', 'Down'], ['arrow-left', 'Left'], ['arrow-right', 'Right'], ['rotate-cw', 'Refresh'], ['corner-up-left', 'Return'],
  ]),
  ...group('Helm', Object.entries(HELM_LABELS).map(([id, label]) => [`helm:${id}`, label] as [string, string])),
];
