/** Static overview of the message lifecycle used in explainer panels. */
export function LifecycleDiagram({ dvnCount = 3 }: { dvnCount?: number }) {
  const lanes = Array.from({ length: dvnCount }, (_, i) => i);
  return (
    <svg viewBox="0 0 440 210" className="w-full max-w-[460px]" role="img" aria-label="LayerZero message lifecycle">
      <defs>
        <marker id="arr2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="fill-muted" />
        </marker>
      </defs>
      <rect x={10} y={80} width={90} height={50} rx={10} className="fill-surface-2 stroke-border" />
      <text x={55} y={101} textAnchor="middle" className="fill-text text-[11px] font-semibold">Source chain</text>
      <text x={55} y={116} textAnchor="middle" className="fill-muted text-[9px]">OApp → Endpoint.send</text>
      {lanes.map((i) => {
        const y = 25 + i * 55;
        return (
          <g key={i}>
            <line x1={100} y1={105} x2={170} y2={y + 15} className="stroke-muted" strokeWidth={1} markerEnd="url(#arr2)" />
            <rect x={172} y={y} width={86} height={30} rx={8} className="fill-accent/15 stroke-accent" />
            <text x={215} y={y + 19} textAnchor="middle" className="fill-text text-[10px]">DVN {i + 1} verifies</text>
            <line x1={258} y1={y + 15} x2={318} y2={105} className="stroke-muted" strokeWidth={1} markerEnd="url(#arr2)" />
          </g>
        );
      })}
      <rect x={320} y={60} width={110} height={40} rx={10} className="fill-surface-2 stroke-border" />
      <text x={375} y={77} textAnchor="middle" className="fill-text text-[10px] font-semibold">Commit verification</text>
      <text x={375} y={91} textAnchor="middle" className="fill-muted text-[9px]">all required DVNs agree</text>
      <line x1={375} y1={100} x2={375} y2={118} className="stroke-muted" strokeWidth={1} markerEnd="url(#arr2)" />
      <rect x={320} y={120} width={110} height={40} rx={10} className="fill-ok/15 stroke-ok" />
      <text x={375} y={137} textAnchor="middle" className="fill-text text-[10px] font-semibold">Executor delivers</text>
      <text x={375} y={151} textAnchor="middle" className="fill-muted text-[9px]">lz_receive → mint / store</text>
      <text x={220} y={200} textAnchor="middle" className="fill-muted text-[9px]">INFLIGHT → (CONFIRMING) → DELIVERED · or FAILED / BLOCKED</text>
    </svg>
  );
}
