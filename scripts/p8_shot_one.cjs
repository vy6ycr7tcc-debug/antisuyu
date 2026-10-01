// Phase 8 parameterized single-shot runner (p8-*).
// Usage: node scripts/p8_shot_one.cjs <shot> <tod> <outname> [extra query params]
// Captures <shot> at 1280x800 WebGL2 into shots/<outname>.png and dumps the
// __shadowInfo probe JSON to shots/<outname>.shadowinfo.json
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const shot = process.argv[2] || 'shadow_check';
const tod = process.argv[3] || 'day';
const out = process.argv[4] || `p8_${shot}_${tod}`;
const extra = process.argv[5] || '';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

  const url = `http://localhost:5173/juzu/?shot=${shot}&tod=${tod}&t=2${extra ? '&' + extra : ''}`;
  await page.goto(url, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
  await page.waitForTimeout(700);

  const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
  const ktx2 = await page.evaluate(() => window.__ktx2Supported);
  const tier = await page.evaluate(() => window.__currentQualityTier || 'unknown');
  const shadowInfo = await page.evaluate(() => window.__shadowInfo || null);
  await page.locator('canvas').screenshot({ path: path.join(OUT, `${out}.png`) });
  if (shadowInfo) {
    fs.writeFileSync(path.join(OUT, `${out}.shadowinfo.json`), JSON.stringify(shadowInfo, null, 2));
  }

  const errs = logs.filter(l => (l.startsWith('error') || l.startsWith('PAGEERROR')) && !l.includes('sw.js'));
  console.log(`${out}: renderer=${rendererType} ktx2=${ktx2} tier=${tier} shadowinfo=${shadowInfo ? 'yes' : 'NULL'} errs=${errs.length}`);
  if (shadowInfo) {
    console.log(`   projScaleX=${shadowInfo.projScaleX.toFixed(5)} frustum.l=${shadowInfo.frustum.left} mapAlloc=${shadowInfo.shadowMapAllocated} casters=${shadowInfo.meshCensus.casters}/${shadowInfo.meshCensus.meshes} smEnabled=${shadowInfo.shadowMapEnabled}`);
  }
  errs.slice(0, 3).forEach(e => console.log('   ' + e.slice(0, 160)));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
