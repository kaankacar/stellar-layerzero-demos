// Renders docs/field-note/card/card.html to card.png (1600x1000) and card@2x.png (3200x2000).
// Run from the repo root so node resolves puppeteer-core:
//   node docs/field-note/card/render-card.mjs
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = 1600;
const HEIGHT = 1000;
const pageUrl = pathToFileURL(path.join(here, 'card.html')).href;

const outputs = [
  { file: 'card.png', scale: 1 },
  { file: 'card@2x.png', scale: 2 },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', `--window-size=${WIDTH},${HEIGHT}`],
});

try {
  for (const { file, scale } of outputs) {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: scale });
    await page.goto(pageUrl, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => {
      try { await document.fonts.load('24px "Special Elite"'); } catch {}
      await document.fonts.ready;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const out = path.join(here, file);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    const loaded = await page.evaluate(() => document.fonts.check('24px "Special Elite"'));
    console.log(`${file}: ${WIDTH * scale}x${HEIGHT * scale} (Special Elite loaded: ${loaded})`);
    await page.close();
  }
} finally {
  await browser.close();
}
