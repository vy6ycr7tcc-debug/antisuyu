// Phase 12 batch capture runner (clone of p10_batch + buoyancy probe support).
// Usage: node scripts/p12_batch.cjs <manifest.json> [prefix]
// Manifest: array of { name, url, w?, h?, probe? } — probe=true evals
// window.__buoyancyProbe() after the shot and prints the JSON line.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const manifestPath = process.argv[2];
if (!manifestPath) { console.error('usage: p12_batch.cjs <manifest.json> [prefix]'); process.exit(1); }
const PREFIX = process.argv[3] || 'p12';
const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);

  for (const e of entries) {
    const W = e.w || 1280, H = e.h || 800;
    await page.setViewportSize({ width: W, height: H });
    const logs = [];
    const onConsole = m => logs.push(`${m.type()}: ${m.text()}`);
    const onPageError = err => logs.push(`PAGEERROR: ${err.message}`);
    page.on('console', onConsole); page.on('pageerror', onPageError);

    const url = `http://localhost:5173/juzu/?${e.url}&readback=1`;
    try {
      await page.goto(url, { timeout: 30000 });
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
      await page.waitForTimeout(700);
      if (e.probe) {
        const data = await page.evaluate(() => (window.__buoyancyProbe ? window.__buoyancyProbe() : null));
        console.log(`${PREFIX}_${e.name}: PROBE ${JSON.stringify(data)}`);
      }
      await page.locator('canvas').screenshot({ path: path.join(OUT, `${PREFIX}_${e.name}.png`) });
      const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('sw.js'));
      console.log(`${PREFIX}_${e.name}: ${W}x${H} errs=${errs.length}`);
      errs.slice(0, 2).forEach(x => console.log('   ' + x.slice(0, 140)));
    } catch (err) {
      console.log(`${PREFIX}_${e.name}: CAPTURE FAILED ${err.message.slice(0, 120)}`);
    }
    page.off('console', onConsole); page.off('pageerror', onPageError);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
