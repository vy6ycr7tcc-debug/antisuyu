// Single-mode, ToD-list capture: node scripts/phase1_skyshots.cjs
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'shots');

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader']
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // WebGL2 horizon shots: day + night + dawn (legacy regression continuity)
  for (const tod of ['day', 'night', 'dawn']) {
    const page = await ctx.newPage();
    await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
    await page.goto(`http://localhost:5173/juzu/?shot=river_crossing&tod=${tod}&t=2`, { timeout: 30000 });
    process.stdout.write(`[webgl2] river_crossing ${tod} ... `);
    try {
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
      await page.waitForTimeout(500);
      await page.locator('canvas').screenshot({ path: path.join(OUT, `p1_river_crossing_${tod}_webgl2.png`) });
      console.log('ok');
    } catch (e) { console.log(`FAILED ${String(e).slice(0, 80)}`); }
    await page.close();
  }

  // Mobile gate viewport 390x844: day + dawn
  const mobile = await ctx.browser().newContext({ viewport: { width: 390, height: 844 } });
  for (const tod of ['day', 'dawn']) {
    const page = await mobile.newPage();
    await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
    await page.goto(`http://localhost:5173/juzu/?shot=river_crossing&tod=${tod}&t=2`, { timeout: 30000 });
    process.stdout.write(`[webgl2-mobile] river_crossing ${tod} ... `);
    try {
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
      await page.waitForTimeout(500);
      await page.locator('canvas').screenshot({ path: path.join(OUT, `p1_river_crossing_${tod}_mobile390_webgl2.png`) });
      console.log('ok');
    } catch (e) { console.log(`FAILED ${String(e).slice(0, 80)}`); }
    await page.close();
  }

  await ctx.close();
  await mobile.close();
  await browser.close();
}
run();
