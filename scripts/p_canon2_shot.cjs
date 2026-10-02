// P-CANON-2 single-shot sweeper: node scripts/p_canon2_shot.cjs <v> <tod> <out> [w] [h] [shot]
// Captures one frame from the BUILT bundle on the preview server (port 3000).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const v = process.argv[2] || 'cf_floor';
const tod = process.argv[3] || 'dawn';
const out = process.argv[4] || 'canon2_sweep';
const w = parseInt(process.argv[5] || '1280', 10);
const h = parseInt(process.argv[6] || '800', 10);
const shot = process.argv[7] || 'foliage_check';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  page.on('pageerror', e => { if (!/popErrorScope/.test(e.message)) console.error('PAGEERROR:', e.message); });
  const vParam = v ? `&v=${v}` : '';
  await page.goto(`http://127.0.0.1:3000/juzu/?shot=${shot}${vParam}&tod=${tod}&t=2&readback=1`, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 30000 });
  await page.waitForTimeout(700);
  fs.writeFileSync(path.join(OUT, `${out}.png`), await page.screenshot({ type: 'png' }));
  await browser.close();
  console.log(`captured shots/${out}.png`);
})();
