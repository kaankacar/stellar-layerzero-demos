/**
 * LayerZero packet header (81 bytes). DVNs sign the hash of this header plus
 * the payload hash: it is literally what a DVN attests to.
 *
 *   version u8 | nonce u64 | srcEid u32 | sender bytes32 | dstEid u32 | receiver bytes32
 */
import { bytesToBigintBE, bytesToHex, hexToBytes, type Hex } from '@/lib/hex';

export interface PacketHeader {
  version: number;
  nonce: bigint;
  srcEid: number;
  sender: Hex;
  dstEid: number;
  receiver: Hex;
}

// snippet:start decodePacketHeader
export function decodePacketHeader(hex: string): PacketHeader {
  const b = hexToBytes(hex);
  if (b.length !== 81) throw new Error(`packet header must be 81 bytes, got ${b.length}`);
  return {
    version: b[0]!,
    nonce: bytesToBigintBE(b.slice(1, 9)),
    srcEid: Number(bytesToBigintBE(b.slice(9, 13))),
    sender: bytesToHex(b.slice(13, 45)) as Hex,
    dstEid: Number(bytesToBigintBE(b.slice(45, 49))),
    receiver: bytesToHex(b.slice(49, 81)) as Hex,
  };
}
// snippet:end decodePacketHeader
