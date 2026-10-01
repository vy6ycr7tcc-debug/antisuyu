// Offline placement census for a given camera position (mirrors decor.ts logic).
// Usage: node scripts/p4_census.cjs <camX> <camZ>
function hash2(x, z, salt = 0) {
  const s = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function smoothstepf(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function biomeWeights(x, z) {
  const pa = smoothstepf(570, 630, x);
  const hs = smoothstepf(280, 340, z) * (1 - pa);
  const jl = (1 - smoothstepf(-430, -370, z)) * (1 - pa) * (1 - hs);
  const cf = Math.max(0, 1 - pa - hs - jl);
  return { cf, hs, jl, pa };
}
function domRegion(x, z) {
  const w = biomeWeights(x, z);
  let best = w.cf, id = 'cloud_forest';
  if (w.hs > best) { best = w.hs; id = 'high_sierra'; }
  if (w.jl > best) { best = w.jl; id = 'jungle_lowlands'; }
  if (w.pa > best) { best = w.pa; id = 'paititi'; }
  return id;
}
// mirrors REGION_SPECIES salts (salt starts 3, +=7 per species in entry order)
const REGION_SPECIES = {
  cloud_forest: ['cf_broadleaf', 'cf_fern', 'cf_tuft', 'cf_orchid'],
  high_sierra: ['hs_ichu', 'hs_broadleaf', 'hs_tuft'],
  jungle_lowlands: ['jl_fern', 'jl_broadleaf', 'jl_tuft'],
  paititi: ['pa_tuft', 'pa_fern', 'pa_broadleaf'],
};
const GRIDS = { coarse: { step: 28, radius: 560 }, mid: { step: 14, radius: 210 }, fine: { step: 4, radius: 88 } };
const PROB = {
  cf_broadleaf: 0.17, cf_fern: 0.5, cf_tuft: 0.42, cf_orchid: 0.09,
  hs_ichu: 0.85, hs_broadleaf: 0.05, hs_tuft: 0.06,
  jl_fern: 0.55, jl_broadleaf: 0.28, jl_tuft: 0.42,
  pa_tuft: 0.25, pa_fern: 0.12, pa_broadleaf: 0.05,
};
const GRID_OF = {
  cf_broadleaf: 'coarse', cf_fern: 'mid', cf_tuft: 'fine', cf_orchid: 'mid',
  hs_ichu: 'fine', hs_broadleaf: 'coarse', hs_tuft: 'mid',
  jl_fern: 'mid', jl_broadleaf: 'coarse', jl_tuft: 'fine',
  pa_tuft: 'fine', pa_fern: 'mid', pa_broadleaf: 'coarse',
};

const camX = parseFloat(process.argv[2] || '-60');
const camZ = parseFloat(process.argv[3] || '100');

let salt = 3;
const salts = {};
for (const list of Object.values(REGION_SPECIES)) for (const id of list) { salt += 7; salts[id] = salt; }
const rockSalts = { granite: 901, limestone: 908, mist: 915 };

const counts = {};
for (const [region, list] of Object.entries(REGION_SPECIES)) {
  for (const id of list) {
    const { step, radius } = GRIDS[GRID_OF[id]];
    let n = 0, nNear = 0;
    const cx0 = Math.floor((camX - radius) / step), cx1 = Math.floor((camX + radius) / step);
    const cz0 = Math.floor((camZ - radius) / step), cz1 = Math.floor((camZ + radius) / step);
    for (let ci = cx0; ci <= cx1; ci++) {
      const qx = ci * step + step / 2;
      for (let cj = cz0; cj <= cz1; cj++) {
        const qz = cj * step + step / 2;
        if (domRegion(qx, qz) !== region) continue;
        const prob = PROB[id];
        if (hash2(qx, qz, salts[id]) >= prob) continue;
        const r3 = hash2(qx, qz, salts[id] + 3), r4 = hash2(qx, qz, salts[id] + 4);
        const fx = qx + (r3 - 0.5) * step * 0.7, fz = qz + (r4 - 0.5) * step * 0.7;
        if (Math.abs(fx) < 22) continue;
        n++;
        const d = Math.hypot(fx - camX, fz - camZ);
        if (d < 60) nNear++;
      }
    }
    counts[id] = { total: n, within60m: nNear };
  }
}
// rocks + mist (coarse grid)
for (const [id, s] of Object.entries(rockSalts)) {
  const { step, radius } = GRIDS.coarse;
  let n = 0;
  const cx0 = Math.floor((camX - radius) / step), cx1 = Math.floor((camX + radius) / step);
  const cz0 = Math.floor((camZ - radius) / step), cz1 = Math.floor((camZ + radius) / step);
  for (let ci = cx0; ci <= cx1; ci++) {
    const qx = ci * step + step / 2;
    for (let cj = cz0; cj <= cz1; cj++) {
      const qz = cj * step + step / 2;
      const prob = id === 'granite' ? { cloud_forest: 0.04 }[domRegion(qx, qz)] ?? 0
        : id === 'limestone' ? ({ cloud_forest: 0.16, jungle_lowlands: 0.26 })[domRegion(qx, qz)] ?? 0
        : ({ cloud_forest: 0.4, jungle_lowlands: 0.28 })[domRegion(qx, qz)] ?? 0;
      if (hash2(qx, qz, s) >= prob) continue;
      const r1 = hash2(qx, qz, s + 1), r2 = hash2(qx, qz, s + 2);
      const fx = qx + (r1 - 0.5) * step * 0.7, fz = qz + (r2 - 0.5) * step * 0.7;
      if (id !== 'mist' && Math.abs(fx) < 12) continue;
      n++;
    }
  }
  counts[id] = { total: n };
}
console.log(`Camera (${camX}, ${camZ}) — dominant region: ${domRegion(camX, camZ)}`);
for (const [id, c] of Object.entries(counts)) console.log(`  ${id}: ${JSON.stringify(c)}`);
