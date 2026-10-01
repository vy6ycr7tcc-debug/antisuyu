// Phase 8 diagnostic: capture the canonical minimal shadow repro page.
// Usage: node scripts/p8_minimal.cjs [on|off|nosun]
const { chromium } = require('playwright');
const path = require('path');

const mode = process.argv[2] || 'on';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 660, height: 500 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:5173/juzu/shadow_minimal.html?mode=${mode}`, { timeout: 30000 });
  await page.waitForFunction(() => window.__minReady === true, { timeout: 20000 });
  await page.waitForTimeout(400);
  const dbg = await page.evaluate(() => window.__minDebug);
  console.log(`mode=${dbg.mode} glRenderer:`, dbg.glRenderer);
  console.log('shadowMapAllocated:', dbg.shadowMapAllocated);
  await page.locator('canvas').screenshot({ path: path.join(__dirname, '..', 'shots', `p8_minimal_${dbg.mode}.png`) });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
