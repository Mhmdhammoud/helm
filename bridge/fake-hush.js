#!/usr/bin/env node
// Stand-in for bin/hush in tests: keeps state in $HUSH_FAKE_STATE and applies writes to it.
// "Broken Phone" never connects, to exercise the not-confirmed path.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = process.env.HUSH_FAKE_STATE;
const s = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
  status: 'connected', error: null, name: 'Bose NC700', firmware: '1.8.4',
  anc: { level: 5, enabled: true }, battery: 80, hoursRemaining: 14,
  eq: { bass: 0, mid: 0, treble: 0 }, selfVoice: 'low',
  devices: [
    { mac: 'aa', name: 'MacBook Pro', connected: true, isHost: true },
    { mac: 'bb', name: "Alex's iPhone", connected: true, isHost: false },
    { mac: 'cc', name: 'iPad', connected: false, isHost: false },
    { mac: 'dd', name: 'Broken Phone', connected: false, isHost: false },
  ],
  inCall: false, callMode: false, updatedAt: '2026-10-03T00:00:00Z',
};
const [cmd, a, b] = process.argv.slice(2).map(decodeURIComponent); // like the app's URL handler
const clamp = n => Math.max(0, Math.min(10, n));
switch (cmd) {
  case 'status': console.log(JSON.stringify(s)); process.exit(0);
  case 'anc': s.anc.level = a === 'up' ? clamp(s.anc.level + 1) : a === 'down' ? clamp(s.anc.level - 1) : Number(a); break;
  case 'eq': if (a === 'flat') s.eq = { bass: 0, mid: 0, treble: 0 }; else s.eq[a] = Number(b); break;
  case 'selfvoice': s.selfVoice = a; break;
  case 'callmode': s.callMode = a === 'on'; break;
  case 'conversation': s.conversation = a === 'on'; break;
  case 'switch': {
    const d = s.devices.find(d => d.name === a);
    if (d && d.name !== 'Broken Phone') {
      s.devices.forEach(x => { if (!x.isHost) x.connected = false; });
      d.connected = true;
    }
    break;
  }
  default: console.error(`unknown command: ${cmd}`); process.exit(2);
}
writeFileSync(file, JSON.stringify(s));
