/**
 * Run 1 of the USDT0 Field Note: one real USDT0 round trip on mainnet with a few dollars.
 *
 *   pnpm exec tsx --tsconfig tsconfig.node.json scripts/fieldnote/run1-mainnet.ts <step>
 *
 * Steps, in order:
 *   status     balances everywhere (safe to run any time)
 *   xlm        ETH on Ethereum -> XLM on the fresh Stellar account via NEAR Intents 1Click (no API key)
 *   trustline  USDT0 trustline on the Stellar account
 *   swap       ETH -> USDT on Ethereum via Uniswap V3 (SwapRouter02, 0.05% pool)
 *   send       approve USDT to the USDT0 OFT adapter, quoteOFT, quoteSend, send 5 USDT to Stellar
 *   wait-in    poll LayerZero Scan until the inbound message is delivered, then read the Stellar balance
 *   return     quote_oft (dust), quote_send (XLM), send 4.9999999 USDT0 from Stellar back to Ethereum
 *   wait-out   poll Scan until the outbound message is delivered, then read the USDT balance on Ethereum
 *
 * Every step appends ISO-timestamped lines to docs/field-note/runs/run1-mainnet.log.
 * Secrets: EVM_DEPLOYER_PRIVATE_KEY from .env; the Stellar key comes from `stellar keys secret usdt0-fieldnote`.
 */
import { execSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { createPublicClient, createWalletClient, formatEther, formatUnits, http, parseAbi, parseEther, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { USDT0 } from '../../src/config/usdt0';
import { STELLAR } from '../../src/config/networks';
import { evmFeeOverrides, evmQuoteOft, evmQuoteSend, evmSend } from '../../src/lib/evm/oft';
import { evmAddressToBytes32 } from '../../src/lib/hex';
import { prepareChangeTrust } from '../../src/lib/stellar/classic';
import { quoteOft, quoteSend, sendParamScVal, messagingFeeScVal } from '../../src/lib/stellar/oft';
import { prepareInvoke } from '../../src/lib/stellar/tx';
import { sc } from '../../src/lib/stellar/scval';
import { getTokenBalance } from '../../src/lib/stellar/sac';
import { stellarAddressToHex } from '../../src/lib/stellar/strkey';
import { submitAndPoll } from '../../src/lib/stellar/tx';
import { envVar, ROOT } from '../lib/env';

const LOG = resolve(ROOT, 'docs/field-note/runs/run1-mainnet.log');
mkdirSync(resolve(ROOT, 'docs/field-note/runs'), { recursive: true });
const ts = () => new Date().toISOString();
const note = (msg: string) => {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- accounts ---
const ETH_RPC = envVar('ETH_RPC_URL') ?? 'https://ethereum-rpc.publicnode.com';
const evmAccount = privateKeyToAccount(envVar('EVM_DEPLOYER_PRIVATE_KEY') as Hex);
const pub = createPublicClient({ chain: mainnet, transport: http(ETH_RPC) });
const wallet = createWalletClient({ account: evmAccount, chain: mainnet, transport: http(ETH_RPC) });
const STELLAR_ALIAS = envVar('FIELDNOTE_STELLAR_ALIAS') ?? 'usdt0-fieldnote';
const stellarKp = Keypair.fromSecret(execSync(`stellar keys secret ${STELLAR_ALIAS}`, { encoding: 'utf8' }).trim());
const G = stellarKp.publicKey();

// --- Ethereum contracts ---
const USDT = USDT0.ethereum.usdt as Address;
const ADAPTER = USDT0.ethereum.adapter as Address;
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const SWAP_ROUTER_02: Address = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
const QUOTER_V2: Address = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const POOL_FEE = 500; // 0.05% WETH/USDT
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address spender, uint256 value)']);
const ROUTER_ABI = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)']);
const QUOTER_ABI = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);

const SCAN = 'https://scan.layerzero-api.com/v1';
const ONE_CLICK = 'https://1click.chaindefuser.com/v0';
const XLM_ASSET = 'nep245:v2_1.omni.hot.tg:1100_111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz';
const ETH_ASSET = 'nep141:eth.omft.near';

