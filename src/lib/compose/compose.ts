/**
 * Compose page: a Soroban vault whose users only hold an EVM wallet.
 *
 * Deposit (EVM -> Stellar): `OFT.send` with `to` = the vault's 32-byte contract
 * id, an lzCompose executor option, and the note as `composeMsg`. On Stellar the
 * OFT mints tUSDT0 to the vault and queues a compose message on the endpoint;
 * the executor (or anyone) calls `lz_compose` on the vault, which credits the
 * sender's EVM address.
 *
 * Withdraw (Stellar only, MetaMask signs): the vault returns the 32-byte digest
 * to sign; MetaMask `personal_sign`s it; a throwaway Stellar key from this
 * browser submits `withdraw(evm, to, amount, signature)` and pays the fee.
 */
import { Keypair, rpc, scValToNative } from '@stellar/stellar-sdk';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import type { StellarEnv } from '@/config/networks';
import { OFT_ABI } from '@/lib/evm/abi/oft';
import { evmFeeOverrides, evmQuoteSend, evmSend, readableEvmError, type EvmSendParam } from '@/lib/evm/oft';
import { publicActions } from 'viem';
import { bytesToHex, hexToBytes } from '@/lib/hex';
import { encodeLzComposeOption } from '@/lib/layerzero/options';
import { fundWithFriendbot } from '@/lib/stellar/friendbot';
import { withRpc } from '@/lib/stellar/rpc';
import { getTokenBalance } from '@/lib/stellar/sac';
import { asBytes, sc } from '@/lib/stellar/scval';
import { readContract } from '@/lib/stellar/simulate';
import { stellarAddressToHex } from '@/lib/stellar/strkey';
import { prepareInvoke, submitAndPoll, type PreparedTx, type SubmitResult } from '@/lib/stellar/tx';

/** Executor budget for lz_compose on Stellar; the same figure the pathway enforces for lz_receive. */
export const COMPOSE_GAS = 500_000n;
export const MAX_NOTE_BYTES = 140;
export const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

export interface VaultDeposit {
  guid: Hex;
  srcEid: number;
  from: Address;
  /** Local decimals (7). */
  amount: bigint;
  note: string;
  ledger: number;
  timestamp: number;
}
export interface VaultState {
  count: number;
  /** tUSDT0 the vault contract holds (SAC balance, 7 decimals). */
  held: bigint;
  deposits: VaultDeposit[];
  /** Credited balance and withdrawal nonce of the connected EVM address, when one is connected. */
  balance: bigint | null;
  nonce: number | null;
}

/** The 20 raw bytes of an EVM address, the vault's account key. */
export const evm20 = (address: string): Uint8Array => hexToBytes(address);

// snippet:start composeDeposit
/**
 * SendParam for a deposit. Three things differ from a plain transfer: the recipient is a contract (the vault),
 * extraOptions carries an lzCompose option so the executor also calls lz_compose, and composeMsg carries the note.
 * The OFT sees a composeMsg and uses message type 2 (SEND_AND_CALL) with its enforced options.
 */
export function depositParam(vault: string, amount6: bigint, note: string): EvmSendParam {
  return {
    dstEid: 40600,
    to: stellarAddressToHex(vault), // the vault's raw 32-byte contract id
    amountLD: amount6, // the EVM token has 6 decimals
    minAmountLD: 0n,
    extraOptions: encodeLzComposeOption(0, COMPOSE_GAS),
    composeMsg: bytesToHex(utf8.encode(note)) as Hex,
  };
}
export const quoteDeposit = (client: PublicClient, oft: Address, p: EvmSendParam) => evmQuoteSend(client, oft, p);
/** MetaMask signs one transaction: burn on the EVM side, fee as msg.value. */
export const sendDeposit = (wallet: WalletClient, oft: Address, p: EvmSendParam, nativeFee: bigint, refund: Address) => evmSend(wallet, oft, p, nativeFee, refund);
/** Testnet faucet on the EVM TestOFT: 1,000 tUSDT0 per hour to the caller. */
export async function evmFaucet(wallet: WalletClient, oft: Address): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error('wallet has no account');
  try {
    const { request } = await wallet.extend(publicActions).simulateContract({ address: oft, abi: OFT_ABI, functionName: 'faucet', account, chain: wallet.chain });
    return await wallet.writeContract({ ...request, ...(await evmFeeOverrides(wallet)) });
  } catch (e) {
    const err = readableEvmError(e);
    throw /cooldown/i.test(err.message) ? new Error('faucet: one drip per address per hour; try again later') : err;
  }
}
// snippet:end composeDeposit

