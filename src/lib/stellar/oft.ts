/**
 * Typed wrappers around the LayerZero OFT contract on Stellar. Signatures are
 * read from the deployed USDT0 OFT (`stellar contract info interface`):
 *
 *   quote_oft(from, send_param) -> (OFTLimit, Vec<OFTFeeDetail>, OFTReceipt)
 *   quote_send(from, send_param, pay_in_zro) -> MessagingFee
 *   send(from, send_param, fee, refund_address) -> (MessagingReceipt, OFTReceipt)
 *   peer(eid) -> Option<BytesN<32>>          enforced_options(eid, msg_type) -> Option<Bytes>
 */
import type { xdr } from '@stellar/stellar-sdk';
import type { StellarEnv } from '@/config/networks';
import { bytesToHex, type Hex } from '@/lib/hex';
import { sc, asBytes, enumVariant, optional } from '@/lib/stellar/scval';
import { simulateRead, readContract, type SimResult } from '@/lib/stellar/simulate';
import { prepareInvoke, type PreparedTx } from '@/lib/stellar/tx';

export interface SendParam {
  dstEid: number;
  /** 32-byte recipient: left-padded EVM address, or a Stellar strkey payload. */
  to: Uint8Array;
  amountLd: bigint;
  minAmountLd: bigint;
  extraOptions?: Uint8Array;
  composeMsg?: Uint8Array;
  oftCmd?: Uint8Array;
}
export interface MessagingFee {
  nativeFee: bigint;
  zroFee: bigint;
}
export interface OftQuote {
  limit: { minAmountLd: bigint; maxAmountLd: bigint };
  fees: { description: string; feeAmountLd: bigint }[];
  receipt: { amountSentLd: bigint; amountReceivedLd: bigint };
}
export interface OftFacts {
  token: string;
  sharedDecimals: number;
  decimalConversionRate: bigint;
  oftType: { variant: 'MintBurn' | 'LockUnlock' | string; minter: string | null };
  isPaused: boolean;
  owner: string | null;
  endpoint: string;
  oftVersion: string;
  approvalRequired: boolean;
}

// snippet:start sendParamScVal
/** A Rust struct becomes a sorted ScMap; BytesN<32> is a 32-byte ScBytes; i128 amounts are bigints. */
export function sendParamScVal(p: SendParam): xdr.ScVal {
  if (p.to.length !== 32) throw new Error('`to` must be exactly 32 bytes');
  return sc.struct({
    amount_ld: sc.i128(p.amountLd),
    compose_msg: sc.bytes(p.composeMsg ?? new Uint8Array()),
    dst_eid: sc.u32(p.dstEid),
    extra_options: sc.bytes(p.extraOptions ?? new Uint8Array()),
    min_amount_ld: sc.i128(p.minAmountLd),
    oft_cmd: sc.bytes(p.oftCmd ?? new Uint8Array()),
    to: sc.bytes(p.to),
  });
}
export function messagingFeeScVal(f: MessagingFee): xdr.ScVal {
  return sc.struct({ native_fee: sc.i128(f.nativeFee), zro_fee: sc.i128(f.zroFee) });
}
// snippet:end sendParamScVal

type RawFee = { native_fee: bigint; zro_fee: bigint };
type RawQuote = [
  { min_amount_ld: bigint; max_amount_ld: bigint },
  { fee_amount_ld: bigint; description: Uint8Array }[],
  { amount_sent_ld: bigint; amount_received_ld: bigint },
];

// snippet:start quoteOft
/** What will actually arrive? Dust removal and OFT fees are applied here, before any XLM fee. */
export async function quoteOft(env: StellarEnv, oft: string, from: string, param: SendParam): Promise<SimResult<OftQuote>> {
  const sim = await simulateRead<RawQuote>(env, oft, 'quote_oft', [sc.address(from), sendParamScVal(param)], from);
  const [limit, fees, receipt] = sim.value;
  return {
    ...sim,
    value: {
      limit: { minAmountLd: BigInt(limit.min_amount_ld), maxAmountLd: BigInt(limit.max_amount_ld) },
      fees: fees.map((f) => ({ description: new TextDecoder().decode(asBytes(f.description)), feeAmountLd: BigInt(f.fee_amount_ld) })),
      receipt: { amountSentLd: BigInt(receipt.amount_sent_ld), amountReceivedLd: BigInt(receipt.amount_received_ld) },
    },
  };
}

