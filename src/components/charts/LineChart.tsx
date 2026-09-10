import { useState } from 'react';

export interface LinePoint {
  x: string;
  y: number;
}

/** Single-series line chart to the data-viz spec: 2px line, >=8px end marker with surface ring, hairline grid, hover crosshair, table view. */
export function LineChart({ points, title, format }: { points: LinePoint[]; title: string; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 640;
  const H = 220;
  const pad = { l: 70, r: 20, t: 16, b: 28 };
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = Math.max(1e-9, max - min);
  const lo = min - span * 0.15;
  const hi = max + span * 0.15;
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-text">{title}</span>
        <button className="text-muted hover:text-text" onClick={() => setTable((t) => !t)}>{table ? 'chart view' : 'table view'}</button>
      </div>
      {table ? (
        <table className="w-full text-left text-xs">
          <thead className="text-muted"><tr><th className="py-1">Day</th><th className="py-1 text-right">Value</th></tr></thead>
          <tbody>{points.map((p) => (<tr key={p.x} className="border-t border-border/60"><td className="py-1">{p.x}</td><td className="py-1 text-right tabular-nums">{format(p.y)}</td></tr>))}</tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
              <text x={pad.l - 8} y={y(t) + 3} textAnchor="end" className="fill-muted text-[10px] tabular-nums">{format(t)}</text>
            </g>
          ))}
          <path d={path} fill="none" style={{ stroke: 'var(--series-1)' }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <g key={p.x}>
              <rect x={x(i) - (W - pad.l - pad.r) / points.length / 2} y={pad.t} width={(W - pad.l - pad.r) / points.length} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
              <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[10px]">{p.x.slice(5)}</text>
            </g>
          ))}
          {points.length ? <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!.y)} r={4} style={{ fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }} /> : null}
          {hover !== null && points[hover] ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="stroke-muted" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(points[hover]!.y)} r={5} style={{ fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }} />
              <foreignObject x={Math.min(x(hover) + 8, W - 170)} y={pad.t} width={160} height={44}>
                <div className="inline-block rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-text shadow">{points[hover]!.x}: {format(points[hover]!.y)}</div>
              </foreignObject>
            </g>
          ) : null}
        </svg>
      )}
    </div>
  );
}
