import type { Address } from 'viem';
import type { EvmTestnetKey } from '@/config/networks';
import { getAsset, totalSupply } from '@/lib/stellar/horizon';
import { getTokenBalance } from '@/lib/stellar/sac';
import { readContract } from '@/lib/stellar/simulate';
import { enumVariant } from '@/lib/stellar/scval';
import { publicClient } from '@/lib/evm/clients';
import { OFT_ABI } from '@/lib/evm/abi/oft';

export interface LockUnlockSupply {
  /** Total classic supply on Stellar (7 decimals, as a number of tokens). */
  stellarTotal: number;
  /** TESTCOIN locked inside the Stellar OFT contract (stroops). */
  lockedLd: bigint;
  /** Minted on the EVM side (6 decimals). */
  evmTotalSupply: bigint;
  /** locked / 10 == evm total supply ? */
  invariantHolds: boolean;
  holders: number;
  oftType: string;
}

// snippet:start lockUnlockSupply
export async function loadLockUnlockSupply(sac: string, oft: string, code: string, issuer: string, evm: { chainKey: EvmTestnetKey; oft: Address }): Promise<LockUnlockSupply> {
  const [asset, lockedLd, evmTotalSupply, oftType] = await Promise.all([
    getAsset('testnet', code, issuer),
    getTokenBalance('testnet', sac, oft), // the OFT's own SAC balance = the locked reserve
    publicClient(evm.chainKey).readContract({ address: evm.oft, abi: OFT_ABI, functionName: 'totalSupply' }),
    readContract<unknown>('testnet', oft, 'oft_type'),
  ]);
  return {
    stellarTotal: asset ? totalSupply(asset) : 0,
    lockedLd,
    evmTotalSupply,
    invariantHolds: lockedLd / 10n === evmTotalSupply, // 7 local decimals vs 6 on the EVM side
    holders: asset?.accounts.authorized ?? 0,
    oftType: enumVariant(oftType).variant,
  };
}
// snippet:end lockUnlockSupply
