// Phase 4 verification — foliage/rock/mist shot matrix (visual bible §8).
// WebGL2 forced (headless WebGPU device-loss is a proven container limitation,
// see Phase 1 worklog). HIGH tier is the primary row set; LOW + 390 mobile +
// wind A/B (§8.3 motion-ready) + regressions included.
// Usage: node scripts/phase4_shots.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SHOT_PORT || '5173';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

// [label, shot, width, height, extraParams]
const MATRIX = [
  // Species palettes × leading ToD (day + dawn per §8.1 rhythm)
  ['cf_floor_day_1280',     'foliage_check', 1280, 800, 'v=cf_floor&quality=high'],
  ['cf_floor_dawn_1280',    'foliage_check', 1280, 800, 'v=cf_dawnlit&quality=high'],
  ['sierra_ichu_day_1280',  'foliage_check', 1280, 800, 'v=sierra_ichu&quality=high'],
  ['sierra_dawnlit_dawn',   'foliage_check', 1280, 800, 'v=sierra_dawnlit&tod=dawn&quality=high'],
  ['jungle_fern_day_1280',  'foliage_check', 1280, 800, 'v=jungle_fern&quality=high'],
  ['jungle_dawnlit_dawn',   'foliage_check', 1280, 800, 'v=jungle_dawnlit&tod=dawn&quality=high'],
  ['paititi_edge_day_1280', 'foliage_check', 1280, 800, 'v=paititi_edge&quality=high'],
  ['paititi_edge_dawn',     'foliage_check', 1280, 800, 'v=paititi_edge&tod=dawn&ch=18&quality=high'],
  ['valley_mix_day_1280',   'foliage_check', 1280, 800, 'v=valley_mix&quality=high'],
  ['valley_dawnlit_dawn',   'foliage_check', 1280, 800, 'v=valley_dawnlit&tod=dawn&quality=high'],
  // Wind A/B pair (§8.3 motion-ready: t=0 vs t=2 wind phase — same vantage)
  ['windA_cf_day_t0',       'foliage_check', 1280, 800, 'v=cf_floor&quality=high&t=0'],
  ['windA_cf_day_t2',       'foliage_check', 1280, 800, 'v=cf_floor&quality=high&t=2'],
  // Tiers + mobile
  ['cf_floor_day_LOW',      'foliage_check', 1280, 800, 'v=cf_floor&quality=low'],
  ['sierra_ichu_day_LOW',   'foliage_check', 1280, 800, 'v=sierra_ichu&quality=low'],
  ['cf_floor_day_390',      'foliage_check', 390,  844, 'v=cf_floor&quality=high'],
  // Regressions on existing shot ids (now with foliage visible in shot mode)
  ['valley_day_regr',       'valley_overview', 1280, 800, 'quality=high'],
  ['valley_dawn_regr',      'valley_overview', 1280, 800, 'quality=high&tod=dawn'],
  ['terrain_cf_day_regr',   'terrain_check', 1280, 800, 'v=cf&quality=high'],
];

async function capture(browser, [label, shot, w, h, extra]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

  const url = `http://localhost:${PORT}/juzu/?shot=${shot}&readback=1&${extra}`;
  await page.goto(url, { timeout: 40000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 35000 });
  await page.waitForTimeout(700);

  const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
  const ktx2 = await page.evaluate(() => window.__ktx2Supported);
  const tier = await page.evaluate(() => window.__currentQualityTier || '?');
  await page.locator('canvas').screenshot({ path: path.join(OUT, `p4_${label}.png`) });

  const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('MIME'));
  console.log(`${label} ... renderer=${rendererType} ktx2=${ktx2} tier=${tier} errs=${errs.length}`);
  errs.slice(0, 3).forEach(e => console.log('   ' + e.slice(0, 160)));

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  for (const row of MATRIX) await capture(browser, row);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
