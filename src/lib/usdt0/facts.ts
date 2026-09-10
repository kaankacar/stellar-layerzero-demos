/**
 * Everything the Inspector shows about USDT0, and where each fact comes from.
 * Horizon for the classic asset and issuer; Soroban RPC simulation for the
 * SAC, the OFT and the ULN; the LayerZero registry for DVN names; a public
 * Ethereum RPC for the other end of the main pathway.
 */
import type { Address } from 'viem';
import { USDT0, USDT0_NETWORKS } from '@/config/usdt0';
import { STELLAR_FALLBACK } from '@/config/layerzero.fallback';
import { accountUrl, assetUrl, getAccount, getAsset, totalSupply, type HorizonAccount, type HorizonAssetRecord } from '@/lib/stellar/horizon';
import { getSacFacts, type SacFacts } from '@/lib/stellar/sac';
import { getEffectiveFeeBps, getEnforcedOptions, getOftFacts, getPeer, getRateLimitConfig, type OftFacts, type RateLimitConfig } from '@/lib/stellar/oft';
import { defaultSendUlnConfig, effectiveExecutorConfig, effectiveSendUlnConfig, type ExecutorConfig, type UlnConfig } from '@/lib/stellar/uln';
import { mapLimit } from '@/lib/net/mapLimit';
import { bytes32ToEvmAddress, type Hex } from '@/lib/hex';
import { stellarAddressToHex } from '@/lib/stellar/strkey';
import { publicClient } from '@/lib/evm/clients';
import { evmEnforcedOptions, evmOftCoreFacts, evmPeer } from '@/lib/evm/oft';
import { loadWithCache, type Loaded } from '@/lib/cache';

export interface ClassicFacts {
  asset: HorizonAssetRecord;
  issuer: HorizonAccount;
  supply: number;
  masterWeight: number;
  locked: boolean;
  requests: { asset: string; issuer: string };
}

// snippet:start classicFacts
export async function loadClassicFacts(): Promise<ClassicFacts> {
  const [asset, issuer] = await Promise.all([getAsset('mainnet', USDT0.code, USDT0.issuer), getAccount('mainnet', USDT0.issuer)]);
  if (!asset) throw new Error('Horizon has no record for USDT0');
  const master = issuer.signers.find((s) => s.key === USDT0.issuer);
  const masterWeight = master?.weight ?? 0;
  return {
    asset,
    issuer,
    supply: totalSupply(asset),
    masterWeight,
    // Locked = master key weight 0 and no other signers: nobody can sign as the issuer any more.
    locked: masterWeight === 0 && issuer.signers.every((s) => s.weight === 0),
    requests: { asset: assetUrl('mainnet', USDT0.code, USDT0.issuer), issuer: accountUrl('mainnet', USDT0.issuer) },
  };
}
// snippet:end classicFacts

export interface ContractFacts {
  sac: SacFacts;
  oft: OftFacts;
  feeBpsToEthereum: number;
  enforcedToEthereum: Hex | null;
  rateLimitToEthereum: RateLimitConfig | null;
  sacIsOftToken: boolean;
  endpointMatchesRegistry: boolean;
}

// snippet:start contractFacts
export async function loadContractFacts(): Promise<ContractFacts> {
  const [sac, oft, feeBps, enforced, rateLimit] = await Promise.all([
    getSacFacts('mainnet', USDT0.sac),
    getOftFacts('mainnet', USDT0.oft),
    getEffectiveFeeBps('mainnet', USDT0.oft, USDT0.ethereum.eid),
    getEnforcedOptions('mainnet', USDT0.oft, USDT0.ethereum.eid, 1),
    getRateLimitConfig('mainnet', USDT0.oft, 'Outbound', USDT0.ethereum.eid),
  ]);
  return {
    sac,
    oft,
    feeBpsToEthereum: feeBps,
    enforcedToEthereum: enforced,
    rateLimitToEthereum: rateLimit,
    sacIsOftToken: oft.token === USDT0.sac,
    endpointMatchesRegistry: oft.endpoint === STELLAR_FALLBACK.mainnet.endpointV2,
  };
}
// snippet:end contractFacts

