import { useCallback, useEffect, useRef, useState } from 'react';
import config from './config.json';

// Shapes come from the Hush app's state.json (see ../../src/useHeadset.ts) plus the bridge's Mac block.
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
export type Mac = { volume?: number; micMuted?: boolean; error?: string };
export type State = { headphones: Headphones; mac: Mac };

const BASE = `http://${config.host}:${config.port}`;
const HEADERS = { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' };

async function call(path: string, body?: object) {
  const r = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: HEADERS,
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.json().catch(() => ({}))).error ?? ''}`.trim());
  return r.json();
}

// ponytail: 1s polling over the LAN; switch the bridge to a WebSocket push if it ever feels laggy.
const POLL_MS = 1000;

export function useBridge() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await call('/state'));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Latest-wins per command family, so dragging a dial sends at most one command per 120ms.
  const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const hush = useCallback(
    (cmd: string) => {
      const key = cmd.split('/').slice(0, cmd.startsWith('eq/') ? 2 : 1).join('/');
      clearTimeout(pending.current[key]);
      pending.current[key] = setTimeout(() => {
        call('/hush', { cmd }).then(refresh, e => setError(e.message));
      }, 120);
    },
    [refresh],
  );

  const mac = useCallback(
    (action: string) =>
      call('/mac', { action }).then(
        r => setState(s => (s ? { ...s, mac: r.mac } : s)),
        e => setError(e.message),
      ),
    [],
  );

  return { state, error, hush, mac, host: config.host };
}
