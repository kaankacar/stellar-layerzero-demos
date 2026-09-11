import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/Shell';
import { AddressChip, Callout, ConsolePanel, DataStatus, Explainer, Section, Spinner, StatTile, UnderTheHood, CountUp } from '@/components/ui';
import { Lifecycle } from '@/components/Lifecycle';
import { ChainBadge } from '@/components/ChainBadge';
import { EVM_TESTNETS, explorers } from '@/config/networks';
import { TESTCOIN_DEPLOYMENT, TESTCOIN_FAUCET_AMOUNT, testcoinReady } from '@/config/testcoin';
import { TESTNET_DEPLOYMENT } from '@/config/testnet';
import { usePageNetworks } from '@/lib/wallets/WalletProvider';
import { useLoader, toLoaded } from '@/lib/useLoader';
import { loadRegistry } from '@/lib/layerzero/chains';
import { useOftBridge } from '@/lib/oftBridge/useOftBridge';
import { loadLockUnlockSupply } from '@/lib/oftBridge/supply';
import { getOftFacts } from '@/lib/stellar/oft';
import { formatUnits, parseUnits, timeAgo } from '@/lib/format';
import { isEvmAddress } from '@/lib/hex';
import { isStellarAccount } from '@/lib/stellar/strkey';
import { extractSnippet } from '@/lib/snippets';
import deploySrc from '../../scripts/deploy-testcoin.ts?raw';
import supplySrc from '@/lib/oftBridge/supply.ts?raw';
import oftSrc from '@/lib/stellar/oft.ts?raw';
import bridgeSrc from '@/lib/oftBridge/useOftBridge.ts?raw';

const D = TESTCOIN_DEPLOYMENT;
const READY = testcoinReady(D);
const EVM_KEY = D.evm?.chainKey ?? 'sepolia';
const EVM = EVM_TESTNETS[EVM_KEY];
const CFG = READY.wired && D.stellar?.oft && D.stellar.sac && D.evm?.oft ? { stellar: { oft: D.stellar.oft, sac: D.stellar.sac, assetCode: D.stellar.assetCode, issuer: D.stellar.issuer, faucet: D.stellar.faucet }, evm: { oft: D.evm.oft, chainKey: EVM_KEY, eid: D.evm.eid }, defaults: { out: '100', back: '40' } } : null;

