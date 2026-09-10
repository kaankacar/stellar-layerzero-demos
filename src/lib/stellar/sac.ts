/**
 * Stellar Asset Contract (SAC): the SEP-41 token interface over a classic
 * asset. For USDT0 the SAC's `admin()` is not the issuer but the SAC-manager
 * contract, which is how the OFT gets to mint.
 */
import type { StellarEnv } from '@/config/networks';
import { sc } from '@/lib/stellar/scval';
import { readContract } from '@/lib/stellar/simulate';

export interface SacFacts {
  name: string;
  symbol: string;
  decimals: number;
  admin: string | null;
}

// snippet:start sacFacts
export async function getSacFacts(env: StellarEnv, sac: string): Promise<SacFacts> {
  const [name, symbol, decimals, admin] = await Promise.all([
    readContract<string>(env, sac, 'name'),
    readContract<string>(env, sac, 'symbol'),
    readContract<number>(env, sac, 'decimals'),
    readContract<string>(env, sac, 'admin').catch(() => null),
  ]);
  return { name, symbol, decimals: Number(decimals), admin };
}

export async function getTokenBalance(env: StellarEnv, token: string, holder: string): Promise<bigint> {
  return BigInt(await readContract<bigint>(env, token, 'balance', [sc.address(holder)]));
}
// snippet:end sacFacts
