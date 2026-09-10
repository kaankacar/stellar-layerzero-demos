import type { RegistrySnapshot } from '@/lib/layerzero/chains';
import { displayName, findByEid } from '@/lib/layerzero/chains';

const COLORS: Record<string, string> = {
  stellar: '#7aa2ff',
  'stellar-testnet': '#7aa2ff',
  ethereum: '#8c8cff',
  sepolia: '#8c8cff',
  arbitrum: '#28a0f0',
  'arbitrum-sepolia': '#28a0f0',
  polygon: '#8247e5',
  optimism: '#ff0420',
  base: '#0052ff',
  bsc: '#f0b90b',
  plasma: '#00d395',
  solana: '#14f195',
  tron: '#ef0027',
};

/** Compact chain label with a deterministic colour dot (no external logo requests). */
export function ChainBadge({ chainKey, eid, registry, size = 'sm' }: { chainKey?: string; eid?: number; registry?: RegistrySnapshot | null; size?: 'sm' | 'lg' }) {
  const key = chainKey ?? (registry && eid !== undefined ? findByEid(registry, eid)?.chain.chainKey : undefined);
  const name = displayName(key ?? (eid !== undefined ? `EID ${eid}` : undefined));
  const color = COLORS[key ?? ''] ?? `hsl(${hash(key ?? String(eid ?? '')) % 360} 60% 55%)`;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 ${size === 'lg' ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-xs'}`}>
      <span className={`inline-block rounded-full ${size === 'lg' ? 'h-3 w-3' : 'h-2 w-2'}`} style={{ background: color }} />
      <span className="font-medium">{name}</span>
      {eid !== undefined ? <span className="text-muted">{eid}</span> : null}
    </span>
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
