/**
 * USDT0 on Stellar mainnet. These are the production addresses; every one of
 * them is re-verified live by the Inspector page, and the OFT/SAC relationship
 * is confirmed on-chain (OFT.token() == SAC, SAC.admin() == SAC-manager).
 *
 * Verified on-chain 2026-09-10. USDT0 is operated by Everdawn Labs; USDT itself
 * is Tether's asset. There is NO USDT0 on Stellar testnet.
 */
export const USDT0 = {
  code: 'USDT0',
  issuer: 'GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q',
  /** Stellar Asset Contract (SEP-41 view of the classic asset). */
  sac: 'CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF',
  /** LayerZero OFT contract (the OApp that talks to the endpoint). */
  oft: 'CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6',
  /** 0x-hex of the OFT contract id, the form LayerZero Scan uses for Stellar OApps. */
  oftHex: '0x5d672cb21b3afcdda54546c7f5b9fd346920e41f8fe8f39e838e5d7bd7435546',
  /** SAC-manager: the SAC's admin; mints on behalf of the OFT under MINTER_ROLE. */
  sacManager: 'CA3GUWLOS3QKN6WNRAELSUDSKLDTVTWEDJ3KLGAJG3SIWGA5L3KZYWGJ',
  /** OneSig multisig that owns the OFT and the SAC-manager. */
  oneSig: 'CBCZ5CETG3XR5MZVDC7QBDOTIH6P7MOLUH2SSC52J3NVBYIV45D4QKR6',
  localDecimals: 7,
  sharedDecimals: 6,
  eid: 30600,
  /**
   * Read-only simulations need an existing source account for the transaction
   * envelope. Nothing is ever signed or submitted with it.
   */
  simulationSource: 'GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q',
  ethereum: {
    /** OFT *Adapter*: locks/unlocks canonical Tether USDT (approval required). */
    adapter: '0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee',
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    eid: 30101,
  },
} as const;

export interface Usdt0Network {
  /** LayerZero chainKey (as the Scan API and registry use it). */
  chainKey: string;
  name: string;
  type: 'OFT' | 'OFT_ADAPTER';
  /** Mainnet endpoint id when known offline; the registry fills the rest. */
  eid?: number;
}

/** The 23 native USDT0 networks listed at docs.usdt0.to (2026-09-10). */
export const USDT0_NETWORKS: Usdt0Network[] = [
  { chainKey: 'ethereum', name: 'Ethereum', type: 'OFT_ADAPTER', eid: 30101 },
  { chainKey: 'arbitrum', name: 'Arbitrum One', type: 'OFT', eid: 30110 },
  { chainKey: 'bera', name: 'Berachain', type: 'OFT', eid: 30362 },
  { chainKey: 'conflux', name: 'Conflux eSpace', type: 'OFT', eid: 30212 },
  { chainKey: 'flare', name: 'Flare', type: 'OFT', eid: 30295 },
  { chainKey: 'hypercore', name: 'HyperCore', type: 'OFT' },
  { chainKey: 'hyperliquid', name: 'HyperEVM', type: 'OFT', eid: 30367 },
  { chainKey: 'hedera', name: 'Hedera', type: 'OFT', eid: 30316 },
  { chainKey: 'ink', name: 'Ink', type: 'OFT', eid: 30339 },
  { chainKey: 'mantle', name: 'Mantle', type: 'OFT', eid: 30181 },
  { chainKey: 'megaeth', name: 'MegaETH', type: 'OFT', eid: 30398 },
  { chainKey: 'monad', name: 'Monad', type: 'OFT', eid: 30390 },
  { chainKey: 'morph', name: 'Morph', type: 'OFT', eid: 30322 },
  { chainKey: 'optimism', name: 'Optimism', type: 'OFT', eid: 30111 },
  { chainKey: 'plasma', name: 'Plasma', type: 'OFT', eid: 30383 },
  { chainKey: 'polygon', name: 'Polygon PoS', type: 'OFT', eid: 30109 },
  { chainKey: 'rootstock', name: 'Rootstock', type: 'OFT', eid: 30333 },
  { chainKey: 'sei', name: 'Sei', type: 'OFT', eid: 30280 },
  { chainKey: 'stable', name: 'Stable', type: 'OFT', eid: 30396 },
  { chainKey: 'stellar', name: 'Stellar', type: 'OFT', eid: 30600 },
  { chainKey: 'tempo', name: 'Tempo', type: 'OFT', eid: 30410 },
  { chainKey: 'unichain', name: 'Unichain', type: 'OFT', eid: 30320 },
  { chainKey: 'xlayer', name: 'X Layer', type: 'OFT', eid: 30274 },
];

/** Destinations used by the quote comparison (all verified as wired peers). */
export const QUOTE_COMPARISON_EIDS = [30101, 30110, 30109, 30111, 30383] as const;
