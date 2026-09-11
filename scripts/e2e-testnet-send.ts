/**
 * Script-signed proof that the testnet pathway works end to end, without a
 * browser wallet: faucet drip -> quote -> OFT send Stellar -> EVM, then a
 * postcard, each tracked on the testnet Scan API until DELIVERED.
 *
 *   pnpm e2e:testnet             # Stellar -> EVM (tUSDT0 + postcard)
 *   pnpm e2e:testnet --reverse   # EVM -> Stellar (needs Sepolia ETH on the EVM deployer)
 */
import { Asset, Keypair, Operation } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EVM_TESTNETS, type EvmTestnetKey } from '../src/config/networks';
import { sc } from '../src/lib/stellar/scval';
import { evmAddressToBytes32, bytesToHex } from '../src/lib/hex';
import { stellarAddressToBytes32 } from '../src/lib/stellar/strkey';
import { quoteOft, quoteSend, prepareOftSend } from '../src/lib/stellar/oft';
import { getTokenBalance } from '../src/lib/stellar/sac';
import { getMessagesByTx, getMessageByGuid } from '../src/lib/layerzero/scan';
import { findPacketSent } from '../src/lib/stellar/packetEvents';
import { TERMINAL } from '../src/lib/layerzero/useMessageTracker';
import { OFT_ABI } from '../src/lib/evm/abi/oft';
import { VIEM_CHAINS } from '../src/lib/evm/chains';
import { envVar, log, ROOT } from './lib/env';
import { classicTx, invoke, read, signAndSubmit } from './lib/stellar-node';
import { prepareInvoke } from '../src/lib/stellar/tx';

interface Deployment {
  stellar: { sac: string; oft: string; faucet: string; postcard?: string; issuer: string; assetCode: string; deployer: string } | null;
  evm: { chainKey: EvmTestnetKey; eid: number; oft: Address; postcard: Address; deployer: Address } | null;
}
const useTestcoin = process.argv.includes('--testcoin');
const dep = JSON.parse(readFileSync(resolve(ROOT, useTestcoin ? 'src/config/testcoin-deployment.json' : 'src/config/testnet-deployment.json'), 'utf8')) as Deployment;
if (!dep.stellar?.oft || !dep.evm?.oft) throw new Error('both halves must be deployed first (pnpm deploy:testnet / deploy:testcoin)');
const S = dep.stellar;
const E = dep.evm;
const reverse = process.argv.includes('--reverse');
const trackOnly = process.argv.indexOf('--track') >= 0 ? process.argv[process.argv.indexOf('--track') + 1] : null;
const deployer = Keypair.fromSecret(envVar('STELLAR_DEPLOYER_SECRET')!);
const evmAccount = privateKeyToAccount(envVar('EVM_DEPLOYER_PRIVATE_KEY') as Hex);
const evmCfg = EVM_TESTNETS[E.chainKey];
const pub = createPublicClient({ chain: VIEM_CHAINS[E.chainKey], transport: http(envVar('EVM_RPC_URL') ?? evmCfg.rpcUrl) });

