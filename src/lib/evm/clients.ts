import { createPublicClient, http, type PublicClient } from 'viem';
import { EVM_MAINNET_RPC, EVM_TESTNETS, type EvmTestnetKey } from '@/config/networks';
import { ETHEREUM_MAINNET, VIEM_CHAINS } from '@/lib/evm/chains';

const clients = new Map<string, PublicClient>();

// snippet:start publicClient
/** Read-only viem client on a CORS-open public RPC (publicnode). Writes go through the wallet's own provider. */
export function publicClient(key: EvmTestnetKey | 'ethereum'): PublicClient {
  let c = clients.get(key);
  if (!c) {
    c =
      key === 'ethereum'
        ? createPublicClient({ chain: ETHEREUM_MAINNET, transport: http(EVM_MAINNET_RPC) })
        : createPublicClient({ chain: VIEM_CHAINS[key], transport: http(EVM_TESTNETS[key].rpcUrl) });
    clients.set(key, c);
  }
  return c;
}
// snippet:end publicClient
