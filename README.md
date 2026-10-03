# Helm

A Stream Deck for your Macs, on an iPad. Pages of keys you set up on the iPad; pressing one runs
an action on the paired Mac. Hush (the Bose NC700 controller) lives inside as a full-screen panel.

- `app/`: iPad app, React Native 0.83 + react-native-skia (landscape, iPad only, bundle `app.helm.ipad`)
- `bridge/`: the Mac side, Node stdlib only. Stores the deck, runs actions, reports live state,
  advertises itself over Bonjour and pairs iPads with a code.

## Set up a Mac

```sh
node bridge/server.js --install    # runs at login (LaunchAgent); --uninstall removes it
node bridge/server.js              # or run it in the foreground
```

Give the bridge's process Accessibility permission (System Settings → Privacy & Security →
Accessibility) so hotkeys, typed text and media keys work. Hush actions need
[Hush](../hush) (`HUSH_CLI`, default `~/Documents/projects/lab/hush/bin/hush`).

## Pair the iPad

Open Helm; every Mac running the bridge is listed. Tap one, and the Mac shows a 6-digit code as a
notification; type it on the iPad. Pair as many Macs as you like and switch from the top bar.
`node bridge/server.js --unpair-all` forgets every iPad. Anyone paired can run scripts on the Mac,
as with any Stream Deck, so pair only your own devices.

## Use

- **Keys**: tap to run. **Edit** → tap a key to set its action, title, emoji or app icon, colour
  and live status; long-press a key, then tap another slot to swap them.
- **Actions**: open app/file/URL, hotkey, type text, media (play/pause, next, previous), volume,
  mic mute, macOS Shortcut, shell script, system (lock, sleep display, screensaver), Hush command,
  Hush panel, go to page, back, multi action (steps with a delay), toggle (alternates two actions).
- **Live keys**: mic, volume, headphone battery, noise cancelling, toggle state.
- **Pages and profiles**: long-press a page tab (in Edit) to rename, delete or bind it to an app.
  A bound page (⚡︎) opens while that app is in front on the Mac, and closes when it isn't.
- **Dials**: Mac volume and noise cancelling, Stream Deck+ style.
- **Grid**: 4×3, 5×3, 6×4 or 8×4 (tap the size in Edit).

## Build the iPad app

```sh
cd app && npm install && cd ios && bundle exec pod install
open Helm.xcworkspace   # pick your team and the iPad; Release bundles the JS (no Metro needed)
```

## Bridge API

Unauthenticated: `GET /hello`, `POST /pair/start`, `POST /pair {code, device}` → `{token}`.
With `Authorization: Bearer <token>`: `GET /deck`, `PUT /deck`, `POST /run {action, id}`,
`GET /state`, `GET /apps`, `GET /shortcuts`, `GET /icon?app=Name` (PNG).
State: `~/Library/Application Support/Helm/` (`deck.json`, `tokens.json` with hashed tokens,
`icons/`, `bin/mediakey`).

## Test

```sh
cd bridge && npm test                     # recording exec: nothing runs on the Mac
cd app && npx jest && npx tsc --noEmit
```
