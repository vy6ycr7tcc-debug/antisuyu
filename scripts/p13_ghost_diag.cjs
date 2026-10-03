// P-FRESH DOM diagnostic: why does the title menu text ghost over gameplay
// on the live build after New Journey?
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  await page.goto('https://vy6ycr7tcc-debug.github.io/juzu/?touch=1&turbo=1', { timeout: 45000 });
  await page.waitForSelector('#title-screen', { timeout: 30000 });
  await page.waitForTimeout(2000);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await page.waitForTimeout(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await tap('#press-to-begin');
  await page.waitForTimeout(300);
  await tap('#btn-new-journey');
  await page.waitForTimeout(2500);

  const diag = await page.evaluate(() => {
    const ts = document.getElementById('title-screen');
    const ml = document.getElementById('title-menu-list');
    const cs = (el) => {
      if (!el) return null;
      const c = getComputedStyle(el);
      return { display: c.display, visibility: c.visibility, opacity: c.opacity, cls: el.className };
    };
    // who renders "NEW JOURNEY"?
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.textContent && n.textContent.includes('NEW JOURNEY')) {
        const el = n.parentElement;
        const chain = [];
        let p = el;
        while (p && p !== document.body) { chain.push(`${p.id ? '#' + p.id : ''}${p.className && typeof p.className === 'string' ? '.' + p.className.split(' ').join('.') : ''}`); p = p.parentElement; }
        const c = getComputedStyle(el);
        hits.push({ chain: chain.reverse(), vis: c.visibility, disp: c.display, op: c.opacity });
      }
    }
    // what's hit-testable at the ghost text location?
    const btn = document.getElementById('btn-new-journey');
    const r = btn ? btn.getBoundingClientRect() : null;
    const hitEl = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      titleScreen: cs(ts),
      menuList: cs(ml),
      textHits: hits,
      hitTestAtButton: hitEl ? `${hitEl.tagName}${hitEl.id ? '#' + hitEl.id : ''}` : null,
      btnRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    };
  });
  console.log(JSON.stringify(diag, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
