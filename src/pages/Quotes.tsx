import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/Shell';
import { Callout, CodeBlock, DataStatus, Explainer, JsonReveal, Section, Spinner, StatTile, UnderTheHood } from '@/components/ui';
import { BarChart, type BarRow } from '@/components/charts/BarChart';
import { ChainBadge } from '@/components/ChainBadge';
import { QUOTE_COMPARISON_EIDS, USDT0, USDT0_NETWORKS } from '@/config/usdt0';
import { TRANSFER_API, TRANSFER_API_KEY_FORM } from '@/config/networks';
import { useWallets } from '@/lib/wallets/WalletProvider';
import { useLoader, useAsyncAction } from '@/lib/useLoader';
import { loadRegistry, dvnName } from '@/lib/layerzero/chains';
import { compareRoutes, PLACEHOLDER_EVM_RECIPIENT, quoteRoute, stroopsToXlm, type RouteQuoteResult } from '@/lib/usdt0/quotes';
import { decodeOptions, describeOption } from '@/lib/layerzero/options';
import { getStoredApiKey, getTransferChains, getTransferTokens, postTransferQuote, QUOTE_FIELD_NOTES, storeApiKey, type TransferToken } from '@/lib/layerzero/transferApi';
import { loadWithCache } from '@/lib/cache';
import { formatUnits, formatUsd, parseUnits, safeJson } from '@/lib/format';
import { errorMessage, HttpError } from '@/lib/net/fetchJson';
import { isEvmAddress } from '@/lib/hex';
import { stellarAddressToHex } from '@/lib/stellar/strkey';
import { extractSnippet } from '@/lib/snippets';
import quotesSrc from '@/lib/usdt0/quotes.ts?raw';
import oftSrc from '@/lib/stellar/oft.ts?raw';
import transferSrc from '@/lib/layerzero/transferApi.ts?raw';

const DESTINATIONS = USDT0_NETWORKS.filter((n) => n.eid && n.eid !== USDT0.eid).sort((a, b) => a.name.localeCompare(b.name));

