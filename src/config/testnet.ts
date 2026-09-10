import raw from '@/config/testnet-deployment.json';

/** Written by scripts/deploy-testnet.ts. `null` halves mean "not deployed yet". */
export interface TestnetDeployment {
  deployedAt: string | null;
  registry: { endpoint: string; uln: string; activeDvn: string; activeDvnHex: string; fetchedAt: string | null } | null;
  wasm: { monorepoCommit: string; files: Record<string, { sha256: string; bytes: number }> } | null;
  stellar: {
    eid: number;
    network: 'testnet';
    deployer: string;
    issuer: string;
    assetCode: string;
    sac: string | null;
    sacManager: string | null;
    oft: string | null;
    oftHex: string | null;
    faucet: string | null;
    postcard: string | null;
    postcardHex: string | null;
    issuerLocked: boolean;
  } | null;
  evm: { chainKey: 'sepolia' | 'arbitrum-sepolia'; eid: number; chainId: number; endpoint: `0x${string}`; deployer: `0x${string}`; oft: `0x${string}` | null; postcard: `0x${string}` | null } | null;
  wiring: { stellarPeers?: boolean; stellarEnforced?: boolean; stellarSendConfig?: boolean; stellarReceiveConfig?: boolean } | null;
}

export const TESTNET_DEPLOYMENT = raw as unknown as TestnetDeployment;
export const MOCK_ASSET_CODE = 'tUSDT0';
export const FAUCET_AMOUNT = 1_000n * 10n ** 7n;

export function deploymentReady(d: TestnetDeployment = TESTNET_DEPLOYMENT): { stellar: boolean; evm: boolean; wired: boolean } {
  const stellar = !!(d.stellar?.oft && d.stellar.sac && d.stellar.faucet && d.stellar.postcard);
  const evm = !!(d.evm?.oft && d.evm.postcard);
  const wired = stellar && evm && !!d.wiring?.stellarPeers && !!d.wiring?.stellarSendConfig;
  return { stellar, evm, wired };
}
