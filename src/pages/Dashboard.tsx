import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/Shell';
import { Callout, CountUp, DataStatus, Explainer, JsonReveal, Section, Skeleton, StatTile, UnderTheHood } from '@/components/ui';
import { ChainBadge } from '@/components/ChainBadge';
import { LineChart } from '@/components/charts/LineChart';
import { PeersGraph } from '@/components/diagrams/PeersGraph';
import { DOCS, explorers } from '@/config/networks';
import { USDT0 } from '@/config/usdt0';
import { useLoader, toLoaded } from '@/lib/useLoader';
import { loadRegistry } from '@/lib/layerzero/chains';
import { inspectorLoaders } from '@/lib/usdt0/facts';
import { dailyFlows, loadHistory, loadTraffic, supplyTrajectory, type TrafficRow } from '@/lib/dashboard/traffic';
import { loadWithCache } from '@/lib/cache';
import { formatDuration, formatNumber, timeAgo, truncate } from '@/lib/format';
import { extractSnippet } from '@/lib/snippets';
import trafficSrc from '@/lib/dashboard/traffic.ts?raw';
import payloadSrc from '@/lib/layerzero/oftPayload.ts?raw';
import factsSrc from '@/lib/usdt0/facts.ts?raw';

export function DashboardPage() {
  const registry = useLoader((f) => loadRegistry(f), []);
  const classic = useLoader(inspectorLoaders.classic, []);
  const peers = useLoader(inspectorLoaders.peers, []);
  const [tick, setTick] = useState(0);
  const traffic = useLoader(() => toLoaded(loadTraffic(40)), [tick]);
  const history = useLoader((force) => loadWithCache({ key: 'dashboard:history7d', ttlMs: 10 * 60 * 1000, force, fetcher: () => loadHistory(7) }), []);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // ticker: highlight rows that appeared since the previous poll
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!traffic.data) return;
    const next = new Set<string>();
    for (const r of traffic.data) if (seen.current.size && !seen.current.has(r.guid)) next.add(r.guid);
    for (const r of traffic.data) seen.current.add(r.guid);
    setFresh(next);
  }, [traffic.data]);

  const rows = traffic.data ?? [];
  const last24 = rows.filter((r) => Date.now() - r.createdAt < 86_400_000);
  const inflow24 = last24.filter((r) => r.direction === 'in').reduce((s, r) => s + (r.amount ?? 0), 0);
  const outflow24 = last24.filter((r) => r.direction === 'out').reduce((s, r) => s + (r.amount ?? 0), 0);
  const delivered = rows.filter((r) => r.deliverySeconds !== null);
  const avgDelivery = delivered.length ? delivered.reduce((s, r) => s + (r.deliverySeconds ?? 0), 0) / delivered.length : null;
  const flows = useMemo(() => (history.data ? dailyFlows(history.data, 7) : []), [history.data]);
  const trajectory = useMemo(() => (classic.data && flows.length ? supplyTrajectory(classic.data.supply, flows) : []), [classic.data, flows]);
  const wired = peers.data?.filter((p) => p.peer).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Omnichain Dashboard" mode="mainnet-readonly">
        USDT0 traffic in and out of Stellar right now: recent messages, which chains are wired, supply, and a live ticker. Everything is read from Horizon, Soroban RPC and the LayerZero Scan API in your browser.
      </PageHeader>

      <Explainer id="dashboard">
        <p>
          The Scan API's <code>/messages/latest</code> accepts <code>srcChainIds</code> / <code>dstChainIds</code>, so “everything leaving Stellar” is one request with <code>srcChainIds=30600</code> and “everything arriving” another with <code>dstChainIds=30600</code>. Each message carries the OFT payload, so the amount (<code>amount_sd</code>, 6 shared decimals) is decoded client-side, and the difference between source and destination timestamps is the delivery time.
        </p>
        <p>
          Supply history is <em>derived</em>: Horizon gives today's supply, and walking backwards through a week of net inflows sketches the recent trajectory. For the heavyweight view (volume by chain, all time) see the <a className="text-accent hover:underline" href={DOCS.dune} target="_blank" rel="noreferrer">Dune dashboard</a>.
        </p>
      </Explainer>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Supply on Stellar" value={classic.data ? <CountUp value={classic.data.supply} digits={0} /> : <Skeleton />} sub="Horizon: accounts + contracts + claimable + pools" />
        <StatTile label="Inflow, last 24h" value={traffic.data ? <CountUp value={inflow24} digits={0} prefix="+" /> : <Skeleton />} sub={`${last24.filter((r) => r.direction === 'in').length} messages into Stellar`} tone="ok" />
        <StatTile label="Outflow, last 24h" value={traffic.data ? <CountUp value={outflow24} digits={0} prefix="−" /> : <Skeleton />} sub={`${last24.filter((r) => r.direction === 'out').length} messages out of Stellar`} />
        <StatTile label="Avg delivery (recent)" value={avgDelivery !== null ? formatDuration(avgDelivery) : traffic.data ? '—' : <Skeleton />} sub="source block → destination block" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title="Live ticker · latest USDT0 messages touching Stellar" subtitle="Polls every 30 s; new rows glow." right={<DataStatus state={traffic} reload={() => setTick((n) => n + 1)} />}>
          {traffic.data ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted">
                  <tr><th className="py-1 pr-2">When</th><th className="py-1 pr-2">Direction</th><th className="py-1 pr-2">Counterpart</th><th className="py-1 pr-2 text-right">USDT0</th><th className="py-1 pr-2">Status</th><th className="py-1 pr-2">Delivery</th><th className="py-1">Tx</th></tr>
                </thead>
                <tbody>
                  {rows.slice(0, 30).map((r: TrafficRow) => (
                    <tr key={r.guid} className={`border-t border-border/60 transition ${fresh.has(r.guid) ? 'bg-accent/10' : ''}`}>
                      <td className="py-1.5 pr-2 whitespace-nowrap text-muted">{timeAgo(r.createdAt)}</td>
                      <td className="py-1.5 pr-2">{r.direction === 'in' ? <span className="text-ok">→ Stellar</span> : <span className="text-warn">Stellar →</span>}</td>
                      <td className="py-1.5 pr-2"><ChainBadge eid={r.counterpartEid} registry={registry.data} /></td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{r.amount === null ? '—' : formatNumber(r.amount, 2)}</td>
                      <td className="py-1.5 pr-2"><span className={`pill ${r.status === 'DELIVERED' ? 'border-ok/50 text-ok' : r.status === 'INFLIGHT' || r.status === 'CONFIRMING' ? 'border-accent/50 text-accent' : 'border-danger/50 text-danger'}`}>{r.status}</span></td>
                      <td className="py-1.5 pr-2 text-muted">{r.deliverySeconds !== null ? formatDuration(r.deliverySeconds) : '…'}</td>
                      <td className="py-1.5 mono"><a className="text-accent hover:underline" href={explorers.lzTx('mainnet', r.srcTx)} target="_blank" rel="noreferrer">{truncate(r.srcTx, 8, 4)}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : traffic.status === 'loading' ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <Callout tone="warn">Scan API unavailable: {traffic.error}</Callout>
          )}
          <JsonReveal request={`GET https://scan.layerzero-api.com/v1/messages/latest?srcChainIds=30600&limit=40 (+ dstChainIds=30600)`} data={rows.slice(0, 3)} />
        </Section>

        <Section title={`Wired pathways · ${wired} of ${peers.data?.filter((p) => p.eid !== USDT0.eid).length ?? '…'} USDT0 networks`} subtitle="peer(eid) on the Stellar OFT; dashed = listed by USDT0 but not wired from Stellar" right={<DataStatus state={peers} reload={peers.reload} />}>
          {peers.data ? <PeersGraph peers={peers.data} /> : <Skeleton className="h-64 w-full" />}
          <div className="mt-2 text-xs text-muted">The registry lists {registry.data ? Object.keys(registry.data.chains).length : '…'} LayerZero chains; USDT0 chooses where it is wired. Ethereum's leg is an adapter (lock/unlock).</div>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Supply on Stellar, last 7 days (derived)" subtitle="Today's Horizon supply walked back through daily net flows decoded from Scan messages. Indicative, not an accounting record." right={<DataStatus state={history} reload={history.reload} label="7d history" />}>
          {trajectory.length ? <LineChart title="USDT0 supply on Stellar" points={trajectory.map((t) => ({ x: t.day, y: t.supply }))} format={(v) => formatNumber(v, 0)} /> : history.status === 'loading' || classic.status === 'loading' ? <Skeleton className="h-56 w-full" /> : <Callout tone="warn">Not enough data: {history.error ?? classic.error}</Callout>}
          {flows.length ? (
            <div className="mt-2 grid grid-cols-7 gap-1 text-[10px] text-muted">
              {flows.map((f) => (
                <div key={f.day} className="rounded border border-border bg-surface-2 p-1 text-center">
                  <div>{f.day.slice(5)}</div>
                  <div className="text-ok">+{formatNumber(f.inflow, 0)}</div>
                  <div className="text-warn">−{formatNumber(f.outflow, 0)}</div>
                  <div>{f.count} msgs</div>
                </div>
              ))}
            </div>
          ) : null}
        </Section>
        <Section title="Go deeper">
          <div className="space-y-2 text-sm">
            <Callout tone="info" title="Dune: Stellar LayerZero OFT volume">
              <p>The community Dune dashboard has all-time volume by chain and direction, built from Stellar ledger data rather than a 7-day API window. <a className="text-accent hover:underline" href={DOCS.dune} target="_blank" rel="noreferrer">Open it ↗</a></p>
            </Callout>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
              <li>Public Soroban RPCs keep about 7 days of events; the <code>oft_sent</code> / <code>oft_received</code> events on the OFT are the on-chain equivalent of this ticker.</li>
              <li>Scan pages are ordered newest first and paginated with <code>nextToken</code>; the history loader walks back until it passes the 7-day mark.</li>
              <li>Amounts are the OFT payload's <code>amount_sd</code> (6 decimals). They match <code>amount_received_ld</code> on a no-fee route.</li>
            </ul>
          </div>
        </Section>
      </div>

      <UnderTheHood
        items={[
          { title: 'Traffic in/out', code: extractSnippet(trafficSrc, 'loadTraffic'), live: traffic.data ? { data: traffic.data.slice(0, 2) } : undefined },
          { title: '7-day history (pagination)', code: extractSnippet(trafficSrc, 'loadHistory') },
          { title: 'Decoding amounts', code: extractSnippet(payloadSrc, 'decodeOftMessage') },
          { title: 'Peers', code: extractSnippet(factsSrc, 'loadPeers') },
        ]}
      />
    </div>
  );
}
