// Probes the live atmosphere state on the sierra_dust vantage: gate flags,
// particle counts, position spread — finds why the field doesn't read.
const { chromium } = require('playwright');

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

  await page.goto(`http://localhost:5173/juzu/?shot=atmos_check&v=sierra_dust&quality=high&readback=1`, { timeout: 30000 });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });

  const state = await page.evaluate(() => {
    const d = window.__atmosDebug;
    if (!d) return { error: 'no __atmosDebug' };
    const probe = (p) => {
      const pos = p.geometry.attributes.position.array;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
      for (let i = 0; i < pos.length; i += 3) {
        minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
        minY = Math.min(minY, pos[i+1]); maxY = Math.max(maxY, pos[i+1]);
        minZ = Math.min(minZ, pos[i+2]); maxZ = Math.max(maxZ, pos[i+2]);
      }
      const cam = window.__camPos || null;
      return {
        visible: p.visible, count: pos.length / 3,
        spread: { minX: minX.toFixed(1), maxX: maxX.toFixed(1), minY: minY.toFixed(1), maxY: maxY.toFixed(1), minZ: minZ.toFixed(1), maxZ: maxZ.toFixed(1) },
      };
    };
    return { dust: probe(d.dust), pollen: probe(d.pollen), motes: probe(d.motes) };
  });
  console.log(JSON.stringify(state, null, 2));
  logs.filter(l => l.startsWith('error') || l.startsWith('PAGEERROR')).slice(0, 5).forEach(l => console.log(l.slice(0, 160)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
