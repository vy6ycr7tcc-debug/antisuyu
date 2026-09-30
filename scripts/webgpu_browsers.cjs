// Try both Playwright Chromium builds; robust device-loss detection.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CANDIDATES = [
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'),
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')
].filter(p => fs.existsSync(p));

async function run() {
  for (const exe of CANDIDATES) {
    const tag = exe.includes('1200') ? 'chromium-1200' : 'chromium-1243';
    const browser = await chromium.launch({
      headless: true,
      executablePath: exe,
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=swiftshader']
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let lost = false, otherErrs = [];
    page.on('console', m => {
      const t = m.text();
      if (t.includes('Device Lost') || t.includes('Instance reference no longer exists')) lost = true;
      else if (m.type() === 'error') otherErrs.push(t.slice(0, 120));
    });
    process.stdout.write(`${tag}: `);
    try {
      await page.goto('http://localhost:5173/juzu/?shot=valley_overview&tod=day&t=2&readback=1', { timeout: 30000 });
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 25000 });
      await page.waitForTimeout(600);
      const rb = await page.evaluate(() => window.__frameDataURL || null);
      if (rb) {
        fs.writeFileSync(path.join(__dirname, '..', 'shots', `probe_${tag}.png`), Buffer.from(rb.split(',')[1], 'base64'));
      }
      console.log(`lost=${lost} readback=${rb ? 'ok' : 'none'} errs=${otherErrs.length}`);
      otherErrs.slice(0, 2).forEach(e => console.log('   ' + e));
    } catch (e) {
      console.log(`FAILED ${String(e).slice(0, 80)}`);
    }
    await browser.close();
  }
}
run();
