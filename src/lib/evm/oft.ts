/**
 * EVM side of an OFT transfer. Same three calls as on Stellar: quoteOFT ->
 * quoteSend -> send, with the LayerZero fee passed as msg.value.
 */
import { publicActions, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { OFT_ABI } from '@/lib/evm/abi/oft';

/**
 * viem's writeContract does not simulate first. On Arbitrum a call that would revert makes MetaMask fall back
 * to the block gas limit (2^50 gas), which shows up as a fee of tens of thousands of ETH. Simulating through
 * the wallet's own provider surfaces the real revert reason (for example ERC20InsufficientBalance) instead.
 */
/**
 * Fee cap with headroom. On Arbitrum the base fee drifts between MetaMask's estimate and the submission, and
 * MetaMask adds no buffer there, so a raw transaction can be rejected with "max fee per gas less than block
 * base fee". A cap of three times the current base fee avoids that; the unused part is refunded.
 */
export async function evmFeeOverrides(wallet: WalletClient): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const pub = wallet.extend(publicActions);
  const [block, fees] = await Promise.all([pub.getBlock(), pub.estimateFeesPerGas().catch(() => null)]);
  const base = block.baseFeePerGas ?? fees?.maxFeePerGas ?? 0n;
  const estimate = fees?.maxFeePerGas ?? base;
  const cap = base * 3n > estimate ? base * 3n : estimate;
  return { maxFeePerGas: cap, maxPriorityFeePerGas: fees?.maxPriorityFeePerGas ?? 0n };
}

export function readableEvmError(e: unknown): Error {
  const err = e as { shortMessage?: string; message?: string; cause?: { shortMessage?: string } };
  return new Error(err.cause?.shortMessage ?? err.shortMessage ?? err.message ?? String(e));
}

export interface EvmSendParam {
  dstEid: number;
  to: Hex; // bytes32
  amountLD: bigint;
  minAmountLD: bigint;
  extraOptions?: Hex;
  composeMsg?: Hex;
  oftCmd?: Hex;
}

const tuple = (p: EvmSendParam) =>
  ({
    dstEid: p.dstEid,
    to: p.to,
    amountLD: p.amountLD,
    minAmountLD: p.minAmountLD,
    extraOptions: p.extraOptions ?? '0x',
    composeMsg: p.composeMsg ?? '0x',
    oftCmd: p.oftCmd ?? '0x',
  }) as const;

// snippet:start evmQuoteSend
export async function evmQuoteOft(client: PublicClient, oft: Address, p: EvmSendParam) {
  const [limit, fees, receipt] = await client.readContract({ address: oft, abi: OFT_ABI, functionName: 'quoteOFT', args: [tuple(p)] });
  return { limit, fees, receipt };
}
export async function evmQuoteSend(client: PublicClient, oft: Address, p: EvmSendParam) {
  const fee = await client.readContract({ address: oft, abi: OFT_ABI, functionName: 'quoteSend', args: [tuple(p), false] });
  return { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee };
}
/** MetaMask signs; `value` carries the LayerZero native fee. Returns the tx hash. */
export async function evmSend(wallet: WalletClient, oft: Address, p: EvmSendParam, nativeFee: bigint, refund: Address): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error('wallet has no account');
  try {
    // Simulate first so a revert reads as "ERC20InsufficientBalance", not as an absurd MetaMask gas estimate.
    const { request } = await wallet.extend(publicActions).simulateContract({
      address: oft,
      abi: OFT_ABI,
      functionName: 'send',
      args: [tuple(p), { nativeFee, lzTokenFee: 0n }, refund],
      value: nativeFee,
      account,
      chain: wallet.chain,
    });
    return await wallet.writeContract({ ...request, ...(await evmFeeOverrides(wallet)) });
  } catch (e) {
    throw readableEvmError(e);
  }
}
// snippet:end evmQuoteSend

/** OApp-level facts every LayerZero EVM OApp exposes. */
export async function evmOAppFacts(client: PublicClient, oapp: Address) {
  const [owner, endpoint] = await Promise.all([
    client.readContract({ address: oapp, abi: OFT_ABI, functionName: 'owner' }),
    client.readContract({ address: oapp, abi: OFT_ABI, functionName: 'endpoint' }),
  ]);
  return { owner, endpoint };
}

/** OFT-core facts. An OFT *Adapter* has these but is not itself an ERC20 (no name/symbol/decimals). */
export async function evmOftCoreFacts(client: PublicClient, oft: Address) {
  const [token, sharedDecimals, approvalRequired] = await Promise.all([
    client.readContract({ address: oft, abi: OFT_ABI, functionName: 'token' }),
    client.readContract({ address: oft, abi: OFT_ABI, functionName: 'sharedDecimals' }),
    client.readContract({ address: oft, abi: OFT_ABI, functionName: 'approvalRequired' }).catch(() => false),
  ]);
  return { token, sharedDecimals: Number(sharedDecimals), approvalRequired };
}

/** ERC20 metadata (only for plain OFTs, where the OFT contract *is* the token). */
export async function evmErc20Facts(client: PublicClient, token: Address) {
  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi: OFT_ABI, functionName: 'name' }),
    client.readContract({ address: token, abi: OFT_ABI, functionName: 'symbol' }),
    client.readContract({ address: token, abi: OFT_ABI, functionName: 'decimals' }),
  ]);
  return { name, symbol, decimals: Number(decimals) };
}

export async function evmPeer(client: PublicClient, oft: Address, eid: number): Promise<Hex> {
  return client.readContract({ address: oft, abi: OFT_ABI, functionName: 'peers', args: [eid] });
}
export async function evmEnforcedOptions(client: PublicClient, oft: Address, eid: number, msgType = 1): Promise<Hex> {
  return client.readContract({ address: oft, abi: OFT_ABI, functionName: 'enforcedOptions', args: [eid, msgType] });
}
export async function evmBalanceOf(client: PublicClient, token: Address, owner: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: OFT_ABI, functionName: 'balanceOf', args: [owner] });
}
