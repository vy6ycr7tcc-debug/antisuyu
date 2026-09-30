const { chromium } = require('playwright');

async function run() {
  const scenarioArg = process.argv[2];

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-gl=angle',
      '--use-angle=swiftshader'
    ]
  });

  const scenarios = scenarioArg ? [scenarioArg] : ['valley_overview', 'river_crossing', 'character_closeup', 'climb_wall', 'rope_swing', 'swim_river'];
  const modes = ['webgpu', 'webgl2'];

  for (const mode of modes) {
    for (const scenario of scenarios) {
      const page = await browser.newPage();

      if (mode === 'webgl2') {
         await page.addInitScript(`Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });`);
      }

      page.on('console', msg => console.log(`[${mode}] ${msg.type()}: ${msg.text()}`));

      console.log(`Loading ${scenario} in ${mode}...`);
      await page.goto(`http://localhost:5173/juzu/?shot=${scenario}&t=2`);

      try {
        await page.waitForFunction(() => window.__shotReady === true, { timeout: 10000 });

        // Wait a small amount for the frame to be presented
        await page.waitForTimeout(500);

        const canvas = await page.locator('canvas');
        await canvas.screenshot({ path: `shot_${scenario}_${mode}.png` });
        console.log(`Saved shot_${scenario}_${mode}.png`);
      } catch (e) {
        console.error(`Timeout for ${scenario} in ${mode}`, e);
      }

      await page.close();
    }
  }

  await browser.close();
}

run();
