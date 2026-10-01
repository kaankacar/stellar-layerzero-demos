/**
 * Browser-side building blocks for launching an omnichain token. Each function
 * returns either an unsigned XDR for the connected wallet to sign, or performs
 * a locally-signed submission with the throwaway issuer key. The wasm hashes
 * were uploaded by the repo's testnet deployment, so deploying a new instance
 * is one `createCustomContract` transaction per contract.
 */
import { Address, Asset, AuthClawbackEnabledFlag, AuthRevocableFlag, BASE_FEE, Keypair, Operation, TransactionBuilder, rpc, xdr, type Transaction } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import type { Address as EvmAddress, Hex, PublicClient, WalletClient } from 'viem';
import { evmFeeOverrides } from '@/lib/evm/oft';
import { STELLAR } from '@/config/networks';
import { withRpc } from '@/lib/stellar/rpc';
import { SimulationError } from '@/lib/stellar/simulate';
import { submitAndPoll } from '@/lib/stellar/tx';
import { prepareInvoke } from '@/lib/stellar/tx';
import { sc } from '@/lib/stellar/scval';
import { encodeLzReceiveOption } from '@/lib/layerzero/options';
import { evmAddressToBytes32, hexToBytes } from '@/lib/hex';
import { CONFIG_TYPE, encodeOAppUlnConfig, requiredDvnsOverride, setConfigParamScVal } from '@/lib/stellar/endpoint';
import manifest from '../../../contracts/wasm/manifest.json';
import testOftArtifact from '../../../contracts/evm/artifacts/TestOFT.json';
import type { OftMode } from '@/lib/launchpad/state';

const ENV = 'testnet' as const;
const PASSPHRASE = STELLAR.testnet.passphrase;

export const WASM_HASHES = {
  sacManager: (manifest as { files: Record<string, { sha256: string }> }).files['sac_manager.wasm']!.sha256,
  oft: (manifest as { files: Record<string, { sha256: string }> }).files['oft.wasm']!.sha256,
  faucet: (manifest as { files: Record<string, { sha256: string }> }).files['faucet.wasm']!.sha256,
};

async function prepareOp(source: string, op: xdr.Operation): Promise<Transaction> {
  return withRpc(ENV, async (server) => {
    const account = await server.getAccount(source);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE }).addOperation(op).setTimeout(120).build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new SimulationError(`simulation failed: ${sim.error}`, sim.error);
    return rpc.assembleTransaction(tx, sim).build();
  });
}

// snippet:start launchpadDeploy
/** Deploy a contract instance from an already-uploaded wasm hash; the wallet signs, the tx returns the new contract Address. */
export async function prepareDeployFromWasm(source: string, wasmHash: string, constructorArgs: xdr.ScVal[]): Promise<Transaction> {
  return prepareOp(
    source,
    Operation.createCustomContract({
      address: new Address(source),
      wasmHash: Buffer.from(wasmHash, 'hex'),
      constructorArgs,
      salt: Keypair.random().rawPublicKey(),
    }),
  );
}
export const sacManagerArgs = (sac: string, owner: string) => [sc.address(sac), sc.address(owner)];
export const oftArgs = (sac: string, mode: OftMode, sacManager: string, endpoint: string, delegate: string) => [
  sc.address(sac),
  sc.u32(6),
  mode === 'MintBurn' ? sc.enumTuple('MintBurn', sc.address(sacManager)) : sc.enumUnit('LockUnlock'),
  sc.address(endpoint),
  sc.address(delegate),
];
// snippet:end launchpadDeploy

/** Classic ops signed by the throwaway issuer, submitted directly. */
export async function issuerClassic(issuer: Keypair, ops: xdr.Operation[]) {
  return withRpc(ENV, async (server) => {
    const account = await server.getAccount(issuer.publicKey());
    const b = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: PASSPHRASE });
    for (const op of ops) b.addOperation(op);
    const tx = b.setTimeout(120).build();
    tx.sign(issuer);
    return submitAndPoll(ENV, tx.toXDR());
  });
}
export const mintByPayment = (issuer: Keypair, to: string, code: string, amount: string) => issuerClassic(issuer, [Operation.payment({ destination: to, asset: new Asset(code, issuer.publicKey()), amount })]);
// snippet:start lockIssuer
/** USDT0's trust model: flags first, then master weight 0. After this the issuer can never sign again. */
export const lockIssuer = (issuer: Keypair) =>
  issuerClassic(issuer, [Operation.setOptions({ setFlags: (AuthRevocableFlag | AuthClawbackEnabledFlag) as 2 | 4 | 8 }), Operation.setOptions({ masterWeight: 0 })]);
// snippet:end lockIssuer

