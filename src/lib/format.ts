export function truncate(addr: string, head = 6, tail = 4): string {
  if (!addr) return '';
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Format a bigint amount with fixed decimals, trimming trailing zeros. */
export function formatUnits(amount: bigint, decimals: number, maxFraction = decimals): string {
  const neg = amount < 0n;
  const a = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = (a % base).toString().padStart(decimals, '0').slice(0, maxFraction);
  frac = frac.replace(/0+$/, '');
  const wholeStr = whole.toLocaleString('en-US');
  return `${neg ? '-' : ''}${wholeStr}${frac ? `.${frac}` : ''}`;
}

/** Parse a decimal string into a bigint with the given decimals (floors extra digits). */
export function parseUnits(input: string, decimals: number): bigint {
  const s = input.trim().replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') throw new Error('invalid amount');
  const [w = '0', f = ''] = s.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

export const formatXlm = (stroops: bigint | number | string) => `${formatUnits(BigInt(stroops), 7, 7)} XLM`;

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 });
}

export function timeAgo(ts: number | string | Date | null | undefined): string {
  if (ts === null || ts === undefined) return '';
  const ms = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : new Date(ts).getTime();
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatTimestamp(ts: number | string | undefined): string {
  if (ts === undefined) return '—';
  const ms = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : new Date(ts).getTime();
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** JSON.stringify that survives bigints and Buffers (for "verify it yourself" panels). */
export function safeJson(v: unknown, space = 2): string {
  return JSON.stringify(
    v,
    (_k, val: unknown) => {
      if (typeof val === 'bigint') return val.toString();
      if (val instanceof Uint8Array) return `0x${Array.from(val, (b) => b.toString(16).padStart(2, '0')).join('')}`;
      return val;
    },
    space,
  );
}