/** What does the LayerZero message cost? Paid in XLM (stroops) to the endpoint inside `send`. */
export async function quoteSend(env: StellarEnv, oft: string, from: string, param: SendParam, payInZro = false): Promise<SimResult<MessagingFee>> {
  const sim = await simulateRead<RawFee>(env, oft, 'quote_send', [sc.address(from), sendParamScVal(param), sc.bool(payInZro)], from);
  return { ...sim, value: { nativeFee: BigInt(sim.value.native_fee), zroFee: BigInt(sim.value.zro_fee) } };
}
// snippet:end quoteOft

// snippet:start prepareOftSend
/** Build the `send` transaction for the wallet to sign. `from` is the tx source, so its require_auth is covered by the signature. */
export function prepareOftSend(env: StellarEnv, oft: string, from: string, param: SendParam, fee: MessagingFee, refundAddress = from): Promise<PreparedTx> {
  return prepareInvoke(env, from, oft, 'send', [sc.address(from), sendParamScVal(param), messagingFeeScVal(fee), sc.address(refundAddress)]);
}
// snippet:end prepareOftSend

export async function getPeer(env: StellarEnv, oft: string, eid: number): Promise<Hex | null> {
  const v = optional<Uint8Array>(await readContract(env, oft, 'peer', [sc.u32(eid)]));
  return v ? (bytesToHex(asBytes(v)) as Hex) : null;
}

export async function getEnforcedOptions(env: StellarEnv, oft: string, eid: number, msgType = 1): Promise<Hex | null> {
  const v = optional<Uint8Array>(await readContract(env, oft, 'enforced_options', [sc.u32(eid), sc.u32(msgType)]));
  return v ? (bytesToHex(asBytes(v)) as Hex) : null;
}

export async function getEffectiveFeeBps(env: StellarEnv, oft: string, dstEid: number): Promise<number> {
  return Number(await readContract<number | bigint>(env, oft, 'effective_fee_bps', [sc.u32(dstEid)]));
}

export interface RateLimitConfig {
  limit: bigint;
  windowSeconds: bigint;
  mode: string;
}
export async function getRateLimitConfig(env: StellarEnv, oft: string, direction: 'Inbound' | 'Outbound', eid: number): Promise<RateLimitConfig | null> {
  const v = optional<{ limit: bigint; window_seconds: bigint; mode: unknown }>(
    await readContract(env, oft, 'rate_limit_config', [sc.enumUnit(direction), sc.u32(eid)]),
  );
  return v ? { limit: BigInt(v.limit), windowSeconds: BigInt(v.window_seconds), mode: enumVariant(v.mode).variant } : null;
}

// snippet:start getOftFacts
export async function getOftFacts(env: StellarEnv, oft: string): Promise<OftFacts> {
  const read = <T,>(m: string) => readContract<T>(env, oft, m);
  const [token, sharedDecimals, rate, oftType, isPaused, owner, endpoint, version, approval] = await Promise.all([
    read<string>('token'),
    read<number>('shared_decimals'),
    read<bigint>('decimal_conversion_rate'),
    read<unknown>('oft_type'),
    read<boolean>('is_paused'),
    read<string | null>('owner'),
    read<string>('endpoint'),
    read<[bigint, bigint]>('oft_version'),
    read<boolean>('approval_required'),
  ]);
  const t = enumVariant(oftType);
  return {
    token,
    sharedDecimals: Number(sharedDecimals),
    decimalConversionRate: BigInt(rate),
    oftType: { variant: t.variant, minter: typeof t.payload[0] === 'string' ? t.payload[0] : null },
    isPaused,
    owner: owner ?? null,
    endpoint,
    oftVersion: `${version[0]}.${version[1]}`,
    approvalRequired: approval,
  };
}
// snippet:end getOftFacts
