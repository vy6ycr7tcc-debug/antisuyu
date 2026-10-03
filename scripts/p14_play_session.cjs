// P14 guided play session — "play the game yourself" (owner request).
// Drives the REAL game end-to-end on the touch profile and captures a
// screenshot tour: title → menu → spawn → joystick run → camera look →
// pause menu resume → teleport tour of the four regions.
// Usage: node scripts/p14_play_session.cjs [BASE]
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
  const logs = [];
  page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));

  // CDP touch helpers (proven in p5_mobile_play.cjs)
  const cdp = await ctx.newCDPSession(page);
  const touchStart = (pts) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
  const touchMove = (pts) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts });
  const touchEnd = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const drag = async (x, y, dx, dy, steps = 6, dwell = 40) => {
    await touchStart([{ x, y }]);
    for (let i = 1; i <= steps; i++) {
      await touchMove([{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }]);
      await sleep(dwell);
    }
  };
  const rawTap = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`no bounding box for ${selector}`);
    await touchStart([{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]);
    await sleep(80);
    await touchEnd();
  };
  // CDP captureScreenshot: Playwright's locator screenshot waits for layout
  // stability, which never happens on an animating canvas (Task 5 lesson).
  let pageCdp = null;
  const shot = async (name) => {
    if (!pageCdp) pageCdp = await ctx.newCDPSession(page);
    const { data } = await pageCdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  };
  const player = () => page.evaluate(() => {
    const p = window.__playerDebug || {};
    return {
      x: +p.x, z: +p.z, y: +p.y, speed: +p.speed, state: p.state,
      tier: window.__currentQualityTier || null, fps: window.__frameStats?.fps ?? null,
    };
  });
  const teleport = (x, z) => page.evaluate(([x, z]) => window.__testTeleport(x, z, Math.PI), [x, z]);

  const session = { steps: [], errors: logs };

  // ---------------------------------------------------------------- boot
  const URL = `${BASE}?touch=1&turbo=1`;
  console.log(`goto ${URL}`);
  await page.goto(URL, { timeout: 45000 });
  await page.waitForSelector('#title-screen', { timeout: 30000 });
  await page.waitForTimeout(3000);
  await shot('play_01_title.png');
  session.steps.push({ step: 'title', shot: 'play_01_title.png' });

  // ------------------------------------------------------- enter the world
  await rawTap('#press-to-begin');           // TAP TO BEGIN gate
  await sleep(1200);
  const njBox = await page.locator('button', { hasText: /New Journey/i }).first().boundingBox().catch(() => null);
  if (njBox) {
    await touchStart([{ x: njBox.x + njBox.width / 2, y: njBox.y + njBox.height / 2 }]);
    await sleep(80); await touchEnd();
  }
  // world boot: wait until the player probe exists and sim has settled
  await page.waitForFunction(() => window.__playerDebug && typeof window.__playerDebug.x === 'number', { timeout: 40000 });
  await sleep(2500);
  const atSpawn = await player();
  await shot('play_02_spawn.png');
  session.steps.push({ step: 'spawn', player: atSpawn, shot: 'play_02_spawn.png' });
  console.log(`spawn: ${JSON.stringify(atSpawn)}`);

  // ------------------------------------------------- G3-style joystick run
  // Full deflection up-screen (turbo compresses time: sim runs far ahead).
  const startPos = { ...atSpawn };
  await touchStart([{ x: 80, y: 764 }]);
  await sleep(80);
  await touchMove([{ x: 80, y: 714 }]); // full deflection
  await sleep(3500);
  await shot('play_03_running.png');
  const midRun = await player();
  await sleep(1500);
  await touchEnd();
  await sleep(800);
  const afterRun = await player();
  const displacement = Math.hypot(afterRun.x - startPos.x, afterRun.z - startPos.z);
  session.steps.push({
    step: 'joystick_run', from: startPos, mid: midRun, to: afterRun,
    displacement_m: +displacement.toFixed(1), maxSpeed: Math.max(midRun.speed || 0, afterRun.speed || 0),
    shot: 'play_03_running.png',
  });
  console.log(`run: disp=${displacement.toFixed(1)}m state=${afterRun.state} speed=${afterRun.speed}`);

  // ---------------------------------------------------------- camera look
  const beforeLook = await player();
  await drag(280, 400, 260, 0, 8, 45);      // right-half drag → yaw
  await sleep(600);
  await shot('play_04_look_right.png');
  session.steps.push({ step: 'camera_look', shot: 'play_04_look_right.png' });

  // ------------------------------------------------------------ pause/resume
  const menuBox = await page.locator('button', { hasText: /MENU/i }).first().boundingBox().catch(() => null);
  if (menuBox) {
    await touchStart([{ x: menuBox.x + menuBox.width / 2, y: menuBox.y + menuBox.height / 2 }]);
    await sleep(80); await touchEnd();
    await sleep(900);
    await shot('play_05_pause_menu.png');
    const resume = await page.locator('button', { hasText: /Resume/i }).first().boundingBox().catch(() => null);
    if (resume) {
      await touchStart([{ x: resume.x + resume.width / 2, y: resume.y + resume.height / 2 }]);
      await sleep(80); await touchEnd();
    }
    await sleep(600);
    session.steps.push({ step: 'pause_resume', shot: 'play_05_pause_menu.png' });
  }

  // --------------------------------------------------------- teleport tour
  const STOPS = [
    { name: 'cloud_forest_blockade', x: -100, z: -500 },
    { name: 'jungle_serpents_path',  x: 100,  z: -800 },
    { name: 'high_sierra_marker',    x: 100,  z: 600 },
    { name: 'paititi_outer_terraces',x: 900,  z: -100 },
    { name: 'paititi_plaza',         x: 1100, z: 50 },
    { name: 'river_valley_home',     x: 45,   z: 120 },
  ];
  for (const s of STOPS) {
    await teleport(s.x, s.z);
    await sleep(3500);                       // stream chunks + settle
    const p = await player();
    await shot(`play_06_${s.name}.png`);
    session.steps.push({ step: 'teleport', stop: s.name, player: p, shot: `play_06_${s.name}.png` });
    console.log(`tour ${s.name}: ${JSON.stringify(p)}`);
  }

  fs.writeFileSync(path.join(OUT, 'p14_play_session.json'), JSON.stringify(session, null, 2));
  console.log(`\nSESSION DONE: ${session.steps.length} steps, errors=${logs.length}`);
  logs.slice(0, 4).forEach(l => console.log('  ' + l));
  await browser.close();
})().catch(e => { console.error('SESSION FAILED:', e.message); process.exit(1); });
