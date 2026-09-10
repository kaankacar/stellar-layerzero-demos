import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { DEMOS, type PageMode } from '@/routes';
import { WalletProvider } from '@/lib/wallets/WalletProvider';
import { WalletBar } from '@/components/WalletBar';
import { DOCS } from '@/config/networks';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

export function ModeBadge({ mode, compact = false }: { mode: PageMode; compact?: boolean }) {
  if (mode === 'learn') return <span className="pill border-border text-muted">LEARN</span>;
  const testnet = mode === 'testnet';
  return (
    <span
      className={`pill ${testnet ? 'border-testnet/40 bg-testnet/10 text-testnet' : 'border-mainnet/40 bg-mainnet/10 text-mainnet'}`}
      title={testnet ? 'Interactive demo on Stellar testnet + an EVM testnet. Mock assets only.' : 'Reads real mainnet data. Never writes, never asks you to sign.'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${testnet ? 'bg-testnet' : 'bg-mainnet'}`} />
      {testnet ? 'TESTNET' : compact ? 'MAINNET' : 'MAINNET · READ-ONLY'}
    </span>
  );
}

export function Shell() {
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  const current = DEMOS.find((d) => d.path === loc.pathname);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <WalletProvider>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
            <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-strong text-white">Ω</span>
              <span className="hidden sm:inline">LayerZero on Stellar</span>
            </Link>
            <nav className="hidden items-center gap-1 lg:flex">
              {DEMOS.map((d) => (
                <NavLink key={d.path} to={d.path} className={({ isActive }) => `rounded-md px-2.5 py-1.5 text-sm ${isActive ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}>
                  {d.short}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {current ? <ModeBadge mode={current.mode} compact /> : null}
              <button className="btn px-2" onClick={toggle} aria-label="Toggle theme" title="Toggle light/dark">
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              <button className="btn px-2 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
                ☰
              </button>
            </div>
          </div>
          {open ? (
            <nav className="border-t border-border px-4 py-2 lg:hidden">
              {DEMOS.map((d) => (
                <NavLink key={d.path} to={d.path} className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-surface-2">
                  <span>{d.emoji} {d.title}</span>
                  <ModeBadge mode={d.mode} compact />
                </NavLink>
              ))}
            </nav>
          ) : null}
          <div className="border-t border-border">
            <div className="mx-auto max-w-7xl px-4 py-1.5">
              <WalletBar />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          <ErrorBoundary key={loc.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 text-sm text-muted md:grid-cols-3">
            <div>
              <div className="mb-2 font-semibold text-text">Ground truth</div>
              <p>USDT0 exists on Stellar <strong className="text-text">mainnet only</strong>. Anything called “USDT0” on testnet is a mock. The LayerZero endpoint is live on both networks, so the testnet demos use a clearly-labelled mock asset and your own test OFT.</p>
            </div>
            <div>
              <div className="mb-2 font-semibold text-text">Docs</div>
              <ul className="space-y-1">
                <li><a className="hover:text-text" href={DOCS.lzStellarOverview} target="_blank" rel="noreferrer">LayerZero on Stellar</a></li>
                <li><a className="hover:text-text" href={DOCS.lzStellarOft} target="_blank" rel="noreferrer">OFT on Stellar</a></li>
                <li><a className="hover:text-text" href={DOCS.lzDeployedContracts} target="_blank" rel="noreferrer">Deployed contracts (registry)</a></li>
                <li><a className="hover:text-text" href={DOCS.usdt0Deployments} target="_blank" rel="noreferrer">USDT0 deployments</a></li>
                <li><a className="hover:text-text" href={DOCS.stellarUsdt0} target="_blank" rel="noreferrer">Stellar docs: USDT0</a></li>
                <li><a className="hover:text-text" href={DOCS.lzDebugging} target="_blank" rel="noreferrer">Debugging messages</a></li>
              </ul>
            </div>
            <div>
              <div className="mb-2 font-semibold text-text">Source</div>
              <ul className="space-y-1">
                <li><a className="hover:text-text" href="https://github.com/kaankacar/stellar-layerzero-demos" target="_blank" rel="noreferrer">This repo</a> · MIT, fork it for your hackathon</li>
                <li><a className="hover:text-text" href={DOCS.cctpDemo} target="_blank" rel="noreferrer">Inspiration: stellar-cctp-demo</a></li>
                <li><a className="hover:text-text" href={DOCS.dune} target="_blank" rel="noreferrer">Dune: Stellar LayerZero OFT volume</a></li>
                <li><a className="hover:text-text" href={DOCS.monorepo} target="_blank" rel="noreferrer">LayerZero monorepo (contracts)</a></li>
              </ul>
            </div>
          </div>
        </footer>
      </div>
    </WalletProvider>
  );
}

export function PageHeader({ title, mode, children }: { title: string; mode: PageMode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <ModeBadge mode={mode} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {children ? <div className="mt-2 max-w-3xl text-muted">{children}</div> : null}
      </div>
    </div>
  );
}
