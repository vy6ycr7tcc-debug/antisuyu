// Phase 5 verification — water system shot matrix (visual bible §8).
// WebGL2 forced (headless WebGPU device-loss is a proven container limitation,
// see Phase 1 worklog). HIGH tier primary rows; LOW + 390 mobile + flow A/B
// (§8.3 motion-ready) + foam A/B + regressions included.
// Usage: node scripts/phase5_shots.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SHOT_PORT || '5173';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

// [label, shot, width, height, extraParams]
const MATRIX = [
  // Primary vantages × ToD rhythm (§8.1: day + dawn minimum per vantage)
  ['water_run_day',         'water_check', 1280, 800, 'v=run&nm=1&quality=high'],
  ['water_run_dawn',        'water_check', 1280, 800, 'v=run_dawnlit&nm=1&quality=high&tod=dawn'],
  ['water_run_dusk',        'water_check', 1280, 800, 'v=run_duskaim&nm=1&quality=high&tod=dusk'],
  ['water_run_night',       'water_check', 1280, 800, 'v=run&nm=1&quality=high&tod=night'],
  ['water_pool_day',        'water_check', 1280, 800, 'v=pool&nm=1&quality=high'],
  ['water_pool_dawn',       'water_check', 1280, 800, 'v=pool_dawnlit&nm=1&quality=high&tod=dawn'],
  ['water_jungle_dark_day', 'water_check', 1280, 800, 'v=jungle_dark&nm=1&quality=high'],
  // Known delta (documented in the PR, flagged to the light-rig owner):
  // jungle-stretch dawn crushes 19.4–27% on N/NW aims and the sun-streak
  // mirrors clip 2.8–4.7% on ENE aims — no passing aim found (swept
  // J1–J5). Same 6° dawn trench-shadow physics as p4's XFAIL rows.
  ['water_jungle_dark_dawn','water_check', 1280, 800, 'v=jungle_dark&nm=1&quality=high&tod=dawn'],
  ['water_bank_foam_day',   'water_check', 1280, 800, 'v=bank_foam&nm=1&quality=high'],
  // Flow A/B pair (§8.3 motion-ready: t=0 vs t=4 flow phase — same vantage)
  ['flowA_run_day_t0',      'water_check', 1280, 800, 'v=run&nm=1&quality=high&t=0'],
  ['flowA_run_day_t4',      'water_check', 1280, 800, 'v=run&nm=1&quality=high&t=4'],
  // Foam A/B (&nf=1 disables the foam band — isolates the foam read)
  ['foamB_run_day_off',     'water_check', 1280, 800, 'v=run&nm=1&quality=high&nf=1'],
  // Tier + mobile
  ['water_run_day_LOW',     'water_check', 1280, 800, 'v=run&nm=1&quality=low'],
  ['water_run_day_390',     'water_check', 390,  844, 'v=run&nm=1&quality=high'],
  ['water_pool_dawn_390',   'water_check', 390,  844, 'v=pool_dawnlit&ch=1.5&cd=8&ly=4&nm=1&quality=high&tod=dawn'],
  // Regressions on existing shot ids (river now visible in all of them)
  ['valley_day_regr',       'valley_overview', 1280, 800, 'quality=high'],
  ['valley_dawn_regr',      'valley_overview', 1280, 800, 'quality=high&tod=dawn'],
  ['river_crossing_day',    'river_crossing',  1280, 800, 'quality=high'],
  ['river_crossing_dawn',   'river_crossing',  1280, 800, 'quality=high&tod=dawn'],
  ['terrain_river_day_regr','terrain_check',   1280, 800, 'v=river&quality=high'],
  ['buoyancy_day_regr',     'buoyancy',        1280, 800, 'quality=high'],
];

async function capture(browser, [label, shot, w, h, extra]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

  const url = `http://localhost:${PORT}/juzu/?shot=${shot}&readback=1${extra ? '&' + extra : ''}`;
  // NOTE: no hardcoded &t= here — A/B rows set their own t; rows without one
  // default to t=0 in shot mode. (A hardcoded t=2 + extra &t= made BOTH
  // flow-A/B rows read t=2 — the audit measured an exactly-zero diff.)
  await page.goto(url, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
  await page.waitForTimeout(700);

  const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
  const ktx2 = await page.evaluate(() => window.__ktx2Supported);
  const tier = await page.evaluate(() => window.__currentQualityTier || 'unknown');
  await page.locator('canvas').screenshot({ path: path.join(OUT, `p5_${label}.png`) });

  const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('sw.js'));
  console.log(`p5_${label}: renderer=${rendererType} ktx2=${ktx2} tier=${tier} errs=${errs.length}`);
  errs.slice(0, 3).forEach(e => console.log('   ' + e.slice(0, 160)));
  await ctx.close();
  return errs.length;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  let totalErrs = 0;
  for (const row of MATRIX) {
    try {
      totalErrs += await capture(browser, row);
    } catch (e) {
      console.log(`p5_${row[0]}: FAILED ${e.message.slice(0, 120)}`);
      totalErrs += 1;
    }
  }
  await browser.close();
  console.log(`\nDone. ${MATRIX.length} captures, total render-error rows: ${totalErrs}`);
})().catch(e => { console.error(e); process.exit(1); });
