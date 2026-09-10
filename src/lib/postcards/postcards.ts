/**
 * Postcards: raw LayerZero messages. Stellar side = contracts/stellar/postcard-oapp,
 * EVM side = contracts/evm/src/PostcardOApp.sol. Both keep the last 50 received.
 */
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import type { StellarEnv } from '@/config/networks';
import { readContract } from '@/lib/stellar/simulate';
import { prepareInvoke, type PreparedTx } from '@/lib/stellar/tx';
import { sc, asBytes } from '@/lib/stellar/scval';
import { bytesToHex } from '@/lib/hex';
import { POSTCARD_ABI } from '@/lib/evm/abi/postcard';

export interface PostcardItem {
  guid: Hex;
  srcEid: number;
  sender: Hex;
  text: string;
  timestamp: number; // seconds
  storedOn: 'stellar' | 'evm';
}

export const MAX_POSTCARD_BYTES = 140;
export const utf8 = new TextEncoder();
export const utf8Decoder = new TextDecoder();

// snippet:start stellarPostcards
type RawCard = { src_eid: number; sender: Uint8Array; guid: Uint8Array; text: Uint8Array; ledger: number; timestamp: bigint };
export async function loadStellarPostcards(env: StellarEnv, contract: string): Promise<PostcardItem[]> {
  const cards = await readContract<RawCard[]>(env, contract, 'postcards');
  return cards.map((c) => ({
    guid: bytesToHex(asBytes(c.guid)) as Hex,
    srcEid: Number(c.src_eid),
    sender: bytesToHex(asBytes(c.sender)) as Hex,
    text: utf8Decoder.decode(asBytes(c.text)),
    timestamp: Number(c.timestamp),
    storedOn: 'stellar',
  }));
}

export async function quoteStellarPostcard(env: StellarEnv, contract: string, dstEid: number, text: string): Promise<bigint> {
  const fee = await readContract<{ native_fee: bigint; zro_fee: bigint }>(env, contract, 'quote_postcard', [sc.u32(dstEid), sc.bytes(utf8.encode(text)), sc.bytes(new Uint8Array()), sc.bool(false)]);
  return BigInt(fee.native_fee);
}

/** send_postcard(caller, dst_eid, text, options, fee): caller is the tx source, pays the XLM fee, gets refunds. */
export function prepareStellarPostcard(env: StellarEnv, contract: string, caller: string, dstEid: number, text: string, nativeFee: bigint): Promise<PreparedTx> {
  return prepareInvoke(env, caller, contract, 'send_postcard', [sc.address(caller), sc.u32(dstEid), sc.bytes(utf8.encode(text)), sc.bytes(new Uint8Array()), sc.struct({ native_fee: sc.i128(nativeFee), zro_fee: sc.i128(0n) })]);
}
// snippet:end stellarPostcards

// snippet:start evmPostcards
export async function loadEvmPostcards(client: PublicClient, contract: Address): Promise<PostcardItem[]> {
  const cards = await client.readContract({ address: contract, abi: POSTCARD_ABI, functionName: 'postcards' });
  return cards.map((c) => ({ guid: c.guid, srcEid: c.srcEid, sender: c.sender, text: c.text, timestamp: Number(c.timestamp), storedOn: 'evm' as const }));
}
export async function quoteEvmPostcard(client: PublicClient, contract: Address, dstEid: number, text: string): Promise<bigint> {
  const fee = await client.readContract({ address: contract, abi: POSTCARD_ABI, functionName: 'quote', args: [dstEid, text, '0x'] });
  return fee.nativeFee;
}
export async function sendEvmPostcard(wallet: WalletClient, contract: Address, dstEid: number, text: string, nativeFee: bigint): Promise<Hex> {
  if (!wallet.account) throw new Error('no account');
  return wallet.writeContract({ address: contract, abi: POSTCARD_ABI, functionName: 'sendPostcard', args: [dstEid, text, '0x'], value: nativeFee, account: wallet.account, chain: wallet.chain });
}
// snippet:end evmPostcards