// snippet:start vaultReads
interface RawDeposit {
  guid: Uint8Array;
  src_eid: number;
  from: Uint8Array;
  amount: bigint;
  note: Uint8Array;
  ledger: number;
  timestamp: bigint;
}
/** Everything the page shows, via read-only simulation of the vault's views plus the SAC balance of the vault. */
export async function loadVault(env: StellarEnv, vault: string, sac: string, evmAddress: Address | null): Promise<VaultState> {
  const [count, raw, held, balance, nonce] = await Promise.all([
    readContract<bigint>(env, vault, 'count'),
    readContract<RawDeposit[]>(env, vault, 'deposits'),
    getTokenBalance(env, sac, vault),
    evmAddress ? readContract<bigint>(env, vault, 'balance', [sc.bytes(evm20(evmAddress))]) : Promise.resolve(null),
    evmAddress ? readContract<bigint>(env, vault, 'nonce', [sc.bytes(evm20(evmAddress))]) : Promise.resolve(null),
  ]);
  return {
    count: Number(count),
    held,
    deposits: raw.map((d) => ({
      guid: bytesToHex(asBytes(d.guid)) as Hex,
      srcEid: Number(d.src_eid),
      from: bytesToHex(asBytes(d.from)) as Address,
      amount: BigInt(d.amount),
      note: utf8Decoder.decode(asBytes(d.note)),
      ledger: Number(d.ledger),
      timestamp: Number(d.timestamp),
    })),
    balance: balance === null ? null : BigInt(balance),
    nonce: nonce === null ? null : Number(nonce),
  };
}
// snippet:end vaultReads

// snippet:start withdrawFlow
/** The exact 32 bytes to sign: keccak256(domain ‖ vault ‖ evm ‖ nonce ‖ amount ‖ to), computed by the contract itself. */
export async function withdrawDigest(env: StellarEnv, vault: string, evm: Address, to: string, amount7: bigint): Promise<Hex> {
  const digest = await readContract<Uint8Array>(env, vault, 'withdraw_digest', [sc.bytes(evm20(evm)), sc.address(to), sc.i128(amount7)]);
  return bytesToHex(asBytes(digest)) as Hex;
}
/** personal_sign over the raw 32 bytes (EIP-191). MetaMask shows the hex; the contract re-derives it from the arguments. */
export async function signDigest(wallet: WalletClient, digest: Hex): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error('wallet has no account');
  return wallet.signMessage({ account, message: { raw: digest } });
}
/** withdraw(evm, to, amount, signature): `source` only pays the Stellar fee; the signature is the authorization. */
export function prepareWithdraw(env: StellarEnv, source: string, vault: string, evm: Address, to: string, amount7: bigint, signature: Hex): Promise<PreparedTx> {
  return prepareInvoke(env, source, vault, 'withdraw', [sc.bytes(evm20(evm)), sc.address(to), sc.i128(amount7), sc.bytes(hexToBytes(signature))]);
}
// snippet:end withdrawFlow

// snippet:start relayer
const RELAYER_KEY = 'lz-demos:compose-relayer';
/**
 * A throwaway Stellar keypair kept in this browser. It never holds tokens; it only pays the fee to submit
 * `withdraw` and, if the executor is slow, `lz_compose`. Friendbot funds it on first use.
 */
