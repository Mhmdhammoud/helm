import { useEffect, useState } from 'react';
import type { Client } from './api';
import type { Key, Page, RunningApp } from './types';

/** One key per running app: its icon, tap to bring it to the front. */
export const runningKeys = (apps: RunningApp[]): Record<string, Key> =>
  Object.fromEntries(apps.map((a, i) => [String(i), { title: a.name, icon: { app: a.path }, action: { type: 'open', target: a.path } }]));

/** The keys a page shows: its own, or for a `running` page (outside Edit) the Mac's running apps, refreshed every 3s. */
export function usePageKeys(api: Client, page: Page, editing: boolean): Record<string, Key> {
  const live = page.kind === 'running' && !editing;
  const [apps, setApps] = useState<RunningApp[]>([]);
  useEffect(() => {
    if (!live) return;
    let on = true;
    const load = () => api.running().then(a => on && setApps(a), () => {});
    load();
    const t = setInterval(load, 3000);
    return () => { on = false; clearInterval(t); };
  }, [api, live]);
  return live ? runningKeys(apps) : page.keys;
}
