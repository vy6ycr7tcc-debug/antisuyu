// p2-5 frustum honesty test: capture material_check dawn with and without
// `nochar=1`, then diff. Any differing pixel cluster = Naira's footprint.
const { chromium } = require('playwright');
const path = require('path');

const PORT = process.env.SHOT_PORT || '5173';
const OUT = path.join(__dirname, '..', 'shots');

async function cap(browser, url, out) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(`Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true});`);
  const page = await ctx.newPage();
  await page.goto(url, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
  await page.waitForTimeout(700);
  await page.locator('canvas').screenshot({ path: path.join(OUT, out) });
  await ctx.close();
  console.log('saved', out);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader']
  });
  const base = `http://localhost:${PORT}/juzu/?shot=material_check&tod=dawn&t=2&readback=1`;
  await cap(browser, base, 'p2_frustum_with_char.png');
  await cap(browser, base + '&nochar=1', 'p2_frustum_nochar.png');
  await browser.close();
})();
