import * as THREE from 'three';

// ============================================================================
// Procedural PBR texture sets (V-MAT).
//
// Channel-packing convention (companion brief, "Asset pipeline"): PBR sets are
// authored as albedo + ORMH + normal. ORMH packs occlusion=R, roughness=G,
// metalness=B, height=A. three.js samples aoMap from .r, roughnessMap from .g
// and metalnessMap from .b, so ONE packed texture feeds all three slots, and
// the alpha channel carries the heightfield used by parallax occlusion on the
// WebGPU path. When real KTX2/Basis assets replace the procedural sets (same
// packing), they drop in without touching material code.
// ============================================================================

// Deterministic RNG (mulberry32) — texture generation must be reproducible so
// ?shot= A/B comparisons stay valid (visual bible §5.4).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- value noise / fbm (kept consistent with the legacy generators) -----------

function vhash(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = vhash(ix, iy, seed), b = vhash(ix + 1, iy, seed);
  const c = vhash(ix, iy + 1, seed), d = vhash(ix + 1, iy + 1, seed);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

function fbm(x: number, y: number, octaves: number, seed: number): number {
  let value = 0, amplitude = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * vnoise(x * freq, y * freq, seed + i * 101);
    freq *= 2; amplitude *= 0.5;
  }
  return value;
}

// ============================================================================
// Ashlar trim sheet (the Inca stonework signature surface, visual bible §4.3
// + companion brief items 1/2/5).
//
// Layout: 6 vertical BANDS (columns). UV convention for consumers: U runs
// ALONG the wall, V runs from wall base (0) to wall top (1). Consumers pick a
// band via texture repeat/offset (see materials.ts bandTexture()).
//
//   0  fine ashlar     — small blocks (≈0.6 m courses)
//   1  standard ashlar — 0.8–1.2 m blocks, running bond
//   2  megalithic      — very large fitted blocks
//   3  rough fieldstone
//   4  carved relief   — chamfered/stepped profiles
//   5  plaster         — smooth rendered wall
//
// Joints are HEIGHTFIELD recesses with baked cavity AO — they read as geometry
// shadowing at any angle (and via POM on WebGPU), never as painted texture
// stripes (§4.3.2). Edge wear (convex edges lighter, §4.3 item 5 of the brief)
// and grime/moisture (recesses + wall base darker, §4.3.3) are baked in.
// ============================================================================

export const TRIM_BAND_COUNT = 6;
export const TRIM_BAND = {
  FINE_ASHLAR: 0,
  ASHLAR: 1,
  MEGALITHIC: 2,
  FIELDSTONE: 3,
  CARVED: 4,
  PLASTER: 5
} as const;

export interface TrimSheetMaps {
  albedo: THREE.DataTexture;
  normal: THREE.DataTexture;
  ormh: THREE.DataTexture;
  size: number;
}

interface BandProfile {
  // Block layout in band-local UV units (u along wall 0..1, v base 0..top 1).
  // TILE SCALE (normative for these numbers): a band spans 2 m of wall (u) and
  // one v tile is 2 m of height at the canonical consumer vScale 1.5 over a
  // 3 m wall — so block pitch = 2 m / cols wide × 2 m / rows tall. §4.3.1
  // requires ashlar blocks 0.6–1.2 m: keep cols/rows within 2–3 for ashlar
  // bands (0.67–1.0 m); fieldstone rubble may go finer.
  cols: number;            // block columns across the band width
  rows: number;            // course rows top to bottom (tile vertically)
  jointDepth: number;      // height recess depth 0..1
  jointWidthPx: number;    // joint recess width in pixels (128 px = 1 m;
                           // §4.3.1 ashlar joints ≤ 0.02 m → ≤ ~3 px)
  relief: number;          // carved profile strength (band 4)
  flatness: number;        // 1 = perfectly smooth face (plaster), 0 = rough
  roughBase: number;       // base roughness for the ORMH G channel
  // §4.3.1 per-block albedo jitter ±4% lightness
  jitter: number;
}

