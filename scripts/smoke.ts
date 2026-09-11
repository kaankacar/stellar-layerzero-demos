/**
 * Headless smoke test: boots the Vite dev server, opens every route in system
 * Chrome, waits for network idle, and reports console/page errors plus a few
 * visible-text checks. Screenshots go to docs/screenshots/.
 *
 *   pnpm smoke               # all routes
 *   pnpm smoke /inspector    # one route
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const routes = process.argv.slice(2).filter((a) => a.startsWith('/'));
const ALL = ['/', '/what-is-an-oft', '/inspector', '/tracker', '/quotes', '/playground', '/postcards', '/testcoin', '/dashboard'];
const targets = routes.length ? routes : ALL;
const expectations: Record<string, string[]> = {
  '/': ['LayerZero V2 on Stellar', 'Registry check'],
  '/inspector': ['USDT0 Inspector', 'Holders', 'Required DVNs'],
  '/tracker': ['Bridge Message Tracker'],
  '/quotes': ['Fee & Quote Explorer', 'What arrives', 'native_fee'],
  '/what-is-an-oft': ['What is an OFT?', 'Shared decimals and dust', 'Check your understanding'],
  '/playground': ['Testnet OFT Playground'],
  '/postcards': ['Cross-Chain Postcards'],
  '/testcoin': ['TestCoin', 'LockUnlock', 'Invariant'],
  '/dashboard': ['Omnichain Dashboard'],
};

const server = await createServer({ configFile: resolve(import.meta.dirname, '../vite.config.ts'), server: { port: 5199, strictPort: true }, logLevel: 'silent' });
await server.listen();
const base = 'http://localhost:5199';
mkdirSync(resolve(import.meta.dirname, '../docs/screenshots'), { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--window-size=1400,1000'] });
let failures = 0;
try {
  for (const route of targets) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('pageerror', (e: unknown) => errors.push(`pageerror: ${e instanceof Error ? e.message : String(e)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
    });
    const t0 = Date.now();
    await page.goto(base + route, { waitUntil: 'networkidle0', timeout: 90_000 }).catch((e: Error) => errors.push(`goto: ${e.message}`));
    // give slow RPC-backed sections a moment, then wait for network idle again
    await new Promise((r) => setTimeout(r, 4000));
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 60_000 }).catch(() => undefined);
    // Scroll through the page so scroll-revealed sections animate in before the screenshot.
    await page.evaluate(async () => {
      const step = 600;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 800));
    const text = await page.evaluate(() => document.body.innerText);
    const lower = text.toLowerCase();
    const missing = (expectations[route] ?? []).filter((s) => !lower.includes(s.toLowerCase()));
    const unavailable = (text.match(/live data unavailable/g) ?? []).length;
    const file = `docs/screenshots/${route === '/' ? 'home' : route.slice(1).replace(/[^a-z0-9-]+/gi, '_').slice(0, 60)}.png`;
    await page.screenshot({ path: resolve(import.meta.dirname, '..', file), fullPage: true });
    // RPC failover noise: a public RPC refusing one request is expected and handled by withRpc().
    const noise = errors.filter((e) => /Access to fetch at 'https:\/\/(rpc\.lightsail|soroban-rpc|mainnet\.sorobanrpc|soroban-testnet)|Failed to load resource: net::ERR_FAILED/.test(e));
    const hard = errors.filter((e) => !noise.includes(e));
    const ok = missing.length === 0 && hard.length === 0;
    if (!ok) failures += 1;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${route.padEnd(16)} ${((Date.now() - t0) / 1000).toFixed(1)}s  unavailable=${unavailable}  rpc-noise=${noise.length}  ${file}`);
    for (const m of missing) console.log(`      missing text: ${m}`);
    for (const e of hard.slice(0, 8)) console.log(`      ${e}`);
    if (process.env.SMOKE_DUMP) console.log(text.slice(0, 3000));
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
