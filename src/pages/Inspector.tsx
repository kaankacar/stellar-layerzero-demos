import { useMemo } from 'react';
import { PageHeader } from '@/components/Shell';
import { AddressChip, Callout, CountUp, DataStatus, Explainer, JsonReveal, Section, Skeleton, StatTile, UnderTheHood } from '@/components/ui';
import { ThreeContractsDiagram } from '@/components/diagrams/ThreeContracts';
import { USDT0 } from '@/config/usdt0';
import { DOCS, explorers } from '@/config/networks';
import { STELLAR_FALLBACK } from '@/config/layerzero.fallback';
import { useLoader } from '@/lib/useLoader';
import { inspectorLoaders } from '@/lib/usdt0/facts';
import { activeDvns, dvnName, loadRegistry } from '@/lib/layerzero/chains';
import { decodeOptions, describeOption } from '@/lib/layerzero/options';
import { formatNumber, formatUnits } from '@/lib/format';
import { extractSnippet } from '@/lib/snippets';
import factsSrc from '@/lib/usdt0/facts.ts?raw';
import simulateSrc from '@/lib/stellar/simulate.ts?raw';
import oftSrc from '@/lib/stellar/oft.ts?raw';
import ulnSrc from '@/lib/stellar/uln.ts?raw';
import horizonSrc from '@/lib/stellar/horizon.ts?raw';
import optionsSrc from '@/lib/layerzero/options.ts?raw';

function Flag({ name, on, meaning }: { name: string; on: boolean; meaning: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 p-2 text-sm">
      <span className={`mt-0.5 pill ${on ? 'border-ok/50 text-ok' : 'border-border text-muted'}`}>{on ? 'true' : 'false'}</span>
      <div>
        <div className="mono text-xs">{name}</div>
        <div className="text-xs text-muted">{meaning}</div>
      </div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span className={`pill ${ok === null ? 'border-border text-muted' : ok ? 'border-ok/50 text-ok' : 'border-danger/50 text-danger'}`}>
      {ok === null ? '…' : ok ? '✓' : '✗'} {label}
    </span>
  );
}

