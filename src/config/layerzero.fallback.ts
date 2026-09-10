/**
 * Documented fallbacks for the LayerZero Stellar deployments.
 *
 * The registry (metadata.layerzero-api.com) is the source of truth and is
 * fetched at runtime and at build time (scripts/verify-registry.ts). These
 * values are what the site uses if the registry is unreachable, and what the
 * "registry check" badge compares live data against.
 *
 * Verified against the registry on 2026-09-10. Note that the testnet was
 * redeployed in August 2026: BRIEF_STALE_TESTNET below records the previous
 * generation so the change is visible.
 */
export const FALLBACK_VERIFIED_AT = '2026-09-10';

export interface StellarDeploymentFallback {
  eid: number;
  chainKey: string;
  stage: 'mainnet' | 'testnet';
  endpointV2: string;
  sendUln302: string;
  receiveUln302: string;
  executor: string;
  executorHelper: string;
  executorFeeLib: string;
  pricefeed: string;
  treasury: string;
  dvnFeeLib: string;
  blockedMessageLib: string;
  /** DVN id (0x-hex of the 32-byte contract id) -> operator info. */
  dvns: Record<string, { name: string; deprecated: boolean; strkey: string }>;
}

export const STELLAR_FALLBACK: Record<'mainnet' | 'testnet', StellarDeploymentFallback> = {
  mainnet: {
    eid: 30600,
    chainKey: 'stellar',
    stage: 'mainnet',
    endpointV2: 'CCQLLRE5JBAWYCW3KTWOIWLMFDUOKROQVZNSALQMGOSXNW3ERUOWTZGK',
    sendUln302: 'CCV4HEII3UC65THWGSRM2DVIJLB6HS6YMUHDTTHUECX2RHTP5FA2GOBA',
    receiveUln302: 'CCV4HEII3UC65THWGSRM2DVIJLB6HS6YMUHDTTHUECX2RHTP5FA2GOBA',
    executor: 'CCEGV7LM6X736RQBPUD4F34HBUUR7OANXLPYUEDQWTPTYX36KSPSAJYM',
    executorHelper: 'CB54JXWG3X77YFAFLYQMRUIMLAEP6XUBBWVQLQYVK2CEOA6PGNQUDRAO',
    executorFeeLib: 'CDKSWYXCNROOAQSALOQZXVK5NZ34VNBOAF5TE4JWHRC4W6OOPNBXFEOB',
    pricefeed: 'CDW44DSP5EQBFC2IC5ZIRFC5WIZDMKL34IUFI6FZ6TIE446C6YAT5YTS',
    treasury: 'CDXWWNCFWCP4YLKFEMQJZBT3CK26S4QDS3AQ4PUOT73VVHSQ7HM7C7TO',
    dvnFeeLib: 'CAQJ2PSRMF2AGA5R4KXHAKG33WNGDPZEOG7TY5VTY5UDNLIYENTSGZTO',
    blockedMessageLib: 'CCQVKSSZAJBV5XPNHJXHLGPIWIHRPLRMVGW5CURKKJQC3E23ONNHATWV',
    dvns: {
      '0x7a73c83c887e9722a0b1f7353ee7ffb216bd0a380f9810e878383e0b748f7eac': {
        name: 'LayerZero Labs',
        deprecated: false,
        strkey: 'CB5HHSB4RB7JOIVAWH3TKPXH76ZBNPIKHAHZQEHIPA4D4C3UR57KZRRD',
      },
      '0xaa84283f1a13265f84b8ea58fdde1123344c8bd52cac1c63f41327e3294f1658': {
        name: 'Horizen',
        deprecated: false,
        strkey: 'CCVIIKB7DIJSMX4EXDVFR7O6CERTITEL2UWKYHDD6QJSPYZJJ4LFQWDO',
      },
      '0xd52136c8472ec7787683eec7568d5dffd02c26a011d0a312688195bd089f7d25': {
        name: 'Nethermind',
        deprecated: false,
        strkey: 'CDKSCNWII4XMO6DWQPXMOVUNLX75ALBGUAI5BIYSNCAZLPIIT56SKAAW',
      },
      '0x719c83f5d635250a40a365ed49f5cf166a72cbd83c4e421dc61c3d3cd3d84815': {
        name: 'Canary',
        deprecated: false,
        strkey: 'CBYZZA7V2Y2SKCSAUNS62SPVZ4LGU4WL3A6E4QQ5YYOD2PGT3BEBLFNS',
      },
      '0xeaa5d5e4e3fe13f510c7505117b8278dcdd4e336fa57bb5c40ebae21dd3fec68': {
        name: 'USDT0',
        deprecated: false,
        strkey: 'CDVKLVPE4P7BH5IQY5IFCF5YE6G43VHDG35FPO24IDV24IO5H7WGRYAN',
      },
      '0x74c934d28d1cb6da116d86b5188728ceafa1bc7713622fc9c1e226adb13f5f5c': {
        name: 'LayerZero Labs',
        deprecated: true,
        strkey: '',
      },
      '0xc609c59166eb4ee15886fb773bb6cdeff89c068a3ab313bcba6778c885a6ee08': {
        name: 'Horizen',
        deprecated: true,
        strkey: '',
      },
      '0x3bbd264a52779dd145b389cf48d4857f0a3991c53bb89ee8565029c64ee75821': {
        name: 'Canary',
        deprecated: true,
        strkey: '',
      },
    },
  },
  testnet: {
    eid: 40600,
    chainKey: 'stellar-testnet',
    stage: 'testnet',
    endpointV2: 'CALTBA5S6GRJEHAXFP45LGGLKWWAF7HTZCPNUBUJF2HWWRRLQNV35AIV',
    sendUln302: 'CCMLPCAWCPIIMXOHJJKU3NZLOFTT2O6QTB2UUFPN6SEHLK35QRHVKKMB',
    receiveUln302: 'CCMLPCAWCPIIMXOHJJKU3NZLOFTT2O6QTB2UUFPN6SEHLK35QRHVKKMB',
    executor: 'CCAVZ7ESAV3PDJ6PISRCXVZCXFFH4NGI7K7MVMZZDR33LC5AD3UPZATT',
    executorHelper: 'CANJCMHRRXEBM46675TSPJIFUVPW7PDOCBLMWS7QPO5TCBHBL7JC4CDL',
    executorFeeLib: 'CBB3SROBFLJGD4O4BPVJ6YNZFXTA6BKLPM4T2QKYUBUXMAHOP642LKNW',
    pricefeed: 'CAIKTIJD4APTPPLJ6K5XKLNGQBXX7JA4CZJLIBP7YQUC6B54TD6EZVK7',
    treasury: 'CCTE7D7O6BDSZILNYKYDXZHOYPXFVEQ3WKGNSELA3G7W3K2T2BOBUU36',
    dvnFeeLib: 'CCNLXA7DYMUERWQS2GS3JRFIXRCQL7Q76I6LGTLTD3ROOQIMUFQ5NI5G',
    blockedMessageLib: 'CBVYQHKEDEIWODJ3H5NZLZ3XSR3VVMLIJ4D5KGI2SQRITVQLTTW7JLRO',
    dvns: {
      '0x7e4b19f130f71d887a1a308add8e214686d426094b05958465cb64952861c1fc': {
        name: 'LayerZero Labs',
        deprecated: false,
        strkey: 'CB7EWGPRGD3R3CD2DIYIVXMOEFDINVBGBFFQLFMEMXFWJFJIMHA7ZLSA',
      },
      '0x73c812d517c866cfaa1c00c7a9fd79914229cd1903ff7d8e84b232bdeb67a1e5': {
        name: 'LayerZero Labs',
        deprecated: true,
        strkey: 'CBZ4QEWVC7EGNT5KDQAMPKP5PGIUEKONDEB767MOQSZDFPPLM6Q6LQQ3',
      },
    },
  },
};