export function TestCoinPage() {
  usePageNetworks({ stellar: 'testnet', evm: EVM_KEY });
  const registry = useLoader((f) => loadRegistry(f), []);
  const bridge = useOftBridge(CFG);
  const { stellar, evm } = bridge.wallets;
  const supply = useLoader(() => (CFG ? toLoaded(loadLockUnlockSupply(CFG.stellar.sac, CFG.stellar.oft, CFG.stellar.assetCode, CFG.stellar.issuer, { chainKey: EVM_KEY, oft: CFG.evm.oft })) : Promise.resolve({ status: 'unavailable' as const, data: null, error: 'not deployed', fetchedAt: null })), [bridge.out.tracker.messages[0]?.status.name, bridge.back.tracker.messages[0]?.status.name]);
  const modes = useLoader(
    () =>
      toLoaded(
        Promise.all([D.stellar?.oft ? getOftFacts('testnet', D.stellar.oft) : null, TESTNET_DEPLOYMENT.stellar?.oft ? getOftFacts('testnet', TESTNET_DEPLOYMENT.stellar.oft) : null]).then(([testcoin, tusdt0]) => ({ testcoin, tusdt0 })),
      ),
    [],
  );

  const s = supply.data;
  return (
    <div className="space-y-6">
      <PageHeader title="TestCoin: a token born on Stellar" mode="testnet">
        The playground mirrors USDT0, a token that <em>arrives</em> on Stellar. TESTCOIN is the other story: a token <strong>issued on Stellar</strong> that travels out over LayerZero. Same endpoint, same wiring, one different constructor argument: <code>OftType::LockUnlock</code>.
      </PageHeader>

      <Callout tone="testnet" title="Testnet, mock, no value">
        <p>TESTCOIN is a demo asset issued by a throwaway account this repo controls. Everything below runs on Stellar testnet and {EVM.label}. Testnet delivery is slow: the {EVM.label} executor has taken 8 to 90 minutes on recent messages, so keep the Tracker link.</p>
      </Callout>

      <Explainer id="testcoin">
        <p>
          With <strong>MintBurn</strong> (tUSDT0, USDT0), the Stellar OFT burns on send and mints on receive, so Stellar's supply shrinks and grows with traffic. With <strong>LockUnlock</strong>, the Stellar OFT never mints: on send it <em>transfers your tokens to itself</em> and holds them; on receive it transfers them back out. The classic supply on Stellar is therefore the <strong>total supply across all chains</strong>, and the OFT's own balance is the reserve backing everything minted elsewhere.
        </p>
        <p>
          This is exactly the role the Ethereum <em>adapter</em> plays for USDT0, mirrored: there, Ethereum holds the reserve and Stellar mints; here, Stellar holds the reserve and {EVM.label} mints. The invariant to watch is <code>locked in the Stellar OFT == minted on {EVM.label}</code>, and the page checks it live after every transfer.
        </p>
        <p>
          Everything else is identical to the playground: a locked issuer, a SAC-manager as SAC admin, a Faucet with <code>MINTER_ROLE</code> for new supply, peers on both sides, enforced options, and the per-OApp ULN config that names the active testnet DVN.
        </p>
      </Explainer>

      {!READY.wired ? (
        <Callout tone="warn" title="Not deployed yet">
          <p>Run <code>pnpm deploy:testcoin</code> (needs Sepolia ETH on the EVM deployer) and commit <code>src/config/testcoin-deployment.json</code>.</p>
        </Callout>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Section title="Supply invariant, live" subtitle="Horizon (classic supply) · Stellar OFT balance (locked reserve) · Sepolia totalSupply (minted)" right={<DataStatus state={supply} reload={supply.reload} />}>
          {s ? (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <StatTile label="Total supply (Stellar classic)" value={<CountUp value={s.stellarTotal} digits={2} />} sub={`${s.holders} holders · every TESTCOIN that exists anywhere`} />
                <StatTile label="Locked in the Stellar OFT" value={<CountUp value={Number(s.lockedLd) / 1e7} digits={2} />} sub="SAC.balance(OFT): the reserve" tone="warn" />
                <StatTile label={`Minted on ${EVM.label}`} value={<CountUp value={Number(s.evmTotalSupply) / 1e6} digits={2} />} sub="TestCoin OFT totalSupply()" tone="ok" />
              </div>
              <div className={`mt-3 rounded-lg border p-3 text-sm ${s.invariantHolds ? 'border-ok/50 bg-ok/10' : 'border-danger/50 bg-danger/10'}`}>
                <strong>{s.invariantHolds ? '✓ Invariant holds:' : '✗ Invariant broken:'}</strong> locked ÷ 10 ({formatUnits(s.lockedLd / 10n, 6)}) {s.invariantHolds ? '==' : '≠'} minted on {EVM.label} ({formatUnits(s.evmTotalSupply, 6)}). Stellar has 7 decimals and the EVM token 6, so the reserve is compared in shared units. <span className="text-muted">(In-flight messages temporarily show a gap: locked before minted.)</span>
              </div>
            </>
          ) : supply.status === 'loading' ? (
            <Spinner label="reading Horizon, the OFT reserve and Sepolia…" />
          ) : (
            <Callout tone="warn">{supply.error}</Callout>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {D.stellar?.sac ? <AddressChip label="SAC" address={D.stellar.sac} href={explorers.stellarContract('testnet', D.stellar.sac)} /> : null}
            {D.stellar?.oft ? <AddressChip label="OFT (LockUnlock)" address={D.stellar.oft} href={explorers.stellarContract('testnet', D.stellar.oft)} /> : null}
            {D.stellar?.sacManager ? <AddressChip label="SAC-manager" address={D.stellar.sacManager} href={explorers.stellarContract('testnet', D.stellar.sacManager)} /> : null}
            {D.stellar?.faucet ? <AddressChip label="Faucet" address={D.stellar.faucet} href={explorers.stellarContract('testnet', D.stellar.faucet)} /> : null}
            {D.stellar ? <AddressChip label="issuer (locked)" address={D.stellar.issuer} href={explorers.stellarAccount('testnet', D.stellar.issuer)} /> : null}
            {D.evm?.oft ? <AddressChip label={`OFT on ${EVM.label}`} address={D.evm.oft} href={explorers.evmAddress(EVM.explorer, D.evm.oft)} /> : null}
          </div>
        </Section>

        <Section title="Two modes, side by side" subtitle="oft_type() read live from both testnet OFTs" right={<DataStatus state={modes} reload={modes.reload} />}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted"><tr><th className="py-1 pr-2"></th><th className="py-1 pr-2">tUSDT0 (playground)</th><th className="py-1 pr-2">TESTCOIN (this page)</th></tr></thead>
              <tbody className="[&_td]:py-1.5 [&_td]:pr-2 [&_tr]:border-t [&_tr]:border-border/60">
                <tr><td className="text-muted">oft_type()</td><td className="mono">{modes.data?.tusdt0 ? `${modes.data.tusdt0.oftType.variant}(${modes.data.tusdt0.oftType.minter?.slice(0, 8)}…)` : '…'}</td><td className="mono">{modes.data?.testcoin?.oftType.variant ?? '…'}</td></tr>
                <tr><td className="text-muted">on send from Stellar</td><td>burn via SAC</td><td>transfer to the OFT (lock)</td></tr>
                <tr><td className="text-muted">on receive on Stellar</td><td>SAC-manager.mint (MINTER_ROLE)</td><td>transfer from the OFT (unlock)</td></tr>
                <tr><td className="text-muted">Stellar classic supply means</td><td>what is currently on Stellar</td><td>total supply on all chains</td></tr>
                <tr><td className="text-muted">who needs MINTER_ROLE</td><td>OFT + Faucet</td><td>Faucet only</td></tr>
                <tr><td className="text-muted">real-world analogue</td><td>USDT0 on Stellar</td><td>USDT0's Ethereum adapter (mirrored)</td></tr>
                <tr><td className="text-muted">shared / local decimals</td><td>6 / 7</td><td>6 / 7</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Both OFTs are the same wasm ({D.wasm?.oft?.slice(0, 12) ?? '…'}…); only the constructor's <code>oft_type</code> differs. Compare with the <Link className="text-accent hover:underline" to="/playground">playground</Link>.</p>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="1 · Get TESTCOIN">
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <ChainBadge chainKey="stellar-testnet" />
              {stellar.address ? <span className="mono">{stellar.address.slice(0, 10)}…</span> : <button className="btn" onClick={() => void stellar.connect()}>Connect Stellar wallet</button>}
              {stellar.wrongNetwork ? <span className="text-warn">switch to Test Net</span> : null}
            </div>
            <StatTile label="TESTCOIN on Stellar" value={bridge.hasTrustline ? formatUnits(parseUnits(bridge.stBalances.data!.mock!, 7), 7) : stellar.address ? (bridge.stBalances.data?.exists ? 'no trustline' : 'account not funded') : '—'} sub={!bridge.stBalances.data?.exists && stellar.address ? <button className="text-accent hover:underline" onClick={() => void bridge.fund.run()}>Fund with Friendbot</button> : 'classic balance via Horizon'} />
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={!stellar.address || bridge.hasTrustline || bridge.trustline.status === 'loading' || !READY.wired} onClick={() => void bridge.trustline.run()}>{bridge.hasTrustline ? '✓ trustline' : 'Add trustline'}</button>
              <button className="btn btn-primary" disabled={!bridge.hasTrustline || bridge.drip.status === 'loading' || !READY.wired} onClick={() => void bridge.drip.run()}>{bridge.drip.status === 'loading' ? 'minting…' : `Faucet: ${formatUnits(TESTCOIN_FAUCET_AMOUNT, 7)}`}</button>
            </div>
            {bridge.trustline.error ? <div className="text-xs text-danger">{bridge.trustline.error}</div> : null}
            {bridge.drip.error ? <div className="text-xs text-danger">{bridge.drip.error.includes('9101') ? 'Cooldown: once per ~hour per address.' : bridge.drip.error}</div> : null}
          </div>
        </Section>

        <Section title={`2 · Lock on Stellar, mint on ${EVM.label}`}>
          <div className="space-y-2 text-sm">
            <label className="text-xs text-muted">Amount (TESTCOIN)<input className="input mt-1 mono" value={bridge.out.amount} onChange={(e) => bridge.out.setAmount(e.target.value)} /></label>
            <label className="text-xs text-muted">Recipient on {EVM.label}<input className={`input mt-1 mono ${bridge.out.recipient && !isEvmAddress(bridge.out.recipient) ? 'border-danger' : ''}`} value={bridge.out.recipient} onChange={(e) => bridge.out.setRecipient(e.target.value.trim())} placeholder="0x… (your MetaMask)" /></label>
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={!stellar.address || !bridge.out.param || !bridge.hasTrustline || bridge.out.quoteAction.status === 'loading' || !READY.wired} onClick={() => void bridge.out.quoteAction.run()}>{bridge.out.quoteAction.status === 'loading' ? 'quoting…' : 'quote'}</button>
              <button className="btn btn-primary" disabled={!bridge.out.quote || bridge.out.sendAction.status === 'loading' || stellar.wrongNetwork} onClick={() => void bridge.out.sendAction.run()}>{bridge.out.sendAction.status === 'loading' ? 'sign in wallet…' : 'send (locks)'}</button>
            </div>
            {bridge.out.quote ? <div className="text-xs text-muted">arrives {formatUnits(bridge.out.quote.received, 7)} · fee {formatUnits(bridge.out.quote.fee, 7)} XLM · the OFT will hold {formatUnits(bridge.out.quote.sent, 7)} TESTCOIN as reserve</div> : null}
            {bridge.out.quoteAction.error ? <div className="text-xs text-danger">{bridge.out.quoteAction.error}</div> : null}
            {bridge.out.sendAction.error ? <div className="text-xs text-danger">{bridge.out.sendAction.error}</div> : null}
            {bridge.out.tx ? (
              <div className="space-y-2">
                <div className="text-xs text-muted"><a className="text-accent hover:underline" href={explorers.stellarTx('testnet', bridge.out.tx)} target="_blank" rel="noreferrer">source tx</a> · <Link className="text-accent hover:underline" to={`/tracker?env=testnet&q=${bridge.out.tx}`}>Tracker</Link></div>
                {bridge.out.tracker.messages.map((m) => <Lifecycle key={m.guid} message={m} env="testnet" registry={registry.data} compact />)}
                {bridge.out.tracker.messages.length === 0 ? <Spinner label="waiting for Scan…" /> : null}
              </div>
            ) : null}
          </div>
        </Section>

        <Section title={`3 · Burn on ${EVM.label}, unlock on Stellar`}>
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <ChainBadge chainKey={EVM.chainKey} />
              {evm.address ? <span className="mono">{evm.address.slice(0, 10)}…</span> : <button className="btn" onClick={() => void evm.connect()}>Connect MetaMask</button>}
              {evm.wrongNetwork ? <button className="text-warn hover:underline" onClick={() => void evm.switchToExpected()}>switch to {EVM.label}</button> : null}
              {bridge.evmBalances.data ? <span className="text-muted">balance {formatUnits(bridge.evmBalances.data.mock, 6)} TESTCOIN</span> : null}
            </div>
            <label className="text-xs text-muted">Amount (TESTCOIN, 6 decimals on EVM)<input className="input mt-1 mono" value={bridge.back.amount} onChange={(e) => bridge.back.setAmount(e.target.value)} /></label>
            <label className="text-xs text-muted">Stellar recipient (G…, with trustline)<input className={`input mt-1 mono ${bridge.back.recipient && !isStellarAccount(bridge.back.recipient) ? 'border-danger' : ''}`} value={bridge.back.recipient} onChange={(e) => bridge.back.setRecipient(e.target.value.trim())} /></label>
            <button className="btn btn-primary" disabled={!evm.walletClient || !READY.wired || bridge.back.sendAction.status === 'loading'} onClick={() => void bridge.back.sendAction.run()}>{bridge.back.sendAction.status === 'loading' ? 'confirm in MetaMask…' : 'quoteSend + send (unlocks)'}</button>
            {bridge.back.sendAction.error ? <div className="text-xs text-danger">{bridge.back.sendAction.error}</div> : null}
            {bridge.back.tx ? (
              <div className="space-y-2">
                <div className="text-xs text-muted"><a className="text-accent hover:underline" href={explorers.evmTx(EVM.explorer, bridge.back.tx)} target="_blank" rel="noreferrer">source tx</a> · <Link className="text-accent hover:underline" to={`/tracker?env=testnet&q=${bridge.back.tx}`}>Tracker</Link></div>
                {bridge.back.tracker.messages.map((m) => <Lifecycle key={m.guid} message={m} env="testnet" registry={registry.data} compact />)}
                {bridge.back.tracker.messages.length === 0 ? <Spinner label="waiting for Scan…" /> : null}
              </div>
            ) : null}
          </div>
        </Section>
      </div>

      <Section title="Console"><ConsolePanel entries={bridge.console.entries} onClear={bridge.console.clear} /></Section>

      <UnderTheHood
        items={[
          { title: 'The one different line', code: extractSnippet(deploySrc, 'deployLockUnlock'), note: <p>From <code>scripts/deploy-testcoin.ts</code>. <code>sc.enumUnit('LockUnlock')</code> encodes the unit variant; the playground passes <code>sc.enumTuple('MintBurn', sc.address(sacManager))</code>.</p> },
          { title: 'Supply invariant', code: extractSnippet(supplySrc, 'lockUnlockSupply'), live: s ? { data: s } : undefined },
          { title: 'oft_type and friends', code: extractSnippet(oftSrc, 'getOftFacts'), live: modes.data ? { data: modes.data } : undefined },
          { title: 'Send / send back (shared hook)', code: extractSnippet(oftSrc, 'prepareOftSend') + '\n\n' + extractSnippet(bridgeSrc, 'bridgeSendBack'), note: <p>The same hook drives this page; the token, mode and peers come from the deployment file.</p> },
        ]}
      />
      <div className="text-xs text-muted">Deployment recorded {D.deployedAt ? timeAgo(D.deployedAt) : 'never'} · endpoint {D.registry?.endpoint ?? '—'}</div>
    </div>
  );
}