const BAND_PROFILES: BandProfile[] = [
  { cols: 3, rows: 3, jointDepth: 0.85, jointWidthPx: 2, relief: 0.0, flatness: 0.25, roughBase: 0.80, jitter: 0.04 }, // fine ashlar — 0.67 m blocks, hairline joints
  { cols: 2, rows: 3, jointDepth: 0.90, jointWidthPx: 3, relief: 0.0, flatness: 0.20, roughBase: 0.78, jitter: 0.04 }, // standard ashlar — 1.0 × 0.67 m
  { cols: 1, rows: 2, jointDepth: 0.95, jointWidthPx: 3, relief: 0.0, flatness: 0.18, roughBase: 0.76, jitter: 0.045 }, // megalithic — 2.0 × 1.0 m cyclopean
  { cols: 5, rows: 4, jointDepth: 0.70, jointWidthPx: 6, relief: 0.0, flatness: 0.05, roughBase: 0.90, jitter: 0.07 }, // fieldstone — 0.4 m rubble (not ashlar; joints may read wider)
  { cols: 2, rows: 2, jointDepth: 0.80, jointWidthPx: 3, relief: 0.85, flatness: 0.15, roughBase: 0.80, jitter: 0.035 }, // carved relief — 1.0 m panels
  { cols: 0, rows: 0, jointDepth: 0.00, jointWidthPx: 0, relief: 0.0, flatness: 0.95, roughBase: 0.85, jitter: 0.02 }  // plaster
];

// §2 palette anchors. Ashlar limestone #B5A98F is the default stone albedo;
// grime/moisture and moss modify it inside the sheet (never a green wash).
const STONE_BASE = { r: 0xB5, g: 0xA9, b: 0x8F };
const PLASTER_BASE = { r: 0xC9, g: 0xBD, b: 0xA4 };
const MOSS_TINT = { r: 0x5A, g: 0x72, b: 0x47 }; // §4.3.4 moss anchor

