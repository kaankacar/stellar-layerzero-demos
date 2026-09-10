import { useMemo, useState } from 'react';
import { bigintToBytesBE, bytesToHex } from '@/lib/hex';
import { conversionRate, removeDust, toSharedDecimals } from '@/lib/layerzero/oftPayload';
import { formatUnits, parseUnits } from '@/lib/format';

/** Type a 7-decimal Stellar amount and watch it get floored to 6 shared decimals. */
export function DustCalculator() {
  const [input, setInput] = useState('1.2345678');
  const rate = conversionRate(7, 6);
  const r = useMemo(() => {
    try {
      const amountLd = parseUnits(input || '0', 7);
      const { sent, dust } = removeDust(amountLd, rate);
      const amountSd = toSharedDecimals(amountLd, rate);
      return { amountLd, sent, dust, amountSd, wire: bytesToHex(bigintToBytesBE(amountSd, 8)), error: null as string | null };
    } catch (e) {
      return { amountLd: 0n, sent: 0n, dust: 0n, amountSd: 0n, wire: '0x', error: e instanceof Error ? e.message : 'invalid' };
    }
  }, [input, rate]);
  const digits = (input.split('.')[1] ?? '').padEnd(7, '0').slice(0, 7);
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <label className="text-xs text-muted">
        Amount in USDT0 (Stellar has 7 decimals)
        <input className="input mt-1 mono text-lg" value={input} onChange={(e) => setInput(e.target.value.trim())} />
      </label>
      {r.error ? <div className="mt-2 text-xs text-danger">{r.error}</div> : null}
      <div className="mt-3 flex items-end gap-1 font-mono text-2xl">
        <span>{input.split('.')[0] || '0'}.</span>
        {digits.split('').map((d, i) => (
          <span key={i} className={`rounded px-0.5 ${i < 6 ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger line-through'}`} title={i < 6 ? 'kept: fits 6 shared decimals' : 'dust: cannot be represented in the message'}>
            {d}
          </span>
        ))}
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <Row k="amount_ld (7 dec, what you pass)" v={`${r.amountLd.toString()} stroops`} />
        <Row k="decimal_conversion_rate" v={`10^(7−6) = ${rate.toString()}`} />
        <Row k="amount_sd (6 dec, on the wire)" v={`${r.amountSd.toString()} → ${formatUnits(r.amountSd, 6)}`} />
        <Row k="dust removed" v={`${r.dust.toString()} stroops = ${formatUnits(r.dust, 7)} USDT0`} tone={r.dust ? 'warn' : 'ok'} />
        <Row k="amount_sent_ld / amount_received_ld (no-fee route)" v={`${formatUnits(r.sent, 7)}`} />
        <Row k="8-byte amount_sd in the message" v={r.wire} mono />
      </div>
      <p className="mt-3 text-xs text-muted">
        The wire format stores the amount as a u64 in <em>shared</em> decimals so every chain (6-decimal USDT on Ethereum, 7-decimal Stellar, 18-decimal others) agrees on the value. Anything finer than 0.000001 cannot be expressed, so the OFT floors it before sending. On a no-fee route the dust stays in your account; <code>quote_oft</code> reports the exact <code>amount_received_ld</code>.
      </p>
    </div>
  );
}
function Row({ k, v, tone, mono }: { k: string; v: string; tone?: 'ok' | 'warn'; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
      <div className="text-muted">{k}</div>
      <div className={`${mono ? 'mono break-all' : ''} ${tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-text'} font-medium`}>{v}</div>
    </div>
  );
}
