#!/usr/bin/env node
/**
 * Demo footage for the DR-3 USDT0 field note: named stills (PNG) and short
 * clips (WebM), recorded headless from the live site and the run logs with
 * puppeteer-core and the system Chrome.
 *
 *   node docs/field-note/shots.mjs              # stills and clips
 *   node docs/field-note/shots.mjs --stills     # PNGs only  -> docs/field-note/shots/
 *   node docs/field-note/shots.mjs --clips      # WebMs only -> docs/field-note/clips/
 *   node docs/field-note/shots.mjs --only=tracker   # shots whose name contains "tracker"
 *
 * Run it from the repo root so `puppeteer-core` resolves from node_modules.
 * CHROME_PATH overrides the Chrome binary, SHOTS_BASE_URL the site,
 * FRESH_CLONE_LOG the run2 log. Clips shell out to ffmpeg (must be on PATH).
 *
 * Not produced here: the mainnet transfer stills 02 to 08 and the wallet
 * stills 11-compose-deposit and 12-compose-withdraw (they need a human and a
 * wallet extension; see video-shotlist.md).
 */
import puppeteer from 'puppeteer-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = (process.env.SHOTS_BASE_URL ?? 'https://kaankacar.github.io/stellar-layerzero-demos').replace(/\/$/, '');
const SHOTS_DIR = resolve(HERE, 'shots');
const CLIPS_DIR = resolve(HERE, 'clips');
const STILL_PREFIX = 'DR-3_usdt0-field-note_';
const W = 1920;
const H = 1080;
const NAV_TIMEOUT = 60_000;
const TEXT_TIMEOUT = 60_000;
const HEADER_OFFSET = 80; // the site header is sticky; keep scrolled targets below it

const RUN1_LOG = resolve(HERE, 'runs/run1-mainnet.log');
const MAINNET_INBOUND_GUID = '0x289e896e97dff3091364e3c4030a8a3e28c038c38a71233440df98260654bfac';
const MAINNET_OUTBOUND_TX = '6bc5348acd5dfa908c8d8ff8401d5cce5e659566b0f6707a84950b16ca7410e8';
const FIELDNOTE_ACCOUNT = 'GB54KUSW2OO5IY3LXJGIR54Q4ZIGQMQ6FIE7QZENCFCL3E5GYXAKQY7L';
const RECON_LOG = resolve(HERE, 'runs/run0-recon.log');
const FRESH_CLONE_LOG =
  process.env.FRESH_CLONE_LOG ?? '/private/tmp/claude-501/-Users-kaankacar-usdt0test/7628fd76-75f7-4a0f-80f8-ad638349e45e/scratchpad/run2/run2-fresh-clone.log';
const TRACKER_GUID = '0x2a4ca88f8fdc264ac1c1b382acc4fb7e10077b186e7465e37e28dbf57dd3d234';
// Tracker.tsx reads `env` and `q` from useSearchParams and tracks `q` on load.
const TRACKER_URL = `${BASE}/tracker?env=testnet&q=${TRACKER_GUID}`;
const README_URL = 'https://github.com/kaankacar/stellar-layerzero-demos';

// The Tracker's explainer and status glossary both contain the bare word
// DELIVERED as static text. The live result shows the pill "Delivered" and the
// stage-4 title "Delivered on <chain>", so wait for that inside the results.
const DELIVERED = /Results for[\s\S]*Delivered on /;
// Home.tsx says "USDT0 itself does not exist on Stellar testnet."
const HOME_TEXT = /USDT0 (itself )?does not exist/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
const readLines = (file) => readFileSync(file, 'utf8').replace(/\n$/, '').split('\n');
const stillPath = (step) => resolve(SHOTS_DIR, `${STILL_PREFIX}${step}.png`);
const clipPath = (name) => resolve(CLIPS_DIR, `${name}.webm`);
const rel = (p) => relative(process.cwd(), p);