export function createAshlarTrimSheet(size: number = 1536): TrimSheetMaps {
  const W = size;
  const H = size;
  const bandW = Math.floor(W / TRIM_BAND_COUNT);

  // Float buffers (0..1): height drives normal+AO+POM; albedo/rough/metal pack at the end.
  const height = new Float32Array(W * H);
  const albedo = new Float32Array(W * H * 3);
  const rough = new Float32Array(W * H);
  const metal = new Float32Array(W * H); // stays 0 for stone; plaster 0; kept for ORMH B
  const ao = new Float32Array(W * H);

  // Fill with stone base so band boundaries never show background
  for (let i = 0; i < W * H; i++) {
    albedo[i * 3] = STONE_BASE.r / 255;
    albedo[i * 3 + 1] = STONE_BASE.g / 255;
    albedo[i * 3 + 2] = STONE_BASE.b / 255;
    height[i] = 0.5;
    rough[i] = 0.85;
    metal[i] = 0;
    ao[i] = 1;
  }

  const rng = mulberry32(0x4A55);

  for (let band = 0; band < TRIM_BAND_COUNT; band++) {
    const prof = BAND_PROFILES[band];
    const x0 = band * bandW;
    const base = band === TRIM_BAND.PLASTER ? PLASTER_BASE : STONE_BASE;

    // Per-band micro texture: surface grain + grunge (fbm, tileable in v via
    // H-periodic noise wrap; u wraps at band edges by drawing blocks over).
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < bandW; x++) {
        const u = x / bandW, v = y / H;
        const nx = u * prof.cols * 2.0, ny = v * 9.0;
        const grain = fbm(nx, ny, 4, 11 + band * 7) - 0.5;
        const i = (y * W + (x0 + x));
        const h = 0.5 + grain * (0.16 * (1 - prof.flatness) + 0.015);
        height[i] = h;
        // grain also modulates roughness slightly (weathering noise)
        rough[i] = prof.roughBase + grain * 0.10 + (fbm(nx * 0.5, ny * 0.5, 3, 77) - 0.5) * 0.08;
      }
    }

    if (band !== TRIM_BAND.PLASTER) {
      // ---- Block courses -----------------------------------------------------
      // Rows tile vertically (wrap), blocks staggered per row (running bond).
      // The COLUMN GRID is gap-free: boundaries sit at floor(c·bandW/cols) so
      // variable-width columns tile the band exactly. The previous scheme
      // (per-block floor(bandW/cols) width + per-row random offset) left 1px
      // unwritten gap columns at row-dependent wrap points — the Sobel normal
      // pass turned each into a vertical chevron artifact under grazing light.
      // A per-row ROTATION (shift) implements stagger/offset wrap-safely.
      const rowH = H / prof.rows;
      const colEdge: number[] = [];
      for (let c = 0; c <= prof.cols; c++) colEdge.push(Math.floor((c * bandW) / prof.cols));
      const locateCol = (xr: number): number => {
        for (let k = 0; k < prof.cols; k++) { if (xr < colEdge[k + 1]) return k; }
        return prof.cols - 1;
      };
      for (let r = 0; r < prof.rows; r++) {
        const y0 = r * rowH;
        const by = Math.floor(y0);
        const bh = Math.floor(rowH);
        const stagger = (r % 2) * (0.5 / prof.cols);
        const off = rng() * 0.999; // deterministic per-course offset (row seam wraps)
        const shift = Math.floor((((stagger + off) % 1) * bandW + bandW) % bandW);
        // Per-block albedo jitter ±4% lightness (§4.3.1) — deterministic per
        // (band, row, UN-rotated column) so shading stays stable per stone.
        const jitters: number[] = [];
        const wanders: number[] = [];
        for (let c = 0; c < prof.cols; c++) {
          jitters.push((vhash(band * 131 + c, r, 5) - 0.5) * 2 * prof.jitter);
          wanders.push((vhash(c * 7 + band, r * 13, 9) - 0.5) * 0.05);
        }
        // Per-block surface tilt/dome: slightly proud center
        for (let y = 0; y < bh; y++) {
          const py = by + y;
          if (py >= H) continue;
          const fv = y / bh;
          for (let x = 0; x < bandW; x++) {
            const xr = (x + shift) % bandW; // rotate into block-local space
            const c = locateCol(xr);
            const bx = colEdge[c], bw = colEdge[c + 1] - bx;
            const fu = (xr - bx) / bw;
            const i = py * W + (x0 + x);
            // dome: blocks bow outward slightly toward center
            const dome = Math.sin(fu * Math.PI) * Math.sin(fv * Math.PI) * 0.10;
            // fieldstone: lumpy irregular height
            const lump = band === TRIM_BAND.FIELDSTONE
              ? (fbm(fu * 4 + c * 9.7, fv * 4 + r * 3.1, 3, band * 17 + r) - 0.5) * 0.35
              : 0;
            // carved band: stepped chisel profiles across the face
            const carve = band === TRIM_BAND.CARVED
              ? (Math.sin(fu * Math.PI * 6) * 0.5 + Math.sin(fv * Math.PI * 2) * 0.3) * prof.relief * 0.22
              : 0;
            height[i] = Math.min(1, 0.5 + dome + lump + carve
              + (fbm(x * 0.8, py * 0.8, 2, 31) - 0.5) * 0.05);

            // Albedo: base + jitter + subtle per-block hue wander
            const jitter = jitters[c], wander = wanders[c];
            albedo[i * 3] = Math.min(1, Math.max(0, base.r / 255 * (1 + jitter + wander)));
            albedo[i * 3 + 1] = Math.min(1, Math.max(0, base.g / 255 * (1 + jitter + wander)));
            albedo[i * 3 + 2] = Math.min(1, Math.max(0, base.b / 255 * (1 + jitter + wander * 0.5)));
          }
        }

        // ---- Joints: heightfield recess (never painted stripes, §4.3.2) ----
        // Evaluated in the rotated frame so every block edge — including the
        // band wrap seam — gets an identical recess with no gap columns.
        const jw = prof.jointWidthPx;
        for (let y = 0; y < bh; y++) {
          const py = by + y;
          if (py >= H) continue;
          const ey = Math.min(y, bh - 1 - y);
          for (let x = 0; x < bandW; x++) {
            const xr = (x + shift) % bandW;
            const c = locateCol(xr);
            const bx = colEdge[c], bw = colEdge[c + 1] - bx;
            const ex = Math.min(xr - bx, bx + bw - 1 - xr);
            const edge = Math.min(ex, ey);
            const i = py * W + (x0 + x);
            if (edge < jw) {
              const t = edge / jw; // 0 at joint center → 1 at block face
              const depth = prof.jointDepth * (1 - t * t); // squared falloff
              height[i] = Math.max(0, height[i] - depth);
              // cavity AO baked into joint (geometry-shadow reading)
              ao[i] = Math.min(ao[i], 0.45 + 0.55 * t);
              // grime collects in recesses (−8..12% lightness, §4.3.3)
              const grime = 1 - 0.10 * (1 - t);
              albedo[i * 3] *= grime; albedo[i * 3 + 1] *= grime; albedo[i * 3 + 2] *= grime;
              rough[i] = Math.min(1, rough[i] + 0.06); // mortar-ish joints rougher
            }
          }
        }
      }
    }

    // ---- Weathering gradient along V (wall base → top), §4.3.3 --------------
    for (let y = 0; y < H; y++) {
      const v = y / H; // 0 = base, 1 = top
      const moisture = 1 - 0.10 * Math.pow(1 - v, 1.6);  // base up to −10% lightness
      const bleach = 1 + 0.05 * Math.pow(v, 2.0);        // top +5% sun-bleached
      for (let x = 0; x < bandW; x++) {
        const i = y * W + (x0 + x);
        albedo[i * 3] *= moisture * bleach;
        albedo[i * 3 + 1] *= moisture * bleach;
        albedo[i * 3 + 2] *= moisture * bleach;
        // moisture also roughens the base slightly
        rough[i] = Math.min(1, rough[i] + (1 - v) * 0.04);
      }
    }

    // ---- Edge wear: convex block borders slightly lighter (brief item 5) ----
    // Re-scan block edges with a light rim where height transitions up.
    if (band !== TRIM_BAND.PLASTER) {
      for (let y = 1; y < H - 1; y++) {
        for (let x = 0; x < bandW; x++) {
          const i = y * W + (x0 + x);
          const hL = height[y * W + (x0 + (x - 1 + bandW) % bandW)];
          const hR = height[y * W + (x0 + (x + 1) % bandW)];
          const hD = height[(y - 1) * W + (x0 + x)];
          const hU = height[(y + 1) * W + (x0 + x)];
          const lap = (hL + hR + hD + hU) * 0.25;
          if (height[i] > lap + 0.02) { // convex ridge → worn highlight
            const w = Math.min(1, (height[i] - lap) * 6);
            albedo[i * 3] = Math.min(1, albedo[i * 3] + 0.05 * w);
            albedo[i * 3 + 1] = Math.min(1, albedo[i * 3 + 1] + 0.05 * w);
            albedo[i * 3 + 2] = Math.min(1, albedo[i * 3 + 2] + 0.05 * w);
            rough[i] = Math.max(0, rough[i] - 0.08 * w); // polished by feet/hand
          } else if (height[i] < lap - 0.02) { // concave → dust darkening
            const w = Math.min(1, (lap - height[i]) * 6);
            albedo[i * 3] *= 1 - 0.06 * w; albedo[i * 3 + 1] *= 1 - 0.06 * w; albedo[i * 3 + 2] *= 1 - 0.06 * w;
          }
        }
      }
    }

    // ---- Moss/lichen patches: fieldstone + ashlar near wall base only -------
    // Coverage ~10%, tinted toward MOSS_TINT, never a uniform wash (§4.3.4).
    if (band === TRIM_BAND.FIELDSTONE || band === TRIM_BAND.ASHLAR) {
      for (let y = 0; y < H * 0.45; y++) {
        for (let x = 0; x < bandW; x++) {
          const u = x / bandW, v = y / H;
          const m = fbm(u * 6, v * 6, 4, band * 41 + 3);
          if (m > 0.62) {
            const t = Math.min(1, (m - 0.62) * 4); // patch softness
            const i = y * W + (x0 + x);
            albedo[i * 3] = albedo[i * 3] * (1 - t * 0.5) + (MOSS_TINT.r / 255) * t * 0.5;
            albedo[i * 3 + 1] = albedo[i * 3 + 1] * (1 - t * 0.5) + (MOSS_TINT.g / 255) * t * 0.5;
            albedo[i * 3 + 2] = albedo[i * 3 + 2] * (1 - t * 0.5) + (MOSS_TINT.b / 255) * t * 0.5;
            rough[i] = Math.min(1, rough[i] + 0.10 * t); // moss is soft/dry
          }
        }
      }
    }
  }

  // ---- Derive normal map from height (Sobel, tileable) -----------------------
  const normal = new Uint8Array(W * H * 4);
  const strength = 3.0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const hL = height[y * W + ((x - 1 + W) % W)];
      const hR = height[y * W + ((x + 1) % W)];
      const hD = height[((y - 1 + H) % H) * W + x];
      const hU = height[((y + 1) % H) * W + x];
      const dx = (hL - hR) * strength; // green-up convention (OpenGL normal map)
      const dy = (hU - hD) * strength;
      const dz = 1.0;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const i = (y * W + x) * 4;
      normal[i] = Math.round((dx / len * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round((dz / len * 0.5 + 0.5) * 255);
      normal[i + 3] = 255;
    }
  }

  // ---- Pack ORMH: O=R, R=G, M=B, H=A -----------------------------------------
  const ormh = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    ormh[i * 4] = Math.round(Math.min(1, ao[i]) * 255);
    ormh[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, rough[i])) * 255);
    ormh[i * 4 + 2] = Math.round(metal[i] * 255);
    ormh[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, height[i])) * 255);
  }

  // ---- Pack albedo (sRGB bytes; texture marked sRGB) --------------------------
  const alb = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    alb[i * 4] = Math.round(albedo[i * 3] * 255);
    alb[i * 4 + 1] = Math.round(albedo[i * 3 + 1] * 255);
    alb[i * 4 + 2] = Math.round(albedo[i * 3 + 2] * 255);
    alb[i * 4 + 3] = 255;
  }

  const albedoTex = new THREE.DataTexture(alb, W, H, THREE.RGBAFormat);
  albedoTex.colorSpace = THREE.SRGBColorSpace;
  const normalTex = new THREE.DataTexture(normal, W, H, THREE.RGBAFormat);
  const ormhTex = new THREE.DataTexture(ormh, W, H, THREE.RGBAFormat);

  for (const t of [albedoTex, normalTex, ormhTex]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
  }
  // Height in alpha must not be mangled by mip filtering for POM — keep mips
  // (aliasing at distance is acceptable; POM fades out far away anyway).

  return { albedo: albedoTex, normal: normalTex, ormh: ormhTex, size: W };
}