export interface PeerRow {
  chainKey: string;
  name: string;
  eid: number | undefined;
  type: 'OFT' | 'OFT_ADAPTER';
  peer: Hex | null;
  peerEvm: string | null;
}

// snippet:start loadPeers
/** peer(eid) for every USDT0 network; `null` means the pathway is not wired from Stellar. */
export async function loadPeers(): Promise<PeerRow[]> {
  return mapLimit(USDT0_NETWORKS, 4, async (n) => {
    if (!n.eid || n.eid === USDT0.eid) return { ...n, eid: n.eid, peer: null, peerEvm: null };
    const peer = await getPeer('mainnet', USDT0.oft, n.eid).catch(() => null);
    let peerEvm: string | null = null;
    try {
      peerEvm = peer ? bytes32ToEvmAddress(peer) : null;
    } catch {
      peerEvm = null;
    }
    return { ...n, eid: n.eid, peer, peerEvm };
  });
}
// snippet:end loadPeers

export interface TrustFacts {
  send: UlnConfig;
  executor: ExecutorConfig;
  libraryDefault: UlnConfig | null;
  /** DVN strkey -> 0x-hex id used by the registry and by Scan. */
  dvnHex: Record<string, Hex>;
}

// snippet:start trustFacts
export async function loadTrustFacts(): Promise<TrustFacts> {
  const uln = STELLAR_FALLBACK.mainnet.sendUln302;
  const [send, executor, libraryDefault] = await Promise.all([
    effectiveSendUlnConfig('mainnet', uln, USDT0.oft, USDT0.ethereum.eid),
    effectiveExecutorConfig('mainnet', uln, USDT0.oft, USDT0.ethereum.eid),
    defaultSendUlnConfig('mainnet', uln, USDT0.ethereum.eid),
  ]);
  const dvnHex: Record<string, Hex> = {};
  for (const d of [...send.requiredDvns, ...send.optionalDvns]) dvnHex[d] = stellarAddressToHex(d);
  return { send, executor, libraryDefault, dvnHex };
}
// snippet:end trustFacts

export interface EthereumSideFacts {
  token: Address;
  approvalRequired: boolean;
  sharedDecimals: number;
  peerToStellar: Hex;
  peerMatchesStellarOft: boolean;
  enforcedToStellar: Hex;
}

// snippet:start ethereumSide
export async function loadEthereumSide(): Promise<EthereumSideFacts> {
  const client = publicClient('ethereum');
  const adapter = USDT0.ethereum.adapter as Address;
  const [facts, peer, enforced] = await Promise.all([evmOftCoreFacts(client, adapter), evmPeer(client, adapter, USDT0.eid), evmEnforcedOptions(client, adapter, USDT0.eid, 1)]);
  return {
    token: facts.token,
    approvalRequired: facts.approvalRequired,
    sharedDecimals: facts.sharedDecimals,
    peerToStellar: peer,
    peerMatchesStellarOft: peer.toLowerCase() === USDT0.oftHex,
    enforcedToStellar: enforced,
  };
}
// snippet:end ethereumSide

const TTL = 2 * 60 * 1000;
export const inspectorLoaders = {
  classic: (force: boolean): Promise<Loaded<ClassicFacts>> => loadWithCache({ key: 'usdt0:classic', ttlMs: TTL, fetcher: loadClassicFacts, force }),
  contracts: (force: boolean): Promise<Loaded<ContractFacts>> => loadWithCache({ key: 'usdt0:contracts', ttlMs: TTL, fetcher: loadContractFacts, force }),
  peers: (force: boolean): Promise<Loaded<PeerRow[]>> => loadWithCache({ key: 'usdt0:peers', ttlMs: 10 * 60 * 1000, fetcher: loadPeers, force }),
  trust: (force: boolean): Promise<Loaded<TrustFacts>> => loadWithCache({ key: 'usdt0:trust', ttlMs: TTL, fetcher: loadTrustFacts, force }),
  ethereum: (force: boolean): Promise<Loaded<EthereumSideFacts>> => loadWithCache({ key: 'usdt0:eth', ttlMs: TTL, fetcher: loadEthereumSide, force }),
};
