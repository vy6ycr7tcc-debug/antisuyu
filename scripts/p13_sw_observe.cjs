// Minimal SW lifecycle observer on the preview build.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  const swLogs = [];
  page.on('console', m => { if (m.text().includes('SW')) swLogs.push(m.text()); });
  page.on('pageerror', e => swLogs.push('PAGEERROR: ' + e.message));
  await page.goto('http://127.0.0.1:3000/juzu/', { timeout: 45000 });
  await sleep(12000);
  const state = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/juzu/');
    if (!reg) return { reg: null };
    const w = reg.installing || reg.waiting || reg.active;
    const keys = await caches.keys();
    return {
      reg: { scope: reg.scope, installing: reg.installing ? reg.installing.state : null, waiting: reg.waiting ? reg.waiting.state : null, active: reg.active ? reg.active.state : null },
      caches: keys,
      controlled: !!navigator.serviceWorker.controller,
    };
  });
  console.log('SW console logs:', JSON.stringify(swLogs));
  console.log('STATE:', JSON.stringify(state, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
