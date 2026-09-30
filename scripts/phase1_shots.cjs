// Phase 1 verification — dual-renderer, four-time-of-day screenshot matrix.
// Usage: node scripts/phase1_shots.cjs [scenario]   (default valley_overview)
// Captures WebGPU (canvas + readback data-URL) and WebGL2 (canvas) per ToD.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SHOT_PORT || '5173';
const scenario = process.argv[2] || 'valley_overview';
const TODS = ['day', 'dawn', 'dusk', 'night'];
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-gl=angle',
      '--use-angle=swiftshader'
    ]
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  for (const mode of ['webgpu', 'webgl2']) {
    for (const tod of TODS) {
      const page = await ctx.newPage();
      if (mode === 'webgl2') {
        await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
      }
      const logs = [];
      page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
      page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

      const url = `http://localhost:${PORT}/juzu/?shot=${scenario}&tod=${tod}&t=2&readback=1`;
      process.stdout.write(`[${mode}] ${tod} ... `);
      try {
        await page.goto(url, { timeout: 30000 });
        await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
        await page.waitForTimeout(600);

        const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
        const canvasPath = path.join(OUT, `p1_${scenario}_${tod}_${mode}.png`);
        await page.locator('canvas').screenshot({ path: canvasPath });

        // Readback frame (WebGPU headless presentation can fail; data-URL is the ground truth)
        const dataUrl = await page.evaluate(() => window.__frameDataURL || null);
        let readbackPath = null;
        if (dataUrl) {
          readbackPath = path.join(OUT, `p1_${scenario}_${tod}_${mode}_readback.png`);
          fs.writeFileSync(readbackPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
        }
        const errs = logs.filter(l => l.startsWith('error') || l.startsWith('PAGEERROR'));
        console.log(`renderer=${rendererType} canvas=ok readback=${dataUrl ? 'ok' : 'none'} errs=${errs.length}`);
        if (errs.length) errs.slice(0, 3).forEach(e => console.log('   ' + e.slice(0, 160)));
      } catch (e) {
        console.log(`FAILED: ${String(e).slice(0, 120)}`);
      }
      await page.close();
    }
  }
  await ctx.close();
  await browser.close();
}

run();
