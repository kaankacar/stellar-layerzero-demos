/**
 * TESTCOIN: a token born on Stellar that travels over LayerZero.
 *
 * Same building blocks as the tUSDT0 playground, one difference that matters:
 * the Stellar OFT is `LockUnlock`, not `MintBurn`. Stellar is the token's home
 * chain: sending locks TESTCOIN inside the OFT contract and Sepolia mints; the
 * way back burns on Sepolia and unlocks from the reserve. Supply on Stellar
 * (classic) is therefore the total supply everywhere, and
 *   locked in the Stellar OFT  ==  minted on Sepolia
 * is the invariant the TestCoin page checks live.
 *
 * Minting new TESTCOIN still goes through a SAC-manager + Faucet (MINTER_ROLE),
 * and the issuer is locked, so the trust model matches the real thing.
 *
 *   pnpm deploy:testcoin            # both halves (needs Sepolia ETH on the EVM deployer) + wiring
 *   pnpm deploy:testcoin --stellar  # Stellar only
 */
import { Asset, AuthClawbackEnabledFlag, AuthRevocableFlag, Keypair, Operation, StrKey } from '@stellar/stellar-sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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
const ASSET_CODE = 'TESTCOIN';

interface State {
  stellar?: { deployer: string; issuer: string; sac?: string; sacManager?: string; oft?: string; faucet?: string; rolesGranted?: boolean; issuerLocked?: boolean; wasm?: Record<string, string> };
  evm?: { chainKey: EvmTestnetKey; deployer: Address; oft?: Address; peerSet?: boolean; enforcedSet?: boolean; endpoint: Address };
  wiring?: { peers?: boolean; enforced?: boolean; config?: boolean };
}
const STATE_PATH = resolve(ROOT, 'scripts/.state/testcoin-deploy.json');
mkdirSync(resolve(ROOT, 'scripts/.state'), { recursive: true });
const state: State = existsSync(STATE_PATH) ? (JSON.parse(readFileSync(STATE_PATH, 'utf8')) as State) : {};
const save = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

