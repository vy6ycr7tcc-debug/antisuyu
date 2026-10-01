// Phase 9 V-POST batch capture runner.
// Usage: node scripts/p9_batch.cjs <manifest.json>
// Manifest: array of { name, url } — url is the FULL query (without ?shot=).
// Each entry is captured at 1280x800 (or w/h from the entry) WebGL2 into
// shots/p9_<name>.png. One browser for the whole batch (deterministic shot
// mode: same-URL re-capture is 0.000% diff, proven in p8).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const manifestPath = process.argv[2];
if (!manifestPath) { console.error('usage: p9_batch.cjs <manifest.json>'); process.exit(1); }
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
    const onPageError = e => logs.push(`PAGEERROR: ${e.message}`);
    page.on('console', onConsole); page.on('pageerror', onPageError);

    const url = `http://localhost:5173/juzu/?${e.url}&readback=1`;
    try {
      await page.goto(url, { timeout: 30000 });
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
      await page.waitForTimeout(700);
      await page.locator('canvas').screenshot({ path: path.join(OUT, `p9_${e.name}.png`) });
      const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('sw.js'));
      console.log(`p9_${e.name}: ${W}x${H} errs=${errs.length}`);
      errs.slice(0, 2).forEach(x => console.log('   ' + x.slice(0, 140)));
    } catch (err) {
      console.log(`p9_${e.name}: CAPTURE FAILED ${err.message.slice(0, 120)}`);
    }
    page.off('console', onConsole); page.off('pageerror', onPageError);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
