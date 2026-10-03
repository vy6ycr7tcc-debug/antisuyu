// P-FRESH evidence captures on the NEW (local) build:
//   mobile title / spawn (dry bank, canon-dark costume) / after-walk
//   desktop spawn / after-walk (own try/catch — SwiftShader flake isolation)
// Usage: node scripts/p13_evidence.cjs [baseUrl]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:3000/juzu/';
const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let cdp = null;
const shot = async (page, name) => {
  if (!cdp) cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log(`shot shots/${name}`);
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });

  // ---------------- MOBILE ----------------
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const page = await ctx.newPage();
    await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
    page.on('pageerror', e => { if (!/popErrorScope/.test(e.message)) console.error('PAGEERROR:', e.message); });
    const cdp2 = await ctx.newCDPSession(page);
    const rawTap = async (sel) => {
      const b = await page.locator(sel).boundingBox();
      await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
      await sleep(80);
      await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    await page.goto(`${BASE}?touch=1&turbo=1`, { timeout: 45000 });
    await page.waitForSelector('#title-screen', { timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot(page, 'p13_new_mobile_title.png');
    await rawTap('#press-to-begin');
    await sleep(400);
    await rawTap('#btn-new-journey');
    await sleep(2500);

    const spawn = await page.evaluate(() => ({ ...(window.__playerDebug || {}), tier: window.__currentQualityTier }));
    console.log('MOBILE spawn:', JSON.stringify(spawn));
    await shot(page, 'p13_new_mobile_spawn.png');

    // ghost-text check on the DOM after journey start
    const ghost = await page.evaluate(() => {
      const ts = document.getElementById('title-screen');
      const c = ts ? getComputedStyle(ts) : null;
      return { cls: ts ? ts.className : null, visibility: c ? c.visibility : null, opacity: c ? c.opacity : null };
    });
    console.log('MOBILE title-after-start:', JSON.stringify(ghost));

    // joystick walk 3 s
    await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 700 }] });
    for (let i = 1; i <= 5; i++) { await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y: 700 - i * 12 }] }); await sleep(60); }
    for (let i = 0; i < 25; i++) { await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y: 640 }] }); await sleep(100); }
    await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await page.evaluate(() => window.__playerDebug);
    console.log('MOBILE after-walk:', JSON.stringify(after));
    await shot(page, 'p13_new_mobile_walk.png');
    await ctx.close();
  } catch (e) { console.error('MOBILE section failed:', e.message); }

  // ---------------- DESKTOP ----------------
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
      page.on('pageerror', e => { if (!/popErrorScope/.test(e.message)) console.error('PAGEERROR:', e.message); });

      await page.goto(BASE, { timeout: 45000 });
      await page.waitForSelector('#title-screen', { timeout: 30000 });
      await page.waitForTimeout(2500);
      await page.keyboard.press('Enter');
      await sleep(400);
      await page.click('#btn-new-journey');
      await sleep(2500);
      const spawn = await page.evaluate(() => ({ ...(window.__playerDebug || {}), tier: window.__currentQualityTier }));
      console.log('DESKTOP spawn:', JSON.stringify(spawn));
      await shot(page, 'p13_new_desktop_spawn.png');
      await page.keyboard.down('KeyW');
      await sleep(3000);
      await page.keyboard.up('KeyW');
      const walked = await page.evaluate(() => window.__playerDebug);
      console.log('DESKTOP after-walk:', JSON.stringify(walked));
      await shot(page, 'p13_new_desktop_walk.png');
      await ctx.close();
      break;
    } catch (e) { console.error(`DESKTOP attempt ${attempt} failed:`, e.message); }
  }

  await browser.close();
  console.log('DONE');
})();