// ============================================================================
// Character detail maps (V-CHAR consumes through materials.ts factories)
// ============================================================================

// Skin pore micro-normal + oiliness roughness map (RGBA: normal in RGB,
// roughness delta in A — consumed via two textures by materials.ts).
export function createSkinDetailTexture(size: number = 256): { normal: THREE.DataTexture; roughness: THREE.DataTexture } {
  const H = new Float32Array(size * size);
  const rng = mulberry32(0x51CE);
  // pores: jittered cell centers, cup-shaped depressions
  const cells = 26;
  const pores: Array<{ x: number; y: number; r: number; d: number }> = [];
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      if (rng() > 0.55) continue;
      pores.push({
        x: (cx + 0.2 + rng() * 0.6) / cells,
        y: (cy + 0.2 + rng() * 0.6) / cells,
        r: (0.010 + rng() * 0.016),
        d: 0.35 + rng() * 0.4
      });
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let h = 0.5 + (fbm(u * 24, v * 24, 3, 91) - 0.5) * 0.10; // micro grain
      for (const p of pores) {
        let dx = Math.abs(u - p.x); dx = Math.min(dx, 1 - dx); // tileable
        let dy = Math.abs(v - p.y); dy = Math.min(dy, 1 - dy);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < p.r) {
          const t = dist / p.r;
          h -= p.d * 0.16 * (1 - t * t); // cup
        }
      }
      H[y * size + x] = Math.min(1, Math.max(0, h));
    }
  }
  const normal = heightToNormalTexture(H, size, 2.2);
  // T-zone oiliness → roughness variation (forehead/nose conceptually; the map
  // is generic so material just multiplies base roughness).
  const rough = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x);
      const r = 0.55 + (fbm(x / size * 8, y / size * 8, 3, 55) - 0.5) * 0.3;
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = Math.round(r * 255);
      rough[i * 4 + 3] = 255;
    }
  }
  const roughTex = new THREE.DataTexture(rough, size, size, THREE.RGBAFormat);
  finishTiling(roughTex);
  return { normal, roughness: roughTex };
}

