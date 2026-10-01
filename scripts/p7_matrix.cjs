// Phase 7 §8.3 matrix — composed (shipped) captures + A/B pairs.
// Usage: node scripts/p7_matrix.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

// [name, shotId, tod, t, extra, w, h]
// (p5 lesson applied: t is a per-row param — the earlier draft hardcoded t=2
// AND appended &t= in extras, so both motion rows read t=2 and the A/B
// diffed to exactly zero.)
const ROWS = [
  // Composed (shipped look) gate rows — canonical closeup framing
  ['p7_gate_day',        'character_closeup', 'day',  2, 'nm=1', 1280, 800],
  ['p7_gate_dawn',       'character_closeup', 'dawn', 2, 'nm=1', 1280, 800],
  ['p7_gate_dusk',       'character_closeup', 'dusk', 2, 'nm=1', 1280, 800],
  ['p7_gate_night',      'character_closeup', 'night',2, 'nm=1', 1280, 800],
  ['p7_gate_day_390',    'character_closeup', 'day',  2, 'nm=1',  390, 844],
  ['p7_gate_dusk_390',   'character_closeup', 'dusk', 2, 'nm=1',  390, 844],
  // Downslope-aim variant: terrain-backed background (sky-bloom wash out of
  // frame) — the measured vantage sweep for the composed day/dusk rows.
  ['p7_gate_day_slope',  'character_closeup', 'day',  2, 'nm=1&ly=0.45&ch=1.2&cd=2.6', 1280, 800],
  ['p7_gate_dusk_slope', 'character_closeup', 'dusk', 2, 'nm=1&ly=0.45&ch=1.2&cd=2.6', 1280, 800],
  // A/B pairs (raw tv=1 to isolate material response from the flagged bloom wash)
  ['p7_gate_motion_t0',  'character_closeup', 'day',  0, 'nm=1&tv=1', 1280, 800],
  ['p7_gate_motion_t4',  'character_closeup', 'day',  4, 'nm=1&tv=1', 1280, 800],
  ['p7_gate_maps_on',    'character_closeup', 'dusk', 2, 'nm=1&tv=1', 1280, 800],
  ['p7_gate_maps_off',   'character_closeup', 'dusk', 2, 'nm=1&tv=1&ncm=1', 1280, 800],
  // Regressions (composed, global look unchanged by character-scoped edits)
  ['p7_gate_valley_day',  'valley_overview', 'day',  2, '', 1280, 800],
  ['p7_gate_valley_dawn', 'valley_overview', 'dawn', 2, '', 1280, 800],
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  for (const [name, shotId, tod, t, extra, W, H] of ROWS) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await ctx.newPage();
    await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
    const logs = [];
    page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));
    const url = `http://localhost:5173/juzu/?shot=${shotId}&tod=${tod}&t=${t}&readback=1${extra ? '&' + extra : ''}`;
    await page.goto(url, { timeout: 30000 });
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
    await page.waitForTimeout(700);
    const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
    const ktx2 = await page.evaluate(() => window.__ktx2Supported);
    const tier = await page.evaluate(() => window.__currentQualityTier || 'unknown');
    await page.locator('canvas').screenshot({ path: path.join(OUT, `${name}.png`) });
    const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('sw.js'));
    console.log(`${name}: renderer=${rendererType} ktx2=${ktx2} tier=${tier} errs=${errs.length}`);
    errs.slice(0, 2).forEach(e => console.log('   ' + e.slice(0, 140)));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
