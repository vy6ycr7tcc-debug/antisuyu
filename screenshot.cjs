const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan']
  });

  const scenarios = ['valley_overview', 'river_crossing', 'character_closeup'];
  const modes = ['webgpu', 'webgl2'];

  for (const mode of modes) {
    for (const scenario of scenarios) {
      const page = await browser.newPage();

      if (mode === 'webgl2') {
         // Mock navigator.gpu to force fallback
         await page.addInitScript(() => {
           delete window.navigator.gpu;
         });
      }

      page.on('console', msg => console.log(`[${mode}] ${msg.type()}: ${msg.text()}`));

      console.log(`Loading ${scenario} in ${mode}...`);
      await page.goto(`http://localhost:5173/antisuyu/?shot=${scenario}&t=2`);

      try {
        await page.waitForFunction(() => window.__shotReady === true, { timeout: 10000 });
        await page.screenshot({ path: `shot_${scenario}_${mode}.png` });
        console.log(`Saved shot_${scenario}_${mode}.png`);
      } catch (e) {
        console.error(`Timeout for ${scenario} in ${mode}`);
      }

      await page.close();
    }
  }

  await browser.close();
}

run();
