/**
 * OFT message codec (identical on Stellar and EVM):
 *
 *   send_to    bytes32   recipient, resolved on the destination
 *   amount_sd  u64       amount in *shared* decimals (6 for USDT0)
 *   compose_from bytes32 (only for SEND_AND_CALL)
 *   compose_msg  bytes   (only for SEND_AND_CALL)
 *
 * Because the wire amount is in shared decimals, anything below the local
 * decimal_conversion_rate (10 for a 7-decimal Stellar asset) cannot be
 * represented and is removed before sending: that is the "dust".
 */
import { bytesToBigintBE, bytesToHex, hexToBytes, type Hex } from '@/lib/hex';

export interface OftMessage {
  sendTo: Hex;
  amountSd: bigint;
  isComposed: boolean;
  composeFrom?: Hex;
  composeMsg?: Hex;
}

// snippet:start decodeOftMessage
export function decodeOftMessage(hex: string): OftMessage {
  const b = hexToBytes(hex);
  if (b.length < 40) throw new Error(`OFT message must be at least 40 bytes, got ${b.length}`);
  const msg: OftMessage = {
    sendTo: bytesToHex(b.slice(0, 32)) as Hex,
    amountSd: bytesToBigintBE(b.slice(32, 40)),
    isComposed: b.length > 40,
  };
  if (msg.isComposed) {
    msg.composeFrom = bytesToHex(b.slice(40, 72)) as Hex;
    msg.composeMsg = bytesToHex(b.slice(72)) as Hex;
  }
  return msg;
}
// snippet:end decodeOftMessage

// snippet:start dustMath
/** local -> shared decimals: floor division by the conversion rate. */
export function toSharedDecimals(amountLd: bigint, conversionRate: bigint): bigint {
  return amountLd / conversionRate;
}
/** shared -> local decimals: exact multiplication. */
export function toLocalDecimals(amountSd: bigint, conversionRate: bigint): bigint {
  return amountSd * conversionRate;
}
/** What the OFT does before building the message: strip anything below the rate. */
export function removeDust(amountLd: bigint, conversionRate: bigint): { sent: bigint; dust: bigint } {
  const sent = (amountLd / conversionRate) * conversionRate;
  return { sent, dust: amountLd - sent };
}
// snippet:end dustMath

export function conversionRate(localDecimals: number, sharedDecimals: number): bigint {
  if (localDecimals < sharedDecimals) throw new Error('local decimals must be >= shared decimals');
  return 10n ** BigInt(localDecimals - sharedDecimals);
}
