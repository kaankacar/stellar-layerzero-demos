import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const STEPS = [
  { title: 'OApp → Endpoint.send', body: 'The OFT burns your tokens, then asks the Stellar endpoint to send. The endpoint assigns a nonce, builds the packet, charges the XLM fee and emits a PacketSent event. Nothing has left Stellar.' },
  { title: 'DVNs verify', body: 'Each required DVN (for USDT0: LayerZero Labs, Canary and the USDT0 DVN) watches Stellar, waits for the configured confirmations, and signs the packet header + payload hash on the destination chain.' },
  { title: 'Commit', body: 'When every required DVN has attested, the receive library commits the verification on the destination endpoint. The payload hash is now trusted there.' },
  { title: 'Executor delivers', body: 'An executor calls lz_receive with the payload. The destination OFT checks the peer, clears the payload on the endpoint, and mints (or unlocks) to the recipient. Delivered.' },
];

/** Animated hop of one message Stellar → DVNs → destination, with captions. */
export function MessageHop({ dvns = ['LayerZero Labs', 'Canary', 'USDT0'] }: { dvns?: string[] }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2400);
    return () => clearInterval(t);
  }, [playing]);
  const posX = [8, 40, 68, 92][step] ?? 8;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="relative h-44">
        {/* rail */}
        <div className="absolute left-[8%] right-[8%] top-1/2 h-0.5 bg-border" />
        <Node x={8} label="Stellar" sub="Endpoint.send" active={step === 0} />
        <div className="absolute left-[40%] top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex flex-col gap-1">
            {dvns.map((d, i) => (
              <motion.div key={d} animate={{ borderColor: step >= 1 ? 'var(--ok)' : 'var(--border)', background: step >= 1 ? 'color-mix(in oklab, var(--ok) 15%, transparent)' : 'var(--surface-2)' }} transition={{ delay: step === 1 ? i * 0.35 : 0 }} className="rounded-md border px-2 py-0.5 text-[11px] whitespace-nowrap">
                {step >= 1 ? '✓ ' : '○ '}{d}
              </motion.div>
            ))}
          </div>
          <div className="mt-1 text-center text-[10px] text-muted">DVNs</div>
        </div>
        <Node x={68} label="Commit" sub="receive ULN" active={step === 2} />
        <Node x={92} label="Destination" sub="lz_receive" active={step === 3} />
        <motion.div animate={{ left: `${posX}%` }} transition={{ type: 'spring', stiffness: 60, damping: 14 }} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="grid h-7 w-7 place-items-center rounded-full border-2 border-accent bg-bg text-[10px] font-bold text-accent shadow">msg</div>
        </motion.div>
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{step + 1}. {STEPS[step]!.title}</div>
          <p className="mt-1 text-xs text-muted">{STEPS[step]!.body}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button className="btn px-2 py-1 text-xs" onClick={() => setPlaying((p) => !p)}>{playing ? 'pause' : 'play'}</button>
          <button className="btn px-2 py-1 text-xs" onClick={() => { setPlaying(false); setStep((s) => (s + 1) % STEPS.length); }}>next ›</button>
        </div>
      </div>
      <div className="mt-2 flex gap-1">
        {STEPS.map((_, i) => (
          <button key={i} className={`h-1.5 flex-1 rounded-full ${i === step ? 'bg-accent' : 'bg-border'}`} onClick={() => { setPlaying(false); setStep(i); }} aria-label={`step ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}

function Node({ x, label, sub, active }: { x: number; label: string; sub: string; active: boolean }) {
  return (
    <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${x}%` }}>
      <motion.div animate={{ borderColor: active ? 'var(--accent)' : 'var(--border)', scale: active ? 1.05 : 1 }} className="rounded-lg border-2 bg-surface-2 px-2 py-1.5">
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-[10px] text-muted">{sub}</div>
      </motion.div>
    </div>
  );
}
