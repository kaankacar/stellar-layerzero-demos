import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanEnv } from '@/config/networks';
import { classifyLookup, getMessageByGuid, getMessagesByTx, getMessagesByWallet, type ScanMessage } from '@/lib/layerzero/scan';
import { errorMessage, HttpError } from '@/lib/net/fetchJson';
import { findPacketSent } from '@/lib/stellar/packetEvents';
import { findPacketSentEvm } from '@/lib/stellar/deliver';
import { publicClient } from '@/lib/evm/clients';
import { EVM_TESTNETS } from '@/config/networks';

export const TERMINAL: ReadonlySet<string> = new Set(['DELIVERED', 'FAILED', 'BLOCKED', 'APPLICATION_BURNED', 'APPLICATION_SKIPPED', 'UNRESOLVABLE_COMMAND', 'MALFORMED_COMMAND']);

export interface TrackerState {
  messages: ScanMessage[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
  polling: boolean;
}

// snippet:start lookupMessages
/** Resolve whatever the user pasted into messages: tx hash (Stellar or EVM), GUID, or wallet. */
export async function lookupMessages(env: ScanEnv, input: string): Promise<ScanMessage[]> {
  const q = classifyLookup(input);
  if (!q) throw new Error('Paste a transaction hash, a LayerZero GUID (0x…64 hex), or a wallet address.');
  if (q.kind === 'wallet') return (await getMessagesByWallet(env, q.value, 20)).data;
  try {
    return await getMessagesByTx(env, q.value);
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
    if (q.value.startsWith('0x')) {
      // A 0x-prefixed 32-byte value may be a GUID rather than a tx hash…
      try {
        return await getMessageByGuid(env, q.value);
      } catch (e2) {
        if (!(e2 instanceof HttpError && e2.status === 404) || env !== 'testnet') throw e2;
        // …or an EVM-testnet tx Scan has not indexed yet: read its PacketSent event and look the GUID up.
        for (const chain of Object.values(EVM_TESTNETS)) {
          const packet = await findPacketSentEvm(publicClient(chain.key), q.value as `0x${string}`).catch(() => null);
          if (packet) return getMessageByGuid(env, packet.guid);
        }
        throw e2;
      }
    }
    // A Stellar tx hash: Scan may not have linked it yet, but the GUID is on-chain in the packet_sent event.
    const packet = await findPacketSent(env, q.value).catch(() => null);
    if (packet) return getMessageByGuid(env, packet.guid);
    throw e;
  }
}
// snippet:end lookupMessages

// snippet:start useMessageTracker
/** Fetch once, then poll every `intervalMs` while any message is still in flight. */
export function useMessageTracker(env: ScanEnv, input: string | null, intervalMs = 10_000): TrackerState & { refresh: () => void } {
  const [state, setState] = useState<TrackerState>({ messages: [], loading: false, error: null, lastFetched: null, polling: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async () => {
    if (!input) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const messages = await lookupMessages(env, input);
      const inflight = messages.some((m) => !TERMINAL.has(m.status.name));
      setState({ messages, loading: false, error: null, lastFetched: Date.now(), polling: inflight });
      if (inflight) timer.current = setTimeout(run, intervalMs);
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorMessage(e), polling: false }));
    }
  }, [env, input, intervalMs]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setState({ messages: [], loading: false, error: null, lastFetched: null, polling: false });
    void run();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [run]);

  return { ...state, refresh: () => void run() };
}
// snippet:end useMessageTracker
