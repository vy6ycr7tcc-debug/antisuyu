// Parameterized single-shot runner for Phase 7 (character materials).
// Usage: node scripts/p7_shot_one.cjs <shotId> <tod> <outname> [extra query params] [width height]
// Captures at 1280x800 WebGL2 into shots/<outname>.png
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const shot = process.argv[2] || 'character_closeup';
const tod = process.argv[3] || 'day';
const out = process.argv[4] || `p7_iter_${shot}_${tod}`;
const extra = process.argv[5] || '';
const W = parseInt(process.argv[6] || '1280', 10);
const H = parseInt(process.argv[7] || '800', 10);
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

  const url = `http://localhost:5173/juzu/?shot=${shot}&tod=${tod}&t=2&readback=1${extra ? '&' + extra : ''}`;
  await page.goto(url, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
  await page.waitForTimeout(700);

  const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
  const ktx2 = await page.evaluate(() => window.__ktx2Supported);
  const tier = await page.evaluate(() => window.__currentQualityTier || 'unknown');
  await page.locator('canvas').screenshot({ path: path.join(OUT, `${out}.png`) });

  const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('sw.js'));
  console.log(`${out}: renderer=${rendererType} ktx2=${ktx2} tier=${tier} errs=${errs.length}`);
  errs.slice(0, 3).forEach(e => console.log('   ' + e.slice(0, 160)));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