// Cloth weave: warp/weft thread pattern → normal + roughness variation.
export function createClothWeaveTexture(size: number = 256): { normal: THREE.DataTexture; roughness: THREE.DataTexture } {
  const H = new Float32Array(size * size);
  const thread = 8; // px per thread
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const overWarp = (Math.floor(x / thread) + Math.floor(y / thread)) % 2 === 0;
      const fu = (x % thread) / thread, fv = (y % thread) / thread;
      const threadRound = Math.sin(fu * Math.PI) * (overWarp ? 1 : 0.35)
                        + Math.sin(fv * Math.PI) * (overWarp ? 0.35 : 1);
      H[y * size + x] = 0.5 + (threadRound - 0.6) * 0.22 + (fbm(x / size * 40, y / size * 40, 2, 71) - 0.5) * 0.05;
    }
  }
  const normal = heightToNormalTexture(H, size, 2.0);
  const rough = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // threads polished by wear: crests slightly smoother
      const crest = Math.max(0, H[i] - 0.55) * 2;
      const r = 0.92 - crest * 0.12;
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = Math.round(Math.min(1, r) * 255);
      rough[i * 4 + 3] = 255;
    }
  }
  const roughTex = new THREE.DataTexture(rough, size, size, THREE.RGBAFormat);
  finishTiling(roughTex);
  return { normal, roughness: roughTex };
}

