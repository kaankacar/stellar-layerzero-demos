import { useLoader } from '@/lib/useLoader';
import { diffStellarDeployment, loadRegistry, stellarDeployment } from '@/lib/layerzero/chains';
import { BRIEF_STALE_TESTNET, FALLBACK_VERIFIED_AT } from '@/config/layerzero.fallback';
import { DOCS } from '@/config/networks';
import { AddressChip, DataStatus, Section } from '@/components/ui';
import { explorers } from '@/config/networks';

/** The registry-vs-documented-address check, shown on Home and the testnet pages. */
export function RegistryCheck({ stage = 'testnet' as 'mainnet' | 'testnet', compact = false }) {
  const reg = useLoader((force) => loadRegistry(force), []);
  const diffs = reg.data ? diffStellarDeployment(reg.data, stage) : [];
  const changed = diffs.filter((d) => d.changed);
  const live = reg.data ? stellarDeployment(reg.data, stage) : undefined;
  return (
    <Section
      title={`Registry check · Stellar ${stage} (EID ${stage === 'mainnet' ? 30600 : 40600})`}
      subtitle={
        <>
          Addresses come from LayerZero's registry at runtime; the values bundled with this repo were verified on {FALLBACK_VERIFIED_AT}. The registry is the source of truth. <a className="text-accent hover:underline" href={DOCS.metadataApi} target="_blank" rel="noreferrer">metadata/deployments ↗</a>
        </>
      }
      right={<DataStatus state={reg} reload={reg.reload} label="registry" />}
    >
      {changed.length > 0 ? (
        <div className="mb-3 rounded-lg border border-warn/50 bg-warn/10 p-3 text-sm">
          <strong>The registry moved {changed.length} address(es)</strong> since this build. The app is using the live values below; the repo's documented fallbacks need an update.
        </div>
      ) : reg.data ? (
        <div className="mb-3 text-sm text-ok">Live registry matches the documented addresses.</div>
      ) : null}
      {!compact ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {diffs.map((d) => (
            <div key={d.field} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs">
              <span className="text-muted">{d.field}</span>
              <span className="flex items-center gap-1">
                {d.changed ? <span className="pill border-warn/50 text-warn">moved</span> : null}
                <AddressChip address={d.live ?? d.fallback} href={explorers.stellarContract(stage, d.live ?? d.fallback)} />
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {stage === 'testnet' && !compact ? (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer">Why this matters: the testnet was redeployed in August 2026</summary>
          <p className="mt-2">
            Before the redeploy, docs and prompts pointed at endpoint <code>{BRIEF_STALE_TESTNET.endpointV2}</code>; two contracts even claimed EID 40600 at once and only one was in the registry. Today the registry says the endpoint is <code>{live?.endpointV2 ?? '…'}</code>. Trust the registry, not a pasted address.
          </p>
        </details>
      ) : null}
    </Section>
  );
}
