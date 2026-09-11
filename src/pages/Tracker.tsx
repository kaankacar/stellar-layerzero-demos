import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/Shell';
import { Callout, DataStatus, Explainer, Section, Spinner, UnderTheHood } from '@/components/ui';
import { Lifecycle } from '@/components/Lifecycle';
import { LifecycleDiagram } from '@/components/diagrams/LifecycleDiagram';
import { ChainBadge } from '@/components/ChainBadge';
import { USDT0 } from '@/config/usdt0';
import { DOCS, type ScanEnv } from '@/config/networks';
import { useLoader } from '@/lib/useLoader';
import { loadRegistry } from '@/lib/layerzero/chains';
import { getLatestMessages, type ScanMessage } from '@/lib/layerzero/scan';
import { useMessageTracker } from '@/lib/layerzero/useMessageTracker';
import { ALL_STATUSES, STATUS_INFO } from '@/lib/layerzero/status';
import { loadWithCache } from '@/lib/cache';
import { timeAgo, truncate } from '@/lib/format';
import { extractSnippet } from '@/lib/snippets';
import scanSrc from '@/lib/layerzero/scan.ts?raw';
import trackerSrc from '@/lib/layerzero/useMessageTracker.ts?raw';
import headerSrc from '@/lib/layerzero/packetHeader.ts?raw';
import payloadSrc from '@/lib/layerzero/oftPayload.ts?raw';

/** A known BLOCKED testnet message (receiver was not a contract): a useful failure example. */
const TESTNET_EXAMPLES = [{ label: 'BLOCKED example (Stellar testnet → Sepolia, receiver not a contract)', value: '9d0d471b90a5c94143bb8dd09dc803fa731145a9891fd2338bec706d6fd7cea4' }];

