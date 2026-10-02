// P-MOBILE functional gate runner (docs/plans/phase-5-mobile-controls.md §P5.3).
// iPhone 14 geometry (390×844 @ dpr 3), touch-capable context, WebGL2
// SwiftShader (navigator.gpu undefined — same headless discipline as p2–p4).
// Drives the REAL game: title → New Journey → joystick → camera drag → pause,
// with CDP touch synthesis, and writes scripts/p5_results.json.
//
// Usage: node scripts/p5_mobile_play.cjs [baseUrl]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5173/juzu/';
const URL = `${BASE}?touch=1&turbo=1`;
const OUT_JSON = path.join(__dirname, 'p5_results.json');
const OUT_SHOTS = path.join(__dirname, '..', 'docs', 'verification', 'phase-5');
fs.mkdirSync(OUT_SHOTS, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// CDP screenshot: page.screenshot() waits for a stable frame, which never
// arrives on a continuously animating canvas — capture raw instead (this
// includes the HTML UI overlay: joystick, HUD, pause menu).
let pageCdp = null;
const shot = async (page, filepath) => {
  if (!pageCdp) pageCdp = await page.context().newCDPSession(page);
  const { data } = await pageCdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
};

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    // dpr 1 for the FUNCTIONAL run: gates measure CSS-px geometry, input
    // routing and sim behavior — identical at any dpr — while SwiftShader
    // fill rate bounds the frame rate (dt clamps to 0.1 s/rAF, so a slow
    // frame starves the sim clock). The dpr-3 visual reference lives in
    // p5_world_regr.cjs (single-frame capture, no simulation needed).
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);

  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));

  const gates = [];
  const gate = (name, pass, detail) => {
    gates.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
  };

  const sample = () => page.evaluate(() => ({
    ...(window.__playerDebug || {}),
    tier: window.__currentQualityTier || null,
    fps: window.__frameStats ? window.__frameStats.fps : null,
  }));

  // CDP touch helpers (CSS px)
  const cdp = await ctx.newCDPSession(page);
  const touchStart = (pts) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
  const touchMove = (pts) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts });
  const touchEnd = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Single-point gesture: start at (x,y), glide to (x+dx, y+dy) in `steps`.
  const drag = async (x, y, dx, dy, steps = 5, dwell = 30) => {
    await touchStart([{ x, y }]);
    for (let i = 1; i <= steps; i++) {
      await touchMove([{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }]);
      await sleep(dwell);
    }
  };
  // Raw finger tap on an element's center. locator.tap() retries its
  // actionability loop after the event lands — and game UI elements often
  // disappear when tapped (title gate, pause menu) — so game taps go raw.
  const rawTap = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`no bounding box for ${selector}`);
    await touchStart([{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]);
    await sleep(70);
    await touchEnd();
  };

  // Frame-synchronous probing: rAF-resolved evaluates give deterministic
  // ordering — input tasks run at frame boundaries, so "dispatch → wait one
  // frame → read" is exact regardless of SwiftShader's frame duration.
  const nextFrame = () => page.evaluate(() => new Promise(res => requestAnimationFrame(() => res())));

  console.log(`goto ${URL}`);
  await page.goto(URL, { timeout: 45000 });
  await page.waitForSelector('#title-screen', { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('app')?.querySelector('canvas'), { timeout: 30000 });
  await page.waitForTimeout(2500); // let the first frames settle

  const tier0 = (await sample()).tier;
  console.log(`initial tier: ${tier0}`);

  // ------------------------------------------------ G1: title gate by touch
  await shot(page, path.join(OUT_SHOTS, 'p5_title_touch.png'));
  const g1t0 = Date.now();
  await rawTap('#press-to-begin');
  let g1frames = null;
  for (let i = 1; i <= 8; i++) {
    await nextFrame();
    const visible = await page.evaluate(() => {
      const el = document.getElementById('title-menu-list');
      return !!el && getComputedStyle(el).display === 'flex';
    });
    if (visible) { g1frames = i; break; }
  }
  gate('G1_title_touch', g1frames !== null, { revealedWithinFrames: g1frames, wallMs: Date.now() - g1t0, criterion: 'menu list reveals within 8 rendered frames of the tap (frame-synced; wall clock inflated only by SwiftShader)', });

  // ------------------------------------------------ G2: journey start
  await rawTap('#btn-new-journey');
  await page.waitForTimeout(600);
  const g2 = await page.evaluate(() => {
    const title = document.getElementById('title-screen');
    const hud = document.getElementById('hud-overlay');
    const pause = document.getElementById('btn-touch-pause');
    return {
      titleHidden: !!title && title.classList.contains('hidden'),
      hudVisible: !!hud && getComputedStyle(hud).display === 'flex',
      pauseVisible: !!pause && getComputedStyle(pause).display === 'block',
    };
  });
  gate('G2_journey_start', g2.titleHidden && g2.hudVisible && g2.pauseVisible, g2);

  // --------------------------------- G3 prep: walk out of the river channel
  // The journey starts at (0,0) — the river crossing (state may be SWIM).
  // Hold full +x deflection until WALK and x >= 25 (east bank, outside the
  // |x|<22 river influence). SwiftShader frames are slow and dt is clamped
  // to 0.1 s per rAF, so sim time runs behind wall time — budget is generous.
  await touchStart([{ x: 80, y: 764 }]);
  await sleep(80);
  await touchMove([{ x: 130, y: 764 }]); // dx +50 = full deflection → +x
  const stabT0 = Date.now();
  let stable = false;
  while (Date.now() - stabT0 < 45000) {
    const s = await sample();
    if (s.state === 'WALK' && s.x >= 25) { stable = true; break; }
    await sleep(200);
  }
  await touchEnd();
  const startPos = await sample();
  console.log(`stabilized=${stable} pos=(${startPos.x?.toFixed(1)},${startPos.z?.toFixed(1)}) state=${startPos.state}`);
  await sleep(500);

  // ------------------------------------------------ G3: analog joystick move
  // Full deflection (50 px = max radius) up-screen → run band.
  const full = { maxDisp: 0, maxSpeed: 0 };
  {
    await touchStart([{ x: 80, y: 764 }]);
    await sleep(80);
    await touchMove([{ x: 80, y: 714 }]);
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) {
      const s = await sample();
      if (typeof s.x === 'number' && typeof startPos.x === 'number') {
        const d = Math.hypot(s.x - startPos.x, s.z - startPos.z);
        full.maxDisp = Math.max(full.maxDisp, d);
        full.maxSpeed = Math.max(full.maxSpeed, s.speed || 0);
      }
      const td = await page.evaluate(() => window.__touchDebug ? window.__touchDebug.mag : null);
      if (typeof td === 'number') full.stickMag = Math.max(full.stickMag || 0, td);
      if (Date.now() - t0 > 1200 && !full.shot) {
        full.shot = true;
        await shot(page, path.join(OUT_SHOTS, 'p5_joystick_engaged.png'));
      }
      await sleep(150);
    }
    await touchEnd();
  }
  await sleep(700); // decelerate

  // Half deflection (25 px) → must stay in the walk band.
  const half = { maxSpeed: 0 };
  {
    await touchStart([{ x: 80, y: 764 }]);
    await sleep(80);
    await touchMove([{ x: 80, y: 739 }]);
    await sleep(2500);
    const t0 = Date.now();
    while (Date.now() - t0 < 1500) {
      const s = await sample();
      half.maxSpeed = Math.max(half.maxSpeed, s.speed || 0);
      await sleep(120);
    }
    await touchEnd();
  }
  gate('G3_analog_move', stable && full.maxDisp >= 3 && full.maxSpeed >= 4.5 && half.maxSpeed <= 2.3, {
    stabilized: stable, fullDeflection: { maxDisplacement_m: +full.maxDisp.toFixed(2), maxSpeed: +full.maxSpeed.toFixed(2) },
    halfDeflection: { maxSpeed: +half.maxSpeed.toFixed(2) },
    stickDelivery: full.stickMag ?? null,
    criterion: 'disp >= 3 m, full-speed >= 4.5 (run band), half-speed <= 2.3 (walk band)',
  });
  await sleep(500);

  // ------------------------------------------------ G4: camera drag (idle stick)
  await nextFrame();
  const th0 = (await sample()).theta;
  // Frame-synced delivery forensics: claim → frame → read; move → frame →
  // read accumulation before the next frame's sub-steps consume it.
  await touchStart([{ x: 300, y: 400 }]);
  await nextFrame();
  const claim = await page.evaluate(() => window.__touchDebug ? window.__touchDebug.right : 'no-hook');
  for (let i = 1; i <= 5; i++) {
    await touchMove([{ x: 300 - 40 * i, y: 400 }]);
  }
  const accumulated = await page.evaluate(() => window.__touchDebug ? window.__touchDebug.camX : null);
  await touchEnd();
  // The accumulated delta is consumed by the next frame's character.update.
  let th1 = th0;
  for (let i = 0; i < 4; i++) {
    await nextFrame();
    th1 = (await sample()).theta;
    if (Math.abs(th1 - th0) >= 0.3) break;
  }
  const dTheta = Math.abs(th1 - th0);
  gate('G4_camera_drag', dTheta >= 0.3, { theta0: +th0.toFixed(3), theta1: +th1.toFixed(3), dTheta: +dTheta.toFixed(3), rightPointerClaimed: claim, accumulatedCamX: accumulated, criterion: '|dTheta| >= 0.3 rad with stick idle (200 px drag)' });

  // ------------------------------------------------ G5: pause via touch
  await rawTap('#btn-touch-pause');
  let opened = false;
  for (let i = 0; i < 10 && !opened; i++) {
    opened = await page.evaluate(() => document.getElementById('pause-menu')?.classList.contains('visible') || false);
    if (!opened) await sleep(100);
  }
  if (opened) await shot(page, path.join(OUT_SHOTS, 'p5_pause_open.png'));
  await rawTap('#btn-resume');
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => {
    const m = document.getElementById('pause-menu');
    return !!m && m.classList.contains('hidden') && !m.classList.contains('visible');
  });
  const joyClean = await page.evaluate(() => {
    const b = document.getElementById('touch-joystick-base');
    return !!b && b.classList.contains('resting') && !b.style.left;
  });
  gate('G5_pause_touch', opened && closed && joyClean, { opened, closed, joystickReleased: joyClean });

  // ------------------------------------------------ G7: tier governor smoke (15 s)
  const fpsSeries = [];
  const tierSeries = [];
  for (let i = 0; i < 15; i++) {
    const s = await sample();
    fpsSeries.push(s.fps);
    tierSeries.push(s.tier);
    await sleep(1000);
  }
  const tierLast = tierSeries[tierSeries.length - 1];
  const fpsMean = fpsSeries.filter(f => typeof f === 'number').reduce((a, b) => a + b, 0) / Math.max(1, fpsSeries.filter(f => typeof f === 'number').length);
  // G7 gates the F9 fix (touch device must START at MEDIUM). The governor's
  // response is recorded as evidence only: at ~1 fps headless the designed
  // degradation (MEDIUM→LOW after 75 slow frames) is CORRECT behavior — a
  // real iPhone at 30 fps never approaches that threshold.
  gate('G7_tier_governor', tier0 === 'MEDIUM', {
    tierStart: tier0, tierEnd: tierLast, tierSeries: [...new Set(tierSeries)],
    headlessFpsMean: +fpsMean.toFixed(1),
    criterion: 'touch device starts at MEDIUM (F9); governor series recorded as evidence — SwiftShader fps is not an on-device claim',
  });

  // ------------------------------------------------ G8: safe-area hit targets
  const g8 = await page.evaluate(() => {
    const p = document.getElementById('btn-touch-pause');
    const j = document.getElementById('touch-joystick-base');
    const pr = p.getBoundingClientRect();
    const jr = j.getBoundingClientRect();
    return {
      pause: { w: +pr.width.toFixed(1), h: +pr.height.toFixed(1), top: +pr.top.toFixed(1), right: +(window.innerWidth - pr.right).toFixed(1) },
      joy: { w: +jr.width.toFixed(1), h: +jr.height.toFixed(1), left: +jr.left.toFixed(1), bottom: +(window.innerHeight - jr.bottom).toFixed(1), visible: getComputedStyle(j).display !== 'none' },
    };
  });
  const g8pass = g8.pause.w >= 44 && g8.pause.h >= 44 && g8.joy.left >= 24 && g8.joy.bottom >= 24 && g8.joy.visible;
  gate('G8_safearea_hittargets', g8pass, { ...g8, criterion: 'pause >= 44x44, joystick inset >= 24px left/bottom, visible' });

  // ------------------------------------------------ G6: render health (whole session)
  // Exemptions: the pre-existing dev-only service-worker artifact (commit
  // 9f1f91c) — in dev the sw.js request serves index.html, and the error
  // text mentions neither sw.js nor the file path, hence the MIME clause.
  const errs = logs.filter(l => (l.startsWith('error:') || l.startsWith('PAGEERROR'))
    && !l.includes('sw.js')
    && !(l.includes("MIME type ('text/html')")));
  const health = await page.evaluate(() => ({ ktx2: window.__ktx2Supported, renderer: window.__rendererType }));
  gate('G6_render_health', errs.length === 0 && health.ktx2 === true && health.renderer === 'webgl2', {
    errors: errs.slice(0, 3), ktx2: health.ktx2, renderer: health.renderer,
    exemption: 'pre-existing dev-only sw.js MIME artifact (documented Phase 2) — production build serves the real worker',
  });

  // Visibility release sanity (F7): hide the tab, confirm vectors wipe.
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { value: true, configurable: true }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await sleep(300);
  const afterHide = await page.evaluate(() => {
    const b = document.getElementById('touch-joystick-base');
    return { resting: b.classList.contains('resting'), titleWasPaused: !window.__frameStats || true };
  });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  gates.push({ name: 'EXTRA_visibility_release', pass: afterHide.resting, detail: afterHide });
  console.log(`${afterHide.resting ? 'PASS' : 'FAIL'}  EXTRA_visibility_release  ${JSON.stringify(afterHide)}`);

  await browser.close();

  const results = {
    timestamp: new Date().toISOString(),
    url: URL,
    viewport: '390x844@1x touch (iPhone 14 geometry), WebGL2 SwiftShader headless',
    gates,
    fpsSeries: fpsSeries.map(f => (typeof f === 'number' ? +f.toFixed(1) : null)),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  const failed = gates.filter(g => !g.pass);
  console.log(`\n${gates.length - failed.length}/${gates.length} gates PASS → ${OUT_JSON}`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
