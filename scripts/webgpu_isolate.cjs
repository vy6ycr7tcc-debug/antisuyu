// Isolate WebGPU device-loss trigger: with/without post pipeline.
const { chromium } = require('playwright');

const URLS = [
  ['post+readback', 'http://localhost:5173/juzu/?shot=valley_overview&tod=day&t=2&readback=1'],
  ['skipPost+readback', 'http://localhost:5173/juzu/?shot=valley_overview&tod=day&t=2&readback=1&tv=1']
];

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const t0 = Date.now();
  const ts = () => `+${((Date.now() - t0) / 1000).toFixed(2)}s`;

  for (const [label, url] of URLS) {
    const logs = [];
    const handler = m => logs.push(`${m.type()}: ${m.text()}`);
    const perr = e => logs.push(`PAGEERROR: ${e.message}`);
    page.on('console', handler);
    page.on('pageerror', perr);
    process.stdout.write(`\n=== ${label} ===\n`);
    try {
      await page.goto(url, { timeout: 30000 });
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => ({ rb: !!window.__frameDataURL }));
      const deviceLost = logs.filter(l => l.includes('Device Lost')).length > 0;
      console.log(`${ts()} shotReady ok, deviceLost=${deviceLost}, readback=${state.rb}`);
      if (state.rb) {
        const dataUrl = await page.evaluate(() => window.__frameDataURL);
        require('fs').writeFileSync(
          require('path').join(__dirname, '..', 'shots', `probe_${label.replace(/[^a-z]/gi, '_')}.png`),
          Buffer.from(dataUrl.split(',')[1], 'base64'));
        console.log(`${ts()} readback saved`);
      }
      logs.filter(l => l.startsWith('error') || l.startsWith('PAGEERROR')).slice(0, 4)
        .forEach(l => console.log('   ' + l.slice(0, 150)));
    } catch (e) {
      console.log(`${ts()} FAILED: ${String(e).slice(0, 100)}`);
    }
    page.off('console', handler);
    page.off('pageerror', perr);
  }
  await browser.close();
}
run();
