// Dumps the procedural foliage cards + mist sprite to a contact sheet PNG
// (texture evidence alongside the p2 trim-sheet contact). Runs the REAL
// generators from src/textures.ts through the vite-served module graph —
// no duplication of the drawing code.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 320 } });
  // Blank page on the dev-server origin so /src module URLs resolve.
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  const dataUrl = await page.evaluate(async () => {
    const m = await import('/juzu/src/textures.ts');
    const kinds = ['broadleaf', 'grass', 'fern', 'orchid'];
    const size = 256, pad = 12;
    const cols = kinds.length + 1; // + mist
    const cnv = document.createElement('canvas');
    cnv.width = cols * (size + pad) + pad;
    cnv.height = size + pad * 2 + 24;
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = '#20242A';
    ctx.fillRect(0, 0, cnv.width, cnv.height);
    let x = pad;
    for (const k of kinds) {
      const tex = m.createFoliageCardTexture(k);
      ctx.drawImage(tex.image, x, pad + 20, size, size);
      ctx.fillStyle = '#cfd4dc';
      ctx.font = '13px monospace';
      ctx.fillText(k, x + 4, pad + 14);
      x += size + pad;
    }
    const mist = m.createMistTexture();
    // mist sprite composited over a mid-grey swatch so its alpha shows
    ctx.fillStyle = '#4A5560';
    ctx.fillRect(x, pad + 20, size, size);
    ctx.drawImage(mist.image, x, pad + 20, size, size);
    ctx.fillStyle = '#cfd4dc';
    ctx.fillText('mist (over grey)', x + 4, pad + 14);
    return cnv.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, 'p4_foliage_cards_contact.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('p4_foliage_cards_contact.png written');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