/** Lines from the one containing "## 6." up to (not including) "## 9.", trailing blanks trimmed. */
function reconSection(lines) {
  const start = lines.findIndex((l) => l.includes('## 6.'));
  if (start < 0) throw new Error(`"## 6." not found in ${rel(RECON_LOG)}`);
  const end = lines.findIndex((l, i) => i > start && l.includes('## 9.'));
  const out = lines.slice(start, end < 0 ? lines.length : end);
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/** A fake terminal: dark page, light monospace text, one div per line. */
function terminalHtml(lines, { title = '', highlight = null } = {}) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = lines.map((l) => `<div class="l${highlight && highlight.test(l) ? ' hi' : ''}">${esc(l) || ' '}</div>`).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #111; }
  body { box-sizing: border-box; min-height: ${H}px; padding: 24px 56px; color: #e2e2e2;
         font: 20px/1.2 ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace; tab-size: 8; }
  .t { color: #6f6f6f; margin-bottom: 12px; }
  .l { white-space: pre-wrap; word-break: break-all; }
  .hi { color: #fff; background: #2a2a18; }
</style></head>
<body>${title ? `<div class="t">${esc(title)}</div>` : ''}
${rows}
</body></html>`;
}

/** Shrink the terminal font (from 20px, never below 14px) until the text fits in one 1080px frame. */
async function fitTerminal(page) {
  return page.evaluate((h) => {
    let px = 20;
    while (document.documentElement.scrollHeight > h && px > 14) {
      px -= 0.5;
      document.body.style.fontSize = `${px}px`;
    }
    return px;
  }, H);
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const ua = await browser.userAgent();
  await page.setUserAgent(ua.replace('HeadlessChrome', 'Chrome'));
  page.setDefaultTimeout(NAV_TIMEOUT);
  return page;
}

/** Navigate, wait for network idle, give slow RPC-backed sections a moment, wait for idle again. Never throws. */
async function open(page, url, waitUntil = 'networkidle0') {
  const notes = [];
  await page.goto(url, { waitUntil, timeout: NAV_TIMEOUT }).catch((e) => notes.push(`goto: ${e.message.split('\n')[0]}`));
  await sleep(2000);
  await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30_000 }).catch(() => notes.push('network never idle'));
  return notes.join('; ');
}

/** Poll document.body.innerText until it matches `re`. Returns false on timeout instead of throwing. */
async function waitForText(page, re, timeout = TEXT_TIMEOUT) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (re.test(text)) return true;
    await sleep(1000);
  }
  return false;
}

/** Document y of the nearest <section> (or element) whose text contains `needle`, or null. */
async function textTop(page, needle) {
  return page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue || !n.nodeValue.includes(needle)) continue;
      const el = n.parentElement.closest('section') ?? n.parentElement;
      return el.getBoundingClientRect().top + window.scrollY;
    }
    return null;
  }, needle);
}

async function scrollToText(page, needle) {
  const top = await textTop(page, needle);
  if (top === null) return false;
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, y)), top - HEADER_OFFSET);
  await sleep(600);
  return true;
}

/** Linear scroll by `px` over `ms`, stepped at ~30 fps from inside the page. */
async function slowScroll(page, px, ms) {
  await page.evaluate(
    async (px, ms) => {
      const start = window.scrollY;
      const t0 = performance.now();
      for (;;) {
        const t = Math.min(1, (performance.now() - t0) / ms);
        window.scrollTo(0, start + px * t);
        if (t >= 1) return;
        await new Promise((r) => setTimeout(r, 33));
      }
    },
    px,
    ms,
  );
}

/** Max distance the page can still scroll down from its current position. */
const scrollRoom = (page) => page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight - window.scrollY));

/**
 * Chrome only emits a screencast frame when something repaints, and puppeteer's
 * recorder needs at least two frames before it writes anything, so a static
 * hold would record nothing (a 0-byte file). A 1px dot at 2% opacity that
 * flips colour every 100 ms keeps the frames coming without being visible.
 */
async function startHeartbeat(page) {
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = '__shots_heartbeat';
    d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:.02;background:#000;pointer-events:none;z-index:2147483647';
    document.body.appendChild(d);
    let on = false;
    window.__shotsHeartbeat = setInterval(() => {
      on = !on;
      d.style.background = on ? '#fff' : '#000';
    }, 100);
  });
}

async function stopHeartbeat(page) {
  await page
    .evaluate(() => {
      clearInterval(window.__shotsHeartbeat);
      document.getElementById('__shots_heartbeat')?.remove();
    })
    .catch(() => undefined);
}

/**
 * Record `fn` to `file`. puppeteer streams ffmpeg's output through a pipe, so
 * the raw WebM has no duration or cues; a stream-copy remux adds them so
 * editors and the ffmpeg concat step see a proper length.
 */
async function record(page, file, fn) {
  const raw = file.replace(/\.webm$/, '.raw.webm');
  await startHeartbeat(page);
  const recorder = await page.screencast({ path: raw, fps: 30, overwrite: true });
  try {
    await fn();
  } finally {
    await recorder.stop();
    await stopHeartbeat(page);
  }
  const mux = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-c', 'copy', file], { encoding: 'utf8' });
  if (mux.status === 0) unlinkSync(raw);
  else renameSync(raw, file); // keep the raw recording rather than lose the clip
  return mux.status === 0 ? '' : `remux failed: ${(mux.stderr || mux.error?.message || '').trim().split('\n')[0]}`;
}

// ---------------------------------------------------------------------------
// Shots. Each `run(page)` returns a note; a note starting with "WARN" marks a
// partial render (the file is still written).

/** A still made from the mainnet run log: the lines matching `filter`, rendered as a terminal. */
function logStill(name, title, filter, highlight) {
  return {
    name,
    file: stillPath(name),
    async run(page) {
      const lines = readLines(RUN1_LOG).filter((l) => filter.test(l)).map((l) => l.replace(/^\[(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.\d+Z\]/, '[$1Z]'));
      const html = terminalHtml(lines, { title, highlight });
      await page.setContent(html, { waitUntil: 'load' });
      const px = await fitTerminal(page);
      await page.screenshot({ path: this.file });
      return `${lines.length} lines at ${px}px`;
    },
  };
}
/** A still of a live page: open, wait for `text`, screenshot. */
function pageStill(name, url, text, scrollTo) {
  return {
    name,
    file: stillPath(name),
    async run(page) {
      const nav = await open(page, url);
      const ok = await waitForText(page, text);
      if (scrollTo) await scrollToText(page, scrollTo);
      await page.screenshot({ path: this.file });
      return ok ? nav : `WARN: ${text} not shown within ${TEXT_TIMEOUT / 1000} s ${nav}`;
    },
  };
}

const stills = [
  {
    name: '01-recon',
    file: stillPath('01-recon'),
    async run(page) {
      const lines = reconSection(readLines(RECON_LOG));
      const html = terminalHtml(lines, { title: `$ cat ${rel(RECON_LOG)}   # sections 6 to 8`, highlight: /amount_received_ld/ });
      await page.setContent(html, { waitUntil: 'load' });
      const px = await fitTerminal(page);
      await page.screenshot({ path: this.file });
      return `${lines.length} lines at ${px}px`;
    },
  },
  logStill('02-trustline', '$ run1-mainnet.ts xlm; run1-mainnet.ts trustline   # fund a fresh mainnet account from ETH, add the USDT0 trustline', /step xlm|xlm:|step trustline|trustline:/, /exists=true|SUCCESS/),
  logStill('03-eth-send', '$ run1-mainnet.ts swap; run1-mainnet.ts send   # ETH -> USDT on Uniswap, approve, quoteOFT, quoteSend, adapter.send to Stellar', /step swap|swap: (QuoterV2|SwapRouter02|success)|step send|send:/, /adapter\.send|quoteSend/),
  pageStill('04-scan-inbound', `${BASE}/tracker?env=mainnet&q=${MAINNET_INBOUND_GUID}`, DELIVERED, 'Results for'),
  pageStill('05-stellar-balance', `https://stellar.expert/explorer/public/account/${FIELDNOTE_ACCOUNT}`, /USDT0/),
  logStill('06-quote-dust', '$ run1-mainnet.ts return   # quote_oft shows the dust, quote_send prices the message in XLM', /step return|return:/, /amount_sent_ld|native_fee/),
  pageStill('07-stellar-send', `https://stellar.expert/explorer/public/tx/${MAINNET_OUTBOUND_TX}`, /send/i),
  pageStill('08-scan-outbound', `${BASE}/tracker?env=mainnet&q=${MAINNET_OUTBOUND_TX}`, DELIVERED, 'Results for'),
  {
    name: '09-fresh-clone-build',
    file: stillPath('09-fresh-clone-build'),
    async run(page) {
      const all = readLines(FRESH_CLONE_LOG).map(stripAnsi);
      const head = all.slice(0, 30);
      const tail = all.slice(-15);
      const nonBlank = (l) => l.trim() !== '';
      // Blank lines (from `time`) are dropped so 45 lines fit one frame at 20px.
      const lines = [...head.filter(nonBlank), `… ${all.length - head.length - tail.length} lines omitted …`, ...tail.filter(nonBlank)];
      const html = terminalHtml(lines, { title: '$ cat run2-fresh-clone.log   # fresh clone: install, build the wasm, verify the manifest' });
      await page.setContent(html, { waitUntil: 'load' });
      const px = await fitTerminal(page);
      await page.screenshot({ path: this.file });
      return `${lines.length} lines at ${px}px`;
    },
  },
  {
    name: '10-reverse-delivered',
    file: stillPath('10-reverse-delivered'),
    async run(page) {
      const nav = await open(page, TRACKER_URL);
      const delivered = await waitForText(page, DELIVERED);
      const found = await scrollToText(page, 'Results for');
      await page.screenshot({ path: this.file });
      if (!delivered) return `WARN: "Delivered on" not shown within ${TEXT_TIMEOUT / 1000} s ${nav}`;
      return `Delivered${found ? ', results scrolled into view' : ''} ${nav}`.trim();
    },
  },
  {
    name: '11-compose-page',
    file: stillPath('11-compose-page'),
    async run(page) {
      const nav = await open(page, `${BASE}/compose`);
      const ok = await waitForText(page, /MetaMask drives a Soroban vault/, 30_000);
      await page.screenshot({ path: this.file });
      return ok ? nav : `WARN: page title text not shown ${nav}`;
    },
  },
  {
    name: '13-inspector',
    file: stillPath('13-inspector'),
    async run(page) {
      const nav = await open(page, `${BASE}/inspector`);
      const ok = await waitForText(page, /MintBurn/);
      await page.screenshot({ path: this.file });
      return ok ? `MintBurn shown ${nav}`.trim() : `WARN: MintBurn not shown within ${TEXT_TIMEOUT / 1000} s ${nav}`;
    },
  },
  {
    name: '14-home',
    file: stillPath('14-home'),
    async run(page) {
      const nav = await open(page, `${BASE}/`);
      const ok = await waitForText(page, HOME_TEXT, 30_000);
      await page.screenshot({ path: this.file });
      return ok ? nav : `WARN: "does not exist" line not shown ${nav}`;
    },
  },
];

