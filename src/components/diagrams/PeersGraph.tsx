import type { PeerRow } from '@/lib/usdt0/facts';

/** Radial connectivity graph: Stellar in the middle, USDT0 networks around it; wired pathways lit, unwired dimmed. */
export function PeersGraph({ peers }: { peers: PeerRow[] }) {
  const nodes = peers.filter((p) => p.eid !== 30600);
  const R = 150;
  const cx = 200;
  const cy = 190;
  return (
    <svg viewBox="0 0 400 380" className="w-full max-w-[520px]" role="img" aria-label="USDT0 pathways wired from Stellar">
      {nodes.map((p, i) => {
        const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + R * Math.cos(a);
        const y = cy + R * Math.sin(a);
        const on = !!p.peer;
        return (
          <g key={p.chainKey}>
            <line x1={cx} y1={cy} x2={x} y2={y} style={{ stroke: on ? 'var(--series-1)' : 'var(--border)', opacity: on ? 0.8 : 0.5 }} strokeWidth={on ? 1.5 : 1} strokeDasharray={on ? undefined : '3 3'} />
            <circle cx={x} cy={y} r={on ? 6 : 4} style={{ fill: on ? 'var(--series-1)' : 'var(--surface-2)', stroke: on ? 'var(--surface)' : 'var(--border)', strokeWidth: 2 }} />
            <text x={x + (Math.cos(a) > 0.2 ? 10 : Math.cos(a) < -0.2 ? -10 : 0)} y={y + (Math.sin(a) > 0.5 ? 14 : Math.sin(a) < -0.5 ? -10 : 4)} textAnchor={Math.cos(a) > 0.2 ? 'start' : Math.cos(a) < -0.2 ? 'end' : 'middle'} className={`text-[10px] ${on ? 'fill-text' : 'fill-muted'}`}>
              {p.name}{p.type === 'OFT_ADAPTER' ? ' (adapter)' : ''}
            </text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={26} className="fill-surface-2 stroke-accent" strokeWidth={2} />
      <text x={cx} y={cy - 2} textAnchor="middle" className="fill-text text-[11px] font-semibold">Stellar</text>
      <text x={cx} y={cy + 11} textAnchor="middle" className="fill-muted text-[9px]">EID 30600</text>
    </svg>
  );
}
