// P14 playtest bisect: capture the spawn vantage (45,10) in shot mode with
// each atmosphere layer toggled off to identify which layer whites out.
// Usage: node scripts/p14_spawn_bisect.cjs [BASE]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://127.0.0.1:3000/juzu/';
const OUT = path.join(__dirname, '..', 'docs', 'verification', 'phase-14-playtest');
fs.mkdirSync(OUT, { recursive: true });

const VARIANTS = [
  { name: 'base',        q: '' },
  { name: 'no_mist',     q: '&nm=1' },
  { name: 'no_particles',q: '&np=1' },
  { name: 'no_vol',      q: '&nv=1' },
  { name: 'no_foam',     q: '&nf=1' },
  { name: 'no_charmaps', q: '&ncm=1' },
  { name: 'far_control', q: '', cx: 900, cz: 300 },
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
  const logs = [];
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

  for (const v of VARIANTS) {
    const cx = v.cx ?? 45, cz = v.cz ?? 10;
    const url = `${BASE}?shot=character_closeup&cx=${cx}&cz=${cz}&cd=6&ch=2.5&ly=1.5&t=2${v.q}`;
    try {
      await page.goto(url, { timeout: 30000 });
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
      await page.waitForTimeout(500);
      const file = path.join(OUT, `spawn_bisect_${v.name}.png`);
      await page.locator('canvas').screenshot({ path: file });
      // measure luminance in-node
      const { execSync } = require('child_process');
      const stats = execSync(`python3 -c "
from PIL import Image; import numpy as np
img = np.array(Image.open('${file}').convert('RGB'))
lum = img.mean(axis=2)
print(f'{(lum>250).mean()*100:.1f} {lum.mean():.1f}')
"`).toString().trim().split(' ');
      console.log(`spawn_bisect_${v.name}: near-white=${stats[0]}% meanLum=${stats[1]}`);
    } catch (e) {
      console.log(`spawn_bisect_${v.name}: FAILED ${e.message.slice(0, 120)}`);
    }
  }
  logs.slice(0, 5).forEach(l => console.log(l));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
