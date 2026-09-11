/**
 * Typed client for the LayerZero Scan API (the backend of layerzeroscan.com).
 *
 * Mainnet: https://scan.layerzero-api.com/v1   Testnet: https://scan-testnet.layerzero-api.com/v1
 * OpenAPI spec: GET /v1/openapi. CORS is open, so the browser calls it directly.
 * Stellar OApp addresses appear as the 0x-hex of the 32-byte contract id.
 */
import { SCAN, type ScanEnv } from '@/config/networks';
import { fetchJson } from '@/lib/net/fetchJson';
import type { MessageStatus } from '@/lib/layerzero/status';

export interface ScanTx {
  /** Missing while Scan has indexed the message by GUID but not yet linked the source tx. */
  txHash?: string;
  blockHash?: string;
  blockNumber?: number | string;
  blockTimestamp?: number;
  from?: string;
  payload?: string;
  blockConfirmations?: number | null;
}
export interface ScanParty {
  address: string;
  id?: string;
  name?: string;
  chain: string;
}
export interface ScanDvnAttestation {
  txHash?: string;
  blockHash?: string;
  blockNumber?: number | string;
  blockTimestamp?: number;
  optional?: boolean;
  status: string;
  proof?: { packetHeader?: string; payloadHash?: string };
}
export interface ScanUlnConfig {
  confirmations?: number;
  requiredDVNCount?: number;
  optionalDVNCount?: number;
  optionalDVNThreshold?: number;
  requiredDVNs?: string[];
  requiredDVNNames?: string[];
  optionalDVNs?: string[];
  optionalDVNNames?: string[];
  executor?: string;
}
export interface ScanMessage {
  guid: string;
  status: { name: MessageStatus | string; message?: string };
  pathway: {
    id?: string;
    srcEid: number;
    dstEid: number;
    nonce?: number;
    sender: ScanParty;
    receiver: ScanParty;
  };
  source: { status?: string; tx: ScanTx };
  destination: { status?: string; tx?: ScanTx | null; lzCompose?: unknown; nativeDrop?: unknown };
  verification?: {
    dvn?: { dvns: Record<string, ScanDvnAttestation>; status?: string };
    sealer?: { tx?: ScanTx; status?: string };
  };
  config?: {
    error?: boolean;
    inboundConfig?: ScanUlnConfig;
    outboundConfig?: ScanUlnConfig;
    sendLibrary?: string;
    receiveLibrary?: string;
    ulnSendVersion?: string;
    ulnReceiveVersion?: string;
  };
  created?: string;
  updated?: string;
}
export interface ScanPage {
  data: ScanMessage[];
  nextToken?: string | null;
}

export interface LatestParams {
  limit?: number;
  srcChainIds?: number | string;
  dstChainIds?: number | string;
  srcOrDstOAppAddress?: string;
  srcOrDstOAppId?: string;
  srcAddress?: string;
  start?: string;
  end?: string;
  nextToken?: string;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return q ? `?${q}` : '';
};

export const scanApi = (env: ScanEnv) => SCAN[env].api;

// snippet:start scanByTx
/** Look up every message created or delivered by a transaction (Stellar hashes have no 0x). */
export async function getMessagesByTx(env: ScanEnv, txHash: string): Promise<ScanMessage[]> {
  const page = await fetchJson<ScanPage>(`${scanApi(env)}/messages/tx/${txHash.trim()}`, { retries: 1 });
  return page.data ?? [];
}
// snippet:end scanByTx

export async function getMessageByGuid(env: ScanEnv, guid: string): Promise<ScanMessage[]> {
  const page = await fetchJson<ScanPage>(`${scanApi(env)}/messages/guid/${guid.trim()}`, { retries: 1 });
  return page.data ?? [];
}

export async function getMessagesByWallet(env: ScanEnv, address: string, limit = 20): Promise<ScanPage> {
  return fetchJson<ScanPage>(`${scanApi(env)}/messages/wallet/${address.trim()}${qs({ limit })}`, { retries: 1 });
}

/** Messages sent or received by an OApp; `address` is 0x-hex for Stellar contracts. */
export async function getMessagesByOApp(env: ScanEnv, eid: number, address: string, limit = 20, nextToken?: string): Promise<ScanPage> {
  return fetchJson<ScanPage>(`${scanApi(env)}/messages/oapp/${eid}/${address}${qs({ limit, nextToken })}`, { retries: 1 });
}

// snippet:start scanLatest
/** Latest messages with filters, e.g. `{ srcChainIds: 30600 }` for everything leaving Stellar. */
export async function getLatestMessages(env: ScanEnv, params: LatestParams = {}): Promise<ScanPage> {
  return fetchJson<ScanPage>(`${scanApi(env)}/messages/latest${qs({ ...params })}`, { retries: 1 });
}
// snippet:end scanLatest

export async function getMessagesByPathway(env: ScanEnv, pathwayId: string, limit = 20): Promise<ScanPage> {
  return fetchJson<ScanPage>(`${scanApi(env)}/messages/pathway/${pathwayId}${qs({ limit })}`, { retries: 1 });
}

export type LookupKind = 'tx' | 'guid' | 'wallet';

/** Decide what the user pasted: a 0x GUID/tx, a Stellar tx hash, or a wallet address. */
export function classifyLookup(input: string): { kind: LookupKind; value: string } | null {
  const v = input.trim();
  if (!v) return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return { kind: 'tx', value: v }; // EVM tx hash or GUID; tx endpoint tried first
  if (/^[0-9a-fA-F]{64}$/.test(v)) return { kind: 'tx', value: v }; // Stellar tx hash
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return { kind: 'wallet', value: v };
  if (/^G[A-Z2-7]{55}$/.test(v)) return { kind: 'wallet', value: v };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return { kind: 'wallet', value: v }; // Solana base58
  return null;
}

export function isStellarEid(eid: number): boolean {
  return eid === 30600 || eid === 40600;
}

/** Timestamps at each lifecycle stage, in seconds, when the API reports them. */
export function stageTimestamps(m: ScanMessage) {
  const dvnTimes = Object.values(m.verification?.dvn?.dvns ?? {})
    .map((d) => d.blockTimestamp)
    .filter((t): t is number => typeof t === 'number');
  return {
    source: m.source.tx?.blockTimestamp,
    dvnFirst: dvnTimes.length ? Math.min(...dvnTimes) : undefined,
    dvnLast: dvnTimes.length ? Math.max(...dvnTimes) : undefined,
    commit: m.verification?.sealer?.tx?.blockTimestamp,
    destination: m.destination.tx?.blockTimestamp,
  };
}
