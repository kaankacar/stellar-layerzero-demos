import { Link } from 'react-router-dom';
import { DEMOS } from '@/routes';
import { ModeBadge } from '@/components/Shell';
import { Callout } from '@/components/ui';
import { RegistryCheck } from '@/components/RegistryCheck';

export function HomePage() {
  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">LayerZero V2 on Stellar, explained with live demos</h1>
          <p className="mt-3 max-w-2xl text-muted">
            Seven small demos that teach how omnichain tokens (OFTs) and messages work on Stellar, using <strong className="text-text">USDT0</strong>, Tether's USDT delivered over LayerZero, as the real-world example. Every page shows what happens on-chain, which contract is called, and the exact code that does it.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/what-is-an-oft" className="btn btn-primary">Start with the explainer</Link>
            <Link to="/inspector" className="btn">Inspect the real USDT0</Link>
            <Link to="/playground" className="btn">Try the testnet playground</Link>
          </div>
        </div>
        <Callout tone="mainnet" title="Two modes, never mixed">
          <p>
            <strong>Mainnet, read-only</strong> pages inspect the real USDT0 and real bridge messages. They never write and never ask you to sign.
          </p>
          <p>
            <strong>Testnet, interactive</strong> pages use a clearly-labelled <strong>mock</strong> asset and your own test OFT through the live testnet endpoint (EID 40600). USDT0 itself does not exist on Stellar testnet.
          </p>
        </Callout>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DEMOS.map((d, i) => (
          <Link key={d.path} to={d.path} className="card group flex flex-col gap-2 p-4 transition hover:border-accent">
            <div className="flex items-center justify-between">
              <span className="text-2xl">{d.emoji}</span>
              <ModeBadge mode={d.mode} compact />
            </div>
            <div className="font-semibold group-hover:text-accent">
              {i + 1}. {d.title}
            </div>
            <p className="text-sm text-muted">{d.blurb}</p>
          </Link>
        ))}
      </section>

      <RegistryCheck />
    </div>
  );
}