export function relayerKeypair(): Keypair {
  try {
    const saved = localStorage.getItem(RELAYER_KEY);
    if (saved) return Keypair.fromSecret(saved);
  } catch {
    /* private mode or blocked storage: fall through to an ephemeral key */
  }
  const kp = Keypair.random();
  try {
    localStorage.setItem(RELAYER_KEY, kp.secret());
  } catch {
    /* ignore */
  }
  return kp;
}
export async function ensureFunded(env: StellarEnv, address: string): Promise<'exists' | 'funded'> {
  const exists = await withRpc(env, (server) => server.getAccount(address).then(() => true).catch(() => false));
  if (exists) return 'exists';
  await fundWithFriendbot(address);
  return 'funded';
}
export async function submitWithKeypair(env: StellarEnv, prepared: PreparedTx, kp: Keypair): Promise<SubmitResult> {
  prepared.tx.sign(kp);
  return submitAndPoll(env, prepared.tx.toXDR());
}
// snippet:end relayer

// snippet:start composeFallback
/** Is a compose message from `oft` to `vault` for this GUID still waiting on the endpoint? (compose_queue keeps the hash until cleared.) */
export async function composeQueued(env: StellarEnv, endpoint: string, oft: string, vault: string, guid: Hex): Promise<boolean> {
  const hash = await readContract<Uint8Array | null | undefined>(env, endpoint, 'compose_queue', [sc.address(oft), sc.address(vault), sc.bytes(hexToBytes(guid)), sc.u32(0)]);
  return hash !== null && hash !== undefined;
}
export interface ComposeSent {
  message: Hex;
  txHash: string;
  ledger: number;
}
/**
 * The compose payload the OFT queued, read from the endpoint's ComposeSent event in the Stellar delivery
 * transaction (topics: compose_sent, from, to, guid, index; data: { message }). That payload is what lz_compose needs.
 */
export async function findComposeSent(env: StellarEnv, endpoint: string, vault: string, guid: Hex, deliveryTxHash: string): Promise<ComposeSent | null> {
  return withRpc(env, async (server) => {
    const tx = await server.getTransaction(deliveryTxHash);
    if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS) return null;
    const events = await server.getEvents({ startLedger: tx.ledger, endLedger: tx.ledger + 1, filters: [{ type: 'contract', contractIds: [endpoint] }], limit: 200 });
    for (const ev of events.events) {
      if (ev.txHash !== deliveryTxHash) continue;
      const topics = ev.topic.map((t) => scValToNative(t) as unknown);
      // #[contractevent] names are snake_case on the wire: ComposeSent -> compose_sent (PacketSent -> packet_sent).
      if (topics[0] !== 'compose_sent' || topics[2] !== vault) continue;
      if (bytesToHex(asBytes(topics[3])).toLowerCase() !== guid.toLowerCase()) continue;
      const data = scValToNative(ev.value) as { message?: Uint8Array };
      if (!data.message) continue;
      return { message: bytesToHex(asBytes(data.message)) as Hex, txHash: deliveryTxHash, ledger: tx.ledger };
    }
    return null;
  });
}
/**
 * Execute the compose yourself: lz_compose(executor, from = OFT, guid, index 0, message, extra_data, value 0).
 * The vault does not require the executor's auth; the endpoint's clear_compose proves the message is genuine.
 */
export function prepareLzCompose(env: StellarEnv, executor: string, vault: string, oft: string, guid: Hex, message: Hex): Promise<PreparedTx> {
  return prepareInvoke(env, executor, vault, 'lz_compose', [sc.address(executor), sc.address(oft), sc.bytes(hexToBytes(guid)), sc.u32(0), sc.bytes(hexToBytes(message)), sc.bytes(new Uint8Array()), sc.i128(0n)]);
}
// snippet:end composeFallback
