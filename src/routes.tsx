import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { HomePage } from '@/pages/Home';

// Pages are code-split: each demo loads its own chunk (the Stellar SDK and viem are shared).
const ExplainerPage = lazy(() => import('@/pages/Explainer').then((m) => ({ default: m.ExplainerPage })));
const InspectorPage = lazy(() => import('@/pages/Inspector').then((m) => ({ default: m.InspectorPage })));
const TrackerPage = lazy(() => import('@/pages/Tracker').then((m) => ({ default: m.TrackerPage })));
const QuotesPage = lazy(() => import('@/pages/Quotes').then((m) => ({ default: m.QuotesPage })));
const PlaygroundPage = lazy(() => import('@/pages/Playground').then((m) => ({ default: m.PlaygroundPage })));
const PostcardsPage = lazy(() => import('@/pages/Postcards').then((m) => ({ default: m.PostcardsPage })));
const TestCoinPage = lazy(() => import('@/pages/TestCoin').then((m) => ({ default: m.TestCoinPage })));
const DashboardPage = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.DashboardPage })));

const wrap = (node: ReactNode) => <Suspense fallback={<div className="p-8 text-sm text-muted">Loading demo…</div>}>{node}</Suspense>;

export type PageMode = 'mainnet-readonly' | 'testnet' | 'learn';

export interface DemoRoute {
  path: string;
  title: string;
  short: string;
  mode: PageMode;
  blurb: string;
  element: React.ReactNode;
  emoji: string;
}

export const DEMOS: DemoRoute[] = [
  { path: '/what-is-an-oft', title: 'What is an OFT?', short: 'Explainer', mode: 'learn', emoji: '🧭', blurb: 'An animated walk through the OFT standard, shared decimals, DVNs and the three-contract shape of USDT0 on Stellar.', element: wrap(<ExplainerPage />) },
  { path: '/inspector', title: 'USDT0 Inspector', short: 'Inspector', mode: 'mainnet-readonly', emoji: '🔬', blurb: 'A live fact sheet of the real USDT0: Horizon flags, issuer lock, SAC/OFT config and the DVN trust model, each with the exact call.', element: wrap(<InspectorPage />) },
  { path: '/tracker', title: 'Bridge Message Tracker', short: 'Tracker', mode: 'mainnet-readonly', emoji: '📡', blurb: 'Paste a tx hash, GUID or wallet and watch the LayerZero message lifecycle: source, DVN attestations, commit, delivery.', element: wrap(<TrackerPage />) },
  { path: '/quotes', title: 'Fee & Quote Explorer', short: 'Quotes', mode: 'mainnet-readonly', emoji: '💱', blurb: 'Quote real USDT0 transfers on-chain with quote_oft and quote_send, compare five destinations, and try the Transfer API.', element: wrap(<QuotesPage />) },
  { path: '/playground', title: 'Testnet OFT Playground', short: 'Playground', mode: 'testnet', emoji: '🧪', blurb: 'Mint a mock tUSDT0, inspect the wiring, and send it Stellar ↔ Sepolia with Freighter and MetaMask.', element: wrap(<PlaygroundPage />) },
  { path: '/postcards', title: 'Cross-Chain Postcards', short: 'Postcards', mode: 'testnet', emoji: '💌', blurb: 'Raw LayerZero messaging: write a postcard on Stellar testnet and see it land on Sepolia (and back).', element: wrap(<PostcardsPage />) },
  { path: '/testcoin', title: 'TestCoin: born on Stellar', short: 'TestCoin', mode: 'testnet', emoji: '🪙', blurb: 'Your own omnichain token, issued on Stellar: a LockUnlock OFT whose reserve on Stellar always equals what is minted on Sepolia.', element: wrap(<TestCoinPage />) },
  { path: '/dashboard', title: 'Omnichain Dashboard', short: 'Dashboard', mode: 'mainnet-readonly', emoji: '📊', blurb: 'Recent USDT0 traffic in and out of Stellar, wired peers, supply, and a live ticker of delivered messages.', element: wrap(<DashboardPage />) },
];

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [{ index: true, element: <HomePage /> }, ...DEMOS.map((d) => ({ path: d.path.slice(1), element: d.element }))],
  },
]);