/** SAC.set_admin(sac_manager) must be signed by the current admin: the issuer. */
export async function handOffSacAdmin(issuer: Keypair, sac: string, sacManager: string) {
  const prepared = await prepareInvoke(ENV, issuer.publicKey(), sac, 'set_admin', [sc.address(sacManager)]);
  prepared.tx.sign(issuer);
  return submitAndPoll(ENV, prepared.tx.toXDR());
}

// Owner-signed invocations (the connected wallet): return unsigned XDR.
export const prepareGrantMinter = (owner: string, sacManager: string, account: string) => prepareInvoke(ENV, owner, sacManager, 'grant_role', [sc.address(account), sc.symbol('MINTER_ROLE'), sc.address(owner)]);
export const prepareSetPeer = (owner: string, oapp: string, eid: number, evmOft: EvmAddress) => prepareInvoke(ENV, owner, oapp, 'set_peer', [sc.u32(eid), sc.bytes(evmAddressToBytes32(evmOft)), sc.address(owner)]);
export const prepareSetEnforced = (owner: string, oapp: string, eid: number, gas = 200_000n) =>
  prepareInvoke(ENV, owner, oapp, 'set_enforced_options', [sc.vec([sc.struct({ eid: sc.u32(eid), msg_type: sc.u32(1), options: sc.bytes(hexToBytes(encodeLzReceiveOption(gas))) })]), sc.address(owner)]);
// snippet:start launchpadSetConfig
/** The testnet DVN override, for send (2) and receive (3), signed by the delegate (= owner here). */
export const prepareUlnConfig = (delegate: string, endpoint: string, oapp: string, uln: string, eid: number, activeDvn: string) => {
  const config = encodeOAppUlnConfig(requiredDvnsOverride([activeDvn]));
  return prepareInvoke(ENV, delegate, endpoint, 'set_config', [
    sc.address(delegate),
    sc.address(oapp),
    sc.address(uln),
    sc.vec([setConfigParamScVal({ eid, configType: CONFIG_TYPE.SEND_ULN, config }), setConfigParamScVal({ eid, configType: CONFIG_TYPE.RECEIVE_ULN, config })]),
  ]);
};
// snippet:end launchpadSetConfig

// ---- EVM (MetaMask) ----
const TEST_OFT = testOftArtifact as { abi: readonly unknown[]; bytecode: Hex };
const PEER_ABI = [
  { type: 'function', name: 'setPeer', stateMutability: 'nonpayable', inputs: [{ name: '_eid', type: 'uint32' }, { name: '_peer', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'setEnforcedOptions', stateMutability: 'nonpayable', inputs: [{ name: '_enforcedOptions', type: 'tuple[]', components: [{ name: 'eid', type: 'uint32' }, { name: 'msgType', type: 'uint16' }, { name: 'options', type: 'bytes' }] }], outputs: [] },
] as const;

// snippet:start launchpadEvm
/** Deploy the EVM half with MetaMask: a plain OFT (the contract is the ERC20). */
export async function deployEvmOft(wallet: WalletClient, pub: PublicClient, name: string, symbol: string, endpoint: EvmAddress): Promise<{ address: EvmAddress; hash: Hex }> {
  if (!wallet.account) throw new Error('connect MetaMask');
  const hash = await wallet.deployContract({ abi: TEST_OFT.abi as never, bytecode: TEST_OFT.bytecode, args: [name, symbol, endpoint, wallet.account.address] as never, account: wallet.account, chain: wallet.chain, ...(await evmFeeOverrides(wallet)) });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (!rc.contractAddress) throw new Error('deployment failed');
  return { address: rc.contractAddress, hash };
}
export async function evmSetPeer(wallet: WalletClient, pub: PublicClient, oft: EvmAddress, stellarOftHex: Hex): Promise<Hex> {
  if (!wallet.account) throw new Error('connect MetaMask');
  const hash = await wallet.writeContract({ address: oft, abi: PEER_ABI, functionName: 'setPeer', args: [40600, stellarOftHex], account: wallet.account, chain: wallet.chain, ...(await evmFeeOverrides(wallet)) });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}
export async function evmSetEnforced(wallet: WalletClient, pub: PublicClient, oft: EvmAddress): Promise<Hex> {
  if (!wallet.account) throw new Error('connect MetaMask');
  const hash = await wallet.writeContract({ address: oft, abi: PEER_ABI, functionName: 'setEnforcedOptions', args: [[{ eid: 40600, msgType: 1, options: encodeLzReceiveOption(500_000n) }]], account: wallet.account, chain: wallet.chain, ...(await evmFeeOverrides(wallet)) });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}
// snippet:end launchpadEvm