const clips = [
  {
    name: 'clip-02-ground-truth',
    file: clipPath('clip-02-ground-truth'),
    async run(page) {
      const nav = await open(page, `${BASE}/`);
      const ok = await waitForText(page, HOME_TEXT, 30_000);
      await record(page, this.file, async () => {
        await sleep(1000);
        await slowScroll(page, 600, 8000);
        await sleep(1000);
      });
      return ok ? `10 s ${nav}`.trim() : `WARN: "does not exist" line not shown ${nav}`;
    },
  },
  {
    name: 'clip-03-inspector',
    file: clipPath('clip-03-inspector'),
    async run(page) {
      const nav = await open(page, `${BASE}/inspector`);
      const ok = await waitForText(page, /MintBurn/);
      // Scroll from the top down to the DVN section (falls back to 1800px, capped by the page height).
      const dvnTop = await textTop(page, 'Required DVNs');
      const room = await scrollRoom(page);
      const distance = Math.min(room, dvnTop !== null ? Math.max(400, dvnTop - HEADER_OFFSET) : 1800);
      await record(page, this.file, async () => {
        await sleep(1000);
        await slowScroll(page, distance, 15000);
        await sleep(1500);
      });
      return `${ok ? '' : 'WARN: MintBurn not shown; '}17.5 s, scrolled ${Math.round(distance)}px ${nav}`.trim();
    },
  },
  {
    name: 'clip-09-tracker',
    file: clipPath('clip-09-tracker'),
    async run(page) {
      const nav = await open(page, TRACKER_URL);
      const delivered = await waitForText(page, DELIVERED);
      await scrollToText(page, 'Results for');
      await record(page, this.file, async () => {
        await sleep(5000);
        await slowScroll(page, 400, 2000);
        await sleep(5000);
      });
      return delivered ? `12 s ${nav}`.trim() : `WARN: "Delivered on" not shown within ${TEXT_TIMEOUT / 1000} s ${nav}`;
    },
  },
  {
    name: 'clip-12-readme',
    file: clipPath('clip-12-readme'),
    async run(page) {
      const nav = await open(page, README_URL, 'load');
      const ok = await waitForText(page, /stellar-layerzero-demos/, 20_000);
      if (!ok) throw new Error(`GitHub did not render the README (headless blocked?) ${nav}`.trim());
      const walled = await page.evaluate(() => /Sign in to GitHub|Verify you are human|rate limit/i.test(document.body.innerText));
      if (walled) throw new Error('GitHub showed a sign-in or verification wall instead of the README');
      await record(page, this.file, async () => {
        await sleep(8000);
      });
      return `8 s ${nav}`.trim();
    },
  },
];

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const wantStills = argv.includes('--stills') || !argv.includes('--clips');
const wantClips = argv.includes('--clips') || !argv.includes('--stills');
const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const selected = [...(wantStills ? stills : []), ...(wantClips ? clips : [])].filter((s) => !only || s.name.includes(only));
if (!selected.length) {
  console.error('nothing selected; use --stills, --clips and/or --only=<name part>');
  process.exit(2);
}

mkdirSync(SHOTS_DIR, { recursive: true });
mkdirSync(CLIPS_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  args: ['--no-sandbox', `--window-size=${W},${H}`, '--hide-scrollbars', '--force-color-profile=srgb'],
});

const tally = { ok: 0, warn: 0, fail: 0 };
try {
  for (const shot of selected) {
    const t0 = Date.now();
    let page = null;
    try {
      page = await newPage(browser);
      const note = (await shot.run(page)) ?? '';
      const size = `${(statSync(shot.file).size / 1024).toFixed(0)} KB`;
      const secs = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
      const status = note.startsWith('WARN') ? 'WARN' : 'OK  ';
      tally[status.trim().toLowerCase()] += 1;
      console.log(`${status}  ${shot.name.padEnd(24)} ${rel(shot.file).padEnd(62)} ${size.padStart(8)} ${secs.padStart(7)}  ${note}`);
    } catch (e) {
      tally.fail += 1;
      const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0];
      console.log(`FAIL  ${shot.name.padEnd(24)} ${msg}`);
    } finally {
      if (page) await page.close().catch(() => undefined);
    }
  }
} finally {
  await browser.close();
}
console.log(`${tally.ok} ok, ${tally.warn} partial, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);
