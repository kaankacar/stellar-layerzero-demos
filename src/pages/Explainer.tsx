import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/Shell';
import { Callout, Section } from '@/components/ui';
import { ThreeContractsDiagram } from '@/components/diagrams/ThreeContracts';
import { BurnMintToggle } from '@/components/explainer/BurnMintToggle';
import { DustCalculator } from '@/components/explainer/DustCalculator';
import { MessageHop } from '@/components/explainer/MessageHop';
import { Quiz } from '@/components/explainer/Quiz';
import { USDT0 } from '@/config/usdt0';
import { STELLAR_FALLBACK } from '@/config/layerzero.fallback';
import { AddressChip } from '@/components/ui';
import { explorers } from '@/config/networks';

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.5, delay }}>
      {children}
    </motion.div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Reveal>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">Part {n}</div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </Reveal>
  );
}

export function ExplainerPage() {
  const [hl, setHl] = useState<'asset' | 'sac' | 'manager' | 'oft' | 'endpoint' | undefined>(undefined);
  const roles: { key: typeof hl; name: string; text: string }[] = [
    { key: 'asset', name: 'Classic asset', text: 'USDT0 issued by a locked account. Trustlines, auth flags (revocable, clawback), Horizon stats. This is what wallets see.' },
    { key: 'sac', name: 'Stellar Asset Contract', text: 'The SEP-41 contract view of the same asset: balance, transfer, burn. Soroban contracts, including the OFT, use this interface.' },
    { key: 'manager', name: 'SAC-manager', text: 'The SAC\'s admin. Mints only for holders of MINTER_ROLE (the OFT), can clawback/freeze under other roles. Owned by a OneSig multisig.' },
    { key: 'oft', name: 'OFT contract', text: 'The LayerZero OApp: quote_oft, quote_send, send (burns via the SAC), lz_receive (mints via the manager). Holds peers and enforced options.' },
    { key: 'endpoint', name: 'EndpointV2', text: 'LayerZero\'s single entry point on Stellar. Routes to the ULN302 library, which knows the DVN set and executor for each pathway.' },
  ];

  return (
    <div className="space-y-10">
      <PageHeader title="What is an OFT?" mode="learn">
        An Omnichain Fungible Token is one token with one supply, living on many chains at once. This page walks through how that works on Stellar, using the real USDT0 as the example: no wallet needed, just scroll.
      </PageHeader>

      <Reveal>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['One supply, many chains', 'Tokens are debited on the source and credited on the destination by a verified message, never “wrapped” by a third party.'],
            ['Security is configurable', 'Each application picks the verifier set (DVNs) that must attest to its messages. USDT0 requires three.'],
            ['Stellar is different', 'USDT0 here is a classic asset with a SAC; the OFT is a separate contract that mints through an admin contract.'],
          ].map(([t, b], i) => (
            <div key={t} className="card p-4" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="font-semibold">{t}</div>
              <p className="mt-1 text-sm text-muted">{b}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Step n={1} title="Burn-and-mint vs lock-and-mint">
        <p className="text-sm text-muted">
          An OFT keeps the total supply constant by pairing a <strong className="text-text">debit</strong> on the source with a <strong className="text-text">credit</strong> on the destination. Which debit happens depends on the leg. On Stellar, USDT0 is <code>MintBurn</code>: sending burns. On Ethereum, canonical Tether USDT already exists, so the USDT0 contract there is an <code>OFT Adapter</code> that <em>locks</em> USDT instead. The invariant is the same: USDT0 minted elsewhere always equals USDT locked in the adapter.
        </p>
        <BurnMintToggle />
        <Callout tone="info" title="Why MintBurn on Stellar?">
          <p>There is no pre-existing USDT on Stellar to lock, and a classic asset whose admin is a contract can mint and burn natively. Burn-and-mint also means no honeypot of locked tokens sits in a contract on Stellar.</p>
        </Callout>
      </Step>

      <Step n={2} title="Shared decimals and dust">
        <p className="text-sm text-muted">
          Chains disagree on decimals (Stellar 7, Ethereum USDT 6, most EVM tokens 18). OFTs agree on a <strong className="text-text">shared</strong> precision, 6 for USDT0, and put amounts on the wire as a u64 in shared decimals. Converting a 7-decimal amount means dividing by <code>decimal_conversion_rate = 10</code> and flooring. The remainder is <strong className="text-text">dust</strong>, removed before the message is built. Try it:
        </p>
        <DustCalculator />
      </Step>

      <Step n={3} title="Endpoint, ULN, DVNs and the executor">
        <p className="text-sm text-muted">
          A message never “travels”. The source <strong className="text-text">endpoint</strong> emits a packet; the <strong className="text-text">ULN302</strong> library says which <strong className="text-text">DVNs</strong> must verify it and how many confirmations to wait; each DVN independently attests on the destination; the verification is <strong className="text-text">committed</strong>; and an <strong className="text-text">executor</strong> delivers by calling <code>lz_receive</code>. Press play:
        </p>
        <MessageHop />
        <Callout tone="mainnet" title="USDT0's real configuration (read live on the Inspector page)">
          <p>Stellar → Ethereum requires LayerZero Labs, Canary and the USDT0 DVN, with 320 Stellar confirmations. The executor is paid to spend 80,000 gas on Ethereum's <code>lzReceive</code>; the Ethereum adapter budgets 500,000 “gas” for delivery on Stellar. The registry lists five DVN operators on Stellar; USDT0 chose three.</p>
        </Callout>
      </Step>

      <Step n={4} title="The Stellar twist: three contracts, one token">
        <p className="text-sm text-muted">
          On EVM chains an OFT is usually one contract that is both the token and the OApp. On Stellar the token is a <strong className="text-text">classic asset</strong>, its contract face is the <strong className="text-text">SAC</strong>, and the LayerZero logic lives in a separate <strong className="text-text">OFT contract</strong>. Because only the SAC admin can mint, a fourth piece, the <strong className="text-text">SAC-manager</strong>, holds the admin role and lets the OFT mint under <code>MINTER_ROLE</code>. Hover the roles:
        </p>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ThreeContractsDiagram highlight={hl} />
          <div className="space-y-2">
            {roles.map((r) => (
              <div key={r.name} className={`rounded-lg border p-2 text-sm transition ${hl === r.key ? 'border-accent bg-accent/10' : 'border-border bg-surface-2'}`} onMouseEnter={() => setHl(r.key)} onMouseLeave={() => setHl(undefined)}>
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-muted">{r.text}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <AddressChip label="asset issuer" address={USDT0.issuer} href={explorers.stellarAccount('mainnet', USDT0.issuer)} />
          <AddressChip label="SAC" address={USDT0.sac} href={explorers.stellarContract('mainnet', USDT0.sac)} />
          <AddressChip label="SAC-manager" address={USDT0.sacManager} href={explorers.stellarContract('mainnet', USDT0.sacManager)} />
          <AddressChip label="OFT" address={USDT0.oft} href={explorers.stellarContract('mainnet', USDT0.oft)} />
          <AddressChip label="endpoint" address={STELLAR_FALLBACK.mainnet.endpointV2} href={explorers.stellarContract('mainnet', STELLAR_FALLBACK.mainnet.endpointV2)} />
        </div>
        <Callout tone="warn" title="The fund-critical detail">
          <p>Recipients are 32 raw bytes. For Stellar that is the strkey <em>payload</em>: the Ed25519 key of a G address or the contract id of a C address, never the strkey string. On delivery the OFT checks whether a contract with that id exists and otherwise credits the account, so a G recipient needs a USDT0 trustline before the message lands.</p>
        </Callout>
      </Step>

      <Step n={5} title="Check your understanding">
        <Quiz />
        <Section title="Where next?">
          <div className="flex flex-wrap gap-2 text-sm">
            <Link className="btn" to="/inspector">Read the real config on the Inspector</Link>
            <Link className="btn" to="/tracker">Watch a real message on the Tracker</Link>
            <Link className="btn" to="/playground">Send a mock OFT on testnet</Link>
          </div>
        </Section>
      </Step>
    </div>
  );
}
