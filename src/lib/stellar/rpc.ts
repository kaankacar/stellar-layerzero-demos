/**
 * Soroban RPC access with failover across public endpoints. Mainnet has three
 * CORS-open public RPCs; we try them in order and remember which one worked.
 */
import { rpc } from '@stellar/stellar-sdk';
import { STELLAR, type StellarEnv } from '@/config/networks';

const servers = new Map<string, rpc.Server>();
const preferred: Record<StellarEnv, number> = { mainnet: 0, testnet: 0 };

export function rpcServer(url: string): rpc.Server {
  let s = servers.get(url);
  if (!s) {
    s = new rpc.Server(url, { allowHttp: url.startsWith('http://') });
    servers.set(url, s);
  }
  return s;
}

export function currentRpcUrl(env: StellarEnv): string {
  const urls = STELLAR[env].rpcUrls;
  return urls[preferred[env] % urls.length]!;
}

/** Public RPCs rate-limit bursts (and 429 responses often lack CORS headers), so cap in-flight calls. */
const MAX_IN_FLIGHT = 4;
const inFlight: Record<StellarEnv, number> = { mainnet: 0, testnet: 0 };
const waiters: Record<StellarEnv, (() => void)[]> = { mainnet: [], testnet: [] };
async function acquire(env: StellarEnv) {
  if (inFlight[env] < MAX_IN_FLIGHT) {
    inFlight[env] += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters[env].push(resolve));
  inFlight[env] += 1;
}
function release(env: StellarEnv) {
  inFlight[env] -= 1;
  waiters[env].shift()?.();
}

// snippet:start withRpc
/** Run `fn` against the first RPC that answers; rotate on network-level failures. */
export async function withRpc<T>(env: StellarEnv, fn: (server: rpc.Server, url: string) => Promise<T>): Promise<T> {
  await acquire(env);
  try {
    return await withRpcUnbounded(env, fn);
  } finally {
    release(env);
  }
}

async function withRpcUnbounded<T>(env: StellarEnv, fn: (server: rpc.Server, url: string) => Promise<T>): Promise<T> {
  const urls = STELLAR[env].rpcUrls;
  let lastErr: unknown;
  for (let i = 0; i < urls.length; i++) {
    const idx = (preferred[env] + i) % urls.length;
    const url = urls[idx]!;
    try {
      const out = await fn(rpcServer(url), url);
      preferred[env] = idx;
      return out;
    } catch (err) {
      lastErr = err;
      // Contract-level failures are deterministic: do not retry them elsewhere.
      if (err instanceof Error && err.name === 'SimulationError') throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('all RPC endpoints failed');
}
// snippet:end withRpc

export async function rpcHealth(env: StellarEnv) {
  return withRpc(env, async (s, url) => ({ url, ...(await s.getHealth()) }));
}
