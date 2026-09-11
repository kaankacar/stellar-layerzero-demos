/**
 * Deliver a Stellar -> Sepolia message yourself (permissionless execution).
 *
 *   pnpm exec tsx --tsconfig tsconfig.node.json scripts/execute-sepolia.ts <stellar tx hash>
 *
 * Reads the packet from the Stellar tx's packet_sent event, checks that the
 * DVN has attested on Sepolia, then calls commitVerification and lzReceive
 * with the EVM deployer key. Useful when the testnet executor is slow.
 */
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { EVM_TESTNETS } from '../src/config/networks';
import { EVM_TESTNET_FALLBACK } from '../src/config/layerzero.fallback';
import { findPacketSent } from '../src/lib/stellar/packetEvents';
import { commitVerification, dvnVerified, executionState, lzReceive, planFromPacket } from '../src/lib/evm/execute';
import { envVar, log, warn } from './lib/env';

const txHash = process.argv[2];
if (!txHash) throw new Error('usage: execute-sepolia.ts <stellar tx hash>');
const packet = await findPacketSent('testnet', txHash);
if (!packet) throw new Error('no packet_sent event found in that transaction');
const plan = planFromPacket(packet);
log(`guid ${plan.guid} nonce ${plan.origin.nonce} -> receiver ${plan.receiver} on eid ${packet.dstEid}`);
if (packet.dstEid !== 40161) throw new Error(`this script only handles Sepolia (40161), got ${packet.dstEid}`);

const account = privateKeyToAccount(envVar('EVM_DEPLOYER_PRIVATE_KEY') as Hex);
const rpc = envVar('EVM_RPC_URL') ?? EVM_TESTNETS.sepolia.rpcUrl;
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const fb = EVM_TESTNET_FALLBACK.sepolia;

let state = await executionState(pub, fb.endpointV2, plan);
log(`endpoint.executable = ${state}`);
if (state === 'Executed') process.exit(0);
if (state === 'NotExecutable') {
  const ok = await dvnVerified(pub, fb.receiveUln302, plan);
  log(`receive library verifiable = ${ok}`);
  if (!ok) {
    warn('the DVN has not attested yet; nothing to commit. Try again later.');
    process.exit(2);
  }
  const h = await commitVerification(wallet, fb.receiveUln302, plan);
  await pub.waitForTransactionReceipt({ hash: h });
  log(`commitVerification tx ${h}`);
  state = await executionState(pub, fb.endpointV2, plan);
  log(`endpoint.executable = ${state}`);
}
if (state === 'Executable') {
  const h = await lzReceive(wallet, fb.endpointV2, plan);
  const rc = await pub.waitForTransactionReceipt({ hash: h });
  log(`lzReceive tx ${h} (${rc.status}) -> https://testnet.layerzeroscan.com/tx/${plan.guid}`);
} else {
  warn(`state ${state}: not executable (VerifiedButNotExecutable usually means an earlier nonce is pending)`);
}