export function InspectorPage() {
  const classic = useLoader(inspectorLoaders.classic, []);
  const contracts = useLoader(inspectorLoaders.contracts, []);
  const peers = useLoader(inspectorLoaders.peers, []);
  const trust = useLoader(inspectorLoaders.trust, []);
  const eth = useLoader(inspectorLoaders.ethereum, []);
  const registry = useLoader((f) => loadRegistry(f), []);

  const enforced = useMemo(() => {
    const hex = contracts.data?.enforcedToEthereum;
    if (!hex) return null;
    try {
      return decodeOptions(hex);
    } catch {
      return null;
    }
  }, [contracts.data]);
  const ethEnforced = useMemo(() => {
    const hex = eth.data?.enforcedToStellar;
    if (!hex) return null;
    try {
      return decodeOptions(hex);
    } catch {
      return null;
    }
  }, [eth.data]);

  const a = classic.data?.asset;
  const wired = peers.data?.filter((p) => p.peer) ?? [];
  const registryDvns = activeDvns(registry.data, 'mainnet');

  return (
    <div className="space-y-6">
      <PageHeader title="USDT0 Inspector" mode="mainnet-readonly">
        A live fact sheet for the real USDT0 on Stellar mainnet. Every number below is fetched now, from Horizon, Soroban RPC (read-only simulation) and LayerZero's registry, and each card shows the exact call behind it.
      </PageHeader>

      <Explainer id="inspector" diagram={<ThreeContractsDiagram />}>
        <p>
          USDT0 on Stellar is <strong>three things at once</strong>. It is a <strong>classic Stellar asset</strong> (<code>USDT0</code> issued by a locked account), which gives it trustlines, authorization flags and Horizon statistics. It has a <strong>Stellar Asset Contract (SAC)</strong>, the SEP-41 token interface that Soroban contracts call. And there is a separate <strong>OFT contract</strong>, a LayerZero OApp that burns the SAC token when you send and mints when a message arrives.
        </p>
        <p>
          The OFT cannot mint by itself: the SAC's admin is a <strong>SAC-manager</strong> contract, and the OFT holds its <code>MINTER_ROLE</code>. Both are owned by a OneSig multisig. The issuer's master key weight is <strong>0</strong>, so nobody can bypass that role model by paying from the issuer.
        </p>
        <p>
          Read-only means read-only: the RPC calls here are <code>simulateTransaction</code> against a throwaway envelope. Nothing is signed or submitted.
        </p>
      </Explainer>

      {/* Headline stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Holders (trustlines, authorized)" value={a ? <CountUp value={a.accounts.authorized} /> : <Skeleton />} sub="Horizon /assets · accounts.authorized" />
        <StatTile label="Total supply on Stellar" value={classic.data ? <CountUp value={classic.data.supply} digits={2} suffix=" USDT0" /> : <Skeleton />} sub="classic + contracts + claimable + pools" />
        <StatTile label="Held by contracts" value={a ? <CountUp value={Number(a.contracts_amount)} digits={2} /> : <Skeleton />} sub={a ? `${a.num_contracts} contract balances` : undefined} />
        <StatTile label="Held by accounts" value={a ? <CountUp value={Number(a.balances.authorized)} digits={2} /> : <Skeleton />} sub={a ? `+ ${Number(a.claimable_balances_amount).toFixed(2)} claimable, ${Number(a.liquidity_pools_amount).toFixed(2)} in pools` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Classic asset */}
        <Section
          title="1 · Classic asset (Horizon)"
          subtitle={<>GET <code className="text-xs">/assets?asset_code=USDT0&amp;asset_issuer=…</code> and <code className="text-xs">/accounts/{'{issuer}'}</code></>}
          right={<DataStatus state={classic} reload={classic.reload} />}
        >
          <div className="mb-3 flex flex-wrap gap-2">
            <AddressChip label="issuer" address={USDT0.issuer} href={explorers.stellarAccount('mainnet', USDT0.issuer)} />
            <a className="text-xs text-accent hover:underline" href={explorers.stellarAsset('mainnet', USDT0.code, USDT0.issuer)} target="_blank" rel="noreferrer">asset on stellar.expert ↗</a>
          </div>
          {a ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Flag name="auth_revocable" on={a.flags.auth_revocable} meaning="Issuer can freeze a holder's trustline (compliance freezes). Tether's USDT has this on every chain." />
              <Flag name="auth_clawback_enabled" on={a.flags.auth_clawback_enabled} meaning="Issuer (here: the SAC-manager, via CLAWBACK_ROLE) can pull tokens back from a holder. USDC on Stellar does not enable this." />
              <Flag name="auth_required" on={a.flags.auth_required} meaning="Off: anyone can open a trustline without approval. Required for a permissionless bridge recipient." />
              <Flag name="auth_immutable" on={a.flags.auth_immutable} meaning="Off: flags could still change. In practice they cannot: the issuer is locked (below)." />
            </div>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
          {classic.data ? (
            <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-semibold">Issuer account</span>
                <Check ok={classic.data.locked} label={classic.data.locked ? 'locked: master key weight 0, no signers' : 'NOT locked'} />
                <Check ok={!classic.data.issuer.home_domain} label={classic.data.issuer.home_domain ? `home_domain ${classic.data.issuer.home_domain}` : 'no home_domain (no stellar.toml)'} />
              </div>
              <p className="text-xs text-muted">
                Thresholds low/med/high = {classic.data.issuer.thresholds.low_threshold}/{classic.data.issuer.thresholds.med_threshold}/{classic.data.issuer.thresholds.high_threshold}. Last modified {classic.data.issuer.last_modified_time}.
              </p>
              <p className="mt-2 text-xs text-muted">
                <strong className="text-text">Why lock the issuer?</strong> On Stellar, a payment <em>from</em> the issuer is minting. If the issuer could still sign, the OFT's role model (mint only via the SAC-manager, only under <code>MINTER_ROLE</code>) could be bypassed. Weight 0 makes the classic issuer inert and moves all control to the contracts, and the OneSig that owns them.
              </p>
            </div>
          ) : null}
          <JsonReveal request={classic.data?.requests.asset} data={classic.data ? { asset: classic.data.asset, issuer: classic.data.issuer } : classic.error} />
        </Section>

        {/* SAC + OFT */}
        <Section
          title="2 · SAC and OFT contracts (Soroban RPC)"
          subtitle="simulateTransaction on the contract getters; nothing is signed"
          right={<DataStatus state={contracts} reload={contracts.reload} />}
        >
          <div className="mb-3 flex flex-wrap gap-2">
            <AddressChip label="SAC" address={USDT0.sac} href={explorers.stellarContract('mainnet', USDT0.sac)} />
            <AddressChip label="OFT" address={USDT0.oft} href={explorers.stellarContract('mainnet', USDT0.oft)} />
            <AddressChip label="SAC-manager" address={USDT0.sacManager} href={explorers.stellarContract('mainnet', USDT0.sacManager)} />
            <a className="text-xs text-accent hover:underline" href={explorers.lzOApp('mainnet', USDT0.oftHex)} target="_blank" rel="noreferrer">OFT on LayerZero Scan ↗</a>
          </div>
          {contracts.data ? (
            <div className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-3">
                <StatTile label="SAC name / symbol" value={<span className="text-base">{contracts.data.sac.symbol}</span>} sub={contracts.data.sac.name} />
                <StatTile label="local decimals" value={contracts.data.sac.decimals} sub="Stellar assets always have 7" />
                <StatTile label="shared decimals" value={contracts.data.oft.sharedDecimals} sub={`conversion rate ${contracts.data.oft.decimalConversionRate.toString()} → dust below 0.000001`} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Check ok={contracts.data.sacIsOftToken} label="OFT.token() == SAC" />
                <Check ok={contracts.data.sac.admin === USDT0.sacManager} label="SAC.admin() == SAC-manager" />
                <Check ok={contracts.data.oft.oftType.variant === 'MintBurn'} label={`oft_type = ${contracts.data.oft.oftType.variant}`} />
                <Check ok={contracts.data.oft.oftType.minter === USDT0.sacManager} label="MintBurn minter == SAC-manager" />
                <Check ok={!contracts.data.oft.isPaused} label={contracts.data.oft.isPaused ? 'PAUSED' : 'not paused'} />
                <Check ok={contracts.data.endpointMatchesRegistry} label="OFT.endpoint() == registry endpoint" />
                <Check ok={contracts.data.oft.owner === USDT0.oneSig} label="owner == OneSig" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-border bg-surface-2 p-2 text-xs">
                  <div className="text-muted">OFT fee to Ethereum (effective_fee_bps)</div>
                  <div className="text-base font-semibold">{contracts.data.feeBpsToEthereum} bps</div>
                  <div className="text-muted">Live config: a non-zero fee would be charged in USDT0 and shown by quote_oft.</div>
                </div>
                <div className="rounded-md border border-border bg-surface-2 p-2 text-xs">
                  <div className="text-muted">Enforced options to Ethereum (msg type 1)</div>
                  <div className="mono break-all">{contracts.data.enforcedToEthereum ?? 'none'}</div>
                  {enforced ? <div className="text-ok">{enforced.options.map(describeOption).join('; ')} → the executor spends this on lzReceive</div> : null}
                </div>
              </div>
              <div className="text-xs text-muted">
                OFT version {contracts.data.oft.oftVersion} · approval_required {String(contracts.data.oft.approvalRequired)} (burn from the sender needs no allowance on Stellar) · outbound rate limit to Ethereum: {contracts.data.rateLimitToEthereum ? `${formatUnits(contracts.data.rateLimitToEthereum.limit, 7)} per ${contracts.data.rateLimitToEthereum.windowSeconds}s (${contracts.data.rateLimitToEthereum.mode})` : 'none set'}
              </div>
            </div>
          ) : contracts.status === 'loading' ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Callout tone="warn">Could not read the contracts right now: {contracts.error}</Callout>
          )}
          <JsonReveal data={contracts.data ?? contracts.error} request="simulateTransaction(OFT.token / shared_decimals / decimal_conversion_rate / oft_type / is_paused / owner / endpoint …)" />
        </Section>
      </div>

      {/* Peers */}
      <Section
        title="3 · Wired peers"
        subtitle={<>peer(eid) on the OFT for each network listed at <a className="text-accent hover:underline" href={DOCS.usdt0Deployments} target="_blank" rel="noreferrer">docs.usdt0.to</a>. A peer is the 32-byte address of the USDT0 contract on the other chain; no peer means no route from Stellar.</>}
        right={<DataStatus state={peers} reload={peers.reload} />}
      >
        {peers.data ? (
          <>
            <div className="mb-2 text-sm">
              <strong>{wired.length}</strong> of {peers.data.filter((p) => p.eid !== USDT0.eid).length} listed networks are wired from Stellar today.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3">Network</th>
                    <th className="py-1 pr-3">EID</th>
                    <th className="py-1 pr-3">Type there</th>
                    <th className="py-1 pr-3">peer(eid) from Stellar</th>
                  </tr>
                </thead>
                <tbody>
                  {peers.data
                    .filter((p) => p.eid !== USDT0.eid)
                    .sort((x, y) => Number(!!y.peer) - Number(!!x.peer))
                    .map((p) => (
                      <tr key={p.chainKey} className="border-t border-border/60">
                        <td className="py-1.5 pr-3">{p.name}</td>
                        <td className="py-1.5 pr-3 mono">{p.eid ?? '—'}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`pill ${p.type === 'OFT_ADAPTER' ? 'border-warn/50 text-warn' : 'border-border text-muted'}`}>{p.type === 'OFT_ADAPTER' ? 'OFT Adapter (lock/unlock)' : 'OFT (burn/mint)'}</span>
                        </td>
                        <td className="py-1.5 pr-3 mono">
                          {p.peer ? (
                            <span className="text-ok">{p.peerEvm ?? p.peer}</span>
                          ) : p.eid ? (
                            <span className="text-muted">null · not wired</span>
                          ) : (
                            <span className="text-muted">no EID in registry</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        ) : peers.status === 'loading' ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <Callout tone="warn">Peers unavailable: {peers.error}</Callout>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Trust model */}
        <Section
          title="4 · Trust model: who verifies a USDT0 message?"
          subtitle="ULN302.effective_send_uln_config(OFT, 30101) — the DVN set USDT0 itself configured for Stellar → Ethereum"
          right={<DataStatus state={trust} reload={trust.reload} />}
        >
          {trust.data ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="mb-1 text-xs uppercase tracking-wide text-muted">Required DVNs ({trust.data.send.requiredDvns.length}) · {trust.data.send.confirmations.toString()} source confirmations</div>
                <ul className="space-y-1">
                  {trust.data.send.requiredDvns.map((d) => (
                    <li key={d} className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{dvnName(registry.data, 'mainnet', trust.data!.dvnHex[d] ?? '')}</span>
                      <AddressChip address={d} href={explorers.stellarContract('mainnet', d)} />
                    </li>
                  ))}
                </ul>
                {trust.data.send.optionalDvns.length ? <div className="mt-1 text-xs text-muted">+ {trust.data.send.optionalDvns.length} optional (threshold {trust.data.send.optionalDvnThreshold})</div> : null}
                <div className="mt-2 text-xs text-muted">
                  Executor: <span className="mono">{trust.data.executor.executor.slice(0, 12)}…</span> · max message size {trust.data.executor.maxMessageSize} bytes
                </div>
              </div>
              <Callout tone="info" title={`${registryDvns.length} DVN operators are registered on Stellar mainnet; USDT0 requires ${trust.data.send.requiredDvns.length}.`}>
                <p>
                  Registered: {registryDvns.map((d) => d.name).join(', ')}. LayerZero lets <em>each application</em> pick its verifier set; USDT0 chose LayerZero Labs, Canary and its own DVN, and every one of them must attest before a message can execute. A DVN attests to the <strong>packet header</strong> (nonce, source/destination EIDs, sender, receiver) plus the <strong>payload hash</strong>, see a real attestation on the Tracker page.
                </p>
                {trust.data.libraryDefault ? (
                  <p className="text-xs">
                    For contrast, the library <em>default</em> for this pathway is a placeholder ({trust.data.libraryDefault.requiredDvns.length} DVN, {trust.data.libraryDefault.confirmations.toString()} confirmations): production OApps on Stellar set their own config.
                  </p>
                ) : null}
              </Callout>
            </div>
          ) : trust.status === 'loading' ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Callout tone="warn">ULN config unavailable: {trust.error}</Callout>
          )}
          <JsonReveal data={trust.data ?? trust.error} request={`simulateTransaction(ULN ${STELLAR_FALLBACK.mainnet.sendUln302}.effective_send_uln_config(${USDT0.oft}, 30101))`} />
        </Section>

        {/* Ethereum side */}
        <Section
          title="5 · The other end: Ethereum OFT Adapter"
          subtitle="eth_call on a public Ethereum RPC. Burn-and-mint is per leg: Ethereum locks real USDT instead."
          right={<DataStatus state={eth} reload={eth.reload} />}
        >
          <div className="mb-3 flex flex-wrap gap-2">
            <AddressChip label="adapter" address={USDT0.ethereum.adapter} href={`https://etherscan.io/address/${USDT0.ethereum.adapter}`} />
            <AddressChip label="USDT" address={USDT0.ethereum.usdt} href={`https://etherscan.io/address/${USDT0.ethereum.usdt}`} />
          </div>
          {eth.data ? (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <Check ok={eth.data.token.toLowerCase() === USDT0.ethereum.usdt.toLowerCase()} label="token() == Tether USDT" />
                <Check ok={eth.data.approvalRequired} label={`approvalRequired = ${eth.data.approvalRequired} (lock/unlock)`} />
                <Check ok={eth.data.peerMatchesStellarOft} label="peers(30600) == Stellar OFT" />
                <Check ok={eth.data.sharedDecimals === 6} label={`sharedDecimals ${eth.data.sharedDecimals}`} />
              </div>
              <div className="rounded-md border border-border bg-surface-2 p-2 text-xs">
                <div className="text-muted">Enforced options towards Stellar (msg type 1)</div>
                <div className="mono break-all">{eth.data.enforcedToStellar}</div>
                {ethEnforced ? <div className="text-ok">{ethEnforced.options.map(describeOption).join('; ')} — "gas" is the executor's abstract unit on Stellar</div> : null}
              </div>
              <p className="text-xs text-muted">
                Sending USDT to Stellar locks it in this adapter and mints USDT0 on Stellar; sending back burns on Stellar and unlocks here. Total USDT0 across chains stays equal to the USDT locked on Ethereum.
              </p>
            </div>
          ) : eth.status === 'loading' ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <Callout tone="warn">Ethereum RPC unavailable: {eth.error}</Callout>
          )}
          <JsonReveal data={eth.data ?? eth.error} request={`eth_call ${USDT0.ethereum.adapter} token() / approvalRequired() / peers(30600) / enforcedOptions(30600, 1)`} />
        </Section>
      </div>

      <UnderTheHood
        items={[
          { title: 'Horizon: asset + issuer', code: extractSnippet(horizonSrc, 'horizonAsset') + '\n\n' + extractSnippet(factsSrc, 'classicFacts'), note: <p>Horizon is the classic-ledger API. The asset record gives holders, supply split and flags; the account record gives signers (weight 0 = locked) and <code>home_domain</code>.</p>, live: classic.data ? { request: classic.data.requests.asset, data: classic.data.asset } : undefined },
          { title: 'RPC: read-only simulation', code: extractSnippet(simulateSrc, 'simulateRead'), note: <p>There is no view-call RPC on Soroban. You build a transaction, simulate it, and read <code>result.retval</code>. Any existing account can be the envelope source.</p> },
          { title: 'OFT getters', code: extractSnippet(oftSrc, 'getOftFacts') + '\n\n' + extractSnippet(factsSrc, 'contractFacts'), live: contracts.data ? { data: contracts.data.oft } : undefined },
          { title: 'Peers', code: extractSnippet(factsSrc, 'loadPeers'), note: <p><code>peer(eid)</code> returns <code>Option&lt;BytesN&lt;32&gt;&gt;</code>. For EVM peers the 20-byte address is left-padded to 32 bytes.</p>, live: peers.data ? { data: peers.data } : undefined },
          { title: 'DVN config (ULN302)', code: extractSnippet(ulnSrc, 'effectiveSendUlnConfig') + '\n\n' + extractSnippet(factsSrc, 'trustFacts'), live: trust.data ? { data: trust.data.send } : undefined },
          { title: 'Decoding enforced options', code: extractSnippet(optionsSrc, 'decodeOptions'), note: <p>Type-3 options: <code>0x0003</code>, then per option: worker id, size, option type, payload. Option type 1 is <code>lzReceive(gas[, value])</code>.</p>, live: enforced ? { data: enforced } : undefined },
          { title: 'Ethereum adapter (viem)', code: extractSnippet(factsSrc, 'ethereumSide'), live: eth.data ? { data: eth.data } : undefined },
        ]}
      />

      <div className="text-xs text-muted">
        Attribution: USDT0 is built and operated by Everdawn Labs; USDT is Tether's asset. Holder count is {a ? formatNumber(a.accounts.authorized) : '…'} authorized trustlines; contract balances (Soroban) are counted separately by Horizon.
      </div>
    </div>
  );
}
