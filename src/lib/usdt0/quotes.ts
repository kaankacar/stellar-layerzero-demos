/**
 * On-chain quoting of a USDT0 transfer from Stellar. No API key: the OFT
 * contract itself answers `quote_oft` (what arrives) and `quote_send` (what
 * the message costs) via read-only simulation.
 */
import { USDT0 } from '@/config/usdt0';
import { STELLAR_FALLBACK } from '@/config/layerzero.fallback';
import { evmAddressToBytes32 } from '@/lib/hex';
import type { Hex } from '@/lib/hex';
import { getEffectiveFeeBps, getEnforcedOptions, getPeer, quoteOft, quoteSend, type MessagingFee, type OftQuote, type SendParam } from '@/lib/stellar/oft';
import { effectiveSendUlnConfig, type UlnConfig } from '@/lib/stellar/uln';
import { SimulationError } from '@/lib/stellar/simulate';
import { removeDust } from '@/lib/layerzero/oftPayload';
import { mapLimit } from '@/lib/net/mapLimit';

/** Placeholder recipient for quotes when the user has not typed one (quotes do not depend on it). */
export const PLACEHOLDER_EVM_RECIPIENT = '0x000000000000000000000000000000000000dEaD';

export interface RouteQuote {
  dstEid: number;
  amountLd: bigint;
  dust: bigint;
  oft: OftQuote;
  fee: MessagingFee;
  feeBps: number;
  enforcedOptions: Hex | null;
  uln: UlnConfig;
  /** Unsigned simulated envelopes, for the "under the hood" panel. */
  xdr: { quoteOft: string; quoteSend: string };
  rpcUrl: string;
}

export type RouteQuoteResult = { ok: true; dstEid: number; quote: RouteQuote } | { ok: false; dstEid: number; reason: string; code: number | null };

// snippet:start quoteRoute
export async function quoteRoute(dstEid: number, amountLd: bigint, from: string, recipientEvm = PLACEHOLDER_EVM_RECIPIENT, light = false): Promise<RouteQuoteResult> {
  const peer = await getPeer('mainnet', USDT0.oft, dstEid);
  if (!peer) return { ok: false, dstEid, reason: 'No peer set on the Stellar OFT for this EID: the pathway is not wired.', code: 2001 };
  const param: SendParam = {
    dstEid,
    to: evmAddressToBytes32(recipientEvm),
    amountLd,
    minAmountLd: 0n, // discover with a zero floor; a real floor turns "expensive" into SlippageExceeded
    extraOptions: new Uint8Array(), // enforced options apply; nothing extra
  };
  try {
    // `light` skips the token-side reads (comparison mode only needs the XLM fee and the DVN set).
    const [oft, fee, feeBps, enforced, uln] = await Promise.all([
      light ? null : quoteOft('mainnet', USDT0.oft, from, param),
      quoteSend('mainnet', USDT0.oft, from, param, false),
      light ? 0 : getEffectiveFeeBps('mainnet', USDT0.oft, dstEid),
      light ? null : getEnforcedOptions('mainnet', USDT0.oft, dstEid, 1),
      effectiveSendUlnConfig('mainnet', STELLAR_FALLBACK.mainnet.sendUln302, USDT0.oft, dstEid),
    ]);
    const emptyQuote: OftQuote = { limit: { minAmountLd: 0n, maxAmountLd: 0n }, fees: [], receipt: { amountSentLd: amountLd, amountReceivedLd: amountLd } };
    return {
      ok: true,
      dstEid,
      quote: {
        dstEid,
        amountLd,
        dust: removeDust(amountLd, 10n).dust,
        oft: oft?.value ?? emptyQuote,
        fee: fee.value,
        feeBps,
        enforcedOptions: enforced,
        uln,
        xdr: { quoteOft: oft?.txXdr ?? '', quoteSend: fee.txXdr },
        rpcUrl: fee.rpcUrl,
      },
    };
  } catch (e) {
    if (e instanceof SimulationError) return { ok: false, dstEid, reason: e.known ?? e.message, code: e.code };
    return { ok: false, dstEid, reason: e instanceof Error ? e.message : String(e), code: null };
  }
}
// snippet:end quoteRoute

// snippet:start compareRoutes
/** The same transfer quoted to several destinations, two at a time to be gentle on public RPCs. */
export function compareRoutes(eids: readonly number[], amountLd: bigint, from: string): Promise<RouteQuoteResult[]> {
  return mapLimit(eids, 2, (eid) => quoteRoute(eid, amountLd, from, PLACEHOLDER_EVM_RECIPIENT, true));
}
// snippet:end compareRoutes

export const stroopsToXlm = (stroops: bigint) => Number(stroops) / 1e7;
