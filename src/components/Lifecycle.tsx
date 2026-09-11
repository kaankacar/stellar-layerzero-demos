import { motion } from 'framer-motion';
import { useMemo } from 'react';
import type { ScanMessage } from '@/lib/layerzero/scan';
import { isStellarEid, stageTimestamps } from '@/lib/layerzero/scan';
import { statusInfo } from '@/lib/layerzero/status';
import { displayName, findByEid, type RegistrySnapshot } from '@/lib/layerzero/chains';
import { decodePacketHeader } from '@/lib/layerzero/packetHeader';
import { decodeOftMessage } from '@/lib/layerzero/oftPayload';
import { bytes32ToEvmAddress } from '@/lib/hex';
import { bytes32ToStellarCandidates } from '@/lib/stellar/strkey';
import { explorers, SCAN, type ScanEnv } from '@/config/networks';
import { formatDuration, formatTimestamp, formatUnits, timeAgo, truncate } from '@/lib/format';
import { ChainBadge } from '@/components/ChainBadge';
import { AddressChip } from '@/components/ui';

type StageState = 'done' | 'active' | 'pending' | 'failed';

function txLink(eid: number, hash: string | undefined, registry: RegistrySnapshot | null): string | undefined {
  if (!hash) return undefined;
  if (isStellarEid(eid)) return explorers.stellarTx(eid === 30600 ? 'mainnet' : 'testnet', hash);
  const explorer = registry ? findByEid(registry, eid)?.chain.explorer : undefined;
  return explorer ? `${explorer.replace(/\/$/, '')}/tx/${hash}` : undefined;
}

function Stage({ label, state, title, children }: { label: string; state: StageState; title: string; children?: React.ReactNode }) {
  const ring = { done: 'border-ok bg-ok/20 text-ok', active: 'border-accent bg-accent/20 text-accent', pending: 'border-border bg-surface-2 text-muted', failed: 'border-danger bg-danger/20 text-danger' }[state];
  return (
    <div className="relative flex gap-3">
      <div className="flex flex-col items-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-xs font-bold ${ring} ${state === 'active' ? 'pulse-dot' : ''}`}
        >
          {label}
        </motion.div>
        <div className={`mt-1 w-0.5 flex-1 ${state === 'done' ? 'bg-ok/60' : 'bg-border'}`} />
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs text-muted">{children}</div>
      </div>
    </div>
  );
}

