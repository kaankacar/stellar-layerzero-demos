/**
 * Find the LayerZero GUID of a message sent by a Stellar transaction.
 *
 * The endpoint emits `packet_sent` with the encoded packet:
 *   version u8 | nonce u64 | srcEid u32 | sender 32 | dstEid u32 | receiver 32 | guid 32 | message...
 * LayerZero Scan indexes Stellar-testnet messages by GUID before it fills in
 * the source tx hash, so a tx-hash lookup can 404 while `/messages/guid/{guid}`
 * already works. Reading the GUID from the chain closes that gap.
 */
import { rpc, scValToNative } from '@stellar/stellar-sdk';
import type { StellarEnv } from '@/config/networks';
import { STELLAR_FALLBACK } from '@/config/layerzero.fallback';
import { withRpc } from '@/lib/stellar/rpc';
import { bytesToHex, type Hex } from '@/lib/hex';

export interface PacketSent {
  guid: Hex;
  nonce: bigint;
  srcEid: number;
  dstEid: number;
  sender: Hex;
  receiver: Hex;
  ledger: number;
}

// snippet:start findPacketSent
export async function findPacketSent(env: StellarEnv, txHash: string): Promise<PacketSent | null> {
  const endpoint = STELLAR_FALLBACK[env].endpointV2;
  return withRpc(env, async (server) => {
    const tx = await server.getTransaction(txHash);
    if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS) return null;
    const events = await server.getEvents({
      startLedger: tx.ledger,
      endLedger: tx.ledger + 1,
      filters: [{ type: 'contract', contractIds: [endpoint] }],
      limit: 200,
    });
    for (const ev of events.events) {
      if (ev.txHash !== txHash) continue;
      const topic0 = ev.topic[0] ? scValToNative(ev.topic[0]) : null;
      if (topic0 !== 'packet_sent') continue;
      const value = scValToNative(ev.value) as { encoded_packet?: Uint8Array };
      const p = value.encoded_packet;
      if (!p || p.length < 113) continue;
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
        ledger: tx.ledger,
      };
    }
    return null;
  });
}
// snippet:end findPacketSent
