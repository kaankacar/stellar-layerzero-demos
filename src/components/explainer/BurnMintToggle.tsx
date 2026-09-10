import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { USDT0 } from '@/config/usdt0';

type Mode = 'mintburn' | 'lockunlock';

/** Two OFT modes animated side by side: what happens to tokens on each chain during a send. */
export function BurnMintToggle() {
  const [mode, setMode] = useState<Mode>('mintburn');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2600);
    return () => clearInterval(t);
  }, []);
  const phase = tick % 2; // 0: before send, 1: after delivery
  const src = mode === 'mintburn' ? { chain: 'Stellar', before: 100, after: 90, verb: 'burn 10', contract: 'OFT → SAC.burn' } : { chain: 'Ethereum', before: 100, after: 100, verb: 'lock 10 in adapter', contract: 'Adapter.send → transferFrom' };
  const dst = mode === 'mintburn' ? { chain: 'Arbitrum', before: 50, after: 60, verb: 'mint 10' } : { chain: 'Stellar', before: 50, after: 60, verb: 'mint 10 (SAC-manager)' };
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <button className={`rounded-md px-2.5 py-1 ${mode === 'mintburn' ? 'bg-accent-strong text-white' : 'bg-surface-2 text-muted'}`} onClick={() => setMode('mintburn')}>Burn & mint (Stellar leg)</button>
        <button className={`rounded-md px-2.5 py-1 ${mode === 'lockunlock' ? 'bg-accent-strong text-white' : 'bg-surface-2 text-muted'}`} onClick={() => setMode('lockunlock')}>Lock & mint (Ethereum leg)</button>
      </div>
      <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Ledger chain={src.chain} balance={phase ? src.after : src.before} locked={mode === 'lockunlock' && phase ? 10 : 0} note={phase ? src.verb : 'user holds 100'} />
        <div className="relative flex h-16 w-24 items-center justify-center">
          <div className="h-0.5 w-full bg-border" />
          <AnimatePresence>
            <motion.div key={tick} initial={{ left: 0, opacity: 0 }} animate={{ left: ['0%', '80%'], opacity: [0, 1, 1, 0] }} transition={{ duration: 2.2, ease: 'easeInOut' }} className="absolute top-1/2 -translate-y-1/2 rounded-full border border-accent bg-accent/30 px-1.5 text-[10px] text-text">
              10 (msg)
            </motion.div>
          </AnimatePresence>
        </div>
        <Ledger chain={dst.chain} balance={phase ? dst.after : dst.before} locked={0} note={phase ? dst.verb : 'recipient holds 50'} />
      </div>
      <p className="mt-3 text-xs text-muted">
        {mode === 'mintburn'
          ? `USDT0 on Stellar is oft_type = MintBurn: send burns from you via the SAC and the destination mints. Total supply across chains stays constant. Contract: ${USDT0.oft.slice(0, 8)}…`
          : `Ethereum has canonical Tether USDT already, so its leg is an OFT Adapter: send locks USDT in the adapter (${USDT0.ethereum.adapter.slice(0, 8)}…) and the other chain mints; the reverse unlocks. Same supply invariant, different mechanics.`}
      </p>
    </div>
  );
}

function Ledger({ chain, balance, locked, note }: { chain: string; balance: number; locked: number; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3 text-center">
      <div className="text-xs uppercase tracking-wide text-muted">{chain}</div>
      <motion.div key={balance} initial={{ scale: 1.15, color: 'var(--accent)' }} animate={{ scale: 1, color: 'var(--text)' }} className="my-1 text-2xl font-bold tabular-nums">
        {balance}
      </motion.div>
      {locked ? <div className="text-[11px] text-warn">+{locked} locked in adapter</div> : null}
      <div className="text-[11px] text-muted">{note}</div>
    </div>
  );
}
