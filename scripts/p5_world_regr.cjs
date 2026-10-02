// P-MOBILE world regression capture: foliage_check cf_floor day at the
// mobile viewport (390×844 @ dpr 3, touch). Controls work must not touch
// world rendering — this must match Phase 4's cf_floor day PASS row.
// Usage: node scripts/p5_world_regr.cjs [BASE]  (default vite dev 5173)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:5173/juzu/';

const OUT = path.join(__dirname, '..', 'docs', 'verification', 'phase-5');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

  const url = `${BASE}?shot=foliage_check&v=cf_floor&tod=day&t=2&readback=1`;
  await page.goto(url, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
  await page.waitForTimeout(700);

  const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
  const ktx2 = await page.evaluate(() => window.__ktx2Supported);
  const tier = await page.evaluate(() => window.__currentQualityTier || 'unknown');
  await page.locator('canvas').screenshot({ path: path.join(OUT, 'p5_world_regr_cf_day_390.png') });

  const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('sw.js'));
  console.log(`p5_world_regr_cf_day_390: renderer=${rendererType} ktx2=${ktx2} tier=${tier} errs=${errs.length}`);
  errs.slice(0, 3).forEach(e => console.log('   ' + e.slice(0, 160)));

  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
