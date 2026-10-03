// Mirrors bridge/deck.js. The bridge validates everything the iPad saves.
export type Mod = 'cmd' | 'shift' | 'opt' | 'ctrl';
export type Action =
  | { type: 'hotkey'; key: string; mods: Mod[] }
  | { type: 'open'; target: string }
  | { type: 'text'; text: string }
  | { type: 'media'; key: 'play' | 'next' | 'previous' }
  | { type: 'volume'; change?: number; set?: number; mute?: 'toggle' }
  | { type: 'shortcut'; name: string }
  | { type: 'script'; command: string }
  | { type: 'mic' }
  | { type: 'system'; what: 'lock' | 'sleep-display' | 'screensaver' }
  | { type: 'hush'; cmd: string }
  | { type: 'page'; page: string }
  | { type: 'back' }
  | { type: 'app'; app: 'hush' }
  | { type: 'multi'; steps: Action[]; delayMs?: number }
  | { type: 'toggle'; on: Action; off: Action };
export type ActionType = Action['type'];

export type Live = 'mic' | 'volume' | 'battery' | 'anc' | 'toggle';
export type Key = {
  title?: string;
  icon?: { symbol?: string; emoji?: string; app?: string };
  color?: string;
  live?: Live;
  action: Action;
};
export type Page = { id: string; name: string; app?: string; keys: Record<string, Key> };
export type Deck = {
  version: 1;
  grid: { cols: number; rows: number };
  autoProfile: boolean;
  dials: ('volume' | 'anc')[];
  pages: Page[];
};

export type Device = { mac: string; name: string; connected: boolean; isHost: boolean };
export type Headphones = {
  status: string;
  error?: string | null;
  name?: string | null;
  battery?: number | null;
  hoursRemaining?: number | null;
  anc?: { level: number; enabled: boolean } | null;
  eq?: { bass: number; mid: number; treble: number } | null;
  selfVoice?: 'off' | 'low' | 'medium' | 'high' | null;
  conversation?: boolean | null;
  callMode?: boolean;
  inCall?: boolean;
  devices?: Device[];
};
export type MacState = { volume?: number; muted?: boolean; micMuted?: boolean; app?: string | null; error?: string };
export type State = { mac: MacState; headphones: Headphones | null; toggles: Record<string, boolean> };

/** A paired Mac, as remembered on this iPad. */
export type Mac = { name: string; host: string; port: number; token: string };