async function trackUntilTerminal(txHash: string, timeoutMs = 30 * 60_000): Promise<string> {
  const started = Date.now();
  let last = '';
  // Stellar sources: Scan indexes by GUID first; read the GUID from the packet_sent event.
  const packet = txHash.startsWith('0x') ? null : await findPacketSent('testnet', txHash).catch(() => null);
  if (packet) log(`  guid ${packet.guid} (nonce ${packet.nonce}, ${packet.srcEid} -> ${packet.dstEid}) -> https://testnet.layerzeroscan.com/tx/${packet.guid}`);
  while (Date.now() - started < timeoutMs) {
    const msgs = packet ? await getMessageByGuid('testnet', packet.guid).catch(() => []) : await getMessagesByTx('testnet', txHash).catch(() => []);
    const m = msgs[0];
    const status = m ? `${m.status.name}${m.status.message ? ` (${m.status.message})` : ''}` : 'not indexed yet';
    if (status !== last) {
      log(`  scan: ${status}${m?.destination.tx?.txHash ? ` dst tx ${m.destination.tx.txHash}` : ''}`);
      last = status;
    }
    if (m && TERMINAL.has(m.status.name)) return m.status.name;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return 'TIMEOUT';
}

if (trackOnly) {
  const s = await trackUntilTerminal(trackOnly);
  log(`message: ${s}`);
  process.exit(s === 'DELIVERED' ? 0 : 1);
}

if (!reverse) {
  // 0. trustline for the deployer, then a faucet drip
  const asset = new Asset(S.assetCode, S.issuer);
  const bal0 = await getTokenBalance('testnet', S.sac, deployer.publicKey()).catch(() => -1n);
  if (bal0 < 0n) {
    await classicTx(deployer, [Operation.changeTrust({ asset })]);
    log('trustline opened');
  }
  if ((await getTokenBalance('testnet', S.sac, deployer.publicKey())) < 10n * 10n ** 7n) {
    await invoke(S.faucet, 'drip', [sc.address(deployer.publicKey())], deployer);
  }
  log(`${S.assetCode} balance: ${(await getTokenBalance('testnet', S.sac, deployer.publicKey())).toString()} stroops`);

  // 1. OFT send 10 tUSDT0 -> EVM deployer
  const param = { dstEid: E.eid, to: evmAddressToBytes32(evmAccount.address), amountLd: 10n * 10n ** 7n, minAmountLd: 0n, extraOptions: new Uint8Array() };
  const oftQ = await quoteOft('testnet', S.oft, deployer.publicKey(), param);
  const feeQ = await quoteSend('testnet', S.oft, deployer.publicKey(), param, false);
  log(`quote_oft: sent ${oftQ.value.receipt.amountSentLd} received ${oftQ.value.receipt.amountReceivedLd}; quote_send: ${feeQ.value.nativeFee} stroops`);
  const prepared = await prepareOftSend('testnet', S.oft, deployer.publicKey(), { ...param, minAmountLd: oftQ.value.receipt.amountReceivedLd }, feeQ.value, deployer.publicKey());
  const sent = await signAndSubmit(prepared.tx, deployer);
  log(`OFT send tx ${sent.hash} -> https://testnet.layerzeroscan.com/tx/${sent.hash}`);
  const s1 = await trackUntilTerminal(sent.hash);
  log(`OFT message: ${s1}`);
  if (s1 === 'DELIVERED') {
    const evmBal = await pub.readContract({ address: E.oft, abi: OFT_ABI, functionName: 'balanceOf', args: [evmAccount.address] });
    log(`EVM ${S.assetCode} balance now ${evmBal.toString()} (6 decimals)`);
  }

  if (useTestcoin || !S.postcard) process.exit(s1 === 'DELIVERED' ? 0 : 1); // no postcard contract for TestCoin
  const postcard = S.postcard;

  // 2. Postcard
  const text = Buffer.from(`hello from Stellar testnet @ ${new Date().toISOString().slice(0, 16)}`);
  const pcFee = await read<{ native_fee: bigint; zro_fee: bigint }>(postcard, 'quote_postcard', [sc.u32(E.eid), sc.bytes(text), sc.bytes(new Uint8Array()), sc.bool(false)]);
  const pc = await prepareInvoke('testnet', deployer.publicKey(), postcard, 'send_postcard', [sc.address(deployer.publicKey()), sc.u32(E.eid), sc.bytes(text), sc.bytes(new Uint8Array()), sc.struct({ native_fee: sc.i128(BigInt(pcFee.native_fee)), zro_fee: sc.i128(0n) })]);
  const pcSent = await signAndSubmit(pc.tx, deployer);
  log(`postcard tx ${pcSent.hash} -> https://testnet.layerzeroscan.com/tx/${pcSent.hash}`);
  const s2 = await trackUntilTerminal(pcSent.hash);
  log(`postcard message: ${s2}`);
  process.exit(s1 === 'DELIVERED' && s2 === 'DELIVERED' ? 0 : 1);
} else {
  const wallet = createWalletClient({ account: evmAccount, chain: VIEM_CHAINS[E.chainKey], transport: http(envVar('EVM_RPC_URL') ?? evmCfg.rpcUrl) });
  const to = bytesToHex(stellarAddressToBytes32(deployer.publicKey())) as Hex; // G payload, not the strkey string
  const amount = 5n * 10n ** 6n; // 5 tUSDT0 in the EVM token's 6 decimals
  const sp = { dstEid: 40600, to, amountLD: amount, minAmountLD: 0n, extraOptions: '0x' as Hex, composeMsg: '0x' as Hex, oftCmd: '0x' as Hex };
  const fee = await pub.readContract({ address: E.oft, abi: OFT_ABI, functionName: 'quoteSend', args: [sp, false] });
  log(`EVM quoteSend nativeFee ${fee.nativeFee} wei`);
  const hash = await wallet.writeContract({ address: E.oft, abi: OFT_ABI, functionName: 'send', args: [sp, { nativeFee: fee.nativeFee, lzTokenFee: 0n }, evmAccount.address], value: fee.nativeFee });
  await pub.waitForTransactionReceipt({ hash });
  log(`EVM send tx ${hash} -> https://testnet.layerzeroscan.com/tx/${hash}`);
  const s = await trackUntilTerminal(hash);
  log(`message: ${s}`);
  if (s === 'DELIVERED') log(`Stellar ${S.assetCode} balance now ${(await getTokenBalance('testnet', S.sac, deployer.publicKey())).toString()} stroops`);
  process.exit(s === 'DELIVERED' ? 0 : 1);
}
