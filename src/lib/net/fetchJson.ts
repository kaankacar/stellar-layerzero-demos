/**
 * Small fetch wrapper used by every network call in the app: timeout, retry
 * with backoff, and a typed error carrying the HTTP status and body so pages
 * can degrade gracefully instead of white-screening.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: unknown,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
  init?: RequestInit;
  /** Retry on these statuses (default: 429 and 5xx). */
  retryOn?: (status: number) => boolean;
}

const defaultRetryOn = (status: number) => status === 429 || status >= 500;

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 15_000, retries = 2, init, retryOn = defaultRetryOn } = opts;
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = await res.text().catch(() => null);
        }
        const err = new HttpError(res.status, url, body);
        if (retryOn(res.status) && attempt < retries) {
          lastError = err;
          await sleep(300 * 2 ** attempt);
          attempt += 1;
          continue;
        }
        throw err;
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HttpError) throw err;
      lastError = err;
      if (attempt >= retries) break;
      await sleep(300 * 2 ** attempt);
      attempt += 1;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}

export async function postJson<T>(url: string, body: unknown, opts: FetchJsonOptions = {}): Promise<T> {
  return fetchJson<T>(url, {
    ...opts,
    retries: opts.retries ?? 0,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.init?.headers ?? {}) },
      body: JSON.stringify(body),
      ...opts.init,
    },
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function errorMessage(err: unknown): string {
  if (err instanceof HttpError) {
    const detail =
      typeof err.body === 'object' && err.body !== null && 'message' in err.body
        ? String((err.body as { message: unknown }).message)
        : '';
    return `HTTP ${err.status}${detail ? `: ${detail}` : ''}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