// Hair strand streaks → roughness variation (for the anisotropic highlight).
export function createHairStrandTexture(size: number = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const rng = mulberry32(0x42A1);
  const strands = 48;
  const offsets: number[] = [];
  for (let s = 0; s < strands; s++) offsets.push(rng());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let streak = 0;
      for (let s = 0; s < strands; s++) {
        let d = Math.abs(u - offsets[s]); d = Math.min(d, 1 - d);
        streak += Math.max(0, 1 - d * strands * 2.2);
      }
      streak = Math.min(1, streak);
      const r = 0.35 + (1 - streak) * 0.3 + (fbm(x / size * 30, y / size * 6, 2, 13) - 0.5) * 0.1;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  finishTiling(tex);
  return tex;
}

// --- helpers ------------------------------------------------------------------

function heightToNormalTexture(H: Float32Array, size: number, strength: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = H[y * size + ((x - 1 + size) % size)];
      const hR = H[y * size + ((x + 1) % size)];
      const hD = H[((y - 1 + size) % size) * size + x];
      const hU = H[((y + 1) % size) * size + x];
      const dx = (hL - hR) * strength;
      const dy = (hU - hD) * strength;
      const dz = 1.0;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const i = (y * size + x) * 4;
      data[i] = Math.round((dx / len * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((dz / len * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  finishTiling(tex);
  return tex;
}

function finishTiling(tex: THREE.DataTexture): void {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
}

// ============================================================================
// Legacy generators (compat) — terrain.ts / river.ts / decor.ts / materials.ts
// still import these until their owning phases (3/4/5) migrate to the packed
// PBR helpers above. Math is byte-identical to the pre-V-MAT file so existing
// ?shot= captures remain comparable across the migration.
// ============================================================================

function legacyHash(x: number, y: number): number {
    return (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) - Math.floor(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
}

function legacyNoise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const a = legacyHash(ix, iy);
    const b = legacyHash(ix + 1, iy);
    const c = legacyHash(ix, iy + 1);
    const d = legacyHash(ix + 1, iy + 1);

    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);

    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

function legacyFbm(x: number, y: number, octaves: number = 4): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
        value += amplitude * legacyNoise(x * frequency, y * frequency);
        frequency *= 2;
        amplitude *= 0.5;
    }
    return value;
}

export function createNoiseTexture(size: number, scale: number = 10, octaves: number = 4): THREE.DataTexture {
    // iPhone memory budget: cap texture sizes
    const actualSize = Math.min(size, 256);
    const data = new Uint8Array(actualSize * actualSize * 4);

    for (let y = 0; y < actualSize; y++) {
        for (let x = 0; x < actualSize; x++) {
            // Apply a domain warp (fbm of fbm) for organic non-tiling variation
            const warpX = legacyFbm((x / actualSize) * scale, (y / actualSize) * scale, 2);
            const warpY = legacyFbm((x / actualSize) * scale + 5.2, (y / actualSize) * scale + 1.3, 2);

            // Re-map scale to avoid visible tiling artifacts by introducing organic warping
            const nx = ((x / actualSize) + warpX * 0.1) * scale;
            const ny = ((y / actualSize) + warpY * 0.1) * scale;

            const v = legacyFbm(nx, ny, octaves);
            const idx = (y * actualSize + x) * 4;
            const val = Math.floor(v * 255);
            data[idx] = val;
            data[idx+1] = val;
            data[idx+2] = val;
            data[idx+3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, actualSize, actualSize, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    // Apply proper magnification/minification filters for terrain variation
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}

export function createNormalTexture(size: number, scale: number = 10, intensity: number = 5.0): THREE.DataTexture {
    // iPhone memory budget: cap texture sizes
    const actualSize = Math.min(size, 256);
    const data = new Uint8Array(actualSize * actualSize * 4);

    for (let y = 0; y < actualSize; y++) {
        for (let x = 0; x < actualSize; x++) {
            // Apply domain warping to normal generation to break up tiling
            const warpX = legacyFbm((x / actualSize) * scale, (y / actualSize) * scale, 2) * 0.1;
            const warpY = legacyFbm((x / actualSize) * scale + 5.2, (y / actualSize) * scale + 1.3, 2) * 0.1;

            const getH = (ox: number, oy: number) => {
                const nx = (((x + ox) / actualSize) + warpX) * scale;
                const ny = (((y + oy) / actualSize) + warpY) * scale;
                return legacyFbm(nx, ny, 4);
            };

            const hL = getH(-1, 0);
            const hR = getH(1, 0);
            const hU = getH(0, -1);
            const hD = getH(0, 1);

            const dx = (hR - hL) * intensity;
            const dy = (hD - hU) * intensity;
            const dz = 1.0;

            const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
            const nx = dx / len;
            const ny = dy / len;
            const nz = dz / len;

            const idx = (y * actualSize + x) * 4;
            data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
            data[idx+1] = Math.floor((ny * 0.5 + 0.5) * 255);
            data[idx+2] = Math.floor((nz * 0.5 + 0.5) * 255);
            data[idx+3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, actualSize, actualSize, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}
