import { Link } from 'react-router-dom';
import type { RegistrySnapshot } from '@/lib/layerzero/chains';
import type { useOftBridge } from '@/lib/oftBridge/useOftBridge';
import { Lifecycle } from '@/components/Lifecycle';
import { ChainBadge } from '@/components/ChainBadge';
import { Section, Spinner, StatTile } from '@/components/ui';
import { EVM_TESTNETS, explorers, type EvmTestnetKey } from '@/config/networks';
import { formatUnits, parseUnits } from '@/lib/format';
import { isEvmAddress } from '@/lib/hex';
import { isStellarAccount } from '@/lib/stellar/strkey';

/** The generic three-step OFT round trip UI (get tokens, send out, send back) over the shared hook. */
export function BridgePanel({ bridge, assetCode, evmKey, registry, faucetAmount, ready }: { bridge: ReturnType<typeof useOftBridge>; assetCode: string; evmKey: EvmTestnetKey; registry: RegistrySnapshot | null; faucetAmount: bigint | null; ready: boolean }) {
  const EVM = EVM_TESTNETS[evmKey];
  const { stellar, evm } = bridge.wallets;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Section title={`1 · ${assetCode} on Stellar`}>
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ChainBadge chainKey="stellar-testnet" />
            {stellar.address ? <span className="mono">{stellar.address.slice(0, 10)}…</span> : <button className="btn" onClick={() => void stellar.connect()}>Connect Stellar wallet</button>}
            {stellar.wrongNetwork ? <span className="text-warn">switch to Test Net</span> : null}
          </div>
          <StatTile label={`${assetCode} balance`} value={bridge.hasTrustline ? formatUnits(parseUnits(bridge.stBalances.data!.mock!, 7), 7) : stellar.address ? (bridge.stBalances.data?.exists ? 'no trustline' : 'account not funded') : '—'} sub={!bridge.stBalances.data?.exists && stellar.address ? <button className="text-accent hover:underline" onClick={() => void bridge.fund.run()}>Fund with Friendbot</button> : 'classic balance via Horizon'} />
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={!stellar.address || bridge.hasTrustline || bridge.trustline.status === 'loading' || !ready} onClick={() => void bridge.trustline.run()}>{bridge.hasTrustline ? '✓ trustline' : 'Add trustline'}</button>
            {faucetAmount !== null ? (
              <button className="btn btn-primary" disabled={!bridge.hasTrustline || bridge.drip.status === 'loading' || !ready} onClick={() => void bridge.drip.run()}>{bridge.drip.status === 'loading' ? 'minting…' : `Faucet: ${formatUnits(faucetAmount, 7)}`}</button>
            ) : null}
          </div>
          {bridge.trustline.error ? <div className="text-xs text-danger">{bridge.trustline.error}</div> : null}
          {bridge.drip.error ? <div className="text-xs text-danger">{bridge.drip.error.includes('9101') ? 'Cooldown: once per ~hour per address.' : bridge.drip.error}</div> : null}
        </div>
      </Section>
      <Section title={`2 · Stellar → ${EVM.label}`}>
        <div className="space-y-2 text-sm">
          <label className="text-xs text-muted">Amount ({assetCode})<input className="input mt-1 mono" value={bridge.out.amount} onChange={(e) => bridge.out.setAmount(e.target.value)} /></label>
          <label className="text-xs text-muted">Recipient on {EVM.label}<input className={`input mt-1 mono ${bridge.out.recipient && !isEvmAddress(bridge.out.recipient) ? 'border-danger' : ''}`} value={bridge.out.recipient} onChange={(e) => bridge.out.setRecipient(e.target.value.trim())} placeholder="0x… (your MetaMask)" /></label>
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={!stellar.address || !bridge.out.param || !bridge.hasTrustline || bridge.out.quoteAction.status === 'loading' || !ready} onClick={() => void bridge.out.quoteAction.run()}>{bridge.out.quoteAction.status === 'loading' ? 'quoting…' : 'quote'}</button>
            <button className="btn btn-primary" disabled={!bridge.out.quote || bridge.out.sendAction.status === 'loading' || stellar.wrongNetwork} onClick={() => void bridge.out.sendAction.run()}>{bridge.out.sendAction.status === 'loading' ? 'sign in wallet…' : 'send'}</button>
          </div>
          {bridge.out.quote ? <div className="text-xs text-muted">arrives {formatUnits(bridge.out.quote.received, 7)} · LayerZero fee {formatUnits(bridge.out.quote.fee, 7)} XLM</div> : null}
          {bridge.out.quoteAction.error ? <div className="text-xs text-danger">{bridge.out.quoteAction.error}</div> : null}
          {bridge.out.sendAction.error ? <div className="text-xs text-danger">{bridge.out.sendAction.error}</div> : null}
          {bridge.out.tx ? (
            <div className="space-y-2">
              <div className="text-xs text-muted"><a className="text-accent hover:underline" href={explorers.stellarTx('testnet', bridge.out.tx)} target="_blank" rel="noreferrer">source tx</a> · <Link className="text-accent hover:underline" to={`/tracker?env=testnet&q=${bridge.out.tx}`}>Tracker</Link></div>
              {bridge.out.tracker.messages.map((m) => <Lifecycle key={m.guid} message={m} env="testnet" registry={registry} compact sourceTxHash={bridge.out.tx ?? undefined} />)}
              {bridge.out.tracker.messages.length === 0 ? <Spinner label="waiting for Scan…" /> : null}
            </div>
          ) : null}
        </div>
      </Section>
      <Section title={`3 · ${EVM.label} → Stellar`}>
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ChainBadge chainKey={EVM.chainKey} />
            {evm.address ? <span className="mono">{evm.address.slice(0, 10)}…</span> : <button className="btn" onClick={() => void evm.connect()}>Connect MetaMask</button>}
            {evm.wrongNetwork ? <button className="text-warn hover:underline" onClick={() => void evm.switchToExpected()}>switch to {EVM.label}</button> : null}
            {bridge.evmBalances.data ? <span className="text-muted">balance {formatUnits(bridge.evmBalances.data.mock, 6)} {assetCode}</span> : null}
          </div>
          <label className="text-xs text-muted">Amount ({assetCode}, 6 decimals on EVM)<input className="input mt-1 mono" value={bridge.back.amount} onChange={(e) => bridge.back.setAmount(e.target.value)} /></label>
          <label className="text-xs text-muted">Stellar recipient (G…, with trustline)<input className={`input mt-1 mono ${bridge.back.recipient && !isStellarAccount(bridge.back.recipient) ? 'border-danger' : ''}`} value={bridge.back.recipient} onChange={(e) => bridge.back.setRecipient(e.target.value.trim())} /></label>
          <button className="btn btn-primary" disabled={!evm.walletClient || !ready || bridge.back.sendAction.status === 'loading'} onClick={() => void bridge.back.sendAction.run()}>{bridge.back.sendAction.status === 'loading' ? 'confirm in MetaMask…' : 'quoteSend + send'}</button>
          {bridge.back.sendAction.error ? <div className="text-xs text-danger">{bridge.back.sendAction.error}</div> : null}
          {bridge.back.tx ? (
            <div className="space-y-2">
              <div className="text-xs text-muted"><a className="text-accent hover:underline" href={explorers.evmTx(EVM.explorer, bridge.back.tx)} target="_blank" rel="noreferrer">source tx</a> · <Link className="text-accent hover:underline" to={`/tracker?env=testnet&q=${bridge.back.tx}`}>Tracker</Link></div>
              {bridge.back.tracker.messages.map((m) => <Lifecycle key={m.guid} message={m} env="testnet" registry={registry} compact />)}
              {bridge.back.tracker.messages.length === 0 ? <Spinner label="waiting for Scan…" /> : null}
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