export function TrackerPage() {
  const [params, setParams] = useSearchParams();
  const env = (params.get('env') === 'testnet' ? 'testnet' : 'mainnet') as ScanEnv;
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const registry = useLoader((f) => loadRegistry(f), []);
  const examples = useLoader(
    (force) =>
      loadWithCache<ScanMessage[]>({
        key: 'tracker:examples',
        ttlMs: 5 * 60 * 1000,
        force,
        fetcher: async () => (await getLatestMessages('mainnet', { srcOrDstOAppAddress: USDT0.oftHex, limit: 4 })).data,
      }),
    [],
  );
  const tracker = useMessageTracker(env, q || null);

  const setQuery = (value: string, e: ScanEnv = env) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    next.set('env', e);
    setParams(next);
  };

  const exampleChips = useMemo(() => (examples.data ?? []).map((m) => ({ label: `${m.pathway.sender.chain} → ${m.pathway.receiver.chain} · ${m.status.name} · ${timeAgo(m.created ?? m.source.tx?.blockTimestamp)}`, value: m.source.tx?.txHash ?? m.guid, m })), [examples.data]);

  return (
    <div className="space-y-6">
      <PageHeader title="Bridge Message Tracker" mode="mainnet-readonly">
        Paste a transaction hash, a LayerZero GUID or a wallet address and follow the message through its lifecycle: source transaction, DVN attestations, commit, and execution on the destination. Data comes straight from the LayerZero Scan API.
      </PageHeader>

      <Explainer id="tracker" diagram={<LifecycleDiagram />}>
        <p>
          A LayerZero message is not a transaction that “goes” to another chain. The source transaction <strong>emits a packet</strong> and pays a fee. <strong>DVNs</strong> (Decentralized Verifier Networks) each watch the source chain, wait for the configured confirmations, and independently sign the packet header + payload hash on the destination. When every <em>required</em> DVN has attested, the verification is <strong>committed</strong> on the destination endpoint. Finally an <strong>executor</strong> (anyone, in principle) calls <code>lz_receive</code>, and the destination OApp does its thing: for USDT0, minting or unlocking.
        </p>
        <p>
          Scan returns a status name (<code>INFLIGHT</code>, <code>CONFIRMING</code>, <code>DELIVERED</code>, <code>FAILED</code>, <code>BLOCKED</code>, …) plus every intermediate transaction and timestamp, which is what the pipeline below renders. Message payloads are public, so we also decode the OFT message (<code>send_to</code>, <code>amount_sd</code>) and the packet header.
        </p>
      </Explainer>

      <Section
        title="Look up a message"
        right={
          <div className="flex items-center gap-1 text-xs">
            {(['mainnet', 'testnet'] as ScanEnv[]).map((e) => (
              <button key={e} className={`rounded-md px-2 py-1 ${env === e ? 'bg-accent-strong text-white' : 'bg-surface-2 text-muted hover:text-text'}`} onClick={() => setQuery(draft, e)}>
                {e === 'mainnet' ? 'Mainnet Scan' : 'Testnet Scan'}
              </button>
            ))}
          </div>
        }
      >
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(draft.trim());
          }}
        >
          <input className="input mono" placeholder="tx hash (Stellar or EVM), 0x… GUID, or wallet address (G…, 0x…, Solana)" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!draft.trim()}>Track</button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Try:</span>
          {env === 'mainnet' ? (
            exampleChips.length ? (
              exampleChips.map((c) => (
                <button key={c.value} className="btn px-2 py-1 text-xs" onClick={() => setQuery(c.value)} title={c.value}>
                  {c.label}
                </button>
              ))
            ) : examples.status === 'loading' ? (
              <Spinner label="loading recent USDT0 messages" />
            ) : (
              <span className="text-muted">recent examples unavailable ({examples.error})</span>
            )
          ) : (
            TESTNET_EXAMPLES.map((c) => (
              <button key={c.value} className="btn px-2 py-1 text-xs" onClick={() => setQuery(c.value, 'testnet')} title={c.value}>
                {c.label}
              </button>
            ))
          )}
          <DataStatus state={examples} reload={examples.reload} label="examples" />
        </div>
      </Section>

      {q ? (
        <Section
          title={`Results for ${truncate(q, 12, 8)}`}
          subtitle={`${env} · ${tracker.messages.length} message(s)${tracker.polling ? ' · polling every 10 s while in flight' : ''}`}
          right={
            <div className="flex items-center gap-2 text-xs">
              {tracker.loading ? <Spinner label="fetching" /> : tracker.lastFetched ? <span className="text-muted">updated {timeAgo(tracker.lastFetched)}</span> : null}
              <button className="btn px-2 py-1 text-xs" onClick={tracker.refresh}>↻ refresh</button>
            </div>
          }
        >
          {tracker.error ? (
            <Callout tone="warn" title="Nothing found">
              <p>{tracker.error}</p>
              <p>Scan indexes messages a few seconds after the source transaction is final. For a Stellar transaction, paste the 64-hex hash without <code>0x</code>. Wallet lookups only return messages that wallet <em>originated</em>.</p>
            </Callout>
          ) : tracker.messages.length === 0 && !tracker.loading ? (
            <Callout tone="info">No messages returned yet.</Callout>
          ) : (
            <div className="space-y-4">
              {tracker.messages.map((m) => (
                <Lifecycle key={m.guid} message={m} env={env} registry={registry.data} />
              ))}
            </div>
          )}
        </Section>
      ) : examples.data?.length ? (
        <Section title="Latest USDT0 messages touching Stellar" subtitle="Preloaded from /messages/latest so the page works without input. Click one to open the full lifecycle.">
          <div className="grid gap-2 sm:grid-cols-2">
            {examples.data.map((m) => (
              <button key={m.guid} className="card flex flex-col gap-1 p-3 text-left hover:border-accent" onClick={() => setQuery(m.source.tx?.txHash ?? m.guid)}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <ChainBadge chainKey={m.pathway.sender.chain} registry={registry.data} />
                  <span className="text-muted">→</span>
                  <ChainBadge chainKey={m.pathway.receiver.chain} registry={registry.data} />
                  <span className={`pill ${m.status.name === 'DELIVERED' ? 'border-ok/50 text-ok' : 'border-accent/50 text-accent'}`}>{m.status.name}</span>
                </div>
                <div className="mono text-xs text-muted">{truncate(m.source.tx?.txHash ?? m.guid, 14, 8)} · {timeAgo(m.created ?? m.source.tx?.blockTimestamp)}</div>
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Lifecycle states, in plain English" subtitle={<>From LayerZero's <a className="text-accent hover:underline" href={DOCS.lzDebugging} target="_blank" rel="noreferrer">debugging guide</a>.</>}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_STATUSES.map((s) => {
            const i = STATUS_INFO[s];
            const cls = i.tone === 'success' ? 'border-ok/50 text-ok' : i.tone === 'danger' ? 'border-danger/50 text-danger' : i.tone === 'warning' ? 'border-warn/50 text-warn' : i.tone === 'progress' ? 'border-accent/50 text-accent' : 'border-border text-muted';
            return (
              <div key={s} className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`pill ${cls}`}>{s}</span>
                </div>
                <div className="text-text">{i.summary}</div>
                <div className="mt-1 text-muted">{i.detail}</div>
                {i.remedy ? <div className="mt-1 text-muted"><strong className="text-text">Fix:</strong> {i.remedy}</div> : null}
              </div>
            );
          })}
        </div>
      </Section>

      <UnderTheHood
        items={[
          { title: 'Classify + look up', code: extractSnippet(trackerSrc, 'lookupMessages') + '\n\n' + extractSnippet(scanSrc, 'scanByTx'), note: <p>Scan has separate endpoints per lookup type. A 0x 32-byte value is tried as a tx hash first and as a GUID on 404. Stellar hashes are 64 hex characters without 0x.</p>, live: tracker.messages[0] ? { request: `GET ${env === 'mainnet' ? 'https://scan.layerzero-api.com/v1' : 'https://scan-testnet.layerzero-api.com/v1'}/messages/tx/${q}`, data: tracker.messages[0] } : undefined },
          { title: 'Polling while in flight', code: extractSnippet(trackerSrc, 'useMessageTracker'), note: <p>Terminal states stop the poll: DELIVERED, FAILED, BLOCKED and the burned/skipped variants.</p> },
          { title: 'Recent messages', code: extractSnippet(scanSrc, 'scanLatest'), note: <p>The examples come from <code>/messages/latest?srcOrDstOAppAddress=&lt;USDT0 OFT as 0x hex&gt;</code>. Stellar OApps appear in Scan as the 0x-hex of their 32-byte contract id.</p>, live: examples.data ? { request: `GET https://scan.layerzero-api.com/v1/messages/latest?srcOrDstOAppAddress=${USDT0.oftHex}&limit=4`, data: examples.data.map((m) => ({ guid: m.guid, status: m.status.name, pathway: m.pathway.id })) } : undefined },
          { title: 'Packet header', code: extractSnippet(headerSrc, 'decodePacketHeader'), note: <p>This 81-byte header is what a DVN signs (together with the payload hash). Decoding it shows the nonce and both endpoint ids.</p> },
          { title: 'OFT payload', code: extractSnippet(payloadSrc, 'decodeOftMessage'), note: <p>The OFT wire format is identical on every chain: 32-byte recipient + 8-byte amount in shared decimals. That is why a 7-decimal Stellar amount must be floored to 6 decimals before it can be sent.</p> },
        ]}
      />
    </div>
  );
}
