import { useCallback, useEffect, useRef, useState } from 'react';
import { LOADING, type Loaded } from '@/lib/cache';

/** Run a `Loaded<T>`-returning loader on mount (and when deps change) with a reload handle. */
export function useLoader<T>(loader: (force: boolean) => Promise<Loaded<T>>, deps: readonly unknown[]): Loaded<T> & { reload: () => void; loading: boolean } {
  const [state, setState] = useState<Loaded<T>>(LOADING as Loaded<T>);
  const [tick, setTick] = useState(0);
  const forceRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    loader(forceRef.current)
      .then((r) => {
        if (!cancelled) setState(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'unavailable', data: null, error: e instanceof Error ? e.message : String(e), fetchedAt: null });
      });
    forceRef.current = false;
    return () => {
      cancelled = true;
    };
  }, [tick, ...deps]);
  const reload = useCallback(() => {
    forceRef.current = true;
    setTick((t) => t + 1);
  }, []);
  return { ...state, reload, loading: state.status === 'loading' };
}

export type AsyncStatus = 'idle' | 'loading' | 'done' | 'error';
export interface AsyncState<T> {
  status: AsyncStatus;
  value: T | null;
  error: string | null;
}
/** Imperative async action state (button-triggered work). */
export function useAsyncAction<Args extends unknown[], T>(fn: (...args: Args) => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'idle', value: null, error: null });
  const run = useCallback(
    async (...args: Args) => {
      setState({ status: 'loading', value: null, error: null });
      try {
        const value = await fn(...args);
        setState({ status: 'done', value, error: null });
        return value;
      } catch (e) {
        setState({ status: 'error', value: null, error: e instanceof Error ? e.message : String(e) });
        return null;
      }
    },
    [fn],
  );
  const reset = useCallback(() => setState({ status: 'idle', value: null, error: null }), []);
  return { ...state, run, reset };
}

/** Simple wrapper for direct promise loaders (no cache) into Loaded<T>. */
export async function toLoaded<T>(p: Promise<T>): Promise<Loaded<T>> {
  try {
    const data = await p;
    return { status: 'live', data, error: null, fetchedAt: Date.now() };
  } catch (e) {
    return { status: 'unavailable', data: null, error: e instanceof Error ? e.message : String(e), fetchedAt: null };
  }
}
