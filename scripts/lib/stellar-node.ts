/**
 * Node-side Stellar helpers for the deploy scripts: Keypair signing instead of a
 * browser wallet, plus wasm upload / contract deploy operations. Contract
 * *invocations* reuse the same prepareInvoke/submitAndPoll the website uses.
 */
import { Address, Asset, BASE_FEE, Keypair, Operation, TransactionBuilder, hash, rpc, type xdr, type Transaction } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';
import { STELLAR } from '../../src/config/networks';
import { withRpc } from '../../src/lib/stellar/rpc';
import { prepareInvoke, submitAndPoll, type SubmitResult } from '../../src/lib/stellar/tx';
import { simulateRead } from '../../src/lib/stellar/simulate';
import { log } from './env';

const ENV = 'testnet' as const;
export const PASSPHRASE = STELLAR.testnet.passphrase;

export async function fundIfNeeded(pubkey: string): Promise<void> {
  const exists = await withRpc(ENV, async (s) => {
    try {
      await s.getAccount(pubkey);
      return true;
    } catch {
      return false;
    }
  });
  if (exists) return;
  log(`funding ${pubkey} via Friendbot`);
  const res = await fetch(`${STELLAR.testnet.friendbot}/?addr=${pubkey}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot ${res.status}`);
}

async function prepareOp(source: Keypair, op: xdr.Operation, opts: { fee?: string } = {}): Promise<Transaction> {
  return withRpc(ENV, async (server) => {
    const account = await server.getAccount(source.publicKey());
    const tx = new TransactionBuilder(account, { fee: opts.fee ?? BASE_FEE, networkPassphrase: PASSPHRASE }).addOperation(op).setTimeout(120).build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);
    return rpc.assembleTransaction(tx, sim).build();
  });
}

export async function signAndSubmit(tx: Transaction, ...signers: Keypair[]): Promise<SubmitResult> {
  for (const k of signers) tx.sign(k);
  return submitAndPoll(ENV, tx.toXDR());
}

/** Classic (non-Soroban) transaction: build, sign, submit. */
export async function classicTx(source: Keypair, ops: xdr.Operation[], extraSigners: Keypair[] = []): Promise<SubmitResult> {
  return withRpc(ENV, async (server) => {
    const account = await server.getAccount(source.publicKey());
    const b = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: PASSPHRASE });
    for (const op of ops) b.addOperation(op);
    const tx = b.setTimeout(120).build();
    tx.sign(source, ...extraSigners);
    return submitAndPoll(ENV, tx.toXDR());
  });
}

// snippet:start uploadWasm
export async function uploadWasm(path: string, signer: Keypair): Promise<string> {
  const wasm = readFileSync(path);
  const wasmHash = Buffer.from(hash(wasm)).toString('hex');
  // Already on chain? getLedgerEntries for the code entry tells us without spending anything.
  const present = await withRpc(ENV, async (s) => {
    try {
      await s.getContractWasmByHash(Buffer.from(wasmHash, 'hex'));
      return true;
    } catch {
      return false;
    }
  });
  if (present) {
    log(`wasm ${path.split('/').pop()} already uploaded (${wasmHash.slice(0, 12)}…)`);
    return wasmHash;
  }
  const tx = await prepareOp(signer, Operation.uploadContractWasm({ wasm }));
  const res = await signAndSubmit(tx, signer);
  log(`uploaded ${path.split('/').pop()} -> wasm hash ${wasmHash.slice(0, 12)}… (tx ${res.hash.slice(0, 10)}…)`);
  return wasmHash;
}
// snippet:end uploadWasm

// snippet:start deployContract
/** Deploy a contract instance from an uploaded wasm hash, running its __constructor with `args`. */
export async function deployContract(wasmHash: string, signer: Keypair, args: xdr.ScVal[], salt?: Buffer): Promise<{ contractId: string; hash: string }> {
  const op = Operation.createCustomContract({
    address: new Address(signer.publicKey()),
    wasmHash: Buffer.from(wasmHash, 'hex'),
    constructorArgs: args,
    salt: salt ?? Keypair.random().rawPublicKey(),
  });
  const tx = await prepareOp(signer, op);
  const res = await signAndSubmit(tx, signer);
  const rv = res.response.status === rpc.Api.GetTransactionStatus.SUCCESS ? res.response.returnValue : undefined;
  if (!rv) throw new Error('deploy returned no value');
  return { contractId: Address.fromScVal(rv).toString(), hash: res.hash };
}
// snippet:end deployContract

// snippet:start deploySac
/** Deploy the Stellar Asset Contract for a classic asset (anyone may; the id is deterministic). */
export async function deploySac(asset: Asset, signer: Keypair): Promise<string> {
  const contractId = asset.contractId(PASSPHRASE);
  try {
    const tx = await prepareOp(signer, Operation.createStellarAssetContract({ asset }));
    await signAndSubmit(tx, signer);
    log(`deployed SAC for ${asset.getCode()}:${(asset.getIssuer() ?? '').slice(0, 6)}… -> ${contractId}`);
  } catch (e) {
    if (String(e).includes('ExistingValue')) log(`SAC already exists -> ${contractId}`);
    else throw e;
  }
  return contractId;
}
// snippet:end deploySac

/** Invoke a contract function, signing as `signer` (which is also the tx source, so its require_auth is satisfied). */
export async function invoke(contractId: string, method: string, args: xdr.ScVal[], signer: Keypair): Promise<SubmitResult> {
  const prepared = await prepareInvoke(ENV, signer.publicKey(), contractId, method, args);
  const res = await signAndSubmit(prepared.tx, signer);
  log(`${method} on ${contractId.slice(0, 8)}… ok (tx ${res.hash.slice(0, 10)}…)`);
  return res;
}

export async function read<T>(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
  return (await simulateRead<T>(ENV, contractId, method, args)).value;
}
