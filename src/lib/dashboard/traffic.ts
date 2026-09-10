/**
 * Dashboard data: USDT0 traffic in and out of Stellar from the Scan API,
 * amounts decoded from the OFT payload, and a derived supply trajectory.
 */
import { USDT0 } from '@/config/usdt0';
import { getLatestMessages, type ScanMessage } from '@/lib/layerzero/scan';
import { decodeOftMessage } from '@/lib/layerzero/oftPayload';

export interface TrafficRow {
  guid: string;
  direction: 'in' | 'out';
  counterpartEid: number;
  counterpartChain: string;
  status: string;
  amountSd: bigint | null;
  amount: number | null; // USDT0 (6 shared decimals)
  createdAt: number; // ms
  deliverySeconds: number | null;
  srcTx: string;
  dstTx: string | null;
}

function toRow(m: ScanMessage): TrafficRow {
  const direction = m.pathway.srcEid === USDT0.eid ? 'out' : 'in';
  let amountSd: bigint | null = null;
  try {
    if (m.source.tx.payload && m.source.tx.payload.length >= 82) amountSd = decodeOftMessage(m.source.tx.payload).amountSd;
  } catch {
    amountSd = null;
  }
  const created = m.created ? new Date(m.created).getTime() : (m.source.tx.blockTimestamp ?? 0) * 1000;
  const src = m.source.tx.blockTimestamp;
  const dst = m.destination.tx?.blockTimestamp;
  return {
    guid: m.guid,
    direction,
    counterpartEid: direction === 'out' ? m.pathway.dstEid : m.pathway.srcEid,
    counterpartChain: direction === 'out' ? m.pathway.receiver.chain : m.pathway.sender.chain,
    status: m.status.name,
    amountSd,
    amount: amountSd === null ? null : Number(amountSd) / 1e6,
    createdAt: created,
    deliverySeconds: src && dst ? dst - src : null,
    srcTx: m.source.tx.txHash,
    dstTx: m.destination.tx?.txHash ?? null,
  };
}

// snippet:start loadTraffic
/** Latest messages leaving and entering Stellar (USDT0 is the only OApp with traffic today). */
export async function loadTraffic(limit = 40): Promise<TrafficRow[]> {
  const [out, inn] = await Promise.all([getLatestMessages('mainnet', { srcChainIds: USDT0.eid, limit }), getLatestMessages('mainnet', { dstChainIds: USDT0.eid, limit })]);
  const rows = [...out.data, ...inn.data].map(toRow);
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.guid) ? false : (seen.add(r.guid), true))).sort((a, b) => b.createdAt - a.createdAt);
}
// snippet:end loadTraffic

// snippet:start loadHistory
/** Walk back through Scan pages until `days` ago (or `maxPages`) for a flow history. */
export async function loadHistory(days = 7, maxPages = 6): Promise<TrafficRow[]> {
  const since = Date.now() - days * 86_400_000;
  const all: TrafficRow[] = [];
  for (const dir of ['out', 'in'] as const) {
    let nextToken: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const res = await getLatestMessages('mainnet', dir === 'out' ? { srcChainIds: USDT0.eid, limit: 100, nextToken } : { dstChainIds: USDT0.eid, limit: 100, nextToken });
      const rows = res.data.map(toRow);
      all.push(...rows);
      const oldest = rows[rows.length - 1]?.createdAt ?? 0;
      if (!res.nextToken || oldest < since) break;
      nextToken = res.nextToken;
    }
  }
  const seen = new Set<string>();
  return all.filter((r) => r.createdAt >= since && (seen.has(r.guid) ? false : (seen.add(r.guid), true)));
}
// snippet:end loadHistory

export interface DayFlow {
  day: string; // YYYY-MM-DD
  inflow: number;
  outflow: number;
  count: number;
}

export function dailyFlows(rows: TrafficRow[], days = 7): DayFlow[] {
  const out: DayFlow[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    out.push({ day: d.toISOString().slice(0, 10), inflow: 0, outflow: 0, count: 0 });
  }
  const byDay = new Map(out.map((d) => [d.day, d]));
  for (const r of rows) {
    if (r.status !== 'DELIVERED' && r.status !== 'INFLIGHT' && r.status !== 'CONFIRMING') continue;
    const day = new Date(r.createdAt).toISOString().slice(0, 10);
    const slot = byDay.get(day);
    if (!slot || r.amount === null) continue;
    if (r.direction === 'in') slot.inflow += r.amount;
    else slot.outflow += r.amount;
    slot.count += 1;
  }
  return out;
}

/** Walk today's supply backwards through daily net flows to sketch the last week. */
export function supplyTrajectory(currentSupply: number, flows: DayFlow[]): { day: string; supply: number }[] {
  const out: { day: string; supply: number }[] = [];
  let s = currentSupply;
  for (let i = flows.length - 1; i >= 0; i--) {
    out.unshift({ day: flows[i]!.day, supply: s });
    s -= flows[i]!.inflow - flows[i]!.outflow; // yesterday's close = today's close - today's net
  }
  return out;
}