async function horizonAccount(): Promise<{ exists: boolean; xlm: string; usdt0: string | null; trustline: boolean }> {
  const r = await fetch(`${STELLAR.mainnet.horizonUrl}/accounts/${G}`);
  if (r.status === 404) return { exists: false, xlm: '0', usdt0: null, trustline: false };
  const a = (await r.json()) as { balances: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }[] };
  const xlm = a.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
  const t = a.balances.find((b) => b.asset_code === USDT0.code && b.asset_issuer === USDT0.issuer);
  return { exists: true, xlm, usdt0: t?.balance ?? null, trustline: !!t };
}

async function status() {
  const [eth, usdt, acct] = await Promise.all([pub.getBalance({ address: evmAccount.address }), pub.readContract({ address: USDT, abi: ERC20, functionName: 'balanceOf', args: [evmAccount.address] }), horizonAccount()]);
  note(`status: EVM ${evmAccount.address} ETH ${formatEther(eth)} USDT ${formatUnits(usdt, 6)} | Stellar ${G} exists=${acct.exists} XLM ${acct.xlm} USDT0 ${acct.usdt0 ?? '(no trustline)'}`);
}

async function xlm() {
  const amount = parseEther(envVar('FIELDNOTE_XLM_ETH') ?? '0.004');
  note(`xlm: asking 1Click for ETH -> XLM, ${formatEther(amount)} ETH, recipient ${G} (account exists: ${(await horizonAccount()).exists})`);
  const body = {
    dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100,
    originAsset: ETH_ASSET, depositType: 'ORIGIN_CHAIN',
    destinationAsset: XLM_ASSET, amount: amount.toString(),
    refundTo: evmAccount.address, refundType: 'ORIGIN_CHAIN',
    recipient: G, recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const q = await fetch(`${ONE_CLICK}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const quote = (await q.json()) as { quote?: { depositAddress: string; depositMemo?: string; amountOutFormatted: string; minAmountOut: string; timeEstimate: number; deadline?: string }; message?: string };
  if (!quote.quote) throw new Error(`1Click quote failed: ${JSON.stringify(quote)}`);
  const { depositAddress, depositMemo, amountOutFormatted, timeEstimate } = quote.quote;
  note(`xlm: quote ${formatEther(amount)} ETH -> ${amountOutFormatted} XLM, estimate ${timeEstimate}s, deposit ${depositAddress}${depositMemo ? ` memo ${depositMemo}` : ''}`);
  const fees = await evmFeeOverrides(wallet);
  const hash = await wallet.sendTransaction({ to: depositAddress as Address, value: amount, ...fees });
  note(`xlm: ETH deposit tx https://etherscan.io/tx/${hash}`);
  await pub.waitForTransactionReceipt({ hash });
  const sub = await fetch(`${ONE_CLICK}/deposit/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: hash, depositAddress }) });
  note(`xlm: deposit/submit -> ${sub.status}`);
  let last = '';
  for (let i = 0; i < 120; i++) {
    const s = (await (await fetch(`${ONE_CLICK}/status?depositAddress=${depositAddress}`)).json()) as { status: string; swapDetails?: { destinationChainTxHashes?: { hash: string; explorerUrl?: string }[]; refundedAmountFormatted?: string; amountOutFormatted?: string } };
    if (s.status !== last) { note(`xlm: 1Click status ${s.status}${s.swapDetails?.amountOutFormatted ? ` out ${s.swapDetails.amountOutFormatted}` : ''}`); last = s.status; }
    if (s.status === 'SUCCESS') {
      note(`xlm: destination tx ${JSON.stringify(s.swapDetails?.destinationChainTxHashes ?? [])}`);
      break;
    }
    if (s.status === 'REFUNDED' || s.status === 'FAILED') { note(`xlm: ended with ${s.status}: ${JSON.stringify(s.swapDetails)}`); break; }
    await sleep(10_000);
  }
  await status();
}

async function trustline() {
  const acct = await horizonAccount();
  if (!acct.exists) throw new Error(`Stellar account ${G} does not exist yet; run xlm first`);
  if (acct.trustline) { note(`trustline: already present on ${G}`); return; }
  const tx = await prepareChangeTrust('mainnet', G, USDT0.code, USDT0.issuer);
  tx.sign(stellarKp);
  const r = await submitAndPoll('mainnet', tx.toXDR());
  note(`trustline: changeTrust USDT0:${USDT0.issuer} -> ${r.status} https://stellar.expert/explorer/public/tx/${r.hash}`);
  await status();
}

async function swap() {
  const amountIn = parseEther(envVar('FIELDNOTE_SWAP_ETH') ?? '0.0025');
  const [out] = await pub.readContract({ address: QUOTER_V2, abi: QUOTER_ABI, functionName: 'quoteExactInputSingle', args: [{ tokenIn: WETH, tokenOut: USDT, amountIn, fee: POOL_FEE, sqrtPriceLimitX96: 0n }] });
  const minOut = (out * 995n) / 1000n;
  note(`swap: QuoterV2 says ${formatEther(amountIn)} ETH -> ${formatUnits(out, 6)} USDT on the 0.05% pool; min out ${formatUnits(minOut, 6)}`);
  // No fee fields in the simulation: with maxFeePerGas and no gas limit, eth_call checks the balance against the node's gas cap.
  const { request } = await pub.simulateContract({ address: SWAP_ROUTER_02, abi: ROUTER_ABI, functionName: 'exactInputSingle', args: [{ tokenIn: WETH, tokenOut: USDT, fee: POOL_FEE, recipient: evmAccount.address, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }], value: amountIn, account: evmAccount });
  const hash = await wallet.writeContract({ ...request, ...(await evmFeeOverrides(wallet)) } as typeof request);
  note(`swap: SwapRouter02.exactInputSingle tx https://etherscan.io/tx/${hash}`);
  const rc = await pub.waitForTransactionReceipt({ hash });
  note(`swap: ${rc.status} in block ${rc.blockNumber}, gas used ${rc.gasUsed}`);
  await status();
}

async function send() {
  const amountLD = BigInt(envVar('FIELDNOTE_SEND_USDT') ?? '5000000'); // 5 USDT, 6 decimals
  const acct = await horizonAccount();
  if (!acct.trustline) throw new Error('no USDT0 trustline on the Stellar account; run trustline first');
  const allowance = await pub.readContract({ address: USDT, abi: ERC20, functionName: 'allowance', args: [evmAccount.address, ADAPTER] });
  note(`send: USDT allowance for the adapter is ${formatUnits(allowance, 6)}`);
  if (allowance < amountLD) {
    const fees = await evmFeeOverrides(wallet);
    if (allowance > 0n) {
      // Tether's USDT reverts on a non-zero -> non-zero approve; reset to 0 first.
      const h0 = await wallet.writeContract({ address: USDT, abi: ERC20, functionName: 'approve', args: [ADAPTER, 0n], ...fees });
      await pub.waitForTransactionReceipt({ hash: h0 });
      note(`send: USDT approve reset to 0 (Tether quirk) https://etherscan.io/tx/${h0}`);
    }
    const h = await wallet.writeContract({ address: USDT, abi: ERC20, functionName: 'approve', args: [ADAPTER, amountLD], ...fees });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    note(`send: USDT approve(${ADAPTER}, ${formatUnits(amountLD, 6)}) ${rc.status} https://etherscan.io/tx/${h}`);
  }
  const to = stellarAddressToHex(G); // raw ed25519 key, 32 bytes
  const param = { dstEid: USDT0.eid, to, amountLD, minAmountLD: 0n } as const;
  const oft = await evmQuoteOft(pub, ADAPTER, param);
  note(`send: quoteOFT amountSentLD ${oft.receipt.amountSentLD} amountReceivedLD ${oft.receipt.amountReceivedLD} fees ${JSON.stringify(oft.fees.map((f) => [f.feeAmountLD.toString(), f.description]))}`);
  const withFloor = { ...param, minAmountLD: oft.receipt.amountReceivedLD };
  const fee = await evmQuoteSend(pub, ADAPTER, withFloor);
  note(`send: quoteSend nativeFee ${formatEther(fee.nativeFee)} ETH (lzToken ${fee.lzTokenFee})`);
  const hash = await evmSend(wallet, ADAPTER, withFloor, fee.nativeFee, evmAccount.address);
  note(`send: adapter.send(dstEid ${USDT0.eid}, to ${to}, ${formatUnits(amountLD, 6)} USDT) tx https://etherscan.io/tx/${hash} -> https://layerzeroscan.com/tx/${hash}`);
  const rc = await pub.waitForTransactionReceipt({ hash });
  note(`send: ${rc.status} in block ${rc.blockNumber}, gas used ${rc.gasUsed}`);
  await status();
}

async function scanWait(txHash: string, label: string) {
  let last = '';
  for (let i = 0; i < 360; i++) {
    // Scan's API refused a connection once mid-wait and the uncaught fetch error killed the poller; tolerate it.
    const r = await fetch(`${SCAN}/messages/tx/${txHash}`).catch(() => null);
    if (!r) { await sleep(10_000); continue; }
    if (r.ok) {
      const d = (await r.json()) as { data: { guid: string; status: { name: string; message?: string }; destination: { status: string; tx?: { txHash?: string } }; verification?: { dvn?: { status?: string } } }[] };
      const m = d.data?.[0];
      if (m) {
        const s = `${m.status.name} (${m.status.message ?? ''}) dvn=${m.verification?.dvn?.status ?? '?'} dst=${m.destination.status}`;
        if (s !== last) { note(`${label}: guid ${m.guid} ${s}`); last = s; }
        if (m.status.name === 'DELIVERED') { note(`${label}: delivered, destination tx ${m.destination.tx?.txHash}`); return m; }
        if (m.status.name === 'FAILED' || m.status.name === 'BLOCKED') { note(`${label}: ${m.status.name}`); return m; }
      }
    } else if (last !== `http ${r.status}`) { note(`${label}: Scan /messages/tx -> ${r.status} (not indexed yet)`); last = `http ${r.status}`; }
    await sleep(10_000);
  }
  note(`${label}: gave up waiting after 60 minutes`);
  return null;
}

async function waitIn() {
  const txHash = process.argv[3];
  if (!txHash) throw new Error('usage: wait-in <ethereum tx hash>');
  await scanWait(txHash, 'wait-in');
  await status();
}

async function returnLeg() {
  const acct = await horizonAccount();
  if (!acct.usdt0) throw new Error('no USDT0 balance on the Stellar account');
  const balance = BigInt(Math.round(Number(acct.usdt0) * 1e7));
  const amountLd = BigInt(envVar('FIELDNOTE_RETURN_STROOPS') ?? (balance - 1n).toString()); // 4.9999999 of 5.0000000
  const to = evmAddressToBytes32(evmAccount.address);
  const discover = { dstEid: USDT0.ethereum.eid, to, amountLd, minAmountLd: 0n };
  const q = await quoteOft('mainnet', USDT0.oft, G, discover);
  note(`return: quote_oft(amount_ld ${amountLd}) -> amount_sent_ld ${q.value.receipt.amountSentLd} amount_received_ld ${q.value.receipt.amountReceivedLd}; dust left behind ${amountLd - q.value.receipt.amountSentLd} stroops; fees ${JSON.stringify(q.value.fees)}`);
  const param = { ...discover, minAmountLd: q.value.receipt.amountReceivedLd };
  const fee = await quoteSend('mainnet', USDT0.oft, G, param);
  note(`return: quote_send -> native_fee ${fee.value.nativeFee} stroops (${Number(fee.value.nativeFee) / 1e7} XLM) to Ethereum`);
  // A 10-minute window: the first attempt expired (txTOO_LATE) while the RPC failover was still timing out.
  const prepared = await prepareInvoke('mainnet', G, USDT0.oft, 'send', [sc.address(G), sendParamScVal(param), messagingFeeScVal(fee.value), sc.address(G)], { timeoutSeconds: 600 });
  prepared.tx.sign(stellarKp);
  const r = await submitAndPoll('mainnet', prepared.tx.toXDR());
  note(`return: OFT.send ${r.status} https://stellar.expert/explorer/public/tx/${r.hash} -> https://layerzeroscan.com/tx/${r.hash}`);
  await status();
}

async function waitOut() {
  const txHash = process.argv[3];
  if (!txHash) throw new Error('usage: wait-out <stellar tx hash>');
  await scanWait(txHash, 'wait-out');
  const bal = await getTokenBalance('mainnet', USDT0.sac, G);
  note(`wait-out: Stellar USDT0 balance now ${bal} stroops (${Number(bal) / 1e7} USDT0)`);
  await status();
}

const steps: Record<string, () => Promise<void>> = { status, xlm, trustline, swap, send, 'wait-in': waitIn, return: returnLeg, 'wait-out': waitOut };
const step = process.argv[2];
if (!step || !steps[step]) throw new Error(`usage: run1-mainnet.ts <${Object.keys(steps).join('|')}>`);
note(`=== step ${step} ===`);
await steps[step]();
