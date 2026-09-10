/**
 * The LayerZero registry (metadata API) is the source of truth for every
 * contract address this site uses. This module fetches it, compacts it,
 * caches it, and falls back to a bundled snapshot so the app still renders
 * when the API is down. The Stellar testnet has been redeployed before; the
 * `diffStellarDeployment` helper powers the visible "registry check" badge.
 */
import { METADATA_API } from '@/config/networks';
import { STELLAR_FALLBACK, type StellarDeploymentFallback } from '@/config/layerzero.fallback';
import { fetchJson } from '@/lib/net/fetchJson';
import { loadWithCache, type Loaded } from '@/lib/cache';
import snapshotJson from '@/config/registry.snapshot.json';

export interface DeploymentAddresses {
  eid: number;
  stage: string;
  chainKey: string;
  endpointV2?: string;
  sendUln302?: string;
  receiveUln302?: string;
  executor?: string;
  executorHelper?: string;
  executorFeeLib?: string;
  pricefeed?: string;
  treasury?: string;
  dvnFeeLib?: string;
  blockedMessageLib?: string;
}
export interface DvnInfo {
  id: string;
  name: string;
  deprecated: boolean;
}
export interface ChainEntry {
  /** Outer registry key, e.g. "stellar-mainnet", "sepolia-testnet". */
  key: string;
  /** LayerZero chainKey as used by Scan, e.g. "stellar", "sepolia". */
  chainKey: string;
  chainType?: string;
  status?: string;
  nativeSymbol?: string;
  nativeDecimals?: number;
  explorer?: string;
  deployments: DeploymentAddresses[];
  /** DVN id (0x-hex) -> info. Only populated for FULL_KEYS to keep the snapshot small. */
  dvns: Record<string, DvnInfo>;
}
export interface RegistrySnapshot {
  fetchedAt: string;
  source: string;
  chains: Record<string, ChainEntry>;
}

/** Chains for which we keep DVN lists in the compact snapshot. */
export const FULL_KEYS = new Set([
  'stellar-mainnet',
  'stellar-testnet',
  'sepolia-testnet',
  'arbsep-testnet',
  'ethereum-mainnet',
  'arbitrum-mainnet',
  'polygon-mainnet',
  'optimism-mainnet',
  'plasma-mainnet',
]);

// ---- raw API shapes (only what we read) ----
interface RawAddress {
  address: string;
}
interface RawDeployment {
  version?: number;
  eid?: string | number;
  stage?: string;
  chainKey?: string;
  endpointV2?: RawAddress;
  sendUln302?: RawAddress;
  receiveUln302?: RawAddress;
  executor?: RawAddress;
  executorHelper?: RawAddress;
  executorFeeLib?: RawAddress;
  pricefeed?: RawAddress;
  treasury?: RawAddress;
  dvnFeeLib?: RawAddress;
  blockedMessageLib?: RawAddress;
}
interface RawChain {
  chainKey?: string;
  chainDetails?: {
    chainType?: string;
    chainStatus?: string;
    nativeCurrency?: { symbol?: string; decimals?: number };
  };
  deployments?: RawDeployment[];
  dvns?: Record<string, { canonicalName?: string; id?: string; deprecated?: boolean }>;
  blockExplorers?: { url: string }[];
}
export type RawRegistry = Record<string, RawChain>;

