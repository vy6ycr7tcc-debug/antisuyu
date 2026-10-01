// Phase 2 verification — material_check shot matrix (visual bible §8).
// WebGL2 forced (headless WebGPU device-loss is a proven container limitation,
// see Phase 1 worklog) + one WebGPU attempt for the record via readback.
// Usage: node scripts/phase2_shots.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SHOT_PORT || '5173';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

// [label, tod, width, height, extraParams]
const MATRIX = [
  ['day_1280',     'day',  1280, 800,  ''],
  ['dawn_1280',    'dawn', 1280, 800,  '&lt=3.0'],
  ['dusk_1280',    'dusk', 1280, 800,  ''],
  ['night_1280',   'night',1280, 800,  ''],
  ['day_390',      'day',  390,  844,  ''],
  ['dawn_390',     'dawn', 390,  844,  '&lt=3.0'],
];

async function capture(browser, mode, [label, tod, w, h, extra]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  if (mode === 'webgl2') {
    await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  }
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

  const url = `http://localhost:${PORT}/juzu/?shot=material_check&tod=${tod}&t=2&readback=1${extra}`;
  process.stdout.write(`[${mode}] ${label} ... `);
  try {
    await page.goto(url, { timeout: 30000 });
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
    await page.waitForTimeout(700);

    const rendererType = await page.evaluate(() => window.__rendererType || 'unknown');
    const ktx2 = await page.evaluate(() => window.__ktx2Supported);
    const canvasPath = path.join(OUT, `p2_material_${label}_${mode}.png`);
    await page.locator('canvas').screenshot({ path: canvasPath });

    const dataUrl = await page.evaluate(() => window.__frameDataURL || null);
    let readbackPath = null;
    if (dataUrl) {
      readbackPath = path.join(OUT, `p2_material_${label}_${mode}_readback.png`);
      fs.writeFileSync(readbackPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
    const errs = logs.filter(l => l.startsWith('error') || l.startsWith('PAGEERROR'));
    console.log(`renderer=${rendererType} ktx2=${ktx2} canvas=ok readback=${dataUrl ? 'ok' : 'none'} errs=${errs.length}`);
    if (errs.length) errs.slice(0, 3).forEach(e => console.log('   ' + e.slice(0, 200)));
  } catch (e) {
    console.log(`FAILED: ${String(e).slice(0, 140)}`);
  }
  await ctx.close();
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-gl=angle',
      '--use-angle=swiftshader'
    ]
  });

  for (const shot of MATRIX) {
    await capture(browser, 'webgl2', shot);
  }
  // WebGPU attempt (expected to lose device in this container — documented)
  await capture(browser, 'webgpu', MATRIX[0]);

  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });
