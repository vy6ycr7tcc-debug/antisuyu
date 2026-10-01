// Parameterized single-shot runner for Phase 3 terrain verification.
// Usage: node scripts/p3_shot_one.cjs <shot> <outname> [query="k=v&k=v"] [w] [h] [quality]
// Example: node scripts/p3_shot_one.cjs terrain_check p3_sierra_day "v=sierra" 1280 800 low
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const shot = process.argv[2] || 'terrain_check';
const out = process.argv[3] || `p3_${shot}`;
const query = process.argv[4] || '';
const W = parseInt(process.argv[5] || '1280', 10);
const H = parseInt(process.argv[6] || '800', 10);
const quality = process.argv[7] || '';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  // WebGL2 forced (headless WebGPU device-loss is the documented container
  // limitation; see Phase 1 worklog). Pass mode=webgpu to attempt WebGPU.
  if (process.env.MODE !== 'webgpu') {
    await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  }
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

  const q = query ? `&${query}` : '';
  const qual = quality ? `&quality=${quality}` : '';
  const url = `http://localhost:5173/juzu/?shot=${shot}&t=2&readback=1${q}${qual}`;
  await page.goto(url, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
  await page.waitForTimeout(700);

  const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
  const ktx2 = await page.evaluate(() => window.__ktx2Supported);
  await page.locator('canvas').screenshot({ path: path.join(OUT, `${out}.png`) });

  const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('MIME'));
  console.log(`${out}: renderer=${rendererType} ktx2=${ktx2} errs=${errs.length}`);
  errs.slice(0, 3).forEach(e => console.log('   ' + e.slice(0, 160)));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