/**
 * The testnet generation that circulated in docs and prompts before the
 * August 2026 redeploy. Kept only so the UI and README can show the change.
 */
export const BRIEF_STALE_TESTNET: Record<string, string> = {
  endpointV2: 'CBQOTWFU4N4DWFWYIU7EY62DXNCZH5N3U3XHKQW326CGY4CI6GT6Q5AF',
  executor: 'CD26IUC2ISTDVOQJYSPHTMO346ODK7Y7CFVEWZ5QFFSD23VGGUYVUUJ3',
  executorHelper: 'CD3NJPHBTHYVFQOW4HV32UMNPJUNOGI2YMNKDFIKHGNCXTXWMNA3CLNJ',
  executorFeeLib: 'CADF4LYNX4NTOQXZPFQDO5EWIUXRB7YM5CM664GXBV26TO36AZQJRZKN',
  sendUln302: 'CAWCTJDDZZEWYARYCY6IP7LJ5WAR5XHNDBNDNRFYNS5ZX22MH3RPSJSH',
  receiveUln302: 'CAWCTJDDZZEWYARYCY6IP7LJ5WAR5XHNDBNDNRFYNS5ZX22MH3RPSJSH',
  pricefeed: 'CBWLREV4VAKBP5JQJO7UM4L6QMJPNXHWYCQ3HIBNNVI5S6CECOZVAS2Y',
  treasury: 'CAXDS6GF6GSN5L4NLHJK6RYDVUMYUE6Z75W434PTSTJDEDF3GZBG7WP4',
  dvnFeeLib: 'CASRGIXQURTTXJB6BLWYW6KYCPBKK7MVHL6MTBFQCFLPBJK7M5TVI55S',
};

export interface EvmTestnetFallback {
  eid: number;
  chainKey: string;
  endpointV2: `0x${string}`;
  sendUln302: `0x${string}`;
  receiveUln302: `0x${string}`;
  executor: `0x${string}`;
  lzLabsDvn: `0x${string}`;
}
export const EVM_TESTNET_FALLBACK: Record<'sepolia' | 'arbitrum-sepolia', EvmTestnetFallback> = {
  sepolia: {
    eid: 40161,
    chainKey: 'sepolia',
    endpointV2: '0x6EDCE65403992e310A62460808c4b910D972f10f',
    sendUln302: '0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE',
    receiveUln302: '0xdAf00F5eE2158dD58E0d3857851c432E34A3A851',
    executor: '0x718B92b5CB0a5552039B593faF724D182A881eDA',
    lzLabsDvn: '0x8eebf8b423b73bfca51a1db4b7354aa0bfca9193',
  },
  'arbitrum-sepolia': {
    eid: 40231,
    chainKey: 'arbitrum-sepolia',
    endpointV2: '0x6EDCE65403992e310A62460808c4b910D972f10f',
    sendUln302: '0x4f7cd4DA19ABB31b0eC98b9066B9e857B1bf9C0E',
    receiveUln302: '0x75Db67CDab2824970131D5aa9CECfC9F69c69636',
    executor: '0x5Df3a1cEbBD9c8BA7F8dF51Fd632A9aef8308897',
    lzLabsDvn: '0x53f488e93b4f1b60e8e83aa374dbe1780a1ee8a8',
  },
};
