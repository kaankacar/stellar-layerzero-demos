/**
 * Permissionless delivery on an EVM destination.
 *
 * Once every required DVN has attested, two calls finish a message, and
 * ANYONE may make them (the executor is a convenience, not a gatekeeper):
 *   1. ReceiveUln302.commitVerification(packetHeader, payloadHash)  -> endpoint.verify(...)
 *   2. EndpointV2.lzReceive(origin, receiver, guid, message, extraData) -> OApp._lzReceive(...)
 * payloadHash = keccak256(guid ‖ message). Both values come straight from the
 * source chain's packet_sent event, so a Stellar tx hash is all you need.
 */
import { keccak256, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { bytes32ToEvmAddress, hexToBytes, bytesToHex, concatBytes } from '@/lib/hex';
import type { PacketSent } from '@/lib/stellar/packetEvents';

export const RECEIVE_ULN_ABI = parseAbi([
  'function commitVerification(bytes _packetHeader, bytes32 _payloadHash)',
  'function verifiable((uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs) _config, bytes32 _headerHash, bytes32 _payloadHash) view returns (bool)',
  'function getUlnConfig(address _oapp, uint32 _remoteEid) view returns ((uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs))',
]);
export const ENDPOINT_ABI = parseAbi([
  'struct Origin { uint32 srcEid; bytes32 sender; uint64 nonce; }',
  'function lzReceive(Origin _origin, address _receiver, bytes32 _guid, bytes _message, bytes _extraData) payable',
  'function inboundPayloadHash(address _receiver, uint32 _srcEid, bytes32 _sender, uint64 _nonce) view returns (bytes32)',
  'function lazyInboundNonce(address _receiver, uint32 _srcEid, bytes32 _sender) view returns (uint64)',
  'function inboundNonce(address _receiver, uint32 _srcEid, bytes32 _sender) view returns (uint64)',
]);

/** Derived from the endpoint's messaging channel (the `executable` helper lives in a separate EndpointV2View contract). */
export const EXECUTION_STATE = ['NotExecutable', 'VerifiedButNotExecutable', 'Executable', 'Executed'] as const;
const ZERO32 = `0x${'0'.repeat(64)}` as Hex;

export function payloadHashOf(guid: Hex, message: Hex): Hex {
  return keccak256(bytesToHex(concatBytes(hexToBytes(guid), hexToBytes(message))) as Hex);
}

export interface DeliveryPlan {
  origin: { srcEid: number; sender: Hex; nonce: bigint };
  receiver: Address;
  guid: Hex;
  message: Hex;
  header: Hex;
  payloadHash: Hex;
}

export function planFromPacket(p: PacketSent): DeliveryPlan {
  return {
    origin: { srcEid: p.srcEid, sender: p.sender, nonce: p.nonce },
    receiver: bytes32ToEvmAddress(p.receiver),
    guid: p.guid,
    message: p.message,
    header: p.header,
    payloadHash: payloadHashOf(p.guid, p.message),
  };
}

// snippet:start executionState
export async function executionState(client: PublicClient, endpoint: Address, plan: DeliveryPlan): Promise<(typeof EXECUTION_STATE)[number]> {
  const { srcEid, sender, nonce } = plan.origin;
  const [hash, lazy, inbound] = await Promise.all([
    client.readContract({ address: endpoint, abi: ENDPOINT_ABI, functionName: 'inboundPayloadHash', args: [plan.receiver, srcEid, sender, nonce] }),
    client.readContract({ address: endpoint, abi: ENDPOINT_ABI, functionName: 'lazyInboundNonce', args: [plan.receiver, srcEid, sender] }),
    client.readContract({ address: endpoint, abi: ENDPOINT_ABI, functionName: 'inboundNonce', args: [plan.receiver, srcEid, sender] }),
  ]);
  if (hash === ZERO32) return lazy >= nonce ? 'Executed' : 'NotExecutable'; // cleared after execution, or never verified
  return inbound >= nonce ? 'Executable' : 'VerifiedButNotExecutable'; // verified; executable once every earlier nonce is verified too
}

/** Has the DVN set already attested on the receive library (so commitVerification will succeed)? */
export async function dvnVerified(client: PublicClient, receiveUln: Address, plan: DeliveryPlan): Promise<boolean> {
  const config = await client.readContract({ address: receiveUln, abi: RECEIVE_ULN_ABI, functionName: 'getUlnConfig', args: [plan.receiver, plan.origin.srcEid] });
  return client.readContract({ address: receiveUln, abi: RECEIVE_ULN_ABI, functionName: 'verifiable', args: [config, keccak256(plan.header), plan.payloadHash] });
}
// snippet:end executionState

// snippet:start deliverYourself
export async function commitVerification(wallet: WalletClient, receiveUln: Address, plan: DeliveryPlan): Promise<Hex> {
  if (!wallet.account) throw new Error('no account');
  return wallet.writeContract({ address: receiveUln, abi: RECEIVE_ULN_ABI, functionName: 'commitVerification', args: [plan.header, plan.payloadHash], account: wallet.account, chain: wallet.chain });
}

export async function lzReceive(wallet: WalletClient, endpoint: Address, plan: DeliveryPlan, gas = 400_000n): Promise<Hex> {
  if (!wallet.account) throw new Error('no account');
  return wallet.writeContract({ address: endpoint, abi: ENDPOINT_ABI, functionName: 'lzReceive', args: [plan.origin, plan.receiver, plan.guid, plan.message, '0x'], account: wallet.account, chain: wallet.chain, gas });
}
// snippet:end deliverYourself
