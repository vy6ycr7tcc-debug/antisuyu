// P-CANON-2 §8.3 subset matrix runner.
// Usage: node scripts/p_canon2_matrix.cjs [BASE]   (default http://127.0.0.1:3000/juzu/)
// Captures day/dawn x {cf, sierra, paititi, valley} at 1280 + cf at 390 into
// docs/verification/p-canon-2/ on the BUILT bundle (preview server), WebGL2.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://127.0.0.1:3000/juzu/';
const OUT = path.join(__dirname, '..', 'docs', 'verification', 'p-canon-2');
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  // [shot, vantage, tod, w, h, outfile]
  ['foliage_check', 'cf_floor', 'day', 1280, 800, 'canon2_cf_day_1280'],
  ['foliage_check', 'cf_floor', 'dawn', 1280, 800, 'canon2_cf_dawn_1280'],
  ['foliage_check', 'jungle_fern', 'day', 1280, 800, 'canon2_jungle_day_1280'],
  ['foliage_check', 'jungle_dawnlit', 'dawn', 1280, 800, 'canon2_jungle_dawn_1280'],
  ['foliage_check', 'paititi_edge', 'day', 1280, 800, 'canon2_paititi_day_1280'],
  ['foliage_check', 'paititi_edge', 'dawn', 1280, 800, 'canon2_paititi_dawn_1280_XFAIL'],
  ['terrain_check', 'sierra_lit', 'day', 1280, 800, 'canon2_sierra_day_1280'],
  ['terrain_check', 'sierra_lit', 'dawn', 1280, 800, 'canon2_sierra_dawn_1280'],
  ['valley_overview', '', 'day', 1280, 800, 'canon2_valley_day_regr'],
  ['valley_overview', '', 'dawn', 1280, 800, 'canon2_valley_dawn_regr_XFAIL'],
  ['foliage_check', 'cf_floor', 'day', 390, 844, 'canon2_cf_day_390'],
  ['foliage_check', 'cf_floor', 'dawn', 390, 844, 'canon2_cf_dawn_390'],
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  let ctx = null, page = null, curSize = '';
  const errors = [];
  for (const [shot, v, tod, w, h, out] of SHOTS) {
    const size = `${w}x${h}`;
    if (size !== curSize) {
      if (page) await ctx.close();
      ctx = await browser.newContext({ viewport: { width: w, height: h } });
      page = await ctx.newPage();
      // Force WebGL2 (same methodology as all prior §8.3 evidence — SwiftShader
      // WebGPU loses the device on first render, a documented pre-existing
      // container limitation, not a code bug).
      await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
      page.on('pageerror', e => {
        const msg = e.message || '';
        if (msg.includes('popErrorScope')) return; // WebGPU-internal noise when gpu probe is stripped
        errors.push(`${out}: ${msg}`);
      });
      curSize = size;
    }
    const vParam = v ? `&v=${v}` : '';
    const url = `${BASE}?shot=${shot}${vParam}&tod=${tod}&t=2&readback=1`;
    await page.goto(url, { timeout: 30000 });
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 30000 });
    await page.waitForTimeout(700);
    const buf = await page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(OUT, `${out}.png`), buf);
    console.log(`captured ${out} (${size})`);
  }
  await browser.close();
  if (errors.length) { console.error('PAGEERRORS:'); errors.forEach(e => console.error(' ', e)); process.exit(2); }
  console.log('matrix complete, zero page errors');
})();
