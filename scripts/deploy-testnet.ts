/**
 * Deploy and wire the testnet playground: a mock tUSDT0 OFT on Stellar testnet
 * (EID 40600) paired with a TestOFT on an EVM testnet, plus a PostcardOApp on
 * each side. Idempotent: progress is kept in scripts/.state/testnet-deploy.json,
 * so a re-run resumes where it stopped. The result the site reads is written to
 * src/config/testnet-deployment.json.
 *
 *   pnpm deploy:testnet            # everything
 *   pnpm deploy:testnet --stellar  # only the Stellar half
 *   pnpm deploy:testnet --evm      # only the EVM half (+ wiring if both exist)
 *
 * Sequence (see README "Deploy the testnet OFT"):
 *   Stellar: asset -> SAC -> SAC-manager -> SAC.set_admin(manager) -> OFT(MintBurn) -> Faucet
 *            -> grant MINTER_ROLE (OFT, Faucet) -> lock issuer -> PostcardOApp
 *   EVM:     TestOFT + PostcardOApp -> setPeer(40600) -> setEnforcedOptions
 *   Stellar: set_peer(evm) -> set_enforced_options -> endpoint.set_config (send + receive ULN with the active DVN)
 */
import { Asset, AuthClawbackEnabledFlag, AuthRevocableFlag, Keypair, Operation, StrKey } from '@stellar/stellar-sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { EVM_TESTNETS, METADATA_API, type EvmTestnetKey } from '../src/config/networks';
import { STELLAR_FALLBACK, EVM_TESTNET_FALLBACK } from '../src/config/layerzero.fallback';
import { compactRegistry, stellarDeployment, activeDvns, chainByKey, type RawRegistry, type RegistrySnapshot } from '../src/lib/layerzero/chains';
import { sc } from '../src/lib/stellar/scval';
import { encodeLzReceiveOption } from '../src/lib/layerzero/options';
import { evmAddressToBytes32, hexToBytes, bytesToHex } from '../src/lib/hex';
import { stellarAddressToBytes32, stellarAddressToHex } from '../src/lib/stellar/strkey';
import { CONFIG_TYPE, encodeOAppUlnConfig, requiredDvnsOverride, setConfigParamScVal } from '../src/lib/stellar/endpoint';
import { effectiveSendUlnConfig, effectiveReceiveUlnConfig } from '../src/lib/stellar/uln';
import { getPeer, getEnforcedOptions } from '../src/lib/stellar/oft';
import { VIEM_CHAINS } from '../src/lib/evm/chains';
import { envVar, log, ROOT, saveEnvVar, warn } from './lib/env';
import { classicTx, deployContract, deploySac, fundIfNeeded, invoke, read, uploadWasm } from './lib/stellar-node';

const args = new Set(process.argv.slice(2));
const doStellar = args.size === 0 || args.has('--stellar');
const doEvm = args.size === 0 || args.has('--evm');

// ---------- state ----------
interface State {
  stellar?: {
    deployer: string;
    issuer: string;
    assetCode: string;
    sac?: string;
    sacManager?: string;
    oft?: string;
    faucet?: string;
    postcard?: string;
    rolesGranted?: boolean;
    issuerLocked?: boolean;
    wasm?: Record<string, string>;
    endpoint?: string;
    uln?: string;
    dvn?: string;
  };
  evm?: { chainKey: EvmTestnetKey; deployer: Address; oft?: Address; postcard?: Address; peersSet?: boolean; enforcedSet?: boolean; endpoint: Address };
  wiring?: { stellarPeers?: boolean; stellarEnforced?: boolean; stellarSendConfig?: boolean; stellarReceiveConfig?: boolean };
}
const STATE_DIR = resolve(ROOT, 'scripts/.state');
const STATE_PATH = resolve(STATE_DIR, 'testnet-deploy.json');
mkdirSync(STATE_DIR, { recursive: true });
const state: State = existsSync(STATE_PATH) ? (JSON.parse(readFileSync(STATE_PATH, 'utf8')) as State) : {};
const save = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