// snippet:start compactRegistry
/** Keep only what the site needs: v2 deployments for every chain, DVN names for a few. */
export function compactRegistry(raw: RawRegistry, fetchedAt = new Date().toISOString()): RegistrySnapshot {
  const chains: Record<string, ChainEntry> = {};
  for (const [key, c] of Object.entries(raw)) {
    const deployments: DeploymentAddresses[] = (c.deployments ?? [])
      .filter((d) => d.version === 2 && d.eid !== undefined)
      .map((d) => ({
        eid: Number(d.eid),
        stage: d.stage ?? '',
        chainKey: d.chainKey ?? c.chainKey ?? key,
        endpointV2: d.endpointV2?.address,
        sendUln302: d.sendUln302?.address,
        receiveUln302: d.receiveUln302?.address,
        executor: d.executor?.address,
        executorHelper: d.executorHelper?.address,
        executorFeeLib: d.executorFeeLib?.address,
        pricefeed: d.pricefeed?.address,
        treasury: d.treasury?.address,
        dvnFeeLib: d.dvnFeeLib?.address,
        blockedMessageLib: d.blockedMessageLib?.address,
      }));
    if (deployments.length === 0) continue;
    const full = FULL_KEYS.has(key);
    // Non-essential chains: keep the routing facts (eid, stage, endpoint) and drop the rest.
    const slimDeployments = full
      ? deployments
      : deployments.map((d) => ({ eid: d.eid, stage: d.stage, chainKey: d.chainKey, endpointV2: d.endpointV2 }));
    const dvns: Record<string, DvnInfo> = {};
    if (full) {
      for (const [id, d] of Object.entries(c.dvns ?? {})) {
        dvns[id] = { id, name: d.canonicalName ?? d.id ?? id, deprecated: d.deprecated === true };
      }
    }
    chains[key] = {
      key,
      chainKey: c.chainKey ?? key,
      chainType: c.chainDetails?.chainType,
      status: c.chainDetails?.chainStatus,
      nativeSymbol: c.chainDetails?.nativeCurrency?.symbol,
      nativeDecimals: c.chainDetails?.nativeCurrency?.decimals,
      explorer: c.blockExplorers?.[0]?.url,
      deployments: slimDeployments,
      dvns,
    };
  }
  return { fetchedAt, source: `${METADATA_API}/deployments`, chains };
}
// snippet:end compactRegistry

export const REGISTRY_SNAPSHOT = snapshotJson as unknown as RegistrySnapshot;
export const REGISTRY_TTL_MS = 15 * 60 * 1000;

// snippet:start loadRegistry
/** Live registry with a 15-minute cache; falls back to the bundled snapshot. */
export function loadRegistry(force = false): Promise<Loaded<RegistrySnapshot>> {
  return loadWithCache<RegistrySnapshot>({
    key: 'registry:v1',
    ttlMs: REGISTRY_TTL_MS,
    force,
    fetcher: async () => {
      const raw = await fetchJson<RawRegistry>(`${METADATA_API}/deployments`, { timeoutMs: 25_000, retries: 1 });
      return compactRegistry(raw);
    },
    fallback: REGISTRY_SNAPSHOT,
  });
}
// snippet:end loadRegistry

// ---- accessors ----
export type StellarStage = 'mainnet' | 'testnet';

export function stellarEntry(reg: RegistrySnapshot, stage: StellarStage): ChainEntry | undefined {
  return reg.chains[`stellar-${stage}`] ?? (stage === 'mainnet' ? reg.chains['stellar'] : undefined);
}

export function stellarDeployment(reg: RegistrySnapshot, stage: StellarStage): DeploymentAddresses | undefined {
  const entry = stellarEntry(reg, stage);
  return entry?.deployments.find((d) => d.stage === stage) ?? entry?.deployments[0];
}

const eidIndexCache = new WeakMap<RegistrySnapshot, Map<number, { chain: ChainEntry; deployment: DeploymentAddresses }>>();
function eidIndex(reg: RegistrySnapshot) {
  let idx = eidIndexCache.get(reg);
  if (!idx) {
    idx = new Map();
    for (const chain of Object.values(reg.chains)) {
      for (const d of chain.deployments) if (!idx.has(d.eid)) idx.set(d.eid, { chain, deployment: d });
    }
    eidIndexCache.set(reg, idx);
  }
  return idx;
}

export function findByEid(reg: RegistrySnapshot, eid: number) {
  return eidIndex(reg).get(eid);
}

export function chainByKey(reg: RegistrySnapshot, chainKey: string): ChainEntry | undefined {
  return Object.values(reg.chains).find((c) => c.chainKey === chainKey);
}

export function eidForChainKey(reg: RegistrySnapshot, chainKey: string, stage: 'mainnet' | 'testnet' = 'mainnet'): number | undefined {
  const c = chainByKey(reg, chainKey);
  return c?.deployments.find((d) => d.stage === stage)?.eid ?? c?.deployments[0]?.eid;
}

