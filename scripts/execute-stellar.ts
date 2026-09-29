/**
 * Deliver an EVM -> Stellar message yourself (permissionless execution on Stellar). The source chain is the
 * EVM testnet in src/config/testnet-deployment.json (Arbitrum Sepolia); EVM_TESTNET=sepolia overrides it.
 *
 *   pnpm exec tsx --tsconfig tsconfig.node.json scripts/execute-stellar.ts <evm tx hash>
 */
import { Keypair } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, http, type Hex } from 'viem';
import { EVM_TESTNETS, type EvmTestnetKey } from '../src/config/networks';
import { VIEM_CHAINS } from '../src/lib/evm/chains';
import { STELLAR_FALLBACK } from '../src/config/layerzero.fallback';
import { findPacketSentEvm, prepareCommitVerification, prepareLzReceive, stellarInboundState, ulnVerifiable } from '../src/lib/stellar/deliver';
import { bytes32ToStellarCandidates } from '../src/lib/stellar/strkey';
import { contractExists } from '../src/lib/stellar/simulate';
import { envVar, log, ROOT, warn } from './lib/env';
import { signAndSubmit } from './lib/stellar-node';

const txHash = process.argv[2] as Hex | undefined;
if (!txHash) throw new Error('usage: execute-stellar.ts <evm tx hash>');
const deployed = JSON.parse(readFileSync(resolve(ROOT, 'src/config/testnet-deployment.json'), 'utf8')) as { evm: { chainKey: EvmTestnetKey } | null };
const evmKey = (envVar('EVM_TESTNET') as EvmTestnetKey | undefined) ?? deployed.evm?.chainKey ?? 'arbitrum-sepolia';
const pub = createPublicClient({ chain: VIEM_CHAINS[evmKey], transport: http(envVar('EVM_RPC_URL') ?? EVM_TESTNETS[evmKey].rpcUrl) });
log(`source chain ${EVM_TESTNETS[evmKey].label}`);
const packet = await findPacketSentEvm(pub, txHash);
if (!packet) throw new Error('no PacketSent event in that transaction');
if (packet.dstEid !== 40600) throw new Error(`destination is ${packet.dstEid}, not Stellar testnet`);
const candidates = bytes32ToStellarCandidates(packet.receiver);
const receiver = (await contractExists('testnet', candidates.contract)) ? candidates.contract : candidates.account;
log(`guid ${packet.guid} nonce ${packet.nonce} -> ${receiver}`);

const executor = Keypair.fromSecret(envVar('STELLAR_DEPLOYER_SECRET')!);
const { endpointV2: ENDPOINT, receiveUln302: ULN } = STELLAR_FALLBACK.testnet;
let state = await stellarInboundState('testnet', ENDPOINT, receiver, packet);
log(`endpoint state: ${state}`);
if (state === 'Executed') process.exit(0);
if (state === 'NotVerified') {
  const ok = await ulnVerifiable('testnet', ULN, packet);
  log(`uln.verifiable = ${ok}`);
  if (!ok) {
    warn('the DVN has not attested on Stellar yet; try again later');
    process.exit(2);
  }
  const prepared = await prepareCommitVerification('testnet', executor.publicKey(), ULN, packet);
  const r = await signAndSubmit(prepared.tx, executor);
  log(`commit_verification tx ${r.hash}`);
  state = await stellarInboundState('testnet', ENDPOINT, receiver, packet);
  log(`endpoint state: ${state}`);
}
if (state === 'Verified') {
  const prepared = await prepareLzReceive('testnet', executor.publicKey(), receiver, packet);
  const r = await signAndSubmit(prepared.tx, executor);
  log(`lz_receive tx ${r.hash} -> https://testnet.layerzeroscan.com/tx/${packet.guid}`);
}
