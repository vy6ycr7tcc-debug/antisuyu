// Debug: when does the WebGPU device die in headless? Full event timeline.
const { chromium } = require('playwright');

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const t0 = Date.now();
  const ts = () => `+${((Date.now() - t0) / 1000).toFixed(2)}s`;

  page.on('console', m => console.log(`${ts()} [console.${m.type()}] ${m.text().slice(0, 220)}`));
  page.on('pageerror', e => console.log(`${ts()} [PAGEERROR] ${e.message.slice(0, 220)}`));

  await page.addInitScript(`
    const origErr = console.error;
    console.error = (...a) => { origErr(...a); window.__errs = (window.__errs||0)+1; };
    navigator.gpu.getAdapterInfo?.().then(i => console.log('ADAPTER:', JSON.stringify(i))).catch(()=>{});
  `);

  console.log(`${ts()} goto...`);
  await page.goto('http://localhost:5173/juzu/?shot=valley_overview&tod=day&t=2&readback=1', { timeout: 30000 });
  try {
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
    console.log(`${ts()} shotReady=true`);
  } catch { console.log(`${ts()} shotReady TIMEOUT`); }

  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    errs: window.__errs || 0,
    readback: !!window.__frameDataURL,
    canvasW: document.querySelector('canvas')?.width,
    canvasH: document.querySelector('canvas')?.height
  })).catch(e => ({ evalErr: e.message }));
  console.log(`${ts()} state:`, JSON.stringify(state));

  // Canvas pixel probe: is the presented surface white (255) or empty (0/transparent)?
  const probe = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return 'no canvas';
    const g = c.getContext('2d') || c.getContext('webgpu');
    return 'contexts: webgpu=' + !!c.getContext('webgpu');
  }).catch(e => 'probe err: ' + e.message);
  console.log(`${ts()} ${probe}`);

  await browser.close();
}
run();
