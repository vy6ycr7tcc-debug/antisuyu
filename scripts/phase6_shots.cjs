// Phase 6 verification — atmosphere (V-ATMOS) shot matrix (visual bible §8).
// WebGL2 forced (headless WebGPU device-loss is a proven container limitation,
// see Phase 1 worklog). HIGH tier primary rows; LOW + 390 mobile + mote A/B
// (§8.3 motion-ready) + particle-presence A/B (&np=1) + regressions included.
// Usage: node scripts/phase6_shots.cjs [--only labelSubstr]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SHOT_PORT || '5173';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

// [label, shot, width, height, extraParams]
const MATRIX = [
  // Primary vantages (§8.1: day + dawn minimum; atmosphere spans all regions,
  // so one vantage per biome system + the p4 regression + the far vista)
  ['atmos_cf_shafts_dawn',   'atmos_check', 1280, 800, 'v=cf_shafts&quality=high&tod=dawn'],
  ['atmos_cf_shafts_day',    'atmos_check', 1280, 800, 'v=cf_shafts&quality=high'],
  ['atmos_cf_shafts_night',  'atmos_check', 1280, 800, 'v=cf_shafts&quality=high&tod=night'],
  ['atmos_sierra_dust_day',  'atmos_check', 1280, 800, 'v=sierra_dust&quality=high'],
  ['atmos_jungle_pollen_day','atmos_check', 1280, 800, 'v=jungle_pollen&quality=high'],
  // p4 deferred-defect regression: the old hard-edged shaft cards showed here
  ['atmos_paititi_dawn',     'atmos_check', 1280, 800, 'v=paititi_regr&quality=high&tod=dawn'],
  // Companion brief item 7 — aerial perspective evidence (distant sierra fade)
  ['atmos_vista_day',        'atmos_check', 1280, 800, 'v=vista&quality=high'],
  // Mote motion A/B pair (§8.3 motion-ready: t=0 vs t=4, deterministic sim)
  ['motesA_cf_dawn_t0',      'atmos_check', 1280, 800, 'v=cf_shafts&quality=high&tod=dawn&t=0'],
  ['motesA_cf_dawn_t4',      'atmos_check', 1280, 800, 'v=cf_shafts&quality=high&tod=dawn&t=4'],
  // Particle-presence A/B (&np=1 suspends the Points systems — isolates the
  // particle read from mist/shafts; proves the systems materially render)
  ['presA_cf_day_np1',       'atmos_check', 1280, 800, 'v=cf_shafts&quality=high&np=1'],
  ['presA_sierra_day_np1',   'atmos_check', 1280, 800, 'v=sierra_dust&quality=high&np=1'],
  // Tier + mobile
  ['atmos_cf_dawn_LOW',      'atmos_check', 1280, 800, 'v=cf_shafts&quality=low&tod=dawn'],
  ['atmos_sierra_day_390',   'atmos_check', 390,  844, 'v=sierra_dust&quality=high'],
  // Regressions on existing shot ids (§8.1: at least one existing shot)
  ['valley_day_regr',        'valley_overview', 1280, 800, 'quality=high'],
  ['valley_dawn_regr',       'valley_overview', 1280, 800, 'quality=high&tod=dawn'],
  ['terrain_sierra_day_regr','terrain_check',   1280, 800, 'v=sierra&quality=high'],
  ['region_cf_dawn_regr',    'region:cf_overview', 1280, 800, 'quality=high&tod=dawn'],
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
  // default to t=0 in shot mode (p5 lesson: a hardcoded t made A/B rows read
  // identical and the motion gate measured exactly zero).
  await page.goto(url, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
  await page.waitForTimeout(700);

  const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
  const ktx2 = await page.evaluate(() => window.__ktx2Supported);
  const tier = await page.evaluate(() => window.__currentQualityTier || 'unknown');
  await page.locator('canvas').screenshot({ path: path.join(OUT, `p6_${label}.png`) });

  const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('sw.js'));
  console.log(`p6_${label}: renderer=${rendererType} ktx2=${ktx2} tier=${tier} errs=${errs.length}`);
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
    if (only && !row[0].includes(only)) continue;
    try {
      totalErrs += await capture(browser, row);
    } catch (e) {
      console.log(`p6_${row[0]}: FAILED ${e.message.slice(0, 120)}`);
      totalErrs += 1;
    }
  }
  await browser.close();
  console.log(`\nDone. ${MATRIX.length} captures, total render-error rows: ${totalErrs}`);
})().catch(e => { console.error(e); process.exit(1); });
