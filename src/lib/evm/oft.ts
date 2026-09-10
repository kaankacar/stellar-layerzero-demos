/**
 * EVM side of an OFT transfer. Same three calls as on Stellar: quoteOFT ->
 * quoteSend -> send, with the LayerZero fee passed as msg.value.
 */
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { OFT_ABI } from '@/lib/evm/abi/oft';

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
  return wallet.writeContract({
    address: oft,
    abi: OFT_ABI,
    functionName: 'send',
    args: [tuple(p), { nativeFee, lzTokenFee: 0n }, refund],
    value: nativeFee,
    account,
    chain: wallet.chain,
  });
}
// snippet:end evmQuoteSend

export async function evmOftFacts(client: PublicClient, oft: Address) {
  const read = <T,>(functionName: 'peers' | 'sharedDecimals' | 'decimals' | 'symbol' | 'name' | 'owner' | 'endpoint' | 'approvalRequired' | 'token' | 'totalSupply', args?: readonly unknown[]) =>
    client.readContract({ address: oft, abi: OFT_ABI, functionName, args } as never) as Promise<T>;
  const [sharedDecimals, decimals, symbol, name, owner, endpoint, approvalRequired, token] = await Promise.all([
    read<number>('sharedDecimals'),
    read<number>('decimals'),
    read<string>('symbol'),
    read<string>('name'),
    read<Address>('owner'),
    read<Address>('endpoint'),
    read<boolean>('approvalRequired').catch(() => false),
    read<Address>('token'),
  ]);
  return { sharedDecimals, decimals, symbol, name, owner, endpoint, approvalRequired, token };
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
