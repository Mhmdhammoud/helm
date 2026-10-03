import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import type { Action, Deck, Mac, RunningApp, State } from './types';

const Native = NativeModules.HelmNative as {
  browse(timeoutMs: number): Promise<{ name: string; host: string; port: number }[]>;
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
  getConstants?: () => { deviceName: string };
  deviceName?: string;
};
export const deviceName = Native.getConstants?.().deviceName ?? Native.deviceName ?? 'iPad';
export const browse = (ms = 2500) => Native.browse(ms);

const base = (m: { host: string; port: number }) => `http://${m.host}:${m.port}`;

async function request(m: { host: string; port: number; token?: string }, method: string, path: string, body?: unknown, timeoutMs = 10000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let r: Response;
  try {
    r = await fetch(base(m) + path, {
      method,
      headers: { 'content-type': 'application/json', ...(m.token && { authorization: `Bearer ${m.token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });
  } catch (e) {
    throw abort.signal.aborted ? new Error(`${m.host} did not answer`) : e;
  } finally {
    clearTimeout(timer);
  }
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(json.error ?? `HTTP ${r.status}`), { status: r.status });
  return json;
}

export const pairStart = (m: { host: string; port: number }) => request(m, 'POST', '/pair/start');
export const pairFinish = async (m: { name: string; host: string; port: number }, code: string): Promise<Mac> => {
  const { token, name, id } = await request(m, 'POST', '/pair', { code, device: deviceName });
  return { name: name ?? m.name, host: m.host, port: m.port, token, id };
};

export function client(m: Mac) {
  return {
    mac: m,
    deck: (): Promise<Deck> => request(m, 'GET', '/deck'),
    saveDeck: (d: Deck): Promise<Deck> => request(m, 'PUT', '/deck', d),
    run: (action: Action, id?: string) => request(m, 'POST', '/run', { action, id }),
    state: (): Promise<State> => request(m, 'GET', '/state'),
    apps: (): Promise<string[]> => request(m, 'GET', '/apps'),
    shortcuts: (): Promise<string[]> => request(m, 'GET', '/shortcuts'),
    icon: (app: string) => ({ uri: `${base(m)}/icon?app=${encodeURIComponent(app)}`, headers: { authorization: `Bearer ${m.token}` } }),
    artwork: (v: string) => ({ uri: `${base(m)}/artwork?v=${encodeURIComponent(v)}`, headers: { authorization: `Bearer ${m.token}` } }),
    running: (): Promise<RunningApp[]> => request(m, 'GET', '/running'),
  };
}
export type Client = ReturnType<typeof client>;

/** Paired Macs and which one is active, persisted on the iPad. */
export function useMacs() {
  const [store, setStore] = useState<{ macs: Mac[]; current: string | null } | null>(null);
  useEffect(() => {
    Native.load().then(s => setStore(s ? JSON.parse(s) : { macs: [], current: null }), () => setStore({ macs: [], current: null }));
  }, []);
  const update = useCallback((next: { macs: Mac[]; current: string | null }) => {
    setStore(next);
    Native.save(JSON.stringify(next));
  }, []);
  // useLive found the Mac at a new address, or learned its bridge id (Macs paired before ids existed).
  useEffect(() => {
    const onMoved = (from: Mac, to: Mac) => setStore(s => {
      if (!s) return s;
      const next = { macs: s.macs.map(m => (m.token === from.token ? to : m)), current: s.current === from.host ? to.host : s.current };
      Native.save(JSON.stringify(next));
      return next;
    });
    moved.add(onMoved);
    return () => { moved.delete(onMoved); };
  }, []);
  const current = store?.macs.find(m => m.host === store.current) ?? null;
  return {
    loaded: store !== null,
    macs: store?.macs ?? [],
    current,
    add: (m: Mac) => update({ macs: [...(store?.macs ?? []).filter(x => x.host !== m.host && !(m.id && x.id === m.id)), m], current: m.host }),
    select: (host: string | null) => store && update({ ...store, current: host }),
    forget: (host: string) => store && update({ macs: store.macs.filter(m => m.host !== host), current: store.current === host ? null : store.current }),
  };
}

const moved = new Set<(from: Mac, to: Mac) => void>();

/** Finds a paired Mac again over Bonjour after its address stopped answering: by bridge id, or by name for Macs paired before ids. */
async function rematch(m: Mac): Promise<Mac | null> {
  const found = await browse(2500).catch(() => []);
  const hellos = await Promise.all(found.map(f => request(f, 'GET', '/hello', undefined, 1500).then(h => ({ ...f, ...h }), () => null)));
  const hit = hellos.find(h => h && (m.id ? h.id === m.id : h.name === m.name));
  return hit && (hit.host !== m.host || hit.port !== m.port) ? { ...m, host: hit.host, port: hit.port, id: hit.id ?? m.id } : null;
}

export type Status = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'unauthorized';
const UNPAIRED = 'This Mac no longer knows this iPad. Pair again.';
const CONNECT_MS = 4000; // give up on a connection attempt
const STALE_MS = 12000; // the bridge sends a heartbeat every 5s; silence this long means the link is dead
const OFFLINE_AFTER = 3; // failed attempts before 'reconnecting' becomes 'offline' and Bonjour is searched again

/**
 * Live state pushed from the bridge over a WebSocket on /live: auto-reconnect with backoff, heartbeat stale
 * detection, Bonjour rematch when the Mac moves, and a fresh connection whenever the app comes to the front.
 * `error` is set only when it's worth showing (offline, unauthorized); `lastError` is the latest failure.
 */
export function useLive(api: Client | null) {
  const [state, setState] = useState<State | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const liveRef = useRef(false);
  const pairing = useRef<string | null>(null);

  // Pushed state needs no refresh; this is the fallback while the socket is down.
  const refresh = useCallback(async () => {
    if (!apiRef.current || liveRef.current) return;
    try {
      setState(await apiRef.current.state());
    } catch (e: any) {
      setLastError(e.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    if (!api) {
      setStatus('offline');
      return;
    }
    const m = api.mac;
    if (pairing.current !== m.token) { pairing.current = m.token; setState(null); } // a moved Mac keeps its state
    liveRef.current = false;
    setStatus('connecting');
    let ws: WebSocket | null = null;
    let retry = 0;
    let stale = 0;
    let fails = 0;
    let lastMsg = 0;
    let stopped = false; // unmounted, switched Mac, or unpaired
    const report = (s: Status, err: string | null) => {
      if (stopped) return;
      liveRef.current = s === 'live';
      setStatus(s);
      setLastError(err);
    };
    const unpaired = () => { report('unauthorized', UNPAIRED); stopped = true; };

    const hangUp = () => {
      clearTimeout(stale);
      if (!ws) return;
      const sock = ws;
      ws = null;
      sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
      sock.close();
    };

    const failed = async (why: string) => {
      hangUp();
      if (stopped) return;
      fails++;
      // Plain HTTP tells "unpaired" from "unreachable" (an upgrade refusal hides the status), and keeps state fresh.
      try {
        setState(await api.state());
      } catch (e: any) {
        if (e.status === 401) return unpaired();
        why = e.message ?? why;
        if (fails % OFFLINE_AFTER === 0) {
          const there = await rematch(m);
          if (there && !stopped) return moved.forEach(f => f(m, there)); // useMacs saves it; a new api reconnects
        }
      }
      if (stopped || ws) return; // the app came to the front meanwhile and already reconnected
      report(fails >= OFFLINE_AFTER ? 'offline' : 'reconnecting', why);
      clearTimeout(retry);
      retry = setTimeout(connect, Math.min(500 * 2 ** (fails - 1), 8000));
    };

    function connect() {
      if (stopped) return;
      hangUp();
      // RN's WebSocket takes headers as a third argument (not in the browser API).
      const sock = new (WebSocket as any)(`ws://${m.host}:${m.port}/live`, null, { headers: { authorization: `Bearer ${m.token}` } }) as WebSocket;
      ws = sock;
      const watchdog = (ms: number) => { clearTimeout(stale); stale = setTimeout(() => failed('connection timed out'), ms); };
      watchdog(CONNECT_MS);
      sock.onmessage = e => {
        lastMsg = Date.now();
        watchdog(STALE_MS);
        const msg = JSON.parse(String(e.data));
        if (msg.t !== 'state') return;
        setState(s => ({ ...s, ...msg.state }) as State);
        if (!liveRef.current) {
          fails = 0;
          report('live', null);
          if (!m.id) request(m, 'GET', '/hello').then(h => h.id && moved.forEach(f => f(m, { ...m, id: h.id })), () => {});
        }
      };
      sock.onclose = (e: any) => (e.code === 4001 ? (hangUp(), unpaired()) : failed(e.reason || 'connection lost'));
    }

    connect();
    const sub = AppState.addEventListener('change', s => {
      if (stopped) return;
      if (s === 'background') { clearTimeout(retry); hangUp(); liveRef.current = false; return; }
      // iOS suspends sockets in the background; on return reconnect unless the link is provably alive.
      if (s === 'active' && (!ws || Date.now() - lastMsg > 6000)) {
        fails = 0;
        clearTimeout(retry);
        report(lastMsg ? 'reconnecting' : 'connecting', null);
        connect();
      }
    });
    return () => {
      stopped = true;
      liveRef.current = false;
      clearTimeout(retry);
      hangUp();
      sub.remove();
    };
  }, [api]);

  const error = status === 'offline' || status === 'unauthorized' ? lastError : null;
  return { state, error, refresh, status, lastError };
}