// ---------- registry: the source of truth for LayerZero addresses ----------
log('fetching LayerZero registry');
let registry: RegistrySnapshot;
try {
  const raw = (await fetch(`${METADATA_API}/deployments`).then((r) => r.json())) as RawRegistry;
  registry = compactRegistry(raw);
} catch (e) {
  warn(`registry unavailable (${String(e)}); using documented fallbacks`);
  registry = { fetchedAt: '', source: 'fallback', chains: {} };
}
const live = stellarDeployment(registry, 'testnet');
const ENDPOINT = live?.endpointV2 ?? STELLAR_FALLBACK.testnet.endpointV2;
const ULN = live?.sendUln302 ?? STELLAR_FALLBACK.testnet.sendUln302;
if (live && live.eid !== 40600) throw new Error(`registry says Stellar testnet EID is ${live.eid}, expected 40600`);
const dvnsLive = activeDvns(registry, 'testnet');
const activeDvnHex = dvnsLive[0]?.id ?? Object.entries(STELLAR_FALLBACK.testnet.dvns).find(([, d]) => !d.deprecated)![0];
const ACTIVE_DVN = STELLAR_FALLBACK.testnet.dvns[activeDvnHex]?.strkey || StrKey.encodeContract(Buffer.from(activeDvnHex.replace(/^0x/, ''), 'hex'));
log(`endpoint ${ENDPOINT}\n         uln      ${ULN}\n         dvn      ${ACTIVE_DVN} (${dvnsLive[0]?.name ?? 'LayerZero Labs'})`);
if (live && live.endpointV2 !== STELLAR_FALLBACK.testnet.endpointV2) warn('registry endpoint differs from the documented fallback: the testnet was redeployed again. Update src/config/layerzero.fallback.ts.');

const evmKey = (envVar('EVM_TESTNET') as EvmTestnetKey | undefined) ?? 'sepolia';
const evmCfg = EVM_TESTNETS[evmKey];
const evmRegistry = chainByKey(registry, evmCfg.chainKey)?.deployments.find((d) => d.eid === evmCfg.eid);
const EVM_ENDPOINT = ((evmRegistry?.endpointV2 as Address | undefined) ?? EVM_TESTNET_FALLBACK[evmKey].endpointV2) as Address;

// ---------- keys ----------
function keypairFromEnv(name: string, label: string): Keypair {
  let secret = envVar(name);
  if (!secret) {
    const kp = Keypair.random();
    secret = kp.secret();
    saveEnvVar(name, secret);
    log(`generated ${label} key ${kp.publicKey()} (saved to .env as ${name})`);
  }
  return Keypair.fromSecret(secret);
}

const WASM = resolve(ROOT, 'contracts/wasm');
const manifest = existsSync(resolve(WASM, 'manifest.json')) ? (JSON.parse(readFileSync(resolve(WASM, 'manifest.json'), 'utf8')) as { files: Record<string, { sha256: string }>; monorepoCommit: string }) : null;

