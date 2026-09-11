/**
 * End-to-end proof of the Launchpad code path with script keys: the exact
 * functions the /launch page calls, in the same order, with the Stellar
 * deployer as the wallet and the EVM deployer as MetaMask. Then one transfer
 * Stellar -> Sepolia, delivered permissionlessly, and a balance check.
 *
 *   pnpm exec tsx --tsconfig tsconfig.node.json scripts/e2e-launchpad.ts [CODE] [LockUnlock|MintBurn]
 */
import { Keypair } from '@stellar/stellar-sdk';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { EVM_TESTNETS } from '../src/config/networks';
import { EVM_TESTNET_FALLBACK, STELLAR_FALLBACK } from '../src/config/layerzero.fallback';
import { TESTNET_DEPLOYMENT } from '../src/config/testnet';
import { deployEvmOft, evmSetEnforced, evmSetPeer, handOffSacAdmin, lockIssuer, mintByPayment, oftArgs, prepareDeployFromWasm, prepareGrantMinter, prepareSetEnforced, prepareSetPeer, prepareUlnConfig, sacManagerArgs, WASM_HASHES } from '../src/lib/launchpad/actions';
import { prepareChangeTrust, prepareDeploySac } from '../src/lib/stellar/classic';
import { stellarAddressToHex } from '../src/lib/stellar/strkey';
import { quoteOft, quoteSend, prepareOftSend, getOftFacts } from '../src/lib/stellar/oft';
import { getTokenBalance } from '../src/lib/stellar/sac';
import { evmAddressToBytes32 } from '../src/lib/hex';
import { findPacketSent } from '../src/lib/stellar/packetEvents';
import { commitVerification, dvnVerified, executionState, lzReceive, planFromPacket } from '../src/lib/evm/execute';
import { OFT_ABI } from '../src/lib/evm/abi/oft';
import { envVar, log, warn } from './lib/env';
import { fundIfNeeded, signAndSubmit } from './lib/stellar-node';
import type { OftMode } from '../src/lib/launchpad/state';

const code = process.argv[2] ?? 'LAUNCHE2E';
const mode = (process.argv[3] as OftMode | undefined) ?? 'LockUnlock';
const owner = Keypair.fromSecret(envVar('STELLAR_DEPLOYER_SECRET')!);
const issuer = Keypair.random();
const evmAccount = privateKeyToAccount(envVar('EVM_DEPLOYER_PRIVATE_KEY') as Hex);
const rpc = envVar('EVM_RPC_URL') ?? EVM_TESTNETS.sepolia.rpcUrl;
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account: evmAccount, chain: sepolia, transport: http(rpc) });
const ENDPOINT = STELLAR_FALLBACK.testnet.endpointV2;
const ULN = STELLAR_FALLBACK.testnet.sendUln302;
const DVN = TESTNET_DEPLOYMENT.registry?.activeDvn ?? Object.values(STELLAR_FALLBACK.testnet.dvns).find((d) => !d.deprecated)!.strkey;

const t0 = Date.now();
const step = (s: string) => log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

