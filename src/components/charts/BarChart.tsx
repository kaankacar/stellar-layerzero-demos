import { useMemo, useState } from 'react';

export interface BarRow {
  key: string;
  label: string;
  value: number | null;
  /** Shown in the tooltip and table. */
  detail?: string;
  /** Rendered instead of a bar when the value is unavailable. */
  error?: string;
}

/**
 * Horizontal single-series bar chart, hand-rolled to the data-viz spec:
 * one hue (magnitude, not identity), bars <= 24px with a 4px rounded data end,
 * hairline gridlines, direct value labels in text ink, hover tooltip, table view.
 */
export function BarChart({ rows, format, title, unit }: { rows: BarRow[]; format: (v: number) => string; title: string; unit: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const max = useMemo(() => Math.max(1e-9, ...rows.map((r) => r.value ?? 0)), [rows]);
  const ticks = useMemo(() => niceTicks(max, 4), [max]);
  const W = 640;
  const labelW = 150;
  const valueW = 110;
  const plotW = W - labelW - valueW;
  const rowH = 34;
  const H = rows.length * rowH + 24;
  const x = (v: number) => labelW + (v / (ticks[ticks.length - 1] ?? max)) * plotW;

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-text">{title}</span>
        <button className="text-muted hover:text-text" onClick={() => setTable((t) => !t)}>{table ? 'chart view' : 'table view'}</button>
      </div>
      {table ? (
        <table className="w-full text-left text-xs">
          <thead className="text-muted"><tr><th className="py-1">Destination</th><th className="py-1 text-right">{unit}</th><th className="py-1 pl-3">Detail</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border/60">
                <td className="py-1">{r.label}</td>
                <td className="py-1 text-right tabular-nums">{r.value === null ? '—' : format(r.value)}</td>
                <td className="py-1 pl-3 text-muted">{r.error ?? r.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label={title}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={0} y2={H - 20} className="stroke-border" strokeWidth={1} />
                <text x={x(t)} y={H - 6} textAnchor="middle" className="fill-muted text-[10px] tabular-nums">{format(t)}</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const y = i * rowH + 6;
              const barH = 22;
              const on = hover === r.key;
              const w = r.value === null ? 0 : Math.max(2, x(r.value) - labelW);
              return (
                <g key={r.key} onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}>
                  {/* hit target larger than the mark */}
                  <rect x={0} y={y - 4} width={W} height={rowH} fill="transparent" />
                  <text x={labelW - 10} y={y + barH / 2 + 4} textAnchor="end" className="fill-text text-[12px]">{r.label}</text>
                  {r.value === null ? (
                    <text x={labelW + 6} y={y + barH / 2 + 4} className="fill-muted text-[11px]">{r.error ?? 'unavailable'}</text>
                  ) : (
                    <>
                      <path d={roundedRight(labelW, y, w, barH, 4)} style={{ fill: 'var(--series-1)', opacity: hover && !on ? 0.55 : 1 }} />
                      <text x={labelW + w + 8} y={y + barH / 2 + 4} className="fill-text text-[12px] font-semibold tabular-nums">{format(r.value)}</text>
                    </>
                  )}
                  {on && (r.detail || r.error) ? (
                    <foreignObject x={labelW} y={y + barH + 2} width={plotW + valueW} height={40}>
                      <div className="inline-block rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-text shadow">{r.error ?? r.detail}</div>
                    </foreignObject>
                  ) : null}
                </g>
              );
            })}
            <line x1={labelW} x2={labelW} y1={0} y2={H - 20} className="stroke-muted" strokeWidth={1} />
          </svg>
        </div>
      )}
    </div>
  );
}

function roundedRight(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr} h-${w - rr} z`;
}

function niceTicks(max: number, count: number): number[] {
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}
