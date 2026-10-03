const fs: { readFileSync(p: string, e: string): string; readdirSync(p: string): string[] } = require('fs');
const LUCIDE = 'node_modules/lucide-react-native/dist/esm/lucide-react-native.mjs';

// Real Lucide export names, without loading the ESM bundle into Jest.
const barrel = fs.readFileSync(LUCIDE, 'utf8');
jest.mock('lucide-react-native', () => {
  const src: string = jest.requireActual('fs').readFileSync('node_modules/lucide-react-native/dist/esm/lucide-react-native.mjs', 'utf8');
  const icon = () => null;
  return { ...Object.fromEntries([...src.matchAll(/default as (\w+)/g)].map(m => [m[1], icon])), createLucideIcon: () => icon };
});
jest.mock('react-native-reanimated', () => ({}));

import { ICONS, defaultSymbol, iconComponent } from '../src/Symbol';
import type { Action } from '../src/types';

test('every SF Symbol name used in src resolves', () => {
  const dir = 'src';
  const names = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((n: string) => /\.tsx?$/.test(n) && n !== 'Symbol.tsx')) {
    const s = fs.readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of s.matchAll(/(?:name=|symbol[=:]\s*\{?|return |\? |: )['"]([a-z][a-z0-9]*(?:\.[a-z0-9]+)*)['"]/g)) names.add(m[1]);
  }
  expect(names.size).toBeGreaterThan(30);
  const missing = [...names].filter(n => n.includes('.') || /^[a-z]+$/.test(n)).filter(n => !iconComponent(n));
  // Plain words that are not icons (e.g. route names) are allowed to miss; dotted SF names are not.
  expect(missing.filter(n => n.includes('.'))).toEqual([]);
});

test('picker ids and default symbols all resolve', () => {
  expect(barrel).toContain('default as SquareDashed');
  expect(ICONS.filter(i => !iconComponent(i.id)).map(i => i.id)).toEqual([]);
  const actions: Action[] = [
    { type: 'hush', cmd: 'anc/10' }, { type: 'hush', cmd: 'anc/0' }, { type: 'hush', cmd: 'anc/cycle' }, { type: 'hush', cmd: 'switch/iPhone' },
    { type: 'hotkey', key: '4', mods: ['shift', 'cmd'] }, { type: 'open', target: 'https://x.com' }, { type: 'system', what: 'sleep-display' },
    { type: 'media', key: 'play' }, { type: 'volume', mute: 'toggle' }, { type: 'text', text: '' }, { type: 'script', command: '' },
    { type: 'page', page: 'a' }, { type: 'back' }, { type: 'multi', steps: [] }, { type: 'app', app: 'hush' },
  ];
  for (const a of actions) expect(iconComponent(defaultSymbol(a))).toBeDefined();
});

test('defaultSymbol picks the specific icon', () => {
  expect(defaultSymbol({ type: 'hush', cmd: 'anc/10' })).toBe('helm:noise-max');
  expect(defaultSymbol({ type: 'hush', cmd: 'anc/0' })).toBe('helm:noise-off');
  expect(defaultSymbol({ type: 'hush', cmd: 'anc/cycle' })).toBe('helm:noise-cycle');
  expect(defaultSymbol({ type: 'hush', cmd: 'conversation/on' })).toBe('helm:conversation');
  expect(defaultSymbol({ type: 'hush', cmd: 'switch/Mac' })).toBe('helm:switch-device');
  expect(defaultSymbol({ type: 'hotkey', key: '4', mods: ['cmd', 'shift'] })).toBe('helm:screenshot');
  expect(defaultSymbol({ type: 'hotkey', key: 'up', mods: ['ctrl'] })).toBe('helm:mission-control');
  expect(defaultSymbol({ type: 'hotkey', key: 'c', mods: ['cmd'] })).toBe('copy');
  expect(defaultSymbol({ type: 'hotkey', key: 'v', mods: ['cmd'] })).toBe('clipboard-paste');
  expect(defaultSymbol({ type: 'hotkey', key: 'z', mods: ['cmd'] })).toBe('undo-2');
  expect(defaultSymbol({ type: 'hotkey', key: 'k', mods: ['cmd'] })).toBe('command');
  expect(defaultSymbol({ type: 'open', target: 'https://x.com' })).toBe('globe');
  expect(defaultSymbol({ type: 'open', target: '~/notes.md' })).toBe('file');
  expect(defaultSymbol({ type: 'system', what: 'lock' })).toBe('lock');
  expect(defaultSymbol({ type: 'toggle', on: { type: 'back' }, off: { type: 'back' } })).toBe('helm:toggle');
});
