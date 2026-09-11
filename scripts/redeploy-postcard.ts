/**
 * Redeploy the Stellar PostcardOApp from the current contracts/wasm/postcard_oapp.wasm
 * and re-wire it (Stellar peer/options/ULN config + the Sepolia PostcardOApp's peer).
 * Used after fixing the contract; keeps the Sepolia side.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { EVM_TESTNETS } from '../src/config/networks';
import { STELLAR_FALLBACK } from '../src/config/layerzero.fallback';
import { sc } from '../src/lib/stellar/scval';
import { encodeLzReceiveOption } from '../src/lib/layerzero/options';
import { evmAddressToBytes32, hexToBytes, bytesToHex } from '../src/lib/hex';
import { stellarAddressToBytes32, stellarAddressToHex } from '../src/lib/stellar/strkey';
import { CONFIG_TYPE, encodeOAppUlnConfig, requiredDvnsOverride, setConfigParamScVal } from '../src/lib/stellar/endpoint';
import { envVar, log, ROOT } from './lib/env';
import { deployContract, invoke, uploadWasm } from './lib/stellar-node';

const depPath = resolve(ROOT, 'src/config/testnet-deployment.json');
const dep = JSON.parse(readFileSync(depPath, 'utf8'));
const statePath = resolve(ROOT, 'scripts/.state/testnet-deploy.json');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const deployer = Keypair.fromSecret(envVar('STELLAR_DEPLOYER_SECRET')!);
const { endpointV2: ENDPOINT, sendUln302: ULN } = STELLAR_FALLBACK.testnet;
const DVN: string = dep.registry.activeDvn;
const evmPostcard = dep.evm.postcard as Address;
const eid = EVM_TESTNETS.sepolia.eid;

const wasmHash = await uploadWasm(resolve(ROOT, 'contracts/wasm/postcard_oapp.wasm'), deployer);
const { contractId: postcard } = await deployContract(wasmHash, deployer, [sc.address(deployer.publicKey()), sc.address(ENDPOINT), sc.address(deployer.publicKey())]);
log(`new PostcardOApp ${postcard}`);
await invoke(postcard, 'set_peer', [sc.u32(eid), sc.bytes(evmAddressToBytes32(evmPostcard)), sc.address(deployer.publicKey())], deployer);
await invoke(postcard, 'set_enforced_options', [sc.vec([sc.struct({ eid: sc.u32(eid), msg_type: sc.u32(1), options: sc.bytes(hexToBytes(encodeLzReceiveOption(200_000n))) })]), sc.address(deployer.publicKey())], deployer);
const config = encodeOAppUlnConfig(requiredDvnsOverride([DVN]));
await invoke(ENDPOINT, 'set_config', [sc.address(deployer.publicKey()), sc.address(postcard), sc.address(ULN), sc.vec([setConfigParamScVal({ eid, configType: CONFIG_TYPE.SEND_ULN, config }), setConfigParamScVal({ eid, configType: CONFIG_TYPE.RECEIVE_ULN, config })])], deployer);

const account = privateKeyToAccount(envVar('EVM_DEPLOYER_PRIVATE_KEY') as Hex);
const rpc = envVar('EVM_RPC_URL') ?? EVM_TESTNETS.sepolia.rpcUrl;
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const peerAbi = [{ type: 'function', name: 'setPeer', stateMutability: 'nonpayable', inputs: [{ name: '_eid', type: 'uint32' }, { name: '_peer', type: 'bytes32' }], outputs: [] }] as const;
const h = await wallet.writeContract({ address: evmPostcard, abi: peerAbi, functionName: 'setPeer', args: [40600, stellarAddressToHex(postcard)] });
await pub.waitForTransactionReceipt({ hash: h });
log(`Sepolia PostcardOApp.setPeer(40600, new) tx ${h}`);

dep.stellar.postcard = postcard;
dep.stellar.postcardHex = bytesToHex(stellarAddressToBytes32(postcard));
dep.wasm.files['postcard_oapp.wasm'] = JSON.parse(readFileSync(resolve(ROOT, 'contracts/wasm/manifest.json'), 'utf8')).files['postcard_oapp.wasm'];
dep.deployedAt = new Date().toISOString();
writeFileSync(depPath, JSON.stringify(dep, null, 2) + '\n');
state.stellar.postcard = postcard;
state.stellar.wasm.postcard_oapp = wasmHash;
writeFileSync(statePath, JSON.stringify(state, null, 2));
log('deployment file updated');