export function QuotesPage() {
  const { stellar } = useWallets();
  const registry = useLoader((f) => loadRegistry(f), []);
  const prices = useLoader(
    (force) =>
      loadWithCache<{ xlm: number | null; usdt: number | null; tokens: TransferToken[] }>({
        key: 'transfer:stellar-tokens',
        ttlMs: 5 * 60 * 1000,
        force,
        fetcher: async () => {
          const tokens = await getTransferTokens('stellar');
          return { xlm: tokens.find((t) => t.symbol === 'XLM')?.price?.usd ?? null, usdt: tokens.find((t) => t.address === USDT0.sac)?.price?.usd ?? null, tokens };
        },
      }),
    [],
  );
  const chains = useLoader((force) => loadWithCache({ key: 'transfer:chains', ttlMs: 30 * 60 * 1000, force, fetcher: getTransferChains }), []);

  const [amount, setAmount] = useState('1000');
  const [dstEid, setDstEid] = useState<number>(30110);
  const [recipient, setRecipient] = useState('');
  const from = stellar.address ?? USDT0.simulationSource;
  const amountLd = useMemo(() => {
    try {
      return parseUnits(amount || '0', 7);
    } catch {
      return null;
    }
  }, [amount]);
  const recipientOk = recipient === '' || isEvmAddress(recipient);

  const single = useAsyncAction(useCallback(() => quoteRoute(dstEid, amountLd ?? 0n, from, recipient || PLACEHOLDER_EVM_RECIPIENT), [dstEid, amountLd, from, recipient]));
  const compare = useAsyncAction(useCallback(() => compareRoutes(QUOTE_COMPARISON_EIDS, amountLd ?? 0n, from), [amountLd, from]));
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // run once on mount with the defaults
    started.current = true;
    void single.run();
    void compare.run();
  }, [single, compare]);

  const xlmUsd = prices.data?.xlm ?? null;
  const q = single.value?.ok ? single.value.quote : null;
  const enforced = q?.enforcedOptions ? safeDecode(q.enforcedOptions) : null;

  const rows: BarRow[] = (compare.value ?? []).map((r: RouteQuoteResult) => {
    const name = DESTINATIONS.find((d) => d.eid === r.dstEid)?.name ?? `EID ${r.dstEid}`;
    if (!r.ok) return { key: String(r.dstEid), label: name, value: null, error: r.reason };
    const xlm = stroopsToXlm(r.quote.fee.nativeFee);
    return { key: String(r.dstEid), label: name, value: xlm, detail: `${r.quote.fee.nativeFee.toString()} stroops${xlmUsd ? ` ≈ ${formatUsd(xlm * xlmUsd)}` : ''} · ${r.quote.uln.requiredDvns.length} DVNs · ${r.quote.uln.confirmations.toString()} confirmations` };
  });

  // ---- Transfer API (BYOK) ----
  const [apiKey, setApiKey] = useState(getStoredApiKey());
  const dstChainKey = DESTINATIONS.find((d) => d.eid === dstEid)?.chainKey ?? 'arbitrum';
  const defaultBody = useMemo(
    () =>
      safeJson({
        srcChainKey: 'stellar',
        dstChainKey,
        srcToken: USDT0.sac,
        dstToken: '', // the USDT0 contract on the destination (see /tokens)
        srcAddress: from,
        dstAddress: recipient || PLACEHOLDER_EVM_RECIPIENT,
        srcAmount: (amountLd ?? 0n).toString(),
        dstAmountMin: '0',
      }),
    [dstChainKey, from, recipient, amountLd],
  );
  const [body, setBody] = useState(defaultBody);
  useEffect(() => setBody(defaultBody), [defaultBody]);
  const transfer = useAsyncAction(
    useCallback(async () => {
      storeApiKey(apiKey);
      const parsed = JSON.parse(body) as Record<string, unknown>;
      try {
        return await postTransferQuote(apiKey, parsed as never);
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) throw new Error('401 Unauthorized: this key was rejected. Quotes need an early-access key from LayerZero (request form linked above).');
        throw new Error(errorMessage(e));
      }
    }, [apiKey, body]),
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Fee & Quote Explorer" mode="mainnet-readonly">
        Quote a real USDT0 transfer out of Stellar without an API key: the OFT contract itself answers <code>quote_oft</code> (what arrives) and <code>quote_send</code> (what the LayerZero message costs) via read-only simulation. Then compare five destinations, and try LayerZero's Transfer API with your own key.
      </PageHeader>

      <Explainer id="quotes">
        <p>
          Every OFT send is priced by <strong>two independent quotes</strong>. <code>quote_oft</code> applies the token rules: dust below 6 shared decimals is removed, any OFT fee in basis points is deducted, and the result is the <code>amount_received_ld</code> the destination will mint. <code>quote_send</code> asks the endpoint what the <strong>message</strong> costs in XLM: the sum of what each required DVN charges, the executor's fee (it must pay destination gas, priced through LayerZero's price feed), and the treasury fee. The XLM fee changes with destination gas prices, so it is quoted every time and never hard-coded.
        </p>
        <p>
          Both are <em>read-only</em>: the site simulates the calls with a throwaway envelope; nothing is signed. The same two calls run before the real <code>send</code> in the testnet playground, and <code>quote_oft</code>'s receipt becomes the slippage floor (<code>min_amount_ld</code>) for the send.
        </p>
        <p>
          LayerZero also offers a hosted <strong>Transfer API</strong> that returns ready-to-sign transactions. Its quotes endpoint needs an API key (early access), so it is optional here.
        </p>
      </Explainer>

      <Section title="Quote a transfer" subtitle="Stellar mainnet → destination, read-only simulation on the USDT0 OFT">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end">
          <label className="text-xs text-muted">
            Amount (USDT0)
            <input className="input mt-1 mono" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" />
          </label>
          <label className="text-xs text-muted">
            Destination
            <select className="input mt-1" value={dstEid} onChange={(e) => setDstEid(Number(e.target.value))}>
              {DESTINATIONS.map((d) => (
                <option key={d.chainKey} value={d.eid}>{d.name} · {d.eid}{d.type === 'OFT_ADAPTER' ? ' · adapter' : ''}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Recipient (EVM, optional)
            <input className={`input mt-1 mono ${recipientOk ? '' : 'border-danger'}`} value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder={PLACEHOLDER_EVM_RECIPIENT} />
          </label>
          <button className="btn btn-primary" onClick={() => void single.run()} disabled={single.status === 'loading' || amountLd === null || amountLd <= 0n || !recipientOk}>
            {single.status === 'loading' ? 'Quoting…' : 'Quote'}
          </button>
        </div>
        <div className="mt-2 text-xs text-muted">
          Sender used for simulation: <span className="mono">{from}</span> {stellar.address ? '(your connected wallet)' : '(a public account; connect a Stellar wallet to quote as yourself)'} · amount_ld = <span className="mono">{amountLd?.toString() ?? '—'}</span> stroops of USDT0 (7 decimals)
        </div>

        {single.error ? <Callout tone="warn" title="Quote failed"><p>{single.error}</p></Callout> : null}
        {single.value && !single.value.ok ? (
          <Callout tone="warn" title={`Not quotable to EID ${single.value.dstEid}`}>
            <p>{single.value.reason}{single.value.code ? ` (contract error #${single.value.code})` : ''}</p>
          </Callout>
        ) : null}

        {q ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-semibold">What arrives · <code className="text-xs">quote_oft</code></div>
                <ChainBadge eid={q.dstEid} registry={registry.data} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <StatTile label="you send (amount_ld)" value={`${formatUnits(q.amountLd, 7)} USDT0`} sub={`${q.amountLd.toString()} stroops`} />
                <StatTile label="dust removed" value={`${formatUnits(q.dust, 7)} USDT0`} sub={q.dust === 0n ? 'amount fits 6 shared decimals' : 'below 0.000001 — stays in your account (no-fee route)'} tone={q.dust === 0n ? undefined : 'warn'} />
                <StatTile label="amount_sent_ld" value={`${formatUnits(q.oft.receipt.amountSentLd, 7)}`} sub="debited from you (burned)" />
                <StatTile label="amount_received_ld" value={`${formatUnits(q.oft.receipt.amountReceivedLd, 7)}`} sub="minted / unlocked on the destination" tone="ok" />
              </div>
              <div className="mt-2 text-xs text-muted">
                OFT fee for this route: <strong className="text-text">{q.feeBps} bps</strong>{q.oft.fees.length ? ` · fee details: ${q.oft.fees.map((f) => `${f.description} ${formatUnits(f.feeAmountLd, 7)}`).join(', ')}` : ' · no OFT fee details'} · limits {formatUnits(q.oft.limit.minAmountLd, 7)} – {q.oft.limit.maxAmountLd > 10n ** 20n ? '∞' : formatUnits(q.oft.limit.maxAmountLd, 7)}
              </div>
              <div className="mt-2 text-xs text-muted">Use <code>amount_received_ld</code> as <code>min_amount_ld</code> when you send: a lower value tolerates fee changes, a higher one reverts with SlippageExceeded.</div>
            </div>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="mb-2 font-semibold">What the message costs · <code className="text-xs">quote_send</code></div>
              <div className="grid gap-2 sm:grid-cols-2">
                <StatTile label="native_fee" value={`${stroopsToXlm(q.fee.nativeFee).toFixed(4)} XLM`} sub={`${q.fee.nativeFee.toString()} stroops${xlmUsd ? ` ≈ ${formatUsd(stroopsToXlm(q.fee.nativeFee) * xlmUsd)}` : ''}`} />
                <StatTile label="zro_fee" value={q.fee.zroFee.toString()} sub="0 unless paying in ZRO (not enabled on Stellar)" />
              </div>
              <div className="mt-3 space-y-1 text-xs text-muted">
                <div><strong className="text-text">Who gets paid:</strong> {q.uln.requiredDvns.length} required DVN{q.uln.requiredDvns.length === 1 ? '' : 's'} ({q.uln.requiredDvns.map((d) => dvnName(registry.data, 'mainnet', safeHex(d))).join(', ')}) after {q.uln.confirmations.toString()} confirmations, the executor, and the treasury. The endpoint sums their fees; the ULN exposes only the total.</div>
                <div><strong className="text-text">Executor budget:</strong> {enforced ? enforced.options.map(describeOption).join('; ') : 'no enforced options'} on the destination, paid in the destination's gas token by the executor and charged to you here in XLM at the price feed's rate.</div>
                <div><strong className="text-text">RPC used:</strong> <span className="mono">{q.rpcUrl}</span></div>
              </div>
              <JsonReveal title="Simulated envelopes (unsigned XDR) and raw quote" data={{ quoteOftXdr: q.xdr.quoteOft, quoteSendXdr: q.xdr.quoteSend, oft: q.oft, fee: q.fee, uln: q.uln }} />
            </div>
          </div>
        ) : single.status === 'loading' ? (
          <div className="mt-4"><Spinner label="simulating quote_oft and quote_send…" /></div>
        ) : null}
      </Section>

      <Section
        title={`Comparison: ${amountLd ? formatUnits(amountLd, 7) : '…'} USDT0 from Stellar to five chains`}
        subtitle="The same transfer quoted to each destination. Ethereum is expensive because the executor must buy Ethereum gas; L2s cost cents."
        right={
          <div className="flex items-center gap-2 text-xs">
            <DataStatus state={prices} label="XLM price" />
            <button className="btn px-2 py-1 text-xs" onClick={() => void compare.run()} disabled={compare.status === 'loading' || !amountLd}>{compare.status === 'loading' ? 'quoting…' : '↻ re-quote'}</button>
          </div>
        }
      >
        {compare.status === 'loading' && !compare.value ? <Spinner label="quoting five routes (two at a time, to be kind to public RPCs)…" /> : null}
        {rows.length ? <BarChart title="LayerZero native fee per destination" unit="XLM" rows={rows} format={(v) => `${v.toFixed(2)} XLM`} /> : null}
        {compare.error ? <Callout tone="warn">{compare.error}</Callout> : null}
        <div className="mt-2 text-xs text-muted">Fees are in XLM (stroops / 10⁷). USD uses the XLM price from the public Transfer API token list{xlmUsd ? ` (${formatUsd(xlmUsd)} / XLM)` : ''}. Values change with destination gas prices; re-quote to see them move.</div>
      </Section>

      <Section
        title="LayerZero Transfer API (bring your own key)"
        subtitle={<>Hosted quotes and ready-to-sign transactions at <code className="text-xs">{TRANSFER_API}</code>. <code className="text-xs">/chains</code>, <code className="text-xs">/tokens</code> and <code className="text-xs">/metadata</code> are public; <code className="text-xs">POST /quotes</code> needs an <code className="text-xs">x-api-key</code>.</>}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
              <div className="mb-1 font-semibold">Public endpoints (no key)</div>
              {chains.data ? (
                <div className="text-xs text-muted">
                  <div><strong className="text-text">{chains.data.length}</strong> chains listed; Stellar appears as <code>chainKey: "stellar"</code>, <code>chainType: STELLAR</code>, native token = the XLM SAC.</div>
                  {prices.data ? (
                    <div className="mt-1">
                      Tokens on stellar: {prices.data.tokens.map((t) => `${t.symbol} (${t.isSupported ? 'supported' : 'listed only'}${t.price?.usd ? `, ${formatUsd(t.price.usd)}` : ''})`).join(' · ')}. USDT0 is listed by its SAC address with symbol “USDT”.
                    </div>
                  ) : null}
                </div>
              ) : chains.status === 'loading' ? (
                <Spinner />
              ) : (
                <div className="text-xs text-danger">{chains.error}</div>
              )}
              <JsonReveal request={`GET ${TRANSFER_API}/tokens?chainKey=stellar`} data={prices.data?.tokens ?? prices.error} />
            </div>
            <Callout tone="info" title="Getting a key">
              <p>Quotes are early access. Request a key through LayerZero's <a className="text-accent hover:underline" href={TRANSFER_API_KEY_FORM} target="_blank" rel="noreferrer">form ↗</a>. Your key is kept in this tab's sessionStorage only and sent straight to LayerZero from your browser.</p>
            </Callout>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted">
              x-api-key
              <input className="input mt-1 mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="paste your key" />
            </label>
            <label className="text-xs text-muted">
              Request body (editable; field names follow the API's own conventions)
              <textarea className="input mt-1 mono h-44" value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            <button className="btn btn-primary" onClick={() => void transfer.run()} disabled={!apiKey || transfer.status === 'loading'}>
              {transfer.status === 'loading' ? 'Requesting…' : 'POST /v1/quotes'}
            </button>
            {transfer.error ? <Callout tone="warn">{transfer.error}</Callout> : null}
            {transfer.value !== null && transfer.status === 'done' ? (
              <div className="space-y-2">
                <div className="text-xs text-muted">Annotated fields:</div>
                <ul className="space-y-1 text-xs">
                  {Object.keys((transfer.value as Record<string, unknown>) ?? {}).map((k) => (
                    <li key={k}><code>{k}</code> — {QUOTE_FIELD_NOTES[k] ?? 'see API reference'}</li>
                  ))}
                </ul>
                <CodeBlock title="response" lang="json" code={safeJson(transfer.value)} />
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      <UnderTheHood
        items={[
          { title: 'quote_oft + quote_send', code: extractSnippet(oftSrc, 'quoteOft'), note: <p>Two read-only simulations. <code>quote_oft</code> takes <code>(from, send_param)</code>, <code>quote_send</code> adds <code>pay_in_zro</code>. Returned i128 values arrive as bigints.</p>, live: q ? { data: { oft: q.oft, fee: q.fee } } : undefined },
          { title: 'Building SendParam', code: extractSnippet(oftSrc, 'sendParamScVal'), note: <p>The Rust struct becomes an ScMap with keys sorted alphabetically; <code>to</code> is 32 bytes (EVM address left-padded); amounts are i128 in 7-decimal stroops.</p> },
          { title: 'One route', code: extractSnippet(quotesSrc, 'quoteRoute'), note: <p>Peer check first (no peer = not wired), then the quotes, the fee bps, enforced options and the DVN set, in parallel.</p> },
          { title: 'Five routes', code: extractSnippet(quotesSrc, 'compareRoutes') },
          { title: 'Transfer API', code: extractSnippet(transferSrc, 'transferApiPublic') + '\n\n' + extractSnippet(transferSrc, 'transferApiQuote'), live: transfer.value ? { request: `POST ${TRANSFER_API}/quotes`, data: transfer.value } : undefined },
        ]}
      />
    </div>
  );
}

function safeDecode(hex: `0x${string}`) {
  try {
    return decodeOptions(hex);
  } catch {
    return null;
  }
}
function safeHex(strkey: string): string {
  try {
    return stellarAddressToHex(strkey);
  } catch {
    return '';
  }
}
