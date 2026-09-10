import { arbitrumSepolia, mainnet, sepolia, type Chain } from 'viem/chains';
import { EVM_TESTNETS, type EvmTestnetKey } from '@/config/networks';

export const VIEM_CHAINS: Record<EvmTestnetKey, Chain> = { sepolia, 'arbitrum-sepolia': arbitrumSepolia };
export const ETHEREUM_MAINNET: Chain = mainnet;

export function evmTestnetByChainId(chainId: number | null | undefined) {
  return Object.values(EVM_TESTNETS).find((c) => c.chainId === chainId);
}
