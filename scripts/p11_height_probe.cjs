// Measures getGlobalTerrainHeight at the paititi shot coords via the live
// vite module graph, so the fixed shot camera heights sit above the plateau.
const { chromium } = require('playwright');

const coords = [
  ['pa_overview_cam', 1000, -200], ['pa_overview_look', 1100, -50],
  ['pa_outer_terraces_cam', 800, -100], ['pa_outer_terraces_look', 900, -100],
  ['pa_plaza_cam', 1050, -50], ['pa_plaza_look', 1100, -50],
  ['pa_sanctuary_cam', 1250, 50], ['pa_sanctuary_look', 1300, 50],
  ['pa_aqueduct_cam', 1150, 0], ['pa_aqueduct_look', 1200, 0],
  ['pa_center', 1100, -50], ['pa_sanct', 1300, 50],
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/juzu/?shot=region:pa_overview', { timeout: 30000 });
  await page.waitForTimeout(2500);
  for (const [name, x, z] of coords) {
    const h = await page.evaluate(async (xz) => {
      const m = await import('/juzu/src/terrain.ts');
      return m.getGlobalTerrainHeight(xz[0], xz[1]);
    }, [x, z]);
    console.log(`${name.padEnd(24)} (${x},${z})  h=${h.toFixed(2)}`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
