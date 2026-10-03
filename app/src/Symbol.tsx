import React from 'react';
import { requireNativeComponent, type ViewStyle } from 'react-native';
import type { Action } from './types';

type Props = { name: string; size?: number; weight?: 'light' | 'regular' | 'medium' | 'semibold' | 'bold'; color?: string; bounce?: number; style?: ViewStyle };
const Native = requireNativeComponent<Props>('HelmSymbolView');

/** An SF Symbol. Bump `bounce` to replay the symbol's bounce. */
export function Symbol({ size = 28, ...p }: Props) {
  return <Native size={size} {...p} style={[{ width: size * 1.5, height: size * 1.5 }, p.style]} />;
}

/** The glyph a key shows when it has no icon of its own. */
export function defaultSymbol(a: Action, live?: { micMuted?: boolean; muted?: boolean }): string {
  switch (a.type) {
    case 'open':
      return /^https?:/.test(a.target) ? 'safari' : /^[~/]/.test(a.target) ? 'doc' : 'arrow.up.forward.app';
    case 'hotkey': return 'command';
    case 'text': return 'text.cursor';
    case 'media': return { play: 'playpause.fill', next: 'forward.fill', previous: 'backward.fill' }[a.key];
    case 'volume':
      if (a.mute || live?.muted) return 'speaker.slash.fill';
      return (a.change ?? 0) < 0 ? 'speaker.wave.1.fill' : 'speaker.wave.3.fill';
    case 'mic': return live?.micMuted ? 'mic.slash.fill' : 'mic.fill';
    case 'shortcut': return 'square.stack.3d.up.fill';
    case 'script': return 'apple.terminal';
    case 'system': return { lock: 'lock.fill', 'sleep-display': 'moon.fill', screensaver: 'sparkles.tv' }[a.what];
    case 'hush':
    case 'app': return 'headphones';
    case 'page': return 'square.grid.2x2';
    case 'back': return 'chevron.backward';
    case 'multi': return 'list.bullet.rectangle';
    case 'toggle': return 'switch.2';
  }
}
