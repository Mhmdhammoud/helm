import { createLucideIcon, type LucideIcon, type LucideIconNode } from 'lucide-react-native';

// Helm's own glyphs for actions Lucide has nothing precise for. Drawn on Lucide's grid
// (24×24, 2px stroke, round caps/joins, ≥1px air between strokes) and rendered through
// Lucide's own Icon, so size/color/strokeWidth behave exactly like a stock Lucide icon.

const HEADPHONES = 'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3';
const p = (d: string): LucideIconNode => ['path', { d }];

// @nodes-start
const NODES: Record<string, LucideIconNode[]> = {
  // Headphones with a level meter in the band: full / empty.
  'noise-max': [p(HEADPHONES), p('M9 12v-1'), p('M12 12V9'), p('M15 12V7')],
  'noise-off': [p(HEADPHONES), p('M8 10c.67-2 1.33-2 2 0s1.33 2 2 0 1.33-2 2 0 1.33 2 2 0')],
  'noise-cycle': [p(HEADPHONES), p('M15.5 10a3.5 3.5 0 1 1-1.03-2.47'), p('M15.5 6v2.5H13')],
  conversation: [p(HEADPHONES), p('M9 9v2'), p('M12 7v6'), p('M15 9v2')],
  'hear-yourself': [p(HEADPHONES), ['circle', { cx: 12, cy: 7.5, r: 1.75 }], p('M9 13.5a3 3 0 0 1 6 0')],
  'switch-device': [p(HEADPHONES), p('M7.5 10h9'), p('m9.5 8-2 2 2 2'), p('m14.5 8 2 2-2 2')],
  // Mac mini / Studio: a low rounded box with the power light, seen from the front.
  'mac-mini': [['rect', { x: 3, y: 9, width: 18, height: 7, rx: 2.5 }], p('M7 19h10'), ['circle', { cx: 17, cy: 12.5, r: 0.5 }]],
  // The Hush mark: a ring holding a wave that dies out.
  hush: [['circle', { cx: 12, cy: 12, r: 10 }], p('M6 12c.8-4 1.7-4 2.5 0c.8 3 1.7 3 2.5 0c.7-2 1.5-2 2.25 0c.6 1 1.4 1 2 0H18')],
  // Meetings: a muted mic / camera framed like the call tile in focus.
  'meeting-mute': [
    p('M3 7V5a2 2 0 0 1 2-2h2'), p('M17 3h2a2 2 0 0 1 2 2v2'), p('M21 17v2a2 2 0 0 1-2 2h-2'), p('M7 21H5a2 2 0 0 1-2-2v-2'),
    p('M12 15.9v1.8'), p('M13.8 10.4V7.8a1.8 1.8 0 0 0-3.41-.8'), p('M14.97 14.97A4.2 4.2 0 0 1 7.8 12v-1.2'),
    p('M16.13 12.74A4.2 4.2 0 0 0 16.2 12v-1.2'), p('m6 6 12 12'), p('M10.2 10.2V12a1.8 1.8 0 0 0 3.07 1.27'),
  ],
  'meeting-video-off': [
    p('M3 7V5a2 2 0 0 1 2-2h2'), p('M17 3h2a2 2 0 0 1 2 2v2'), p('M21 17v2a2 2 0 0 1-2 2h-2'), p('M7 21H5a2 2 0 0 1-2-2v-2'),
    p('M10.4 8.4H12a1.2 1.2 0 0 1 1.2 1.2v1.5l3.15-1.84a.3.3 0 0 1 .45.26v4.92'),
    p('M14.4 14.4a1.2 1.2 0 0 1-1.2 1.2H7.2A1.2 1.2 0 0 1 6 14.4V9.6a1.2 1.2 0 0 1 1.2-1.2h1.2'), p('m6 6 12 12'),
  ],
  // Mac.
  screenshot: [
    p('M3 7V5a2 2 0 0 1 2-2h2'), p('M17 3h2a2 2 0 0 1 2 2v2'), p('M21 17v2a2 2 0 0 1-2 2h-2'), p('M7 21H5a2 2 0 0 1-2-2v-2'),
    p('M12 8v2'), p('M12 14v2'), p('M8 12h2'), p('M14 12h2'),
  ],
  'mission-control': [
    ['rect', { x: 2, y: 4, width: 9, height: 7, rx: 1.5 }], ['rect', { x: 13, y: 4, width: 9, height: 7, rx: 1.5 }],
    ['rect', { x: 7, y: 14, width: 10, height: 7, rx: 1.5 }],
  ],
  'display-sleep': [
    ['rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }], p('M12 17v4'), p('M8 21h8'),
    p('M15.59 10.19a3.6 3.6 0 1 1-3.79-3.79c.16-.01.25.18.16.32a2.4 2.4 0 0 0 3.31 3.31c.14-.09.33 0 .32.16'),
  ],
  'running-apps': [
    ['rect', { x: 3, y: 7, width: 5, height: 5, rx: 1 }], ['rect', { x: 9.5, y: 7, width: 5, height: 5, rx: 1 }],
    ['rect', { x: 16, y: 7, width: 5, height: 5, rx: 1 }], p('M5.5 16h.01'), p('M12 16h.01'), p('M2 20h20'),
  ],
  'now-playing': [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }], p('M13 15V7l3 1.5'), ['circle', { cx: 11, cy: 15, r: 2 }]],
  'play-pause': [p('M3 6.5a1.5 1.5 0 0 1 2.3-1.27l7.2 5.5a1.5 1.5 0 0 1 0 2.54l-7.2 5.5A1.5 1.5 0 0 1 3 17.5z'), p('M17 5v14'), p('M21 5v14')],
  // Deck.
  multi: [['rect', { x: 10, y: 10, width: 11, height: 11, rx: 2 }], p('M6.5 17.5v-9a2 2 0 0 1 2-2h9'), p('M3 14V5a2 2 0 0 1 2-2h9')],
  toggle: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ['circle', { cx: 9, cy: 12, r: 2.5 }], p('M16 9v6')],
  'page-link': [
    ['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }], p('M14 17.5h7'), p('m18 14.5 3 3-3 3'),
  ],
  'page-back': [
    ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }], p('M10 6.5H3'), p('m6 3.5-3 3 3 3'),
  ],
};
// @nodes-end

export const HELM_LABELS: Record<string, string> = {
  'mac-mini': 'Mac mini', 'noise-max': 'Noise cancelling max', 'noise-off': 'Noise cancelling off', 'noise-cycle': 'Cycle noise cancelling',
  conversation: 'Conversation mode', 'hear-yourself': 'Hear yourself', 'switch-device': 'Switch device', hush: 'Hush',
  'meeting-mute': 'Meeting mute', 'meeting-video-off': 'Meeting video off', screenshot: 'Screenshot region',
  'mission-control': 'Mission Control', 'display-sleep': 'Display sleep', 'running-apps': 'Running apps',
  'now-playing': 'Now playing', 'play-pause': 'Play / pause', multi: 'Several steps', toggle: 'On / off', 'page-link': 'Go to page', 'page-back': 'Back',
};

/** Custom icons by id, without the "helm:" prefix. */
export const HELM_ICONS: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(NODES).map(([id, node]) => [
    id,
    createLucideIcon(`helm-${id}`, node.map(([tag, attrs], i) => [tag, { ...attrs, key: String(i) }] as LucideIconNode)),
  ]),
);