// 1. issuer
await fundIfNeeded(issuer.publicKey());
step(`issuer ${issuer.publicKey()} funded`);
// 2. SAC (owner signs)
const sacTx = await prepareDeploySac('testnet', owner.publicKey(), code, issuer.publicKey());
await signAndSubmit(sacTx.tx, owner);
const sac = sacTx.contractId;
step(`SAC ${sac}`);
// 3. SAC-manager
const smTx = await prepareDeployFromWasm(owner.publicKey(), WASM_HASHES.sacManager, sacManagerArgs(sac, owner.publicKey()));
const sacManager = String((await signAndSubmit(smTx, owner)).returnValue);
step(`SAC-manager ${sacManager}`);
// 4. trustline + 5. mint
await signAndSubmit(await prepareChangeTrust('testnet', owner.publicKey(), code, issuer.publicKey()), owner);
await mintByPayment(issuer, owner.publicKey(), code, '1000');
step(`trustline + 1000 ${code} minted to owner`);
// 6. admin hand-off
await handOffSacAdmin(issuer, sac, sacManager);
step('SAC admin -> SAC-manager');
// 7. OFT
const oftTx = await prepareDeployFromWasm(owner.publicKey(), WASM_HASHES.oft, oftArgs(sac, mode, sacManager, ENDPOINT, owner.publicKey()));
const oft = String((await signAndSubmit(oftTx, owner)).returnValue);
step(`OFT (${mode}) ${oft}`);
// 8. role (MintBurn only)
if (mode === 'MintBurn') {
  await signAndSubmit((await prepareGrantMinter(owner.publicKey(), sacManager, oft)).tx, owner);
  step('MINTER_ROLE granted to the OFT');
}
// 9. lock issuer
await lockIssuer(issuer);
step('issuer locked');
// 10. EVM OFT
const { address: evmOft } = await deployEvmOft(wallet, pub, `${code} (launch e2e)`, code, EVM_TESTNET_FALLBACK.sepolia.endpointV2);
step(`Sepolia OFT ${evmOft}`);
// 11. EVM wiring
await evmSetPeer(wallet, pub, evmOft, stellarAddressToHex(oft));
await evmSetEnforced(wallet, pub, evmOft);
step('Sepolia setPeer + setEnforcedOptions');
// 12. Stellar wiring
await signAndSubmit((await prepareSetPeer(owner.publicKey(), oft, 40161, evmOft)).tx, owner);
await signAndSubmit((await prepareSetEnforced(owner.publicKey(), oft, 40161)).tx, owner);
await signAndSubmit((await prepareUlnConfig(owner.publicKey(), ENDPOINT, oft, ULN, 40161, DVN)).tx, owner);
step('Stellar set_peer + set_enforced_options + set_config');
const facts = await getOftFacts('testnet', oft);
log(`oft_type = ${facts.oftType.variant}, endpoint ok = ${facts.endpoint === ENDPOINT}`);

// 13. send 7 tokens Stellar -> Sepolia
const param = { dstEid: 40161, to: evmAddressToBytes32(evmAccount.address), amountLd: 7n * 10n ** 7n, minAmountLd: 0n, extraOptions: new Uint8Array() };
const q = await quoteOft('testnet', oft, owner.publicKey(), param);
const f = await quoteSend('testnet', oft, owner.publicKey(), param, false);
const prepared = await prepareOftSend('testnet', oft, owner.publicKey(), { ...param, minAmountLd: q.value.receipt.amountReceivedLd }, f.value, owner.publicKey());
const sent = await signAndSubmit(prepared.tx, owner);
step(`send tx ${sent.hash} (fee ${f.value.nativeFee} stroops)`);
if (mode === 'LockUnlock') log(`locked in OFT: ${(await getTokenBalance('testnet', sac, oft)).toString()} stroops (expect 70000000)`);

// 14. wait for the DVN, then deliver ourselves
const packet = (await findPacketSent('testnet', sent.hash))!;
const plan = planFromPacket(packet);
log(`guid ${plan.guid} -> https://testnet.layerzeroscan.com/tx/${plan.guid}`);
const fb = EVM_TESTNET_FALLBACK.sepolia;
const deadline = Date.now() + 40 * 60_000;
while (Date.now() < deadline) {
  const state = await executionState(pub, fb.endpointV2, plan);
  if (state === 'Executed') break;
  if (state === 'Executable') {
    const h = await lzReceive(wallet, fb.endpointV2, plan);
    await pub.waitForTransactionReceipt({ hash: h });
    step(`lzReceive ${h}`);
    break;
  }
  if (state === 'NotExecutable' && (await dvnVerified(pub, fb.receiveUln302, plan))) {
    const h = await commitVerification(wallet, fb.receiveUln302, plan);
    await pub.waitForTransactionReceipt({ hash: h });
    step(`commitVerification ${h}`);
    continue;
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
const bal = await pub.readContract({ address: evmOft, abi: OFT_ABI, functionName: 'balanceOf', args: [evmAccount.address] });
log(`Sepolia ${code} balance: ${bal.toString()} (6 dec) → ${bal === 7_000_000n ? 'OK: 7 tokens arrived' : 'MISMATCH'}`);
if (bal !== 7_000_000n) warn('delivery not observed within 40 minutes');
process.exit(bal === 7_000_000n ? 0 : 1);
