import { USDT0 } from '@/config/usdt0';
import { truncate } from '@/lib/format';

/**
 * The Stellar twist: USDT0 is a classic asset with a SAC, and the OFT is a
 * separate Soroban contract. Minting flows OFT -> SAC-manager (SAC admin) -> SAC.
 */
export function ThreeContractsDiagram({ highlight }: { highlight?: 'asset' | 'sac' | 'manager' | 'oft' | 'endpoint' }) {
  const box = (key: string, x: number, y: number, w: number, title: string, sub: string, addr?: string) => {
    const on = highlight === key;
    return (
      <g key={key}>
        <rect x={x} y={y} width={w} height={54} rx={10} className={on ? 'fill-accent/20 stroke-accent' : 'fill-surface-2 stroke-border'} strokeWidth={1.5} />
        <text x={x + 12} y={y + 21} className="fill-text text-[12px] font-semibold">{title}</text>
        <text x={x + 12} y={y + 37} className="fill-muted text-[10px]">{sub}</text>
        {addr ? <text x={x + 12} y={y + 49} className="fill-muted font-mono text-[9px]">{truncate(addr, 10, 6)}</text> : null}
      </g>
    );
  };
  return (
    <svg viewBox="0 0 440 300" className="w-full max-w-[460px]" role="img" aria-label="Classic asset, SAC, SAC-manager, OFT and endpoint relationship">
      {box('asset', 20, 20, 190, 'Classic asset USDT0', 'issuer locked (weight 0), revocable + clawback', USDT0.issuer)}
      {box('sac', 20, 110, 190, 'Stellar Asset Contract', 'SEP-41 view: balance / transfer / burn', USDT0.sac)}
      {box('manager', 20, 200, 190, 'SAC-manager (admin)', 'mint under MINTER_ROLE, clawback, freeze', USDT0.sacManager)}
      {box('oft', 240, 110, 180, 'OFT contract (OApp)', 'quote_oft · quote_send · send · lz_receive', USDT0.oft)}
      {box('endpoint', 240, 220, 180, 'LayerZero EndpointV2', 'routes to ULN302 → DVNs + executor', 'CCQLLRE5JBAWYCW3KTWOIWLMFDUOKROQVZNSALQMGOSXNW3ERUOWTZGK')}
      {/* arrows */}
      <defs>
        <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="fill-muted" />
        </marker>
      </defs>
      <line x1={115} y1={74} x2={115} y2={108} className="stroke-muted" strokeWidth={1.5} markerEnd="url(#arr)" />
      <text x={122} y={95} className="fill-muted text-[9px]">wraps the asset</text>
      <line x1={115} y1={164} x2={115} y2={198} className="stroke-muted" strokeWidth={1.5} markerEnd="url(#arr)" />
      <text x={122} y={185} className="fill-muted text-[9px]">admin = manager</text>
      <line x1={240} y1={150} x2={212} y2={230} className="stroke-muted" strokeWidth={1.5} markerEnd="url(#arr)" />
      <text x={222} y={200} className="fill-muted text-[9px]" textAnchor="end">mint(to, amt)</text>
      <line x1={240} y1={128} x2={212} y2={128} className="stroke-muted" strokeWidth={1.5} markerEnd="url(#arr)" />
      <text x={226} y={120} className="fill-muted text-[9px]" textAnchor="middle">burn</text>
      <line x1={330} y1={166} x2={330} y2={218} className="stroke-muted" strokeWidth={1.5} markerEnd="url(#arr)" />
      <text x={337} y={196} className="fill-muted text-[9px]">send / quote</text>
    </svg>
  );
}
