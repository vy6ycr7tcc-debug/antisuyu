// Probe: character_closeup runtime state via __charDebug (asserted at __shotReady).
// Usage: node scripts/p7_probe_state.cjs [extra query params]
const { chromium } = require('playwright');

const extra = process.argv[2] || '';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);

  await page.goto(`http://localhost:5173/juzu/?shot=character_closeup&tod=day&t=2&readback=1${extra ? '&' + extra : ''}`, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });

  const d = await page.evaluate(() => window.__charDebug);
  console.log('charDebug:', JSON.stringify(d, (k, v) => (v && v.isVector3) ? { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) } : v, 2));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
