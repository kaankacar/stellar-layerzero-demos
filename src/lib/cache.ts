/**
 * localStorage-backed TTL cache with stale-while-revalidate semantics.
 *
 * Every page's data hook resolves to a `Loaded<T>`:
 *  - live:        fetched just now
 *  - stale:       the network failed, but we had a cached copy (age shown)
 *  - unavailable: the network failed and there was no cache or fallback
 * so the UI can always render something and say how fresh it is.
 */
export type LoadStatus = 'loading' | 'live' | 'stale' | 'fallback' | 'unavailable';

export interface Loaded<T> {
  status: LoadStatus;
  data: T | null;
  error: string | null;
  fetchedAt: number | null;
}

export interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

const PREFIX = 'lz-stellar:';

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (typeof parsed?.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PREFIX + key, JSON.stringify({ value, fetchedAt: Date.now() } satisfies CacheEntry<T>));
  } catch {
    // Quota exceeded or private mode: caching is best-effort.
  }
}

export interface LoadWithCacheOptions<T> {
  key: string;
  ttlMs: number;
  fetcher: () => Promise<T>;
  /** Bundled data to fall back on when there is no network and no cache. */
  fallback?: T;
  /** Skip the cache and always hit the network (still writes the cache). */
  force?: boolean;
}

// snippet:start loadWithCache
export async function loadWithCache<T>(opts: LoadWithCacheOptions<T>): Promise<Loaded<T>> {
  const cached = readCache<T>(opts.key);
  const fresh = cached && Date.now() - cached.fetchedAt < opts.ttlMs;
  if (fresh && !opts.force) {
    return { status: 'live', data: cached.value, error: null, fetchedAt: cached.fetchedAt };
  }
  try {
    const value = await opts.fetcher();
    writeCache(opts.key, value);
    return { status: 'live', data: value, error: null, fetchedAt: Date.now() };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (cached) return { status: 'stale', data: cached.value, error, fetchedAt: cached.fetchedAt };
    if (opts.fallback !== undefined) return { status: 'fallback', data: opts.fallback, error, fetchedAt: null };
    return { status: 'unavailable', data: null, error, fetchedAt: null };
  }
}
// snippet:end loadWithCache

export const LOADING: Loaded<never> = { status: 'loading', data: null, error: null, fetchedAt: null };
