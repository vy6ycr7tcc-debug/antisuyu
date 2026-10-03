// P-FRESH functional gates (headless WebGL2 SwiftShader, iPhone geometry):
//   G1_spawn_dry   — boot spawn lands WALK on dry ground at (45,10)
//   G2_spawn_walk  — joystick walk works FROM the new spawn (displacement)
//   G3_sw_fresh    — SW active with build-stamped caches; no legacy trap
//                    cache; navigation fetch returns the live index.html
//                    (network-first proof) containing the loaded bundle name
// Usage: node scripts/p13_gates.cjs [baseUrl]
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:3000/juzu/';
const URL = `${BASE}?touch=1&turbo=1`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
  const errors = [];
  page.on('pageerror', e => { if (!/popErrorScope/.test(e.message)) errors.push(e.message); });

  // Watchdog: never hang the whole run — abort with diagnostics.
  const kick = setTimeout(() => { console.error('WATCHDOG: 240 s exceeded, aborting'); process.exit(2); }, 240000);
  const mark = (m) => console.log(`[stage] ${m} +${Math.round(process.uptime())}s`);

  await page.goto(URL, { timeout: 45000 });
  mark('goto done');
  await page.waitForSelector('#title-screen', { timeout: 30000 });
  await page.waitForTimeout(2000);
  mark('title ready');

  const cdp = await ctx.newCDPSession(page);
  const rawTap = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await sleep(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await rawTap('#press-to-begin');
  await sleep(300);
  mark('gate tapped');
  await rawTap('#btn-new-journey');
  mark('journey tapped');

  // Frame-synchronous settle (bounded — a stalled rAF must not hang the run)
  const nextFrame = () => Promise.race([
    page.evaluate(() => new Promise(res => requestAnimationFrame(() => res()))),
    sleep(4000),
  ]);
  let spawn = null;
  for (let i = 0; i < 6; i++) {
    await nextFrame();
    const s = await page.evaluate(() => ({ ...(window.__playerDebug || {}) }));
    if (s.state === 'WALK') { spawn = s; break; }
    spawn = s;
  }
  mark('spawn sampled');
  const g1pass = spawn && spawn.state === 'WALK' && Math.abs(spawn.x - 45) < 2 && Math.abs(spawn.z - 10) < 2;
  console.log(`${g1pass ? 'PASS' : 'FAIL'}  G1_spawn_dry  ${JSON.stringify({ ...spawn, criterion: 'state WALK within 6 frames at (45,10) ±2 — no SWIM, no drift' } || {})}`);

  // G3 (run BEFORE the heavy walk loop — a stalled SwiftShader renderer after
  // 40+ s of turbo sim can starve the evaluate; the SW check wants a quiet
  // page): service worker freshness. Hard-bounded in-page so a starved
  // evaluate returns partial diagnostics instead of hanging the run.
  const sw = await Promise.race([
    page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready.catch(() => null);
    for (let i = 0; i < 40; i++) {
      const keys = await caches.keys();
      const juzu = keys.filter(k => k.startsWith('juzu-'));
      if (ready && ready.active && juzu.length >= 2) {
        // network-first proof: fetch the navigation through the SW and confirm
        // it returns an index.html whose bundle reference matches the one loaded
        const loaded = [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).find(s => s.includes('main-'));
        const text = await fetch('/juzu/', { cache: 'reload' }).then(r => r.text());
        const m = text.match(/main-[A-Za-z0-9_-]+\.js/);
        return {
          state: ready.active.state,
          caches: juzu,
          legacyTrap: keys.includes('juzu-cache-v1'),
          navBundle: m ? m[0] : null,
          loadedBundle: loaded ? loaded.split('/').pop() : null,
        };
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return { state: (ready && ready.active ? ready.active.state : 'none'), caches: (await caches.keys()).filter(k => k.startsWith('juzu-')), legacyTrap: (await caches.keys()).includes('juzu-cache-v1'), navBundle: null, loadedBundle: null };
    }),
    // Bounded: 45 s in-page budget — partial diagnostics instead of a hang.
    new Promise(res => setTimeout(() => res({ state: 'evaluate-timeout', caches: [], legacyTrap: null, navBundle: null, loadedBundle: null }), 45000)),
  ]);
  const g3pass = sw.state === 'activated'
    && sw.caches.length >= 2
    && sw.caches.every(c => /^juzu-(shell|assets)-v-\d+$/.test(c))
    && !sw.legacyTrap
    && sw.navBundle && sw.loadedBundle && sw.navBundle === sw.loadedBundle;
  console.log(`${g3pass ? 'PASS' : 'FAIL'}  G3_sw_fresh  ${JSON.stringify({ ...sw, criterion: 'SW activated; only build-stamped juzu-* caches; navigation fetch serves the live bundle' })}`);

  // G2 (last — heaviest): joystick walk from spawn — hold full up deflection
  const x0 = spawn.x, z0 = spawn.z;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 700 }] });
  for (let i = 1; i <= 4; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y: 700 - i * 12 }] }); await sleep(50); }
  for (let i = 0; i < 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y: 652 }] }); await sleep(100); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await nextFrame();
  mark('walk sampled');
  const after = await page.evaluate(() => ({ ...(window.__playerDebug || {}) }));
  const disp = Math.hypot(after.x - x0, after.z - z0);
  const g2pass = disp >= 3 && after.state === 'WALK';
  console.log(`${g2pass ? 'PASS' : 'FAIL'}  G2_spawn_walk  ${JSON.stringify({ displacement_m: +disp.toFixed(2), endState: after.state, criterion: '>= 3 m displacement from spawn, still WALK' })}`);

  console.log(`pageerrors: ${errors.length}${errors.length ? ' -> ' + errors[0] : ''}`);
  clearTimeout(kick);
  await browser.close();
  const all = g1pass && g2pass && g3pass && errors.length === 0;
  console.log('OVERALL', all ? 'PASS' : 'FAIL');
  process.exit(all ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
