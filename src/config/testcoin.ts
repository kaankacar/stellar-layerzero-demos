import raw from '@/config/testcoin-deployment.json';

export interface TestcoinDeployment {
  deployedAt: string | null;
  registry: { endpoint: string; uln: string; activeDvn: string; activeDvnHex: string } | null;
  wasm: { monorepoCommit: string; oft: string | null } | null;
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
    oftType: 'LockUnlock';
    faucet: string | null;
    issuerLocked: boolean;
  } | null;
  evm: { chainKey: 'sepolia' | 'arbitrum-sepolia'; eid: number; chainId: number; endpoint: `0x${string}`; deployer: `0x${string}`; oft: `0x${string}` | null } | null;
  wiring: { peers?: boolean; enforced?: boolean; config?: boolean } | null;
}

export const TESTCOIN_DEPLOYMENT = raw as unknown as TestcoinDeployment;
export const TESTCOIN_FAUCET_AMOUNT = 500n * 10n ** 7n;

export function testcoinReady(d: TestcoinDeployment = TESTCOIN_DEPLOYMENT) {
  const stellar = !!(d.stellar?.oft && d.stellar.sac && d.stellar.faucet);
  const evm = !!d.evm?.oft;
  return { stellar, evm, wired: stellar && evm && !!d.wiring?.peers && !!d.wiring?.config };
}