/** Human name for a chainKey: "arbitrum" -> "Arbitrum", "sepolia-testnet" -> "Sepolia". */
export function displayName(chainKey: string | undefined): string {
  if (!chainKey) return 'Unknown';
  const special: Record<string, string> = {
    bsc: 'BNB Chain',
    hyperliquid: 'HyperEVM',
    bera: 'Berachain',
    xlayer: 'X Layer',
    arbsep: 'Arbitrum Sepolia',
    'arbitrum-sepolia': 'Arbitrum Sepolia',
    'stellar-testnet': 'Stellar Testnet',
    sepolia: 'Sepolia',
  };
  if (special[chainKey]) return special[chainKey]!;
  return chainKey
    .replace(/-(mainnet|testnet)$/, '')
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function eidLabel(reg: RegistrySnapshot | null, eid: number): string {
  const hit = reg ? findByEid(reg, eid) : undefined;
  return hit ? `${displayName(hit.chain.chainKey)} (${eid})` : `EID ${eid}`;
}

export function dvnName(reg: RegistrySnapshot | null, stage: StellarStage, dvnId: string): string {
  const fromReg = reg ? stellarEntry(reg, stage)?.dvns[dvnId.toLowerCase()] : undefined;
  if (fromReg) return fromReg.deprecated ? `${fromReg.name} (deprecated)` : fromReg.name;
  const fb = STELLAR_FALLBACK[stage].dvns[dvnId.toLowerCase()];
  if (fb) return fb.deprecated ? `${fb.name} (deprecated)` : fb.name;
  return `${dvnId.slice(0, 10)}…`;
}

export function activeDvns(reg: RegistrySnapshot | null, stage: StellarStage): DvnInfo[] {
  const entry = reg ? stellarEntry(reg, stage) : undefined;
  const list = entry
    ? Object.values(entry.dvns)
    : Object.entries(STELLAR_FALLBACK[stage].dvns).map(([id, d]) => ({ id, name: d.name, deprecated: d.deprecated }));
  return list.filter((d) => !d.deprecated);
}

export interface DeploymentDiff {
  field: keyof StellarDeploymentFallback;
  live: string | undefined;
  fallback: string;
  changed: boolean;
}

// snippet:start diffStellarDeployment
/** Compare the live registry with the addresses documented in this repo. */
export function diffStellarDeployment(reg: RegistrySnapshot, stage: StellarStage): DeploymentDiff[] {
  const live = stellarDeployment(reg, stage);
  const fb = STELLAR_FALLBACK[stage];
  const fields: (keyof StellarDeploymentFallback)[] = [
    'endpointV2', 'sendUln302', 'receiveUln302', 'executor', 'executorHelper',
    'executorFeeLib', 'pricefeed', 'treasury', 'dvnFeeLib', 'blockedMessageLib',
  ];
  return fields.map((field) => {
    const liveValue = live?.[field as keyof DeploymentAddresses];
    const fallback = fb[field] as string;
    return { field, live: liveValue === undefined ? undefined : String(liveValue), fallback, changed: liveValue !== undefined && liveValue !== fallback };
  });
}
// snippet:end diffStellarDeployment

/** Deployment addresses to use right now: live registry when available, else the documented fallback. */
export function effectiveStellarDeployment(reg: RegistrySnapshot | null, stage: StellarStage): StellarDeploymentFallback {
  const fb = STELLAR_FALLBACK[stage];
  const live = reg ? stellarDeployment(reg, stage) : undefined;
  if (!live) return fb;
  return {
    ...fb,
    endpointV2: live.endpointV2 ?? fb.endpointV2,
    sendUln302: live.sendUln302 ?? fb.sendUln302,
    receiveUln302: live.receiveUln302 ?? fb.receiveUln302,
    executor: live.executor ?? fb.executor,
    executorHelper: live.executorHelper ?? fb.executorHelper,
    executorFeeLib: live.executorFeeLib ?? fb.executorFeeLib,
    pricefeed: live.pricefeed ?? fb.pricefeed,
    treasury: live.treasury ?? fb.treasury,
    dvnFeeLib: live.dvnFeeLib ?? fb.dvnFeeLib,
    blockedMessageLib: live.blockedMessageLib ?? fb.blockedMessageLib,
  };
}
