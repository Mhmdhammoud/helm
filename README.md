# Helm

An iPad control surface for the desk: a touch dial for the Hush headphones (noise cancelling,
EQ, self voice, conversation, call mode, device switching) plus a few Mac buttons (mic mute,
volume, open Claude, sleep display).

- `app/`: React Native 0.83 + react-native-skia iPad app (landscape, iPad only, bundle `app.helm.ipad`)
- `bridge/`: Mac-side HTTP bridge, Node stdlib only. Headphone commands go through Hush's
  `bin/hush` (the Hush menu-bar app does the Bluetooth work); Mac actions are a fixed allow-list.

## Run

```sh
node bridge/server.js --pair   # once: writes app/src/config.json (Mac hostname, port, token)
node bridge/server.js          # keep running on the Mac (port 7733)

cd app && npm install && cd ios && pod install
open Helm.xcworkspace          # pick your team, choose the iPad, Run (Release to bundle the JS)
```

Every request needs the bearer token from `~/Library/Application Support/Helm/token`.
Env: `HUSH_CLI` (default `~/Documents/projects/lab/hush/bin/hush`), `HELM_PORT` (7733),
`HELM_TOKEN_FILE`.

## API

- `GET /state` → `{ headphones: <Hush state.json>, mac: { volume, micMuted } }`
- `POST /hush {cmd}`: the `hush://` command language (`anc/7`, `eq/bass/-3`, `eq/flat`,
  `selfvoice/low`, `switch/iPad`, `callmode/on`, `conversation/on`), validated before it runs
- `POST /mac {action}`: `mic`, `volume-up`, `volume-down`, `claude`, `sleep-display`

## Test

```sh
cd bridge && npm test   # runs against fake-hush.js and a stub Mac, touches nothing real
cd app && npx jest && npx tsc --noEmit
```