// ---------- Stellar half ----------
if (doStellar) {
  if (!manifest) throw new Error('contracts/wasm is empty: run `pnpm build:wasm` first');
  const deployer = keypairFromEnv('STELLAR_DEPLOYER_SECRET', 'Stellar deployer');
  const issuer = keypairFromEnv('MOCK_ISSUER_SECRET', 'mock issuer');
  await fundIfNeeded(deployer.publicKey());
  await fundIfNeeded(issuer.publicKey());
  state.stellar ??= { deployer: deployer.publicKey(), issuer: issuer.publicKey(), assetCode: 'tUSDT0' };
  const S = state.stellar;
  S.endpoint = ENDPOINT;
  S.uln = ULN;
  S.dvn = ACTIVE_DVN;
  const asset = new Asset(S.assetCode, issuer.publicKey());

  // 1. SAC for the classic asset
  if (!S.sac) {
    S.sac = await deploySac(asset, deployer);
    save();
  }
  // 2. wasm uploads
  S.wasm ??= {};
  for (const name of ['sac_manager', 'oft', 'faucet', 'postcard_oapp']) {
    if (!S.wasm[name]) {
      S.wasm[name] = await uploadWasm(resolve(WASM, `${name}.wasm`), deployer);
      save();
    }
  }
  // 3. SAC-manager(sac_token, owner)
  if (!S.sacManager) {
    const r = await deployContract(S.wasm.sac_manager!, deployer, [sc.address(S.sac), sc.address(deployer.publicKey())]);
    S.sacManager = r.contractId;
    log(`SAC-manager ${S.sacManager}`);
    save();
  }
  // 4. issuer hands SAC admin to the manager (only the current admin, the issuer, can do this)
  const admin = await read<string>(S.sac, 'admin').catch(() => null);
  if (admin !== S.sacManager) {
    await invoke(S.sac, 'set_admin', [sc.address(S.sacManager)], issuer);
    log('SAC admin is now the SAC-manager');
  }
  // 5. OFT(token, shared_decimals, oft_type, endpoint, delegate)
  if (!S.oft) {
    const r = await deployContract(S.wasm.oft!, deployer, [sc.address(S.sac), sc.u32(6), sc.enumTuple('MintBurn', sc.address(S.sacManager)), sc.address(ENDPOINT), sc.address(deployer.publicKey())]);
    S.oft = r.contractId;
    log(`OFT ${S.oft}`);
    save();
  }
  // 6. Faucet(sac_manager, amount, cooldown_ledgers): 1,000 tUSDT0 per drip, ~1 hour cooldown
  if (!S.faucet) {
    const r = await deployContract(S.wasm.faucet!, deployer, [sc.address(S.sacManager), sc.i128(1_000n * 10n ** 7n), sc.u32(720)]);
    S.faucet = r.contractId;
    log(`Faucet ${S.faucet}`);
    save();
  }
  // 7. MINTER_ROLE for the OFT (credit on receive) and the Faucet (drip)
  if (!S.rolesGranted) {
    for (const who of [S.oft, S.faucet]) {
      const has = await read<number | null | undefined>(S.sacManager, 'has_role', [sc.address(who), sc.symbol('MINTER_ROLE')]).catch(() => null);
      if (has === null || has === undefined) await invoke(S.sacManager, 'grant_role', [sc.address(who), sc.symbol('MINTER_ROLE'), sc.address(deployer.publicKey())], deployer);
    }
    S.rolesGranted = true;
    save();
  }
  // 8. Mirror USDT0's issuer: revocable + clawback flags, then master weight 0 (locked). Order matters: admin handoff first.
  if (!S.issuerLocked) {
    await classicTx(issuer, [Operation.setOptions({ setFlags: (AuthRevocableFlag | AuthClawbackEnabledFlag) as 2 | 4 | 8 }), Operation.setOptions({ masterWeight: 0 })]);
    S.issuerLocked = true;
    log('issuer flags set (revocable, clawback) and master key weight 0: the classic issuer is now inert');
    save();
  }
  // 9. PostcardOApp(owner, endpoint, delegate)
  if (!S.postcard) {
    const r = await deployContract(S.wasm.postcard_oapp!, deployer, [sc.address(deployer.publicKey()), sc.address(ENDPOINT), sc.address(deployer.publicKey())]);
    S.postcard = r.contractId;
    log(`PostcardOApp ${S.postcard}`);
    save();
  }
}

