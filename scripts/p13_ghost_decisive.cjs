// P-FRESH ghost-text decisive experiment: at ONE instant, capture
//  (a) CDP screenshot pixels, (b) full DOM text-node inventory, (c) computed
//  styles, (d) the canvas BITMAP pixels at the ghost-text location.
// If DOM is hidden but pixels show text: compositor artifact. If the canvas
// bitmap itself contains the text: baked into GL (would mean DOM overlay
// leaked into the GL frame — different bug class).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:3000/juzu/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  await page.goto(`${BASE}?touch=1&turbo=1`, { timeout: 45000 });
  await page.waitForSelector('#title-screen', { timeout: 30000 });
  await page.waitForTimeout(2000);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await sleep(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await tap('#press-to-begin');
  await sleep(300);
  await tap('#btn-new-journey');
  await sleep(2500);

  // Same-instant: screenshot + DOM inventory
  const [shotData, dom] = await Promise.all([
    cdp.send('Page.captureScreenshot', { format: 'png' }),
    page.evaluate(() => {
      const ts = document.getElementById('title-screen');
      const c = ts ? getComputedStyle(ts) : null;
      const texts = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const t = w.currentNode.textContent.trim();
        if (t === 'NEW JOURNEY' || t === 'SETTINGS' || t === 'CONTINUE') texts.push(t);
      }
      // canvas bitmap probe: read pixels where the ghost text would be
      // (button rect was ~x101-289, y421-460 for NEW JOURNEY)
      const cv = document.querySelector('#app canvas');
      let canvasProbe = null;
      if (cv) {
        try {
          const off = document.createElement('canvas');
          off.width = cv.width; off.height = cv.height;
          const octx = off.getContext('2d');
          octx.drawImage(cv, 0, 0);
          const rect = cv.getBoundingClientRect();
          const sx = Math.round((150 / rect.width) * cv.width);
          const sy = Math.round((440 / rect.height) * cv.height);
          const px = octx.getImageData(sx - 40, sy - 10, 80, 20).data;
          let bright = 0;
          for (let i = 0; i < px.length; i += 4) {
            const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
            if (l > 150) bright++;
          }
          canvasProbe = { brightPixelsIn80x20: bright, total: px.length / 4 };
        } catch (e) { canvasProbe = { error: e.message }; }
      }
      return {
        titleCls: ts ? ts.className : null,
        titleVis: c ? c.visibility : null,
        titleOp: c ? c.opacity : null,
        textNodesFound: texts,
        canvasProbe,
      };
    }),
  ]);

  fs.writeFileSync('shots/p13_ghost_same_instant.png', Buffer.from(shotData.data, 'base64'));
  console.log(JSON.stringify(dom, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
