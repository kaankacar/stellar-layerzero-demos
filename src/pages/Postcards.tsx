import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PageHeader } from '@/components/Shell';
import { AddressChip, Callout, ConsolePanel, DataStatus, Explainer, Section, Spinner, UnderTheHood, useConsole } from '@/components/ui';
import { Lifecycle } from '@/components/Lifecycle';
import { ChainBadge } from '@/components/ChainBadge';
import { PixelStamp } from '@/components/PixelStamp';
import { EVM_TESTNETS, explorers } from '@/config/networks';
import { deploymentReady, TESTNET_DEPLOYMENT } from '@/config/testnet';
import { usePageNetworks, useWallets } from '@/lib/wallets/WalletProvider';
import { useAsyncAction, useLoader, toLoaded } from '@/lib/useLoader';
import { loadRegistry } from '@/lib/layerzero/chains';
import { useMessageTracker } from '@/lib/layerzero/useMessageTracker';
import { submitAndPoll } from '@/lib/stellar/tx';
import { publicClient } from '@/lib/evm/clients';
import { loadEvmPostcards, loadStellarPostcards, MAX_POSTCARD_BYTES, prepareStellarPostcard, quoteEvmPostcard, quoteStellarPostcard, sendEvmPostcard, utf8, type PostcardItem } from '@/lib/postcards/postcards';
import { formatUnits, formatTimestamp, timeAgo, truncate } from '@/lib/format';
import { extractSnippet } from '@/lib/snippets';
import postcardsSrc from '@/lib/postcards/postcards.ts?raw';
import rustSrc from '../../contracts/stellar/postcard-oapp/src/lib.rs?raw';
import solSrc from '../../contracts/evm/src/PostcardOApp.sol?raw';

const D = TESTNET_DEPLOYMENT;
const READY = deploymentReady(D);
const EVM_KEY = D.evm?.chainKey ?? 'sepolia';
const EVM = EVM_TESTNETS[EVM_KEY];

async function loadWall(): Promise<PostcardItem[]> {
  const [stellar, evm] = await Promise.all([
    D.stellar?.postcard ? loadStellarPostcards('testnet', D.stellar.postcard).catch(() => []) : Promise.resolve([]),
    D.evm?.postcard ? loadEvmPostcards(publicClient(EVM_KEY), D.evm.postcard).catch(() => []) : Promise.resolve([]),
  ]);
  return [...stellar, ...evm].sort((a, b) => b.timestamp - a.timestamp);
}