// ---------- EVM half ----------
if (doEvm) {
  let pk = envVar('EVM_DEPLOYER_PRIVATE_KEY') as Hex | undefined;
  if (!pk) {
    pk = generatePrivateKey();
    saveEnvVar('EVM_DEPLOYER_PRIVATE_KEY', pk);
    log('generated EVM deployer key (saved to .env as EVM_DEPLOYER_PRIVATE_KEY)');
  }
  const account = privateKeyToAccount(pk);
  const chain = VIEM_CHAINS[evmKey];
  const rpcUrl = envVar('EVM_RPC_URL') ?? evmCfg.rpcUrl;
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const balance = await pub.getBalance({ address: account.address });
  log(`EVM deployer ${account.address} on ${evmCfg.label}: ${(Number(balance) / 1e18).toFixed(5)} ETH`);
  if (balance < 5_000_000_000_000_000n) {
    warn(`needs ≈0.02+ ${evmCfg.label} ETH to deploy two contracts. Fund ${account.address} (e.g. a Sepolia faucet) and re-run with --evm.`);
  } else {
    state.evm ??= { chainKey: evmKey, deployer: account.address, endpoint: EVM_ENDPOINT };
    const E = state.evm;
    const artifact = (name: string) => JSON.parse(readFileSync(resolve(ROOT, `contracts/evm/artifacts/${name}.json`), 'utf8')) as { abi: readonly unknown[]; bytecode: Hex };
    const deploy = async (name: string, ctorArgs: unknown[]) => {
      const a = artifact(name);
      const hash = await wallet.deployContract({ abi: a.abi as never, bytecode: a.bytecode, args: ctorArgs as never, account, chain });
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (!rc.contractAddress) throw new Error(`${name} deploy failed`);
      log(`${name} ${rc.contractAddress} (tx ${hash.slice(0, 10)}…)`);
      return rc.contractAddress;
    };
    if (!E.oft) {
      E.oft = await deploy('TestOFT', ['Test USDT0 (mock)', 'tUSDT0', EVM_ENDPOINT, account.address]);
      save();
    }
    if (!E.postcard) {
      E.postcard = await deploy('PostcardOApp', [EVM_ENDPOINT, account.address]);
      save();
    }
    const S = state.stellar;
    if (S?.oft && S.postcard) {
      const write = async (address: Address, functionName: string, fnArgs: unknown[], abi: readonly unknown[]) => {
        const hash = await wallet.writeContract({ address, abi: abi as never, functionName: functionName as never, args: fnArgs as never, account, chain });
        await pub.waitForTransactionReceipt({ hash });
        log(`${functionName} on ${address.slice(0, 10)}… (tx ${hash.slice(0, 10)}…)`);
      };
      const peerAbi = [
        { type: 'function', name: 'setPeer', stateMutability: 'nonpayable', inputs: [{ name: '_eid', type: 'uint32' }, { name: '_peer', type: 'bytes32' }], outputs: [] },
        { type: 'function', name: 'setEnforcedOptions', stateMutability: 'nonpayable', inputs: [{ name: '_enforcedOptions', type: 'tuple[]', components: [{ name: 'eid', type: 'uint32' }, { name: 'msgType', type: 'uint16' }, { name: 'options', type: 'bytes' }] }], outputs: [] },
      ] as const;
      if (!E.peersSet) {
        // A Stellar peer is the raw 32-byte contract id (no left-padding).
        await write(E.oft, 'setPeer', [40600, stellarAddressToHex(S.oft)], peerAbi);
        await write(E.postcard, 'setPeer', [40600, stellarAddressToHex(S.postcard)], peerAbi);
        E.peersSet = true;
        save();
      }
      if (!E.enforcedSet) {
        // Same budget the production Ethereum adapter enforces for deliveries on Stellar.
        const opts = encodeLzReceiveOption(500_000n);
        await write(E.oft, 'setEnforcedOptions', [[{ eid: 40600, msgType: 1, options: opts }]], peerAbi);
        await write(E.postcard, 'setEnforcedOptions', [[{ eid: 40600, msgType: 1, options: opts }]], peerAbi);
        E.enforcedSet = true;
        save();
      }
    } else {
      warn('Stellar side not deployed yet; EVM peers will be set on the next run');
    }
  }
}

