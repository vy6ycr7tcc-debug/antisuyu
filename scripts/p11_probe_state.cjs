// Probe the live scene state for a paititi shot: chunk count, region group
// children, renderer type, console errors — diagnose the blank-fog frames.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text().slice(0, 160)}`));
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message.slice(0, 200)}`));

  await page.goto('http://localhost:5173/juzu/?shot=region:pa_overview&readback=1', { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
  await page.waitForTimeout(700);

  const info = await page.evaluate(() => {
    const scene = window.__sceneProbe || null;
    // fall back: traverse from renderer
    const groups = [];
    let found = 0;
    window.__THREE_DEVTOOLS__; // noop
    // main.ts may expose nothing; count via scene ref if present
    return {
      hasSceneProbe: !!scene,
      rendererType: window.__rendererType || 'unknown',
    };
  });
  console.log('info:', JSON.stringify(info));
  const interesting = logs.filter(l => !l.includes('sw.js') && !l.includes('Download the React DevTools'));
  interesting.slice(0, 25).forEach(l => console.log(l));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