log('fetching LayerZero registry');
let registry: RegistrySnapshot;
try {
  registry = compactRegistry((await fetch(`${METADATA_API}/deployments`).then((r) => r.json())) as RawRegistry);
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
const evmKey = (envVar('EVM_TESTNET') as EvmTestnetKey | undefined) ?? 'sepolia';
const evmCfg = EVM_TESTNETS[evmKey];
const EVM_ENDPOINT = ((chainByKey(registry, evmCfg.chainKey)?.deployments.find((d) => d.eid === evmCfg.eid)?.endpointV2 as Address | undefined) ?? EVM_TESTNET_FALLBACK[evmKey].endpointV2) as Address;
log(`endpoint ${ENDPOINT} · uln ${ULN} · dvn ${ACTIVE_DVN}`);

function keypairFromEnv(name: string, label: string): Keypair {
  let secret = envVar(name);
  if (!secret) {
    const kp = Keypair.random();
    secret = kp.secret();
    saveEnvVar(name, secret);
    log(`generated ${label} ${kp.publicKey()} (saved to .env as ${name})`);
  }
  return Keypair.fromSecret(secret);
}
const WASM = resolve(ROOT, 'contracts/wasm');
const manifest = JSON.parse(readFileSync(resolve(WASM, 'manifest.json'), 'utf8')) as { files: Record<string, { sha256: string }>; monorepoCommit: string };

if (doStellar) {
  // Same deployer as the playground (already funded); a fresh issuer for TESTCOIN.
  const deployer = keypairFromEnv('STELLAR_DEPLOYER_SECRET', 'Stellar deployer');
  const issuer = keypairFromEnv('TESTCOIN_ISSUER_SECRET', 'TESTCOIN issuer');
  await fundIfNeeded(deployer.publicKey());
  await fundIfNeeded(issuer.publicKey());
  state.stellar ??= { deployer: deployer.publicKey(), issuer: issuer.publicKey() };
  const S = state.stellar;
  const asset = new Asset(ASSET_CODE, issuer.publicKey());
  if (!S.sac) {
    S.sac = await deploySac(asset, deployer);
    save();
  }
  S.wasm ??= {};
  for (const name of ['sac_manager', 'oft', 'faucet']) {
    if (!S.wasm[name]) {
      S.wasm[name] = await uploadWasm(resolve(WASM, `${name}.wasm`), deployer); // already on chain from the playground: no-op
      save();
    }
  }
  if (!S.sacManager) {
    S.sacManager = (await deployContract(S.wasm.sac_manager!, deployer, [sc.address(S.sac), sc.address(deployer.publicKey())])).contractId;
    log(`SAC-manager ${S.sacManager}`);
    save();
  }
  if ((await read<string>(S.sac, 'admin').catch(() => null)) !== S.sacManager) {
    await invoke(S.sac, 'set_admin', [sc.address(S.sacManager)], issuer);
  }
  if (!S.oft) {
    // snippet:start deployLockUnlock
    // The one line that differs from tUSDT0: OftType::LockUnlock (unit variant, no minter).
    S.oft = (await deployContract(S.wasm.oft!, deployer, [sc.address(S.sac), sc.u32(6), sc.enumUnit('LockUnlock'), sc.address(ENDPOINT), sc.address(deployer.publicKey())])).contractId;
    log(`OFT (LockUnlock) ${S.oft}`);
    // snippet:end deployLockUnlock
    save();
  }
  if (!S.faucet) {
    S.faucet = (await deployContract(S.wasm.faucet!, deployer, [sc.address(S.sacManager), sc.i128(500n * 10n ** 7n), sc.u32(720)])).contractId;
    log(`Faucet ${S.faucet}`);
    save();
  }
  if (!S.rolesGranted) {
    // Only the Faucet mints here. A LockUnlock OFT never mints: it unlocks its own balance.
    const has = await read<number | null | undefined>(S.sacManager, 'has_role', [sc.address(S.faucet), sc.symbol('MINTER_ROLE')]).catch(() => null);
    if (has === null || has === undefined) await invoke(S.sacManager, 'grant_role', [sc.address(S.faucet), sc.symbol('MINTER_ROLE'), sc.address(deployer.publicKey())], deployer);
    S.rolesGranted = true;
    save();
  }
  if (!S.issuerLocked) {
    await classicTx(issuer, [Operation.setOptions({ setFlags: (AuthRevocableFlag | AuthClawbackEnabledFlag) as 2 | 4 | 8 }), Operation.setOptions({ masterWeight: 0 })]);
    S.issuerLocked = true;
    log('issuer locked');
    save();
  }
}

if (doEvm) {
  const pk = envVar('EVM_DEPLOYER_PRIVATE_KEY') as Hex | undefined;
  if (!pk) throw new Error('EVM_DEPLOYER_PRIVATE_KEY missing: run pnpm deploy:testnet --evm first');
  const account = privateKeyToAccount(pk);
  const chain = VIEM_CHAINS[evmKey];
  const rpcUrl = envVar('EVM_RPC_URL') ?? evmCfg.rpcUrl;
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const balance = await pub.getBalance({ address: account.address });
  log(`EVM deployer ${account.address}: ${(Number(balance) / 1e18).toFixed(5)} ETH`);
  if (balance < 3_000_000_000_000_000n) {
    warn(`needs ≈0.01 ${evmCfg.label} ETH; fund ${account.address}`);
  } else {
    state.evm ??= { chainKey: evmKey, deployer: account.address, endpoint: EVM_ENDPOINT };
    const E = state.evm;
    if (!E.oft) {
      const a = JSON.parse(readFileSync(resolve(ROOT, 'contracts/evm/artifacts/TestOFT.json'), 'utf8')) as { abi: readonly unknown[]; bytecode: Hex };
      const hash = await wallet.deployContract({ abi: a.abi as never, bytecode: a.bytecode, args: ['TestCoin', 'TESTCOIN', EVM_ENDPOINT, account.address] as never, account, chain });
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (!rc.contractAddress) throw new Error('TestCoin OFT deploy failed');
      E.oft = rc.contractAddress;
      log(`TestCoin OFT on ${evmCfg.label}: ${E.oft} (tx ${hash.slice(0, 10)}…)`);
      save();
    }
    const S = state.stellar;
    if (S?.oft) {
      const peerAbi = [
        { type: 'function', name: 'setPeer', stateMutability: 'nonpayable', inputs: [{ name: '_eid', type: 'uint32' }, { name: '_peer', type: 'bytes32' }], outputs: [] },
        { type: 'function', name: 'setEnforcedOptions', stateMutability: 'nonpayable', inputs: [{ name: '_enforcedOptions', type: 'tuple[]', components: [{ name: 'eid', type: 'uint32' }, { name: 'msgType', type: 'uint16' }, { name: 'options', type: 'bytes' }] }], outputs: [] },
      ] as const;
      const write = async (functionName: 'setPeer' | 'setEnforcedOptions', fnArgs: unknown[]) => {
        const hash = await wallet.writeContract({ address: E.oft!, abi: peerAbi, functionName, args: fnArgs as never, account, chain });
        await pub.waitForTransactionReceipt({ hash });
        log(`${functionName} (tx ${hash.slice(0, 10)}…)`);
      };
      if (!E.peerSet) {
        await write('setPeer', [40600, stellarAddressToHex(S.oft)]);
        E.peerSet = true;
        save();
      }
      if (!E.enforcedSet) {
        await write('setEnforcedOptions', [[{ eid: 40600, msgType: 1, options: encodeLzReceiveOption(500_000n) }]]);
        E.enforcedSet = true;
        save();
      }
    }
  }
}

if (state.stellar?.oft && state.evm?.oft) {
  const S = state.stellar;
  const E = state.evm;
  const deployer = Keypair.fromSecret(envVar('STELLAR_DEPLOYER_SECRET')!);
  state.wiring ??= {};
  const W = state.wiring;
  if (!W.peers) {
    const want = bytesToHex(evmAddressToBytes32(E.oft!));
    if ((await getPeer('testnet', S.oft!, evmCfg.eid))?.toLowerCase() !== want.toLowerCase()) {
      await invoke(S.oft!, 'set_peer', [sc.u32(evmCfg.eid), sc.bytes(evmAddressToBytes32(E.oft!)), sc.address(deployer.publicKey())], deployer);
    }
    W.peers = true;
    save();
  }
  if (!W.enforced) {
    const want = encodeLzReceiveOption(200_000n);
    if ((await getEnforcedOptions('testnet', S.oft!, evmCfg.eid, 1))?.toLowerCase() !== want.toLowerCase()) {
      await invoke(S.oft!, 'set_enforced_options', [sc.vec([sc.struct({ eid: sc.u32(evmCfg.eid), msg_type: sc.u32(1), options: sc.bytes(hexToBytes(want)) })]), sc.address(deployer.publicKey())], deployer);
    }
    W.enforced = true;
    save();
  }
  const config = encodeOAppUlnConfig(requiredDvnsOverride([ACTIVE_DVN]));
  const send = await effectiveSendUlnConfig('testnet', ULN, S.oft!, evmCfg.eid);
  const recv = await effectiveReceiveUlnConfig('testnet', ULN, S.oft!, evmCfg.eid);
  const params: { eid: number; configType: number; config: Uint8Array }[] = [];
  if (!(send.requiredDvns.length === 1 && send.requiredDvns[0] === ACTIVE_DVN)) params.push({ eid: evmCfg.eid, configType: CONFIG_TYPE.SEND_ULN, config });
  if (!(recv.requiredDvns.length === 1 && recv.requiredDvns[0] === ACTIVE_DVN)) params.push({ eid: evmCfg.eid, configType: CONFIG_TYPE.RECEIVE_ULN, config });
  if (params.length) {
    await invoke(ENDPOINT, 'set_config', [sc.address(deployer.publicKey()), sc.address(S.oft!), sc.address(ULN), sc.vec(params.map(setConfigParamScVal))], deployer);
    log(`ULN config set (${params.map((p) => (p.configType === 2 ? 'send' : 'receive')).join(' + ')})`);
  } else log('ULN config already names the active DVN');
  W.config = true;
  save();
}

const out = {
  deployedAt: new Date().toISOString(),
  registry: { endpoint: ENDPOINT, uln: ULN, activeDvn: ACTIVE_DVN, activeDvnHex },
  wasm: { monorepoCommit: manifest.monorepoCommit, oft: manifest.files['oft.wasm']?.sha256 ?? null },
  stellar: state.stellar
    ? {
        eid: 40600,
        network: 'testnet',
        deployer: state.stellar.deployer,
        issuer: state.stellar.issuer,
        assetCode: ASSET_CODE,
        sac: state.stellar.sac ?? null,
        sacManager: state.stellar.sacManager ?? null,
        oft: state.stellar.oft ?? null,
        oftHex: state.stellar.oft ? bytesToHex(stellarAddressToBytes32(state.stellar.oft)) : null,
        oftType: 'LockUnlock',
        faucet: state.stellar.faucet ?? null,
        issuerLocked: state.stellar.issuerLocked ?? false,
      }
    : null,
  evm: state.evm ? { chainKey: state.evm.chainKey, eid: EVM_TESTNETS[state.evm.chainKey].eid, chainId: EVM_TESTNETS[state.evm.chainKey].chainId, endpoint: state.evm.endpoint, deployer: state.evm.deployer, oft: state.evm.oft ?? null } : null,
  wiring: state.wiring ?? null,
};
writeFileSync(resolve(ROOT, 'src/config/testcoin-deployment.json'), JSON.stringify(out, null, 2) + '\n');
log('wrote src/config/testcoin-deployment.json');
console.log(JSON.stringify(out, null, 2));
