/**
 * LayerZero Value Transfer API (transfer.layerzero-api.com/v1).
 *
 * Public without a key: GET /chains, /tokens, /metadata. Quotes and
 * transaction building (POST /quotes, /build-user-steps, /submit-signature,
 * GET /status/{quoteId}) require an `x-api-key`, currently issued on request
 * (early access). The site therefore quotes on-chain by default and lets you
 * bring your own key for this API; the key stays in sessionStorage.
 */
import { TRANSFER_API } from '@/config/networks';
import { fetchJson, postJson } from '@/lib/net/fetchJson';

export interface TransferChain {
  name: string;
  shortName?: string;
  chainKey: string;
  chainType: string;
  chainId: number | string;
  nativeCurrency?: { address: string; decimals: number; symbol: string; name: string };
}
export interface TransferToken {
  chainKey: string;
  address: string;
  decimals: number;
  symbol: string;
  name: string;
  isSupported?: boolean;
  price?: { usd?: number };
}

// snippet:start transferApiPublic
export async function getTransferChains(): Promise<TransferChain[]> {
  const res = await fetchJson<{ chains: TransferChain[] }>(`${TRANSFER_API}/chains`);
  return res.chains;
}
export async function getTransferTokens(chainKey?: string): Promise<TransferToken[]> {
  // The API accepts ?chainKey but (as of 2026-09) returns the full list anyway, so filter client-side.
  const res = await fetchJson<{ tokens: TransferToken[] }>(`${TRANSFER_API}/tokens${chainKey ? `?chainKey=${encodeURIComponent(chainKey)}` : ''}`);
  return chainKey ? res.tokens.filter((t) => t.chainKey === chainKey) : res.tokens;
}
// snippet:end transferApiPublic

export interface QuoteRequestBody {
  srcChainKey: string;
  dstChainKey: string;
  srcToken: string;
  dstToken: string;
  srcAddress: string;
  dstAddress: string;
  srcAmount: string;
  dstAmountMin: string;
  [k: string]: unknown;
}

// snippet:start transferApiQuote
/** POST /quotes with a user-supplied key. 401 = missing/invalid key; 4xx with a message = unsupported pair or bad body. */
export async function postTransferQuote(apiKey: string, body: QuoteRequestBody): Promise<unknown> {
  return postJson<unknown>(`${TRANSFER_API}/quotes`, body, { init: { headers: { 'x-api-key': apiKey } } });
}
// snippet:end transferApiQuote

const KEY = 'lz-transfer-api-key';
export function getStoredApiKey(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
export function storeApiKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(KEY, key);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Best-effort annotations for fields commonly returned by quote APIs, shown next to the raw JSON. */
export const QUOTE_FIELD_NOTES: Record<string, string> = {
  quoteId: 'Handle to pass to /build-user-steps and /status.',
  srcChainKey: 'Origin chain (LayerZero chainKey).',
  dstChainKey: 'Destination chain (LayerZero chainKey).',
  srcToken: 'Token contract on the origin; for Stellar this is the SAC address.',
  dstToken: 'Token contract on the destination.',
  srcAmount: 'Amount in the origin token\'s smallest unit (7 decimals on Stellar).',
  dstAmount: 'Expected amount received, in destination units.',
  dstAmountMin: 'Slippage floor; the transfer reverts below this.',
  fees: 'Per-component fees: the native LayerZero messaging fee (DVNs + executor + treasury) and any token fee.',
  nativeFee: 'Fee paid in the origin native token (XLM on Stellar) to the endpoint.',
  steps: 'Ordered user actions: approvals, the send transaction, and any signatures.',
  transaction: 'Chain-specific transaction to sign (calldata for EVM, XDR for Stellar).',
  estimatedTime: 'Expected seconds until delivery, from finality and DVN latency.',
  route: 'Which OFT/pathway serves this pair.',
};
