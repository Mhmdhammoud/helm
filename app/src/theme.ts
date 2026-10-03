// Same silver-on-black palette as the Hush menu-bar app, so the two feel like one set.
export const C = {
  bg: '#0b0c0e',
  text: '#eef0f3',
  secondary: '#b9bfc7',
  label: '#a6acb4',
  dim: '#8d939b',
  hairline: 'rgba(255,255,255,0.16)',
  silver: '#d9dde3',
  raised: '#15171a',
  danger: '#e8a0a0',
  ok: '#9fd8b4',
};

/** Spring used for every snap in the app (tabs, keys, sheets). */
export const SPRING = { damping: 30, stiffness: 420, mass: 0.7 };

/** Key tints offered in the editor (null = plain metal). Blended over the key face, never flat. */
export const KEY_COLORS = [null, '#3f6bd1', '#7d55d6', '#d65548', '#3fa877', '#d6a23f', '#8a96a8'];
