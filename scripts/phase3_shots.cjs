// Phase 3 verification — terrain biome/material shot matrix (visual bible §8).
// WebGL2 forced (headless WebGPU device-loss is a proven container limitation,
// see Phase 1 worklog) + one WebGPU attempt for the record via readback.
// Usage: node scripts/phase3_shots.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SHOT_PORT || '5173';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

// [label, shot, width, height, extraParams]
const MATRIX = [
  ['sierra_day_1280',    'terrain_check', 1280, 800, 'v=sierra'],
  ['sierra_dawn_1280',   'terrain_check', 1280, 800, 'v=sierra_lit&tod=dawn'],
  ['snowline_dawn_1280', 'terrain_check', 1280, 800, 'v=snowline&tod=dawn'],
  ['river_dawn_1280',    'terrain_check', 1280, 800, 'v=river&tod=dawn'],
  ['cf_day_1280',        'terrain_check', 1280, 800, 'v=cf'],
  ['jungle_day_1280',    'terrain_check', 1280, 800, 'v=jungle'],
  ['paititi_day_1280',   'terrain_check', 1280, 800, 'v=paititi'],
  ['boundary_day_1280',  'terrain_check', 1280, 800, 'v=boundary'],
  ['sierra_day_390',     'terrain_check', 390,  844, 'v=sierra'],
  ['sierra_day_LOW',     'terrain_check', 1280, 800, 'v=sierra&quality=low'],
  ['valley_day_regr',    'valley_overview', 1280, 800, ''],
  ['valley_dawn_regr',   'valley_overview', 1280, 800, '&tod=dawn'],
];

async function capture(browser, mode, [label, shot, w, h, extra]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  if (mode === 'webgl2') {
    await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  }
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

  const suffix = mode === 'webgl2' ? 'webgl2' : 'webgpu';
  const url = `http://localhost:${PORT}/juzu/?shot=${shot}&t=2&readback=1&${extra}`;
  await page.goto(url, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
  await page.waitForTimeout(700);

  const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
  const ktx2 = await page.evaluate(() => window.__ktx2Supported);
  const tier = await page.evaluate(() => window.__currentQualityTier || '?');
  await page.locator('canvas').screenshot({ path: path.join(OUT, `p3_${label}_${suffix}.png`) });

  const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('MIME'));
  console.log(`[${mode}] ${label} ... renderer=${rendererType} ktx2=${ktx2} tier=${tier} errs=${errs.length}`);
  errs.slice(0, 3).forEach(e => console.log('   ' + e.slice(0, 160)));

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  for (const row of MATRIX) await capture(browser, 'webgl2', row);
  await capture(browser, 'webgpu', MATRIX[0]);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