// ---------- Stellar → EVM wiring (needs both halves) ----------
if (state.stellar?.oft && state.stellar.postcard && state.evm?.oft && state.evm.postcard) {
  const S = state.stellar;
  const E = state.evm;
  const deployer = Keypair.fromSecret(envVar('STELLAR_DEPLOYER_SECRET')!);
  state.wiring ??= {};
  const W = state.wiring;
  const pairs: [string, Address][] = [
    [S.oft!, E.oft!],
    [S.postcard!, E.postcard!],
  ];
  if (!W.stellarPeers) {
    for (const [stellarOApp, evmOApp] of pairs) {
      const current = await getPeer('testnet', stellarOApp, evmCfg.eid);
      const want = bytesToHex(evmAddressToBytes32(evmOApp));
      if (current?.toLowerCase() !== want.toLowerCase()) {
        // set_peer(eid, Option<BytesN<32>>, operator): via the SDK, not the CLI (the CLI can silently store None).
        await invoke(stellarOApp, 'set_peer', [sc.u32(evmCfg.eid), sc.bytes(evmAddressToBytes32(evmOApp)), sc.address(deployer.publicKey())], deployer);
      }
    }
    W.stellarPeers = true;
    save();
  }
  if (!W.stellarEnforced) {
    for (const [stellarOApp] of pairs) {
      const current = await getEnforcedOptions('testnet', stellarOApp, evmCfg.eid, 1);
      const want = encodeLzReceiveOption(200_000n);
      if (current?.toLowerCase() !== want.toLowerCase()) {
        await invoke(stellarOApp, 'set_enforced_options', [sc.vec([sc.struct({ eid: sc.u32(evmCfg.eid), msg_type: sc.u32(1), options: sc.bytes(hexToBytes(want)) })]), sc.address(deployer.publicKey())], deployer);
      }
    }
    W.stellarEnforced = true;
    save();
  }
  // Testnet gotcha: the library defaults still name a deprecated DVN, so require the active one explicitly.
  const config = encodeOAppUlnConfig(requiredDvnsOverride([ACTIVE_DVN]));
  for (const [stellarOApp] of pairs) {
    const send = await effectiveSendUlnConfig('testnet', ULN, stellarOApp, evmCfg.eid);
    const recv = await effectiveReceiveUlnConfig('testnet', ULN, stellarOApp, evmCfg.eid);
    const params: { eid: number; configType: number; config: Uint8Array }[] = [];
    if (!(send.requiredDvns.length === 1 && send.requiredDvns[0] === ACTIVE_DVN)) params.push({ eid: evmCfg.eid, configType: CONFIG_TYPE.SEND_ULN, config });
    if (!(recv.requiredDvns.length === 1 && recv.requiredDvns[0] === ACTIVE_DVN)) params.push({ eid: evmCfg.eid, configType: CONFIG_TYPE.RECEIVE_ULN, config });
    if (params.length) {
      await invoke(ENDPOINT, 'set_config', [sc.address(deployer.publicKey()), sc.address(stellarOApp), sc.address(ULN), sc.vec(params.map(setConfigParamScVal))], deployer);
      log(`ULN config set for ${stellarOApp.slice(0, 8)}… (${params.map((p) => (p.configType === 2 ? 'send' : 'receive')).join(' + ')})`);
    } else {
      log(`ULN config already names the active DVN for ${stellarOApp.slice(0, 8)}…`);
    }
  }
  W.stellarSendConfig = true;
  W.stellarReceiveConfig = true;
  save();
}

// ---------- publish deployment for the site ----------
const out = {
  deployedAt: new Date().toISOString(),
  registry: { endpoint: ENDPOINT, uln: ULN, activeDvn: ACTIVE_DVN, activeDvnHex, fetchedAt: registry.fetchedAt || null },
  wasm: manifest ? { monorepoCommit: manifest.monorepoCommit, files: manifest.files } : null,
  stellar: state.stellar
    ? {
        eid: 40600,
        network: 'testnet',
        deployer: state.stellar.deployer,
        issuer: state.stellar.issuer,
        assetCode: state.stellar.assetCode,
        sac: state.stellar.sac ?? null,
        sacManager: state.stellar.sacManager ?? null,
        oft: state.stellar.oft ?? null,
        oftHex: state.stellar.oft ? bytesToHex(stellarAddressToBytes32(state.stellar.oft)) : null,
        faucet: state.stellar.faucet ?? null,
        postcard: state.stellar.postcard ?? null,
        postcardHex: state.stellar.postcard ? bytesToHex(stellarAddressToBytes32(state.stellar.postcard)) : null,
        issuerLocked: state.stellar.issuerLocked ?? false,
      }
    : null,
  evm: state.evm
    ? { chainKey: state.evm.chainKey, eid: EVM_TESTNETS[state.evm.chainKey].eid, chainId: EVM_TESTNETS[state.evm.chainKey].chainId, endpoint: state.evm.endpoint, deployer: state.evm.deployer, oft: state.evm.oft ?? null, postcard: state.evm.postcard ?? null }
    : null,
  wiring: state.wiring ?? null,
};
writeFileSync(resolve(ROOT, 'src/config/testnet-deployment.json'), JSON.stringify(out, null, 2) + '\n');
log('wrote src/config/testnet-deployment.json');
console.log(JSON.stringify(out, null, 2));
