jest.mock('react-native-skia', () => ({}));
jest.mock('react-native-reanimated', () => ({}));
jest.mock('react-native-gesture-handler', () => ({}));
jest.mock('react-native-worklets', () => ({}));
jest.mock('../src/Symbol', () => ({}));
import { liveView } from '../src/KeyTile';
import type { Key, State } from '../src/types';

const key = (live: Key['live']): Key => ({ live, action: { type: 'media', key: 'play' } });
const state = (extra: Partial<State>): State => ({ mac: {}, headphones: null, toggles: {}, ...extra });

test('now playing shows the track over its artwork', () => {
  const np = { app: 'Spotify' as const, title: 'Song', artist: 'Band', playing: false, art: 'abc' };
  expect(liveView(key('nowplaying'), state({ nowPlaying: np }), 'p/0')).toEqual({ title: 'Song', sub: 'Paused · Band', art: 'abc' });
  expect(liveView(key('nowplaying'), state({ nowPlaying: { ...np, playing: true, art: null } }), 'p/0')).toEqual({ title: 'Song', sub: 'Band', art: undefined });
  expect(liveView(key('nowplaying'), state({ nowPlaying: null }), 'p/0').sub).toBe('Nothing playing');
});

test('Mac stats', () => {
  expect(liveView(key('cpu'), state({ cpu: 95 }), 'p/0')).toEqual({ sub: '95%', level: 0.95, alert: true });
  expect(liveView(key('memory'), state({ memory: 40 }), 'p/0')).toEqual({ sub: '40%', level: 0.4, alert: false });
  expect(liveView(key('macbattery'), state({ macBattery: { percent: null, charging: false, ac: true } }), 'p/0')).toEqual({ sub: 'AC' });
  expect(liveView(key('macbattery'), state({ macBattery: { percent: 15, charging: false, ac: false } }), 'p/0').alert).toBe(true);
  expect(liveView(key('clock'), null, 'p/0').face).toMatch(/\d{1,2}:\d{2}/);
});
