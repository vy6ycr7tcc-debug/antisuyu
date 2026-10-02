// P5 diagnostic: what element sits at the G4 drag point, and what does the
// pointerdown event look like there? One-off probe, kept for the record.
const { chromium } = require('playwright');

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
  await page.goto('http://localhost:5173/juzu/?touch=1&turbo=1', { timeout: 45000 });
  await page.waitForSelector('#title-screen', { timeout: 30000 });
  await page.waitForTimeout(1500);

  // Tap through the title first (same as gate flow)
  const box = await page.locator('#press-to-begin').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  const nb = await page.locator('#btn-new-journey').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);

  // Install a capture-phase pointerdown recorder
  await page.evaluate(() => {
    window.__pd = [];
    window.addEventListener('pointerdown', (e) => {
      window.__pd.push({
        pointerType: e.pointerType,
        x: e.clientX, y: e.clientY,
        target: e.target.tagName + (e.target.id ? '#' + e.target.id : '') + (e.target.className && typeof e.target.className === 'string' ? '.' + e.target.className.split(' ').join('.') : ''),
        uiGuarded: !!(e.target.closest && e.target.closest('#ui-root, #touch-root, button, input, select, textarea, a')),
      });
    }, true);
  });

  const pts = [[300, 400], [300, 300], [250, 500], [200, 422], [80, 764], [50, 400]];
  for (const [x, y] of pts) {
    const hit = await page.evaluate(([px, py]) => {
      const e = document.elementFromPoint(px, py);
      return e ? `${e.tagName}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.split(' ').join('.') : ''}` : 'null';
    }, [x, y]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
    const rec = await page.evaluate(() => window.__pd[window.__pd.length - 1] || null);
    console.log(`(${x},${y})  elementFromPoint=${hit}   lastPointerDown=${JSON.stringify(rec)}`);
  }

  const pad = await page.evaluate(() => window.__touchDebug || null);
  console.log('touchDebug:', JSON.stringify(pad));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
