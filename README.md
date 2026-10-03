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

The login item runs through a small "Helm Bridge" app, so macOS asks for permissions under that name
(not `node`): allow its Documents access if the repo lives there, and turn on Helm Bridge in System
Settings → Privacy & Security → Accessibility so hotkeys, typed text and media keys work. In the
foreground, the permission belongs to your terminal instead. Hush actions and the headphone panel need
[Hush](https://github.com/Mhmdhammoud/hush) installed and running: the bridge reads its state file and
sends `hush://` commands to it, nothing else.

## Pair the iPad

Open Helm; every Mac running the bridge is listed. Tap one, and the Mac shows a 6-digit code as a
notification; type it on the iPad. Pair as many Macs as you like and switch from the top bar.
`node bridge/server.js --unpair-all` forgets every iPad. Anyone paired can run scripts on the Mac,
as with any Stream Deck, so pair only your own devices.

## Use

- **Keys**: tap to run; the key flashes when the Mac has done it. Keys show their icon only (app keys
  are the app icon edge to edge) plus any live reading.
- **Edit**: a library opens beside the keys (below them in portrait) with your open apps first,
  then common apps, media, Mac, headphones, meetings, live keys and your macOS Shortcuts; search
  finds the rest. Hold an item briefly and drag it onto a slot.
  Hold and drag a key to move it (dropping on another key swaps them) or onto the library to remove
  it. Tap a key to open its editor: what it does, what it does when held, icon (Lucide + Helm's own
  set, the app's icon, or an emoji), tint and live status, with a live preview and "Try it on the Mac".
- **Actions**: open app/file/URL, key combo, type text, media (play/pause, next, previous), volume
  (real volume keys, so the Mac shows its volume bar), mic mute, macOS Shortcut, shell command,
  system (lock, sleep display, screensaver), Hush command, Hush panel, go to page, back, several
  steps (with a delay), on/off (alternates two actions).
- **Live keys**: mic, volume, headphone battery, noise cancelling, toggle state, now playing (Music
  or Spotify: artwork, title, artist; only asked while the app is already running), clock, CPU, memory,
  Mac battery ("AC" on Macs without one), weather. Mac readings are taken only while an iPad is watching.
- **Widgets**: clock, weather, system (CPU, memory, battery) and now playing can span 2×1 up to 3×2
  slots (Widgets in the library, or Size in the editor). Weather comes from Open-Meteo (free, no key;
  the bridge sends it the city name and then its coordinates) for the key's city or, by default, the
  Mac's time-zone city, refreshed every 15 minutes.
- **Hold**: a key can have a second action that runs when held for half a second (outside Edit).
- **Pages and profiles**: hold a page tab (in Edit) to rename, delete, bind it to an app, or make it
  show the Mac's open apps. A bound page (⚡︎) opens while that app is in front on the Mac.
- **Dials and fader**: turn by touch, mouse wheel or trackpad; double-tap the volume dial to mute.
  Mac volume and noise cancelling as dials, brightness as a DJ-style fader
  (`"dials": ["volume", "anc", "brightness"]`). Brightness keys reach built-in and Apple displays
  only; macOS can't dim third-party monitors.
- **Focus / Do Not Disturb**: make a Shortcut named "Toggle Focus" (Shortcuts app → Set Focus → Do
  Not Disturb, Toggle) and put it on a Shortcut key.
- **Grid**: 4×3, 5×3, 6×4 or 8×4 (tap the size in Edit). Works in landscape and portrait.

## Build the iPad app

```sh
cd app && npm install && cd ios && bundle exec pod install
open Helm.xcworkspace   # pick your team and the iPad; Release bundles the JS (no Metro needed)
```

## Bridge API

Unauthenticated: `GET /hello` → `{app, name, id}`, `POST /pair/start`, `POST /pair {code, device}` → `{token, name, id}`.
`id` is the bridge's stable random id (`id` file in the state folder); the iPad uses it to find a paired Mac
again over Bonjour when its address changes.
With `Authorization: Bearer <token>`: `GET /deck`, `PUT /deck`, `POST /run {action, id}`,
`GET /state`, `GET /apps`, `GET /shortcuts`, `GET /icon?app=Name|/path/To.app` (PNG), `GET /running`
(`[{name, path}]`), `GET /artwork` (current track's PNG).

`POST /run` answers when the action finishes or after 250ms, whichever comes first (`{ok, pending: true}` in
the second case). Slow actions (shortcuts, scripts) finish in the background and their effect arrives on `/live`.

Live state: WebSocket `GET /live` (same port, same bearer header). The first message is the full state,
`{"t":"state","state":{mac, headphones, toggles, …}}`. After that a key is sent again only when it changes
(`{"t":"state","state":{"mac":{…}}}`, merge it into what you have), right after each key press, and with
`{"t":"hb"}` plus a ping every 5s. Volume and mic changes arrive within ~100ms; everything else is polled
every second, and only while an iPad is connected. Close code 4001 means the iPad was unpaired.
`GET /state` still returns the full state in one request.
State: `~/Library/Application Support/Helm/` (`deck.json`, `tokens.json` with hashed tokens, `id`,
`icons/`, `bin/mediakey`).

## Test

```sh
cd bridge && npm test                     # recording exec: nothing runs on the Mac
cd app && npx jest && npx tsc --noEmit
```
