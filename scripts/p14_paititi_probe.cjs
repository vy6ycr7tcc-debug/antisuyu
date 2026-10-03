// P14 paititi plaza probe: teleport to the plaza POI and capture what the
// golden city actually looks like in normal play.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:3000/juzu/';
const OUT = path.join(__dirname, '..', 'docs', 'verification', 'phase-14-playtest');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
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
  await sleep(1200);

  // plaza POI (1100,-50): teleport, then a second hop to zoom the camera in
  await page.evaluate(() => window.__testTeleport(1080, -50, Math.PI * 0.75));
  await sleep(4000);
  await shot('tour_paititi_plaza_close.png');
  console.log('plaza close captured');
  await page.evaluate(() => window.__testTeleport(1050, -80, Math.PI * 0.6));
  await sleep(4000);
  await shot('tour_paititi_plaza_mid.png');
  console.log('plaza mid captured');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
