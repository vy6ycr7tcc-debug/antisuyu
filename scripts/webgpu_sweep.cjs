// A/B: baseline vs current code under identical capture; plus flag sweep.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const FLAG_SETS = {
  vulkan: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  noVulkan: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader'],
  vulkanNoSandbox: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox']
};

async function trial(browser, label, flags, viewport) {
  const page = await browser.newPage({ viewport });
  let deviceLost = false, adapter = '?', ready = false;
  page.on('console', m => {
    const t = m.text();
    if (t.includes('Device Lost')) deviceLost = true;
  });
  try {
    await page.goto('http://localhost:5173/juzu/?shot=valley_overview&tod=day&t=2&readback=1', { timeout: 30000 });
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
    ready = true;
    adapter = await page.evaluate(async () => {
      try { const a = await navigator.gpu.requestAdapter(); const i = await a.requestAdapterInfo?.(); return i?.vendor + '/' + i?.architecture || 'ok'; } catch { return 'err'; }
    });
    const rb = await page.evaluate(() => !!window.__frameDataURL);
    const vp = `${viewport.width}x${viewport.height}`;
    await page.locator('canvas').screenshot({ path: path.join(OUT, `sweep_${label}.png`) });
    console.log(`${label.padEnd(28)} ready=${ready} deviceLost=${deviceLost} readback=${rb} adapter=${adapter} [${vp}]`);
  } catch (e) {
    console.log(`${label.padEnd(28)} ready=${ready} deviceLost=${deviceLost} FAILED ${String(e).slice(0, 60)}`);
  }
  await page.close();
}

async function run() {
  const variant = process.argv[2] || 'current';
  const vpSmall = { width: 640, height: 400 };
  const vpGate = { width: 1280, height: 800 };

  for (const [name, flags] of Object.entries(FLAG_SETS)) {
    const browser = await chromium.launch({ headless: true, args: flags });
    await trial(browser, `${variant}_${name}_small`, flags, vpSmall);
    await trial(browser, `${variant}_${name}_gate`, flags, vpGate);
    await browser.close();
  }
}
run();
