// sky_check captures: day + night, WebGL2, gate viewport.
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'shots');

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader']
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const jobs = [
    ['day', 315], ['night', 315], ['dawn', 315],
    ['day', 135], ['night', 135]
  ];
  for (const [tod, az] of jobs) {
    const page = await ctx.newPage();
    await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
    await page.goto(`http://localhost:5173/juzu/?shot=sky_check&tod=${tod}&az=${az}&t=2`, { timeout: 30000 });
    process.stdout.write(`[webgl2] sky_check ${tod} az${az} ... `);
    try {
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
      await page.waitForTimeout(500);
      await page.locator('canvas').screenshot({ path: path.join(OUT, `p1_sky_check_${tod}_az${az}_webgl2.png`) });
      console.log('ok');
    } catch (e) { console.log(`FAILED ${String(e).slice(0, 80)}`); }
    await page.close();
  }
  await ctx.close();
  await browser.close();
}
run();
