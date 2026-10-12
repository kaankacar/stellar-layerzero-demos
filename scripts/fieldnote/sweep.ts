/**
 * Return the field-note leftovers to Kaan as ETH on Ethereum, in one go:
 *
 *   pnpm exec tsx --tsconfig tsconfig.node.json scripts/fieldnote/sweep.ts all
 *
 * Steps (also runnable one at a time: xlm, evm): XLM on Stellar -> ETH on our key via NEAR Intents 1Click;
 * USDT -> WETH on Uniswap V3 and unwrap; then every wei except gas -> the funding address.
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
  const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const ROUTER: Address = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'; // Uniswap V3 SwapRouter02
  const QUOTER: Address = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
  const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address spender, uint256 value)', 'function withdraw(uint256 wad)']);
  const routerAbi = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)']);
  const quoterAbi = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
  const usdt = await pub.readContract({ address: USDT, abi: erc20, functionName: 'balanceOf', args: [account.address] });
  if (usdt > 0n) {
    const [out] = await pub.readContract({ address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: USDT, tokenOut: WETH, amountIn: usdt, fee: 500, sqrtPriceLimitX96: 0n }] });
    note(`sweep: ${formatUnits(usdt, 6)} USDT -> ${formatEther(out)} WETH quoted on the 0.05% pool`);
    const allowance = await pub.readContract({ address: USDT, abi: erc20, functionName: 'allowance', args: [account.address, ROUTER] });
    if (allowance < usdt) {
      if (allowance > 0n) await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: USDT, abi: erc20, functionName: 'approve', args: [ROUTER, 0n] }) }); // Tether quirk
      const ha = await wallet.writeContract({ address: USDT, abi: erc20, functionName: 'approve', args: [ROUTER, usdt] });
      await pub.waitForTransactionReceipt({ hash: ha });
      note(`sweep: USDT approved to SwapRouter02 https://etherscan.io/tx/${ha}`);
    }
    const { request } = await pub.simulateContract({ address: ROUTER, abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: USDT, tokenOut: WETH, fee: 500, recipient: account.address, amountIn: usdt, amountOutMinimum: (out * 995n) / 1000n, sqrtPriceLimitX96: 0n }], account });
    const hs = await wallet.writeContract(request);
    const rs = await pub.waitForTransactionReceipt({ hash: hs });
    note(`sweep: swap ${rs.status} https://etherscan.io/tx/${hs}`);
    const weth = await pub.readContract({ address: WETH, abi: erc20, functionName: 'balanceOf', args: [account.address] });
    const hw = await wallet.writeContract({ address: WETH, abi: erc20, functionName: 'withdraw', args: [weth] });
    await pub.waitForTransactionReceipt({ hash: hw });
    note(`sweep: unwrapped ${formatEther(weth)} WETH to ETH https://etherscan.io/tx/${hw}`);
  }
  const block = await pub.getBlock();
  const maxFee = (block.baseFeePerGas ?? 0n) * 2n + 100_000_000n;
  const bal = await pub.getBalance({ address: account.address });
  // The destination may be a contract wallet: a 21k-gas transfer to it reverted on 2026-10-12. Estimate, then add a margin.
  const est = await pub.estimateGas({ account, to: KAAN, value: bal / 2n });
  const gas = (est * 125n) / 100n;
  const value = bal - gas * maxFee;
  if (value <= 0n) { note('sweep: nothing left to send after gas'); return; }
  note(`sweep: final transfer needs about ${est} gas (limit ${gas}); sending ${formatEther(value)} ETH to ${KAAN}`);
  const h = await wallet.sendTransaction({ to: KAAN, value, gas, maxFeePerGas: maxFee, maxPriorityFeePerGas: 100_000_000n });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  note(`sweep: ${formatEther(value)} ETH returned, ${r.status} https://etherscan.io/tx/${h}; key now holds ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
}

const evmKey = () => privateKeyToAccount(envVar('EVM_DEPLOYER_PRIVATE_KEY') as Hex);

async function xlm() {
  const SELF = evmKey().address;
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
    refundTo: kp.publicKey(), refundType: 'ORIGIN_CHAIN', recipient: SELF, recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const q = (await (await fetch('https://1click.chaindefuser.com/v0/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as { quote?: { depositAddress: string; depositMemo?: string; amountOutFormatted: string }; message?: string };
  if (!q.quote) throw new Error(`1Click quote failed: ${JSON.stringify(q)}`);
  note(`sweep: 1Click ${amount} XLM -> ${q.quote.amountOutFormatted} ETH to our key ${SELF}; deposit ${q.quote.depositAddress} memo ${q.quote.depositMemo}`);
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
if (step === 'all') { await xlm(); await evm(); }
else if (step === 'evm') await evm();
else if (step === 'xlm') await xlm();
else throw new Error('usage: sweep.ts <all|xlm|evm>');
