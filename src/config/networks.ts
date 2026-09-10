/**
 * Network endpoints used by the site. Everything here is public and CORS-open
 * (verified 2026-09-10), which is what lets this be a static single-page app
 * with no backend: the browser talks to Horizon, Soroban RPC, the LayerZero
 * registry and LayerZero Scan directly.
 */
export type StellarEnv = 'mainnet' | 'testnet';

export interface StellarNetworkConfig {
  env: StellarEnv;
  label: string;
  passphrase: string;
  /** Tried in order; the first healthy one wins (see lib/stellar/rpc.ts). */
  rpcUrls: readonly string[];
  horizonUrl: string;
  explorer: string;
  friendbot: string | null;
  /** LayerZero endpoint id for this Stellar network. */
  eid: number;
  /** LayerZero chainKey as used by the Scan API. */
  chainKey: string;
}

export const STELLAR: Record<StellarEnv, StellarNetworkConfig> = {
  mainnet: {
    env: 'mainnet',
    label: 'Stellar Mainnet',
    passphrase: 'Public Global Stellar Network ; September 2015',
    // Order matters: the first entry takes the load. All three are CORS-open; sorobanrpc.com
    // was observed rejecting browser bursts of simulateTransaction, so it is the last resort.
    rpcUrls: [
      'https://rpc.lightsail.network',
      'https://soroban-rpc.mainnet.stellar.gateway.fm',
      'https://mainnet.sorobanrpc.com',
    ],
    horizonUrl: 'https://horizon.stellar.org',
    explorer: 'https://stellar.expert/explorer/public',
    friendbot: null,
    eid: 30600,
    chainKey: 'stellar',
  },
  testnet: {
    env: 'testnet',
    label: 'Stellar Testnet',
    passphrase: 'Test SDF Network ; September 2015',
    rpcUrls: ['https://soroban-testnet.stellar.org'],
    horizonUrl: 'https://horizon-testnet.stellar.org',
    explorer: 'https://stellar.expert/explorer/testnet',
    friendbot: 'https://friendbot.stellar.org',
    eid: 40600,
    chainKey: 'stellar-testnet',
  },
};

export type ScanEnv = 'mainnet' | 'testnet';
export const SCAN: Record<ScanEnv, { api: string; site: string }> = {
  mainnet: { api: 'https://scan.layerzero-api.com/v1', site: 'https://layerzeroscan.com' },
  testnet: { api: 'https://scan-testnet.layerzero-api.com/v1', site: 'https://testnet.layerzeroscan.com' },
};

export const METADATA_API = 'https://metadata.layerzero-api.com/v1/metadata';
export const TRANSFER_API = 'https://transfer.layerzero-api.com/v1';
export const TRANSFER_API_KEY_FORM =
  'https://forms.monday.com/forms/c64c278b03d2b40a24e305943a743527?r=use1';

export type EvmTestnetKey = 'sepolia' | 'arbitrum-sepolia';
export interface EvmTestnetConfig {
  key: EvmTestnetKey;
  label: string;
  chainKey: string;
  eid: number;
  chainId: number;
  rpcUrl: string;
  explorer: string;
}
export const EVM_TESTNETS: Record<EvmTestnetKey, EvmTestnetConfig> = {
  sepolia: {
    key: 'sepolia',
    label: 'Sepolia',
    chainKey: 'sepolia',
    eid: 40161,
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
  },
  'arbitrum-sepolia': {
    key: 'arbitrum-sepolia',
    label: 'Arbitrum Sepolia',
    chainKey: 'arbitrum-sepolia',
    eid: 40231,
    chainId: 421614,
    rpcUrl: 'https://arbitrum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.arbiscan.io',
  },
};

export const EVM_MAINNET_RPC = 'https://ethereum-rpc.publicnode.com';

export const DOCS = {
  lzStellarOverview: 'https://docs.layerzero.network/v2/developers/stellar/overview',
  lzStellarOft: 'https://docs.layerzero.network/v2/developers/stellar/oft/overview',
  lzDeployedContracts: 'https://docs.layerzero.network/v2/deployments/deployed-contracts',
  lzDebugging: 'https://docs.layerzero.network/v2/concepts/troubleshooting/debugging-messages',
  lzDvnConfig: 'https://docs.layerzero.network/v2/developers/stellar/configuration/dvn-executor-config',
  usdt0Deployments: 'https://docs.usdt0.to/technical-documentation/deployments',
  usdt0Developer: 'https://docs.usdt0.to/technical-documentation/developer',
  stellarUsdt0: 'https://developers.stellar.org/docs/tokens/usdt0-layerzero',
  dune: 'https://dune.com/stellar/stellar-layerzero-oft-volume',
  cctpDemo: 'https://github.com/ElliotFriend/stellar-cctp-demo',
  scanSwagger: 'https://scan.layerzero-api.com/v1/swagger',
  metadataApi: 'https://metadata.layerzero-api.com/v1/metadata/deployments',
  monorepo: 'https://github.com/LayerZero-Labs/monorepo-external',
} as const;

export const explorers = {
  stellarTx: (env: StellarEnv, hash: string) => `${STELLAR[env].explorer}/tx/${hash}`,
  stellarAccount: (env: StellarEnv, id: string) => `${STELLAR[env].explorer}/account/${id}`,
  stellarContract: (env: StellarEnv, id: string) => `${STELLAR[env].explorer}/contract/${id}`,
  stellarAsset: (env: StellarEnv, code: string, issuer: string) =>
    `${STELLAR[env].explorer}/asset/${code}-${issuer}`,
  lzTx: (env: ScanEnv, hash: string) => `${SCAN[env].site}/tx/${hash}`,
  lzOApp: (env: ScanEnv, address: string) => `${SCAN[env].site}/address/${address}`,
  evmTx: (explorer: string, hash: string) => `${explorer}/tx/${hash}`,
  evmAddress: (explorer: string, address: string) => `${explorer}/address/${address}`,
};
