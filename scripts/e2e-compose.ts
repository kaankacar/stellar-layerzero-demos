/**
 * Script-signed proof of the Compose page, no browser wallet: the EVM deployer
 * deposits 5 tUSDT0 plus a note into the ComposerVault on Stellar through the
 * OFT with a compose message, the message is tracked to DELIVERED, lz_compose
 * is awaited (or executed by us), and then 2 tUSDT0 are withdrawn to the
 * Stellar deployer with a personal_sign signature from the same EVM key.
 *
 *   pnpm e2e:compose                 # full round trip
 *   pnpm e2e:compose --track <evm tx># resume from an existing deposit tx
 *   pnpm e2e:compose --withdraw-only # only the signature-authorized withdrawal
 */
import { Keypair } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EVM_TESTNETS, type EvmTestnetKey } from '../src/config/networks';
import { STELLAR_FALLBACK } from '../src/config/layerzero.fallback';
import { OFT_ABI } from '../src/lib/evm/abi/oft';
import { VIEM_CHAINS } from '../src/lib/evm/chains';
import { getMessagesByTx } from '../src/lib/layerzero/scan';
import { TERMINAL } from '../src/lib/layerzero/useMessageTracker';
import { getTokenBalance } from '../src/lib/stellar/sac';
import { composeQueued, depositParam, evmFaucet, findComposeSent, loadVault, prepareLzCompose, prepareWithdraw, quoteDeposit, sendDeposit, signDigest, submitWithKeypair, withdrawDigest } from '../src/lib/compose/compose';
import { envVar, log, ROOT } from './lib/env';

interface Deployment {
  registry: { endpoint: string } | null;
  stellar: { sac: string; oft: string; composer: string | null; deployer: string } | null;
  evm: { chainKey: EvmTestnetKey; eid: number; oft: Address; deployer: Address } | null;
}
const dep = JSON.parse(readFileSync(resolve(ROOT, 'src/config/testnet-deployment.json'), 'utf8')) as Deployment;
if (!dep.stellar?.composer || !dep.evm?.oft) throw new Error('deploy first: pnpm deploy:testnet (needs the composer vault and the EVM OFT)');
const S = dep.stellar;
const E = dep.evm;
const VAULT = S.composer!;
const ENDPOINT = dep.registry?.endpoint ?? STELLAR_FALLBACK.testnet.endpointV2;
const evmCfg = EVM_TESTNETS[E.chainKey];
const account = privateKeyToAccount(envVar('EVM_DEPLOYER_PRIVATE_KEY') as Hex);
const rpcUrl = envVar('EVM_RPC_URL') ?? evmCfg.rpcUrl;
const pub = createPublicClient({ chain: VIEM_CHAINS[E.chainKey], transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain: VIEM_CHAINS[E.chainKey], transport: http(rpcUrl) });
const stellarDeployer = Keypair.fromSecret(envVar('STELLAR_DEPLOYER_SECRET')!);
const argv = process.argv.slice(2);
const trackOnly = argv.indexOf('--track') >= 0 ? argv[argv.indexOf('--track') + 1] : null;
const withdrawOnly = argv.includes('--withdraw-only');
const DEPOSIT_6 = 5n * 10n ** 6n; // 5 tUSDT0 on the EVM side (6 decimals)
const DEPOSIT_7 = 5n * 10n ** 7n; // the same 5 tUSDT0 credited on Stellar (7 decimals)
const WITHDRAW_7 = 2n * 10n ** 7n;

async function trackUntilTerminal(txHash: string, timeoutMs = 30 * 60_000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    const m = (await getMessagesByTx('testnet', txHash).catch(() => []))[0];
    const status = m ? `${m.status.name}${m.status.message ? ` (${m.status.message})` : ''}` : 'not indexed yet';
    if (status !== last) {
      log(`  scan: ${status}${m?.destination.tx?.txHash ? ` dst tx ${m.destination.tx.txHash}` : ''}`);
      last = status;
    }
    if (m && TERMINAL.has(m.status.name)) return m;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return null;
}

const vaultBefore = await loadVault('testnet', VAULT, S.sac, account.address);
log(`vault ${VAULT}: ${vaultBefore.count} deposits, holds ${vaultBefore.held} stroops; ${account.address} balance ${vaultBefore.balance} nonce ${vaultBefore.nonce}`);

