/**
 * One-off (2026-10-07): raise the Stellar PostcardOApp's enforced lzReceive gas toward the EVM testnets
 * from 200k to 500k. The executor's simulation of a postcard reverted on Arbitrum Sepolia with empty data;
 * the receive path writes a five-field struct with a string, which does not fit in 200k.
 *
 *   pnpm exec tsx --tsconfig tsconfig.node.json scripts/fieldnote/raise-postcard-gas.ts
 */
import { Keypair } from '@stellar/stellar-sdk';
import { TESTNET_DEPLOYMENT } from '../../src/config/testnet';
import { encodeLzReceiveOption } from '../../src/lib/layerzero/options';
import { hexToBytes } from '../../src/lib/hex';
import { sc } from '../../src/lib/stellar/scval';
import { getEnforcedOptions } from '../../src/lib/stellar/oft';
import { envVar, log } from '../lib/env';
import { invoke } from '../lib/stellar-node';

const deployer = Keypair.fromSecret(envVar('STELLAR_DEPLOYER_SECRET')!);
const postcard = TESTNET_DEPLOYMENT.stellar!.postcard!;
const want = encodeLzReceiveOption(500_000n);
for (const eid of [40231, 40161]) {
  const before = await getEnforcedOptions('testnet', postcard, eid, 1);
  const r = await invoke(postcard, 'set_enforced_options', [sc.vec([sc.struct({ eid: sc.u32(eid), msg_type: sc.u32(1), options: sc.bytes(hexToBytes(want)) })]), sc.address(deployer.publicKey())], deployer);
  const after = await getEnforcedOptions('testnet', postcard, eid, 1);
  log(`${new Date().toISOString()} postcard ${postcard} eid ${eid}: enforced options ${before} -> ${after} (tx ${r.hash}, ${r.status})`);
}
