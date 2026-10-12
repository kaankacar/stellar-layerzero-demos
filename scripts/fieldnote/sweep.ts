/**
 * Return the field-note leftovers to Kaan. Two steps, run them in this order:
 *
 *   pnpm exec tsx --tsconfig tsconfig.node.json scripts/fieldnote/sweep.ts evm   # USDT + ETH on Ethereum -> the funding address
 *   pnpm exec tsx --tsconfig tsconfig.node.json scripts/fieldnote/sweep.ts xlm   # XLM on Stellar -> ETH at the funding address via NEAR Intents 1Click
 *
 * The funding address is the one that sent 0.015 ETH to the key on 2026-10-07 (tx 0xf7f093f9…). Override with SWEEP_TO=0x….
 * The Stellar account keeps about 2.4 XLM: it cannot be merged while it holds 0.0000010 USDT0 of dust on its trustline.
 */
import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Asset, Keypair, Memo, Operation, TransactionBuilder, BASE_FEE, Horizon } from '@stellar/stellar-sdk';
import { createWalletClient, createPublicClient, http, parseAbi, formatEther, formatUnits, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { STELLAR } from '../../src/config/networks';
import { envVar, ROOT } from '../lib/env';

const LOG = resolve(ROOT, 'docs/field-note/runs/run1-mainnet.log');
const ts = () => new Date().toISOString();
const note = (m: string) => { const l = `[${ts()}] ${m}`; console.log(l); appendFileSync(LOG, l + '\n'); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KAAN = (envVar('SWEEP_TO') ?? '0xb51D87fa22ED49208b2191Fa1884D836629256A4') as Address;

async function evm() {
  const account = privateKeyToAccount(envVar('EVM_DEPLOYER_PRIVATE_KEY') as Hex);
  const rpc = http(envVar('ETH_RPC_URL') ?? 'https://ethereum-rpc.publicnode.com');
  const pub = createPublicClient({ chain: mainnet, transport: rpc });
  const wallet = createWalletClient({ account, chain: mainnet, transport: rpc });
  const USDT: Address = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
  const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address to, uint256 value)']);
  const usdt = await pub.readContract({ address: USDT, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  if (usdt > 0n) {
    note(`sweep: sending ${formatUnits(usdt, 6)} USDT to ${KAAN}`);
    const h = await wallet.writeContract({ address: USDT, abi: erc20, functionName: 'transfer', args: [KAAN, usdt] });
    const r = await pub.waitForTransactionReceipt({ hash: h });
    note(`sweep: USDT transfer ${r.status} https://etherscan.io/tx/${h}`);
  }
  const block = await pub.getBlock();
  const maxFee = (block.baseFeePerGas ?? 0n) * 2n + 100_000_000n;
  const bal = await pub.getBalance({ address: account.address });
  const value = bal - 21_000n * maxFee;
  if (value <= 0n) { note('sweep: nothing left to send after gas'); return; }
  const h = await wallet.sendTransaction({ to: KAAN, value, gas: 21_000n, maxFeePerGas: maxFee, maxPriorityFeePerGas: 100_000_000n });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  note(`sweep: ${formatEther(value)} ETH returned, ${r.status} https://etherscan.io/tx/${h}; key now holds ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
}

async function xlm() {
  const kp = Keypair.fromSecret(execSync('stellar keys secret usdt0-fieldnote', { encoding: 'utf8' }).trim());
  const horizon = new Horizon.Server(STELLAR.mainnet.horizonUrl);
  const acct = await horizon.loadAccount(kp.publicKey());
  const xlm = Number(acct.balances.find((b) => b.asset_type === 'native')!.balance);
  const keep = 2.4; // 1 XLM base reserve + 0.5 XLM trustline reserve + fees, the account cannot be merged
  const amount = Math.floor((xlm - keep) * 1e7) / 1e7;
  if (amount < 5) { note(`sweep: only ${xlm} XLM on the account, nothing worth converting`); return; }
  const body = {
    dry: false, depositMode: 'MEMO', swapType: 'EXACT_INPUT', slippageTolerance: 100,
    originAsset: 'nep245:v2_1.omni.hot.tg:1100_111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz', depositType: 'ORIGIN_CHAIN',
    destinationAsset: 'nep141:eth.omft.near', amount: String(Math.round(amount * 1e7)),
    refundTo: kp.publicKey(), refundType: 'ORIGIN_CHAIN', recipient: KAAN, recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const q = (await (await fetch('https://1click.chaindefuser.com/v0/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as { quote?: { depositAddress: string; depositMemo?: string; amountOutFormatted: string }; message?: string };
  if (!q.quote) throw new Error(`1Click quote failed: ${JSON.stringify(q)}`);
  note(`sweep: 1Click ${amount} XLM -> ${q.quote.amountOutFormatted} ETH to ${KAAN}; deposit ${q.quote.depositAddress} memo ${q.quote.depositMemo}`);
  const tx = new TransactionBuilder(acct, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: STELLAR.mainnet.passphrase })
    .addOperation(Operation.payment({ destination: q.quote.depositAddress, asset: Asset.native(), amount: amount.toFixed(7) }))
    .addMemo(q.quote.depositMemo ? Memo.text(q.quote.depositMemo) : Memo.none())
    .setTimeout(600).build();
  tx.sign(kp);
  const res = await horizon.submitTransaction(tx);
  note(`sweep: XLM payment https://stellar.expert/explorer/public/tx/${res.hash}`);
  let last = '';
  for (let i = 0; i < 60; i++) {
    const s = (await (await fetch(`https://1click.chaindefuser.com/v0/status?depositAddress=${q.quote.depositAddress}${q.quote.depositMemo ? `&depositMemo=${q.quote.depositMemo}` : ''}`)).json()) as { status: string; swapDetails?: { destinationChainTxHashes?: { hash: string }[]; amountOutFormatted?: string } };
    if (s.status !== last) { note(`sweep: 1Click status ${s.status}${s.swapDetails?.amountOutFormatted ? ` out ${s.swapDetails.amountOutFormatted} ETH` : ''}`); last = s.status; }
    if (s.status === 'SUCCESS') { note(`sweep: ETH delivered ${JSON.stringify(s.swapDetails?.destinationChainTxHashes ?? [])}`); return; }
    if (s.status === 'REFUNDED' || s.status === 'FAILED') { note(`sweep: ended with ${s.status}`); return; }
    await sleep(10_000);
  }
}

const step = process.argv[2];
if (step === 'evm') await evm();
else if (step === 'xlm') await xlm();
else throw new Error('usage: sweep.ts <evm|xlm>');
