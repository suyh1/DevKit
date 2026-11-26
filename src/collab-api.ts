import { useCallback, useEffect, useRef, useState } from 'react';
import { remoteRequest } from './workspace-remote';

export type CollabModule = 'transfer' | 'mock' | 'whiteboard' | 'relay';
export type PageProps = { active: boolean; edit: boolean };
declare global {
  interface Window {
    devkitCollab?: {
      request(module: CollabModule, action: string, input?: unknown): Promise<{ data?: unknown; error?: string }>;
    };
  }
}
export async function collab<T>(module: CollabModule, action: string, input?: unknown): Promise<T> {
  if (!window.devkitCollab) return remoteRequest<T>(module, action, input);
  const result = await window.devkitCollab.request(module, action, input);
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

// A slow poll must never replace a newer response or apply after leaving the page.
export function useLive<T>(active: boolean, load: () => Promise<T>, interval = 2200) {
  const [value, setValue] = useState<T>(),
    [error, setError] = useState('');
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const data = await load();
      if (seq === sequence.current) {
        setValue(data);
        setError('');
      }
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    }
  }, [load]);
  useEffect(() => {
    if (!active) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) await refresh();
      if (live) timer = setTimeout(poll, interval);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
      sequence.current++;
    };
  }, [active, refresh, interval]);
  return { value, refresh, error };
}
export function useCollabList<T>(module: CollabModule, active: boolean) {
  const cache = useRef<{ version?: string; items: T[] }>({ items: [] });
  return useLive(
    active,
    useCallback(async () => {
      const result = await collab<{ version: string; items?: T[] }>(module, 'list', {
        sync: true,
        version: cache.current.version,
      });
      if (result.items) cache.current = { version: result.version, items: result.items };
      return cache.current.items;
    }, [module]),
  );
}
export function useOperation() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function run(job: () => Promise<void | string>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      setMessage((await job()) || '');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, message, run, clear: () => setMessage('') };
}
