// P14 region stills (shot mode, single-frame — fast). Complements the
// in-game tour: jungle / paititi / sierra / river at day, mobile viewport.
// Usage: node scripts/p14_region_stills.cjs [BASE]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://127.0.0.1:3000/juzu/';
const OUT = path.join(__dirname, '..', 'docs', 'verification', 'phase-14-playtest');
const STOPS = [
  { name: 'jungle_lowlands', q: 'shot=terrain_check&v=jungle&tod=day&t=2' },
  { name: 'paititi',         q: 'shot=terrain_check&v=paititi&tod=day&t=2' },
  { name: 'high_sierra',     q: 'shot=terrain_check&v=sierra&tod=day&t=2' },
  { name: 'river_valley',    q: 'shot=terrain_check&v=river&tod=day&t=2' },
  { name: 'snowline_dawn',   q: 'shot=terrain_check&v=snowline&tod=dawn&t=2' },
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  const cdp = await ctx.newCDPSession(page);
  for (const s of STOPS) {
    try {
      await page.goto(`${BASE}?${s.q}`, { timeout: 30000 });
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 30000 });
      await page.waitForTimeout(400);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `still_${s.name}.png`), Buffer.from(data, 'base64'));
      console.log(`still_${s.name}: captured`);
    } catch (e) {
      console.log(`still_${s.name}: FAILED ${e.message.slice(0, 90)}`);
    }
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
