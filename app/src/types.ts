// Mirrors bridge/deck.js. The bridge validates everything the iPad saves.
export type Mod = 'cmd' | 'shift' | 'opt' | 'ctrl';
export type Action =
  | { type: 'hotkey'; key: string; mods: Mod[] }
  | { type: 'open'; target: string }
  | { type: 'text'; text: string }
  | { type: 'media'; key: 'play' | 'next' | 'previous' | 'brightness-up' | 'brightness-down' }
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

export type Live = 'mic' | 'volume' | 'battery' | 'anc' | 'toggle' | 'nowplaying' | 'cpu' | 'memory' | 'macbattery' | 'clock';
export type Key = {
  title?: string;
  icon?: { symbol?: string; emoji?: string; app?: string };
  color?: string;
  live?: Live;
  /** Runs instead of `action` when the key is held ≥500ms (outside Edit mode). */
  hold?: Action;
  action: Action;
};
/** `kind: 'running'` pages ignore `keys` and fill with the Mac's running apps. */
export type Page = { id: string; name: string; app?: string; kind?: 'running'; keys: Record<string, Key> };
export type Deck = {
  version: 1;
  grid: { cols: number; rows: number };
  autoProfile: boolean;
  dials: ('volume' | 'anc' | 'brightness')[];
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
/** `art` is a version id for GET /artwork, null when the track has none. */
export type NowPlaying = { app: 'Music' | 'Spotify'; title: string; artist: string | null; playing: boolean; art: string | null };
export type MacBattery = { percent: number | null; charging: boolean; ac: boolean };
/** Live-source fields are present only when the deck has a key for that source. */
export type State = {
  mac: MacState;
  headphones: Headphones | null;
  toggles: Record<string, boolean>;
  nowPlaying?: NowPlaying | null;
  cpu?: number;
  memory?: number;
  macBattery?: MacBattery;
};
export type RunningApp = { name: string; path: string };

/** A paired Mac, as remembered on this iPad. `id` is the bridge's stable id (missing for Macs paired before ids). */
export type Mac = { name: string; host: string; port: number; token: string; id?: string };
