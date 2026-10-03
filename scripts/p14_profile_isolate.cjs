// P14 isolate: which browser-profile variable whites out the frame?
// A/B/C: (A) repo Playwright, NO GL flags, no touch (agent-browser-like)
//        (B) repo Playwright, GL flags, no touch
//        (C) repo Playwright, no GL flags, touch+mobile (gate-like)
// Usage: node scripts/p14_profile_isolate.cjs [BASE]
const { chromium } = require('playwright');
const path = require('path');
const { execSync } = require('child_process');

const BASE = process.argv[2] || 'http://127.0.0.1:3000/juzu/';
const OUT = path.join(__dirname, '..', 'docs', 'verification', 'phase-14-playtest');

const PROFILES = [
  { name: 'A_nogl_notouch', glFlags: false, touch: false },
  { name: 'B_gl_notouch',   glFlags: true,  touch: false },
  { name: 'C_nogl_touch',   glFlags: false, touch: true },
];

(async () => {
  for (const p of PROFILES) {
    const args = p.glFlags
      ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader']
      : [];
    const browser = await chromium.launch({ headless: true, args });
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: p.touch,
      hasTouch: p.touch,
    });
    const page = await ctx.newPage();
    if (p.touch) {
      await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
    }
    const logs = [];
    page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 140)); });
    page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message.slice(0, 140)}`));
    const url = `${BASE}?shot=character_closeup&cx=45&cz=10&cd=6&ch=2.5&ly=1.5&t=2`;
    try {
      await page.goto(url, { timeout: 30000 });
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
      await page.waitForTimeout(400);
      const info = await page.evaluate(() => ({
        renderer: window.__rendererType, tier: window.__currentQualityTier,
        gl: (() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); if (!g) return 'none'; const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'masked'; })(),
      }));
      const file = path.join(OUT, `isolate_${p.name}.png`);
      await page.locator('canvas').screenshot({ path: file });
      const stats = execSync(`python3 -c "
from PIL import Image; import numpy as np
img = np.array(Image.open('${file}').convert('RGB'))
lum = img.mean(axis=2)
print(f'{(lum>250).mean()*100:.1f} {lum.mean():.1f}')
"`).toString().trim().split(' ');
      console.log(`${p.name}: white=${stats[0]}% lum=${stats[1]} renderer=${info.renderer} tier=${info.tier} gl=${String(info.gl).slice(0,60)} errs=${logs.length}`);
      logs.slice(0, 2).forEach(l => console.log('   ' + l));
    } catch (e) {
      console.log(`${p.name}: FAILED ${e.message.slice(0, 100)}`);
    }
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