if (!withdrawOnly) {
  let depositTx = trackOnly;
  if (!depositTx) {
    // 0. tUSDT0 on the EVM side, from the TestOFT faucet if needed
    let bal = await pub.readContract({ address: E.oft, abi: OFT_ABI, functionName: 'balanceOf', args: [account.address] });
    if (bal < DEPOSIT_6) {
      const h = await evmFaucet(wallet, E.oft);
      await pub.waitForTransactionReceipt({ hash: h });
      bal = await pub.readContract({ address: E.oft, abi: OFT_ABI, functionName: 'balanceOf', args: [account.address] });
      log(`faucet() -> ${bal} (6 decimals)`);
    }
    // 1. deposit: OFT.send to the vault with a compose message
    const note = `compose from ${evmCfg.label} @ ${new Date().toISOString().slice(0, 16)}`;
    const p = depositParam(VAULT, DEPOSIT_6, note);
    const fee = await quoteDeposit(pub, E.oft, p);
    log(`quoteSend(SEND_AND_CALL) nativeFee ${fee.nativeFee} wei; note "${note}"`);
    depositTx = await sendDeposit(wallet, E.oft, p, fee.nativeFee, account.address);
    await pub.waitForTransactionReceipt({ hash: depositTx as Hex });
    log(`deposit tx ${depositTx} -> https://testnet.layerzeroscan.com/tx/${depositTx}`);
  }
  // 2. LayerZero delivery on Stellar
  const m = await trackUntilTerminal(depositTx);
  if (!m || m.status.name !== 'DELIVERED') {
    log(`message ${m?.status.name ?? 'TIMEOUT'}; stop`);
    process.exit(1);
  }
  const guid = m.guid as Hex;
  const dst = (m.destination.tx?.txHash ?? '').replace(/^0x/, '');
  log(`delivered on Stellar in ${dst}; guid ${guid}`);
  // 3. compose: wait for the executor for a while, then do it ourselves
  const started = Date.now();
  let queued = await composeQueued('testnet', ENDPOINT, S.oft, VAULT, guid);
  while (queued && Date.now() - started < 3 * 60_000) {
    log('  compose still queued on the endpoint; waiting for the executor…');
    await new Promise((r) => setTimeout(r, 15_000));
    queued = await composeQueued('testnet', ENDPOINT, S.oft, VAULT, guid);
  }
  if (queued) {
    const found = await findComposeSent('testnet', ENDPOINT, VAULT, guid, dst);
    if (!found) throw new Error('ComposeSent event not found in the delivery tx');
    log(`executing lz_compose ourselves with payload ${found.message}`);
    const prepared = await prepareLzCompose('testnet', stellarDeployer.publicKey(), VAULT, S.oft, guid, found.message);
    const res = await submitWithKeypair('testnet', prepared, stellarDeployer);
    log(`lz_compose tx ${res.hash}`);
  } else {
    log('compose executed by the LayerZero executor');
  }
  const after = await loadVault('testnet', VAULT, S.sac, account.address);
  const credited = (after.balance ?? 0n) - (vaultBefore.balance ?? 0n);
  log(`vault balance for ${account.address}: ${vaultBefore.balance} -> ${after.balance} (+${credited}); deposits ${after.count}; latest note "${after.deposits[0]?.note}"`);
  if (!trackOnly && credited !== DEPOSIT_7) {
    log(`expected +${DEPOSIT_7}; stop`);
    process.exit(1);
  }
}

// 4. withdraw 2 tUSDT0 to the Stellar deployer (it has a trustline from the OFT e2e), authorized by personal_sign
const to = stellarDeployer.publicKey();
const before = await getTokenBalance('testnet', S.sac, to);
const digest = await withdrawDigest('testnet', VAULT, account.address, to, WITHDRAW_7);
const sig = await signDigest(wallet, digest);
log(`withdraw_digest ${digest} signed by ${account.address}: ${sig.slice(0, 20)}…`);
const prepared = await prepareWithdraw('testnet', stellarDeployer.publicKey(), VAULT, account.address, to, WITHDRAW_7, sig);
const res = await submitWithKeypair('testnet', prepared, stellarDeployer);
const afterBal = await getTokenBalance('testnet', S.sac, to);
const v2 = await loadVault('testnet', VAULT, S.sac, account.address);
log(`withdraw tx ${res.hash}: ${to} ${before} -> ${afterBal} stroops; vault balance now ${v2.balance}, nonce ${v2.nonce}`);
process.exit(afterBal - before === WITHDRAW_7 ? 0 : 1);
