/**
 * Permissionless delivery on the Stellar destination.
 *
 * On Stellar the OApp's `lz_receive(executor, origin, guid, message, extra_data, value)`
 * only requires the *given* executor address to authorize (pull mode), so any
 * account can be the executor: pass yourself and sign. Before that, the ULN302's
 * `commit_verification(packet_header, payload_hash)` (also permissionless) moves
 * the DVN attestation into the endpoint. payload_hash = keccak256(guid ‖ message).
 */
import { keccak256, parseAbi, parseEventLogs, type Hex, type PublicClient } from 'viem';
import type { StellarEnv } from '@/config/networks';
import { bytesToHex, hexToBytes, concatBytes } from '@/lib/hex';
import { sc, asBytes, optional } from '@/lib/stellar/scval';
import { readContract } from '@/lib/stellar/simulate';
import { prepareInvoke, type PreparedTx } from '@/lib/stellar/tx';
import type { PacketSent } from '@/lib/stellar/packetEvents';

const ENDPOINT_EVENTS = parseAbi(['event PacketSent(bytes encodedPayload, bytes options, address sendLibrary)']);

// snippet:start findPacketSentEvm
/** Read the encoded packet from an EVM source transaction's PacketSent event. */
export async function findPacketSentEvm(client: PublicClient, txHash: Hex): Promise<PacketSent | null> {
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const logs = parseEventLogs({ abi: ENDPOINT_EVENTS, logs: receipt.logs, eventName: 'PacketSent' });
  const encoded = logs[0]?.args.encodedPayload;
  if (!encoded) return null;
  const p = hexToBytes(encoded);
  const u32 = (o: number) => ((p[o]! << 24) | (p[o + 1]! << 16) | (p[o + 2]! << 8) | p[o + 3]!) >>> 0;
  let nonce = 0n;
  for (let i = 1; i < 9; i++) nonce = (nonce << 8n) | BigInt(p[i]!);
  return {
    guid: bytesToHex(p.slice(81, 113)) as Hex,
    nonce,
    srcEid: u32(9),
    sender: bytesToHex(p.slice(13, 45)) as Hex,
    dstEid: u32(45),
    receiver: bytesToHex(p.slice(49, 81)) as Hex,
    ledger: Number(receipt.blockNumber),
    packet: encoded,
    header: bytesToHex(p.slice(0, 81)) as Hex,
    message: bytesToHex(p.slice(113)) as Hex,
  };
}
// snippet:end findPacketSentEvm

export const payloadHash = (guid: Hex, message: Hex): Hex => keccak256(bytesToHex(concatBytes(hexToBytes(guid), hexToBytes(message))) as Hex);

export type StellarInboundState = 'NotVerified' | 'Verified' | 'Executed';

// snippet:start stellarInboundState
export async function stellarInboundState(env: StellarEnv, endpoint: string, receiver: string, p: PacketSent): Promise<StellarInboundState> {
  const [hash, inbound] = await Promise.all([
    readContract<Uint8Array | null | undefined>(env, endpoint, 'inbound_payload_hash', [sc.address(receiver), sc.u32(p.srcEid), sc.bytes(hexToBytes(p.sender)), sc.u64(p.nonce)]),
    readContract<bigint>(env, endpoint, 'inbound_nonce', [sc.address(receiver), sc.u32(p.srcEid), sc.bytes(hexToBytes(p.sender))]),
  ]);
  if (optional(hash)) return 'Verified';
  return BigInt(inbound) >= p.nonce ? 'Executed' : 'NotVerified';
}

/** Has the DVN set attested on the receive library (so commit_verification will succeed)? */
export async function ulnVerifiable(env: StellarEnv, uln: string, p: PacketSent): Promise<boolean> {
  return readContract<boolean>(env, uln, 'verifiable', [sc.bytes(hexToBytes(p.header)), sc.bytes(hexToBytes(payloadHash(p.guid, p.message)))]);
}
// snippet:end stellarInboundState

// snippet:start stellarDeliver
export function prepareCommitVerification(env: StellarEnv, caller: string, uln: string, p: PacketSent): Promise<PreparedTx> {
  return prepareInvoke(env, caller, uln, 'commit_verification', [sc.bytes(hexToBytes(p.header)), sc.bytes(hexToBytes(payloadHash(p.guid, p.message)))]);
}
/** You are the executor: the OApp clears the payload on the endpoint and credits the recipient. */
export function prepareLzReceive(env: StellarEnv, executor: string, oapp: string, p: PacketSent): Promise<PreparedTx> {
  const origin = sc.struct({ nonce: sc.u64(p.nonce), sender: sc.bytes(hexToBytes(p.sender)), src_eid: sc.u32(p.srcEid) });
  return prepareInvoke(env, executor, oapp, 'lz_receive', [sc.address(executor), origin, sc.bytes(hexToBytes(p.guid)), sc.bytes(hexToBytes(p.message)), sc.bytes(new Uint8Array()), sc.i128(0n)]);
}
// snippet:end stellarDeliver

export { asBytes };