/** Animated lifecycle pipeline for one LayerZero message. Reused by the Tracker, Playground, Postcards and Dashboard. */
export function Lifecycle({ message: m, env, registry, compact = false }: { message: ScanMessage; env: ScanEnv; registry: RegistrySnapshot | null; compact?: boolean }) {
  const info = statusInfo(m.status.name);
  const ts = stageTimestamps(m);
  const dvns = Object.entries(m.verification?.dvn?.dvns ?? {});
  const requiredIds = m.config?.inboundConfig?.requiredDVNs ?? dvns.map(([id]) => id);
  const names = m.config?.inboundConfig?.requiredDVNNames ?? [];
  const dvnDone = dvns.length > 0 && requiredIds.every((id) => m.verification?.dvn?.dvns[id]?.status === 'SUCCEEDED');
  const sealerDone = m.verification?.sealer?.status === 'SUCCEEDED';
  const delivered = m.status.name === 'DELIVERED';
  const failed = ['FAILED', 'BLOCKED', 'PAYLOAD_STORED'].includes(m.status.name);
  const dstEidStellar = isStellarEid(m.pathway.dstEid);

  const header = useMemo(() => {
    const ph = dvns[0]?.[1]?.proof?.packetHeader;
    if (!ph) return null;
    try {
      return decodePacketHeader(ph);
    } catch {
      return null;
    }
  }, [dvns]);

  const oft = useMemo(() => {
    const payload = m.source.tx?.payload;
    if (!payload || payload.length < 82) return null;
    try {
      return decodeOftMessage(payload);
    } catch {
      return null;
    }
  }, [m.source.tx?.payload]);

  const recipient = useMemo(() => {
    if (!oft) return null;
    try {
      if (dstEidStellar) {
        const c = bytes32ToStellarCandidates(oft.sendTo);
        return { label: 'Stellar recipient (contract-first resolution)', primary: c.account, secondary: c.contract };
      }
      return { label: 'EVM recipient', primary: bytes32ToEvmAddress(oft.sendTo), secondary: null };
    } catch {
      return { label: 'recipient (raw bytes32)', primary: oft.sendTo, secondary: null };
    }
  }, [oft, dstEidStellar]);

  const stageState = (done: boolean, isActive: boolean): StageState => (done ? 'done' : failed && isActive ? 'failed' : isActive ? 'active' : 'pending');
  const srcDone = m.source.status === 'SUCCEEDED' || !!m.source.tx?.blockTimestamp || !!m.guid;
  const s1 = stageState(srcDone, !srcDone);
  const s2 = stageState(dvnDone, srcDone && !dvnDone);
  const s3 = stageState(sealerDone, dvnDone && !sealerDone);
  const s4: StageState = delivered ? 'done' : failed ? 'failed' : sealerDone ? 'active' : 'pending';
  const total = ts.source && ts.destination ? ts.destination - ts.source : null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ChainBadge eid={m.pathway.srcEid} registry={registry} size="lg" />
          <span className="text-muted">→</span>
          <ChainBadge eid={m.pathway.dstEid} registry={registry} size="lg" />
          {m.pathway.sender.name ? <span className="pill border-border text-muted">{m.pathway.sender.name}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`pill ${info.tone === 'success' ? 'border-ok/50 text-ok' : info.tone === 'danger' ? 'border-danger/50 text-danger' : info.tone === 'warning' ? 'border-warn/50 text-warn' : 'border-accent/50 text-accent'}`}>
            {info.tone === 'progress' ? <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" /> : null}
            {info.label}
          </span>
          <a className="text-xs text-accent hover:underline" href={m.source.tx?.txHash ? `${SCAN[env].site}/tx/${m.source.tx.txHash}` : `${SCAN[env].site}/tx/${m.guid}`} target="_blank" rel="noreferrer">LayerZero Scan ↗</a>
        </div>
      </div>
      {m.status.message ? <div className="mb-3 text-xs text-muted">Scan says: “{m.status.message}”</div> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          <Stage label="1" state={s1} title={`Source transaction on ${displayName(m.pathway.sender.chain)}`}>
            <div className="flex flex-wrap items-center gap-2">
              {m.source.tx?.txHash ? <AddressChip address={m.source.tx.txHash} href={txLink(m.pathway.srcEid, m.source.tx.txHash, registry)} /> : <span className="text-muted">source tx not linked by Scan yet (message found by GUID)</span>}
              {ts.source ? <span>{formatTimestamp(ts.source)} ({timeAgo(ts.source)})</span> : null}
            </div>
            <div className="mt-1">
              The OApp called the endpoint's <code>send</code>: the packet (nonce {header ? header.nonce.toString() : m.pathway.nonce ?? '?'}) was emitted as an event and the LayerZero fee was paid. Nothing has left the chain yet; DVNs are now watching for finality.
            </div>
          </Stage>

          <Stage label="2" state={s2} title={`DVN verification · ${requiredIds.length || dvns.length} required${m.config?.inboundConfig?.confirmations ? ` · ${m.config.inboundConfig.confirmations} source confirmations` : ''}`}>
            <div className="space-y-1">
              {(requiredIds.length ? requiredIds : dvns.map(([id]) => id)).map((id, i) => {
                const att = m.verification?.dvn?.dvns[id];
                const ok = att?.status === 'SUCCEEDED';
                return (
                  <div key={id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1">
                    <span className={`h-2 w-2 rounded-full ${ok ? 'bg-ok' : 'bg-warn pulse-dot'}`} />
                    <span className="font-medium text-text">{names[i] ?? truncate(id, 10, 4)}</span>
                    <span className={ok ? 'text-ok' : 'text-warn'}>{att?.status ?? 'WAITING'}</span>
                    {att?.blockTimestamp ? <span>{formatTimestamp(att.blockTimestamp)}{ts.source ? ` (+${formatDuration(att.blockTimestamp - ts.source)})` : ''}</span> : null}
                    {att?.txHash ? <AddressChip address={att.txHash} href={txLink(m.pathway.dstEid, att.txHash, registry)} /> : null}
                  </div>
                );
              })}
            </div>
            <div className="mt-1">Each DVN independently re-derives the packet from the source chain and signs <em>packet header + payload hash</em> on the destination. All required ones must agree.</div>
          </Stage>

          <Stage label="3" state={s3} title="Commit verification">
            <div className="flex flex-wrap items-center gap-2">
              <span className={sealerDone ? 'text-ok' : 'text-muted'}>{m.verification?.sealer?.status ?? 'WAITING'}</span>
              {m.verification?.sealer?.tx?.txHash ? <AddressChip address={m.verification.sealer.tx.txHash} href={txLink(m.pathway.dstEid, m.verification.sealer.tx.txHash, registry)} /> : null}
              {ts.commit ? <span>{formatTimestamp(ts.commit)}{ts.source ? ` (+${formatDuration(ts.commit - ts.source)})` : ''}</span> : null}
            </div>
            <div className="mt-1">With every attestation in, the receive library marks the payload hash as verified on the endpoint. From here delivery is permissionless.</div>
          </Stage>

          <Stage label="4" state={s4} title={delivered ? `Delivered on ${displayName(m.pathway.receiver.chain)}` : `Execution on ${displayName(m.pathway.receiver.chain)}`}>
            <div className="flex flex-wrap items-center gap-2">
              {m.destination.tx?.txHash ? <AddressChip address={m.destination.tx.txHash} href={txLink(m.pathway.dstEid, m.destination.tx.txHash, registry)} /> : <span>no destination transaction yet</span>}
              {ts.destination ? <span>{formatTimestamp(ts.destination)}{total !== null ? ` · end to end ${formatDuration(total)}` : ''}</span> : null}
            </div>
            <div className="mt-1">
              {dstEidStellar
                ? 'On Stellar the executor authorizes the OApp\'s lz_receive (pull mode): the OApp calls the endpoint\'s clear, then credits the recipient, for an OFT by minting through the SAC-manager.'
                : 'The executor calls the endpoint\'s lzReceive, which invokes the OApp; for an OFT that mints or unlocks the tokens.'}
            </div>
            {!delivered ? <div className={`mt-2 rounded-md border p-2 ${info.tone === 'danger' ? 'border-danger/50 bg-danger/10' : 'border-border bg-surface-2'}`}><strong className="text-text">{info.label}:</strong> {info.summary} {info.remedy ? <span>{info.remedy}</span> : null}</div> : null}
          </Stage>
        </div>

        {!compact ? (
          <aside className="space-y-3 text-xs">
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="mb-1 font-semibold text-text">Message</div>
              <div className="space-y-1">
                <div><span className="text-muted">GUID </span><span className="mono break-all">{m.guid}</span></div>
                <div><span className="text-muted">sender </span><span className="mono break-all">{m.pathway.sender.address}</span></div>
                <div><span className="text-muted">receiver </span><span className="mono break-all">{m.pathway.receiver.address}</span></div>
                {header ? <div><span className="text-muted">packet </span>v{header.version} · nonce {header.nonce.toString()} · {header.srcEid} → {header.dstEid}</div> : null}
              </div>
            </div>
            {oft ? (
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="mb-1 font-semibold text-text">Decoded OFT payload</div>
                <div className="space-y-1">
                  <div><span className="text-muted">amount_sd </span><span className="mono">{oft.amountSd.toString()}</span> = <strong className="text-text">{formatUnits(oft.amountSd, 6)}</strong> (6 shared decimals)</div>
                  {recipient ? (
                    <div>
                      <div className="text-muted">{recipient.label}</div>
                      <div className="mono break-all text-text">{recipient.primary}</div>
                      {recipient.secondary ? <div className="mono break-all text-muted" title="If a contract with this id exists on Stellar, the OFT credits the contract instead of the account.">or contract {truncate(recipient.secondary, 8, 6)}</div> : null}
                    </div>
                  ) : null}
                  {oft.isComposed ? <div className="text-warn">composed message: lzCompose follows delivery</div> : null}
                </div>
              </div>
            ) : null}
            {m.config?.inboundConfig || m.config?.outboundConfig ? (
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="mb-1 font-semibold text-text">Security config in force</div>
                <div>send lib <span className="mono">{truncate(m.config?.sendLibrary ?? '', 8, 4)}</span> · receive lib <span className="mono">{truncate(m.config?.receiveLibrary ?? '', 8, 4)}</span></div>
                <div>inbound: {m.config?.inboundConfig?.requiredDVNCount ?? '?'} required DVNs, {m.config?.inboundConfig?.confirmations ?? '?'} confirmations</div>
                <div>outbound: {m.config?.outboundConfig?.requiredDVNNames?.join(', ') ?? '—'}</div>
                {m.config?.outboundConfig?.executor ? <div>executor <span className="mono">{truncate(m.config.outboundConfig.executor, 8, 4)}</span></div> : null}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