export function PostcardsPage() {
  usePageNetworks({ stellar: 'testnet', evm: EVM_KEY });
  const { stellar, evm } = useWallets();
  const console_ = useConsole();
  const registry = useLoader((f) => loadRegistry(f), []);
  const [tick, setTick] = useState(0);
  const wall = useLoader(() => toLoaded(loadWall()), [tick]);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  const [text, setText] = useState('');
  const bytes = utf8.encode(text).length;
  const [direction, setDirection] = useState<'stellar' | 'evm'>('stellar');
  const [txHash, setTxHash] = useState<string | null>(null);
  const tracker = useMessageTracker('testnet', txHash);
  useEffect(() => {
    if (tracker.messages[0]?.status.name === 'DELIVERED') setTick((n) => n + 1);
  }, [tracker.messages]);

  const send = useAsyncAction(
    useCallback(async () => {
      if (!text.trim() || bytes > MAX_POSTCARD_BYTES) throw new Error('write 1–140 bytes');
      if (direction === 'stellar') {
        if (!stellar.address || !D.stellar?.postcard || !D.evm) throw new Error('connect a Stellar wallet');
        const fee = await quoteStellarPostcard('testnet', D.stellar.postcard, D.evm.eid, text);
        console_.log('info', `quote_postcard(${D.evm.eid}, ${bytes} bytes) → native_fee ${fee} stroops (${formatUnits(fee, 7)} XLM)`);
        const prepared = await prepareStellarPostcard('testnet', D.stellar.postcard, stellar.address, D.evm.eid, text, fee);
        console_.log('info', 'send_postcard: unsigned envelope', undefined, prepared.unsignedXdr);
        const signed = await stellar.signTransaction(prepared.unsignedXdr);
        const res = await submitAndPoll('testnet', signed);
        console_.log('ok', `submitted ${res.hash}`, undefined, res.returnValue);
        setTxHash(res.hash);
        return res.hash;
      }
      if (!evm.walletClient || !D.evm?.postcard) throw new Error('connect MetaMask');
      if (evm.wrongNetwork) throw new Error(`switch MetaMask to ${EVM.label}`);
      const fee = await quoteEvmPostcard(publicClient(EVM_KEY), D.evm.postcard, 40600, text);
      console_.log('info', `quote(40600, "${text}") → nativeFee ${fee} wei`);
      const hash = await sendEvmPostcard(evm.walletClient, D.evm.postcard, 40600, text, fee);
      console_.log('ok', `MetaMask submitted ${hash}`);
      setTxHash(hash);
      return hash;
    }, [text, bytes, direction, stellar, evm, console_]),
  );

  const stellarCount = useMemo(() => wall.data?.filter((p) => p.storedOn === 'stellar').length ?? 0, [wall.data]);

  return (
    <div className="space-y-6">
      <PageHeader title="Cross-Chain Postcards" mode="testnet">
        OFTs are one application of LayerZero messaging. This one is simpler: write up to 140 bytes on Stellar testnet and a contract on {EVM.label} stores it (or the other way round). Same endpoint, same DVN, same lifecycle, no tokens.
      </PageHeader>

      <Explainer id="postcards">
        <p>
          An <strong>OApp</strong> is any contract that implements <code>lz_receive</code> and calls the endpoint's <code>send</code>. The OFT standard adds token semantics on top; a postcard OApp adds none. On Stellar our contract's <code>send_postcard</code> does <code>caller.require_auth()</code>, then <code>__lz_send(dst_eid, bytes, options, fee)</code>; on {EVM.label} <code>sendPostcard</code> calls <code>_lzSend</code>. The payload is the raw UTF-8 text.
        </p>
        <p>
          On arrival the generated <code>lz_receive</code> checks that the sender is the configured peer, clears the payload on the endpoint, and calls our <code>__lz_receive</code>, which pushes a <code>Postcard</code> into a ring buffer of 50 and emits an event. The wall below reads both contracts' buffers; the pixel stamp is derived from the message GUID.
        </p>
        <p>Solana is skipped on purpose: there is no verified Stellar-testnet ↔ Solana pathway to demo, and a Solana OApp is an Anchor program. It is listed as an extension idea in CONTRIBUTING.md.</p>
      </Explainer>

      {!READY.wired ? (
        <Callout tone="warn" title="Postcard contracts not fully deployed">
          <p>{READY.stellar ? `The Stellar PostcardOApp is deployed; the ${EVM.label} side is missing.` : 'Run pnpm deploy:testnet to deploy both PostcardOApps and wire them.'} Sending is disabled until both halves exist.</p>
        </Callout>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Section title="Write a postcard">
          <div className="mb-2 flex gap-1 text-xs">
            <button className={`rounded-md px-2.5 py-1 ${direction === 'stellar' ? 'bg-accent-strong text-white' : 'bg-surface-2 text-muted'}`} onClick={() => setDirection('stellar')}>Stellar → {EVM.label} (Freighter)</button>
            <button className={`rounded-md px-2.5 py-1 ${direction === 'evm' ? 'bg-accent-strong text-white' : 'bg-surface-2 text-muted'}`} onClick={() => setDirection('evm')}>{EVM.label} → Stellar (MetaMask)</button>
          </div>
          <div className="relative rounded-xl border border-border bg-[repeating-linear-gradient(0deg,transparent,transparent_27px,var(--border)_28px)] p-4">
            <textarea className="h-28 w-full resize-none bg-transparent font-mono text-sm outline-none placeholder:text-muted" placeholder="Dear other chain, …" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
            <div className="absolute right-3 top-3">
              <PixelStamp seed={text ? bytesToSeed(text) : '0x00'} size={44} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className={bytes > MAX_POSTCARD_BYTES ? 'text-danger' : 'text-muted'}>{bytes} / {MAX_POSTCARD_BYTES} bytes</span>
            <button className="btn btn-primary" disabled={!READY.wired || !text.trim() || bytes > MAX_POSTCARD_BYTES || send.status === 'loading' || (direction === 'stellar' ? !stellar.address : !evm.walletClient)} onClick={() => void send.run()}>
              {send.status === 'loading' ? 'sign in wallet…' : `Send via LayerZero`}
            </button>
          </div>
          {direction === 'stellar' && !stellar.address ? <div className="mt-1 text-xs text-muted">Connect a Stellar wallet (testnet) to send.</div> : null}
          {direction === 'evm' && !evm.walletClient ? <div className="mt-1 text-xs text-muted">Connect MetaMask ({EVM.label}) to send.</div> : null}
          {send.error ? <div className="mt-1 text-xs text-danger">{send.error}</div> : null}
          {txHash ? (
            <div className="mt-3 space-y-2">
              <div className="text-xs text-muted">
                Source tx <a className="text-accent hover:underline" href={direction === 'stellar' ? explorers.stellarTx('testnet', txHash) : explorers.evmTx(EVM.explorer, txHash)} target="_blank" rel="noreferrer">{truncate(txHash, 12, 8)}</a> · <Link className="text-accent hover:underline" to={`/tracker?env=testnet&q=${txHash}`}>open in Tracker</Link>
              </div>
              {tracker.messages.map((m) => <Lifecycle key={m.guid} message={m} env="testnet" registry={registry.data} compact sourceTxHash={direction === 'stellar' && txHash ? txHash : undefined} />)}
              {tracker.messages.length === 0 ? <Spinner label="waiting for LayerZero Scan to index…" /> : null}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {D.stellar?.postcard ? <AddressChip label="Stellar OApp" address={D.stellar.postcard} href={explorers.stellarContract('testnet', D.stellar.postcard)} /> : null}
            {D.evm?.postcard ? <AddressChip label={`${EVM.label} OApp`} address={D.evm.postcard} href={explorers.evmAddress(EVM.explorer, D.evm.postcard)} /> : null}
          </div>
        </Section>

        <Section title="The wall" subtitle={`Last 50 received on each side · ${wall.data?.length ?? 0} postcards (${stellarCount} stored on Stellar, ${(wall.data?.length ?? 0) - stellarCount} on ${EVM.label})`} right={<DataStatus state={wall} reload={() => setTick((n) => n + 1)} />}>
          {wall.data && wall.data.length === 0 ? <Callout tone="info">No postcards yet. Be the first.</Callout> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {(wall.data ?? []).map((p) => (
                <motion.article key={p.guid} layout initial={{ opacity: 0, y: 12, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} className="relative rounded-lg border border-border bg-surface-2 p-3 shadow-sm">
                  <div className="absolute right-2 top-2"><PixelStamp seed={p.guid} size={40} /></div>
                  <div className="pr-12 text-sm">{p.text}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span>from</span>
                    <ChainBadge eid={p.srcEid} registry={registry.data} />
                    <span>→ stored on</span>
                    <ChainBadge chainKey={p.storedOn === 'stellar' ? 'stellar-testnet' : EVM.chainKey} />
                    <span title={formatTimestamp(p.timestamp)}>{timeAgo(p.timestamp)}</span>
                  </div>
                  <div className="mono mt-1 text-[10px] text-muted">guid {truncate(p.guid, 10, 6)}</div>
                </motion.article>
              ))}
            </AnimatePresence>
          </div>
        </Section>
      </div>

      <Section title="Console"><ConsolePanel entries={console_.entries} onClear={console_.clear} /></Section>

      <UnderTheHood
        items={[
          { title: 'Stellar OApp (Rust): send', code: extractSnippet(rustSrc, 'sendPostcardRust'), lang: 'rust', note: <p>The whole OApp surface (peers, options, <code>lz_receive</code>) is generated by <code>#[oapp]</code>; the contract adds only its own logic.</p> },
          { title: 'Stellar OApp (Rust): receive', code: extractSnippet(rustSrc, 'lzReceiveRust'), lang: 'rust' },
          { title: 'EVM OApp (Solidity)', code: extractSnippet(solSrc, 'sendPostcardSol') + '\n\n' + extractSnippet(solSrc, 'lzReceiveSol'), lang: 'solidity' },
          { title: 'Browser: Stellar calls', code: extractSnippet(postcardsSrc, 'stellarPostcards') },
          { title: 'Browser: EVM calls', code: extractSnippet(postcardsSrc, 'evmPostcards') },
        ]}
      />
    </div>
  );
}

function bytesToSeed(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of utf8.encode(text)) h = ((h ^ ch) * 0x01000193) >>> 0;
  return `0x${h.toString(16).padStart(8, '0').repeat(8)}`;
}
