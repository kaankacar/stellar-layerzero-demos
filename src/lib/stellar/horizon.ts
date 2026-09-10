/**
 * Horizon is Stellar's classic-ledger API. We use it for what RPC cannot give
 * us: aggregate asset statistics (holders, supply split, flags) and account
 * details (signers, thresholds, home_domain).
 */
import { STELLAR, type StellarEnv } from '@/config/networks';
import { fetchJson } from '@/lib/net/fetchJson';

export interface HorizonAssetRecord {
  asset_type: string;
  asset_code: string;
  asset_issuer: string;
  contract_id?: string;
  accounts: { authorized: number; authorized_to_maintain_liabilities: number; unauthorized: number };
  balances: { authorized: string; authorized_to_maintain_liabilities: string; unauthorized: string };
  claimable_balances_amount: string;
  liquidity_pools_amount: string;
  contracts_amount: string;
  num_contracts: number;
  num_claimable_balances: number;
  num_liquidity_pools?: number;
  flags: { auth_required: boolean; auth_revocable: boolean; auth_immutable: boolean; auth_clawback_enabled: boolean };
  paging_token: string;
}

export interface HorizonAccount {
  id: string;
  sequence: string;
  home_domain?: string | null;
  last_modified_time?: string;
  last_modified_ledger?: number;
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
  flags: { auth_required: boolean; auth_revocable: boolean; auth_immutable: boolean; auth_clawback_enabled: boolean };
  signers: { key: string; weight: number; type: string }[];
  balances: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string; is_authorized?: boolean }[];
}

export const horizonUrl = (env: StellarEnv) => STELLAR[env].horizonUrl;

// snippet:start horizonAsset
export function assetUrl(env: StellarEnv, code: string, issuer: string): string {
  return `${horizonUrl(env)}/assets?asset_code=${code}&asset_issuer=${issuer}`;
}
export async function getAsset(env: StellarEnv, code: string, issuer: string): Promise<HorizonAssetRecord | null> {
  const res = await fetchJson<{ _embedded: { records: HorizonAssetRecord[] } }>(assetUrl(env, code, issuer));
  return res._embedded.records[0] ?? null;
}
// snippet:end horizonAsset

export function accountUrl(env: StellarEnv, id: string): string {
  return `${horizonUrl(env)}/accounts/${id}`;
}
export async function getAccount(env: StellarEnv, id: string): Promise<HorizonAccount> {
  return fetchJson<HorizonAccount>(accountUrl(env, id));
}

export async function accountExists(env: StellarEnv, id: string): Promise<boolean> {
  try {
    await getAccount(env, id);
    return true;
  } catch {
    return false;
  }
}

/** Total supply as seen by Horizon: classic balances + contract-held + claimable + pools. */
export function totalSupply(a: HorizonAssetRecord): number {
  return (
    Number(a.balances.authorized) +
    Number(a.balances.authorized_to_maintain_liabilities) +
    Number(a.balances.unauthorized) +
    Number(a.contracts_amount) +
    Number(a.claimable_balances_amount) +
    Number(a.liquidity_pools_amount)
  );
}

export function hasTrustline(account: HorizonAccount, code: string, issuer: string): boolean {
  return account.balances.some((b) => b.asset_code === code && b.asset_issuer === issuer);
}
