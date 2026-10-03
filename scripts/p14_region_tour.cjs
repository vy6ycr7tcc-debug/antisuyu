// P14 region tour — lean pass: boot, skip probes, teleport the 6 stops with
// short settles, CDP screenshots. Complements p14_play_session.cjs (which
// captured title/spawn/run/look before its wall-clock budget ran out).
// Usage: node scripts/p14_region_tour.cjs [BASE]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://127.0.0.1:3000/juzu/';
const OUT = path.join(__dirname, '..', 'docs', 'verification', 'phase-14-playtest');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  };
  const touchStart = (pts) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
  const touchEnd = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const rawTap = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`no box for ${selector}`);
    await touchStart([{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]);
    await sleep(80); await touchEnd();
  };

  await page.goto(`${BASE}?touch=1&turbo=1`, { timeout: 45000 });
  await page.waitForSelector('#title-screen', { timeout: 30000 });
  await page.waitForTimeout(2500);
  await rawTap('#press-to-begin');
  await sleep(1000);
  await rawTap('button:has-text("New Journey")');
  await page.waitForFunction(() => window.__playerDebug && typeof window.__playerDebug.x === 'number', { timeout: 40000 });
  await sleep(1500);

  const STOPS = [
    { name: 'pause_menu',            skipTeleport: true },
    { name: 'cloud_forest_blockade', x: -100, z: -500 },
    { name: 'jungle_serpents_path',  x: 100,  z: -800 },
    { name: 'high_sierra_marker',    x: 100,  z: 600 },
    { name: 'paititi_outer_terraces',x: 900,  z: -100 },
    { name: 'paititi_plaza',         x: 1100, z: 50 },
  ];
  for (const s of STOPS) {
    if (s.skipTeleport) {
      // pause menu capture: tap MENU, shoot, resume
      const menu = await page.locator('button:has-text("MENU")').first().boundingBox().catch(() => null);
      if (menu) {
        await touchStart([{ x: menu.x + menu.width / 2, y: menu.y + menu.height / 2 }]);
        await sleep(80); await touchEnd();
        await sleep(800);
        await shot(`tour_${s.name}.png`);
        const resume = await page.locator('button:has-text("Resume")').first().boundingBox().catch(() => null);
        if (resume) {
          await touchStart([{ x: resume.x + resume.width / 2, y: resume.y + resume.height / 2 }]);
          await sleep(80); await touchEnd();
          await sleep(400);
        }
        console.log(`stop ${s.name}: captured`);
      }
      continue;
    }
    await page.evaluate(([x, z]) => window.__testTeleport(x, z, Math.PI), [s.x, s.z]);
    await sleep(3000);
    const p = await page.evaluate(() => ({
      x: +window.__playerDebug.x, z: +window.__playerDebug.z, state: window.__playerDebug.state,
    }));
    await shot(`tour_${s.name}.png`);
    console.log(`stop ${s.name}: pos=(${p.x},${p.z}) state=${p.state}`);
  }
  console.log('TOUR DONE');
  await browser.close();
})().catch(e => { console.error('TOUR FAILED:', e.message); process.exit(1); });
