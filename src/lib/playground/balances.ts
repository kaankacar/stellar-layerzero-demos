import type { Address } from 'viem';
import { getAccount, type HorizonAccount } from '@/lib/stellar/horizon';
import { publicClient } from '@/lib/evm/clients';
import { evmBalanceOf } from '@/lib/evm/oft';
import type { EvmTestnetKey } from '@/config/networks';

export interface StellarBalances {
  exists: boolean;
  xlm: string | null;
  /** null = no trustline for the mock asset yet */
  mock: string | null;
  account: HorizonAccount | null;
}

// snippet:start stellarBalances
export async function loadStellarBalances(address: string, code: string, issuer: string): Promise<StellarBalances> {
  try {
    const account = await getAccount('testnet', address);
    const xlm = account.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
    const mock = account.balances.find((b) => b.asset_code === code && b.asset_issuer === issuer)?.balance ?? null;
    return { exists: true, xlm, mock, account };
  } catch {
    return { exists: false, xlm: null, mock: null, account: null }; // 404: not funded yet
  }
}
// snippet:end stellarBalances

export async function loadEvmBalances(chainKey: EvmTestnetKey, address: Address, oft: Address): Promise<{ eth: bigint; mock: bigint }> {
  const client = publicClient(chainKey);
  const [eth, mock] = await Promise.all([client.getBalance({ address }), evmBalanceOf(client, oft, address)]);
  return { eth, mock };
}
