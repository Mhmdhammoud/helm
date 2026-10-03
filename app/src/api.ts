import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';
import type { Action, Deck, Mac, State } from './types';

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

async function request(m: { host: string; port: number; token?: string }, method: string, path: string, body?: unknown) {
  const r = await fetch(base(m) + path, {
    method,
    headers: { 'content-type': 'application/json', ...(m.token && { authorization: `Bearer ${m.token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(json.error ?? `HTTP ${r.status}`), { status: r.status });
  return json;
}

export const pairStart = (m: { host: string; port: number }) => request(m, 'POST', '/pair/start');
export const pairFinish = async (m: { name: string; host: string; port: number }, code: string): Promise<Mac> => {
  const { token, name } = await request(m, 'POST', '/pair', { code, device: deviceName });
  return { name: name ?? m.name, host: m.host, port: m.port, token };
};

export function client(m: Mac) {
  return {
    deck: (): Promise<Deck> => request(m, 'GET', '/deck'),
    saveDeck: (d: Deck): Promise<Deck> => request(m, 'PUT', '/deck', d),
    run: (action: Action, id?: string) => request(m, 'POST', '/run', { action, id }),
    state: (): Promise<State> => request(m, 'GET', '/state'),
    apps: (): Promise<string[]> => request(m, 'GET', '/apps'),
    shortcuts: (): Promise<string[]> => request(m, 'GET', '/shortcuts'),
    icon: (app: string) => ({ uri: `${base(m)}/icon?app=${encodeURIComponent(app)}`, headers: { authorization: `Bearer ${m.token}` } }),
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
  const current = store?.macs.find(m => m.host === store.current) ?? null;
  return {
    loaded: store !== null,
    macs: store?.macs ?? [],
    current,
    add: (m: Mac) => update({ macs: [...(store?.macs ?? []).filter(x => x.host !== m.host), m], current: m.host }),
    select: (host: string | null) => store && update({ ...store, current: host }),
    forget: (host: string) => store && update({ macs: store.macs.filter(m => m.host !== host), current: store.current === host ? null : store.current }),
  };
}

// ponytail: 1s polling over the LAN; switch to a WebSocket push if it ever feels laggy.
export function useLive(api: Client | null) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const refresh = useCallback(async () => {
    if (!apiRef.current) return;
    try {
      setState(await apiRef.current.state());
      setError(null);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, []);
  useEffect(() => {
    setState(null);
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [api, refresh]);
  return { state, error, refresh };
}
