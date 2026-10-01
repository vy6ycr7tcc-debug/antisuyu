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


// Terrain surface textures (V-TERRAIN). The generic createNoiseTexture /
// createNormalTexture above carry high-octave domain warps whose neighboring
// texels decorrelate completely — at terrain tiling that reads as per-texel
// white-noise speckle ("static"), not geology. These variants are strictly
// low-frequency: broad blotch structure, no per-texel grit.

// Albedo detail multiplier, 0.84–1.0 (near-white), sRGB set by caller.
export function createTerrainDetailTexture(size: number = 256): THREE.DataTexture {
    const actualSize = Math.min(size, 256);
    const data = new Uint8Array(actualSize * actualSize * 4);
    for (let y = 0; y < actualSize; y++) {
        for (let x = 0; x < actualSize; x++) {
            const u = x / actualSize, v = y / actualSize;
            // Periodic sin/cos lattice → seamless tiles, broad features only.
            const tone =
                Math.sin(u * Math.PI * 2 * 3 + Math.sin(v * Math.PI * 2 * 2) * 1.2) * 0.5 +
                Math.sin((u + v) * Math.PI * 2 * 5 + 1.7) * 0.25 +
                Math.sin(u * Math.PI * 2 * 9 + v * Math.PI * 2 * 7) * 0.12;
            const val = Math.floor(Math.min(1, Math.max(0, 0.925 + tone * 0.075)) * 255);
            const idx = (y * actualSize + x) * 4;
            data[idx] = val; data[idx + 1] = val; data[idx + 2] = val; data[idx + 3] = 255;
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

// Roughness multiplier, 0.72–0.98, ~40 m blotch rhythm: the high end keeps
// dry ground matte; the low end gives the sanctioned wet-specular patches
// without mirror-glint whiteout under the day sun (measured in p3-5).
export function createTerrainRoughnessTexture(size: number = 256): THREE.DataTexture {
    const actualSize = Math.min(size, 256);
    const data = new Uint8Array(actualSize * actualSize * 4);
    for (let y = 0; y < actualSize; y++) {
        for (let x = 0; x < actualSize; x++) {
            const u = x / actualSize, v = y / actualSize;
            const tone =
                Math.sin(u * Math.PI * 2 * 2 + Math.sin(v * Math.PI * 2 * 3 + 0.8) * 1.5) * 0.5 +
                Math.sin((u * 1.3 + v * 0.7) * Math.PI * 2 * 4 + 2.3) * 0.3 +
                Math.sin(u * Math.PI * 2 * 7 - v * Math.PI * 2 * 5 + 0.4) * 0.15;
            const val = Math.floor(Math.min(1, Math.max(0, 0.85 + tone * 0.13)) * 255);
            const idx = (y * actualSize + x) * 4;
            data[idx] = val; data[idx + 1] = val; data[idx + 2] = val; data[idx + 3] = 255;
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

// ============================================================================
// Foliage cards + mist sprite (V-FOLIAGE).
//
// §7.3 FoliageSpec.cardTexture and §6.3: foliage cards ≤ 256², alpha-TESTED
// (never alpha-blended) with side: DoubleSide. Cards are drawn WHITE with
// internal luminance variation — the tint comes from per-instance color
// (FoliageSpec.colorA..colorB), so one silhouette serves a whole biome.
// Alpha is authored hard (1 px antialiased edge only) so alphaTest 0.5 keeps
// crisp silhouettes with no dithered halo. Generation is seeded — reproducible
// frames for §5.4/§8 A/B gates.
// ============================================================================

export type FoliageCardKind = 'broadleaf' | 'grass' | 'fern' | 'orchid';

const CARD_SEEDS: Record<FoliageCardKind, number> = {
    broadleaf: 0x5EE01, grass: 0x1C0D0, fern: 0x3E2A1, orchid: 0x4F1C7,
};

// Luminance ramp kept 0.78–0.97: near-white for clean instance tinting, never
// a flat single value (flat cards read as paper cutouts at close range).
function cardShade(rng: () => number, base = 0.78, spread = 0.19): string {
    const v = Math.round((base + rng() * spread) * 255);
    return `rgb(${v},${v},${v})`;
}

// A single leaf: two quadratic curves meeting at a tip, anchored at (x,y),
// pointing at `angle` (radians, -y is "up" on canvas), length L width W.
function cardLeaf(
    ctx: CanvasRenderingContext2D, rng: () => number,
    x: number, y: number, angle: number, L: number, W: number, fill: string
): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(W, -L * 0.45, 0, -L);
    ctx.quadraticCurveTo(-W, -L * 0.45, 0, 0);
    ctx.fill();
    ctx.restore();
}

// Tapered grass blade from (bx,by) toward tip (tx,ty) with sideways bow `bend`.
function cardBlade(
    ctx: CanvasRenderingContext2D, rng: () => number,
    bx: number, by: number, tx: number, ty: number, w: number, bend: number
): void {
    const mx = (bx + tx) / 2, my = (by + ty) / 2;
    const dx = ty - by, dy = bx - tx; // perpendicular
    const dl = Math.max(1e-4, Math.hypot(dx, dy));
    const px = dx / dl, py = dy / dl;
    ctx.fillStyle = cardShade(rng, 0.74, 0.24);
    ctx.beginPath();
    ctx.moveTo(bx - px * w, by - py * w);
    ctx.quadraticCurveTo(mx - px * w * 0.35 + px * bend, my - py * w * 0.35 + py * bend, tx, ty);
    ctx.quadraticCurveTo(mx + px * w * 0.35 + px * bend, my + py * w * 0.35 + py * bend, bx + px * w, by + py * w);
    ctx.closePath();
    ctx.fill();
}

function foliageCardCanvas(kind: FoliageCardKind, size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const rng = mulberry32(CARD_SEEDS[kind]);
    const S = size;
    ctx.clearRect(0, 0, S, S);

    if (kind === 'broadleaf') {
        // Canopy mass: jittered ring of leaves around an off-center heart.
        // Luminance falls toward the clump center/base — a baked depth cue
        // that keeps layered cards from reading as one flat pom-pom.
        const cx = S * 0.5, cy = S * 0.4;
        const R = S * 0.3;
        for (let i = 0; i < 22; i++) {
            const a = (i / 22) * Math.PI * 2 + rng() * 0.55;
            const r = R * (0.35 + rng() * 0.6);
            const lx = cx + Math.cos(a) * r * 1.15;
            const ly = cy + Math.sin(a) * r * 0.85;
            const L = S * (0.13 + rng() * 0.09);
            // outer + higher leaves catch light; inner + lower go darker
            const depth = r / R;
            const lum = 0.62 + depth * 0.3 + (cy - ly) / S * 0.25 + rng() * 0.08;
            cardLeaf(ctx, rng, lx, ly, a + Math.PI / 2 + (rng() - 0.5) * 0.9, L, L * 0.42,
                cardShade(rng, Math.min(0.94, Math.max(0.5, lum)), 0.02));
        }
        for (let i = 0; i < 7; i++) {
            const lx = S * (0.18 + rng() * 0.64);
            const ly = S * (0.62 + rng() * 0.2);
            const L = S * (0.12 + rng() * 0.07);
            cardLeaf(ctx, rng, lx, ly, Math.PI + (rng() - 0.5) * 1.6, L, L * 0.4, cardShade(rng, 0.6, 0.14));
        }
        // Trunk-facing stem wedge (dark — attaches to the instanced trunk).
        ctx.fillStyle = cardShade(rng, 0.45, 0.1);
        ctx.beginPath();
        ctx.moveTo(S * 0.44, S);
        ctx.lineTo(S * 0.56, S);
        ctx.lineTo(S * 0.5, cy + S * 0.08);
        ctx.closePath();
        ctx.fill();
        // Light gaps between leaf layers (alpha holes → depth when layered).
        ctx.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 10; i++) {
            const a = rng() * Math.PI * 2;
            const r = R * rng() * 0.85;
            ctx.beginPath();
            ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, S * 0.015, S * 0.05, a, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
    } else if (kind === 'grass') {
        // Ichu tussock: many thin bowed blades from one base — tighter fan
        // than a starburst, lengths staggered inner-short/outer-long so the
        // silhouette arcs like a grass clump, not an agave rosette.
        const bx = S * 0.5, by = S * 0.97;
        const n = 19;
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1) - 0.5;
            const a = -Math.PI / 2 + t * 1.9 + (rng() - 0.5) * 0.18;
            const centerBias = 1 - Math.abs(t) * 0.55;
            const len = S * (0.34 + rng() * 0.5) * (0.55 + centerBias * 0.65);
            const tx = bx + Math.cos(a) * len;
            const ty = by + Math.sin(a) * len;
            const bend = Math.sign(t || 1) * (0.1 + rng() * 0.35) * S * 0.3;
            cardBlade(ctx, rng, bx, by, tx, ty, S * (0.008 + rng() * 0.009), bend);
        }
    } else if (kind === 'fern') {
        // Fronds of paired pinnae arcing out from the base.
        const bx = S * 0.5, by = S * 0.96;
        const n = 7;
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.5 + (rng() - 0.5) * 0.15;
            const len = S * (0.62 + rng() * 0.3);
            // Stem: quadratic base → tip, control bowed outward/downward.
            const tx = bx + Math.cos(a) * len;
            const ty = by + Math.sin(a) * len + S * 0.06;
            const cxx = bx + Math.cos(a) * len * 0.55 + Math.cos(a + Math.PI / 2) * S * 0.05;
            const cyy = by + Math.sin(a) * len * 0.5;
            ctx.strokeStyle = cardShade(rng, 0.6, 0.12);
            ctx.lineWidth = S * 0.008;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.quadraticCurveTo(cxx, cyy, tx, ty);
            ctx.stroke();
            // Pinnae pairs along the stem, shrinking toward the tip.
            const steps = 9;
            for (let sIdx = 1; sIdx <= steps; sIdx++) {
                const t = sIdx / (steps + 1);
                const px = (1 - t) * (1 - t) * bx + 2 * (1 - t) * t * cxx + t * t * tx;
                const py = (1 - t) * (1 - t) * by + 2 * (1 - t) * t * cyy + t * t * ty;
                const pl = len * 0.2 * (1 - t * 0.75);
                const pa = a + Math.PI / 2;
                cardLeaf(ctx, rng, px, py, pa + 0.5 + rng() * 0.3, pl, pl * 0.34, cardShade(rng));
                cardLeaf(ctx, rng, px, py, pa - 0.5 - rng() * 0.3, pl, pl * 0.34, cardShade(rng));
            }
        }
    } else { // orchid
        // Sparse epiphyte accent: 3 basal blades + one stem, small 5-petal
        // flowers. Instance tint supplies the §2.2 orchid color.
        const bx = S * 0.5, by = S * 0.94;
        for (let i = 0; i < 3; i++) {
            const a = -Math.PI / 2 + (i - 1) * 0.75 + (rng() - 0.5) * 0.2;
            cardLeaf(ctx, rng, bx, by, a, S * (0.26 + rng() * 0.08), S * 0.028, cardShade(rng, 0.66, 0.14));
        }
        // Stem up to the flower cluster.
        const sx = bx + S * 0.05, syTop = S * 0.34;
        ctx.strokeStyle = cardShade(rng, 0.7, 0.1);
        ctx.lineWidth = S * 0.011;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + S * 0.1, S * 0.62, sx, syTop);
        ctx.stroke();
        // Flowers: 5 petals around a center, slight per-flower jitter.
        const flowers: Array<[number, number, number]> = [
            [sx, syTop, 1.0],
            [sx - S * 0.09, syTop + S * 0.07, 0.8],
            [sx + S * 0.08, syTop + S * 0.05, 0.75],
        ];
        for (const [fx, fy, fs] of flowers) {
            const pr = S * 0.055 * fs;
            for (let p = 0; p < 5; p++) {
                const pa = (p / 5) * Math.PI * 2 + rng() * 0.3;
                cardLeaf(ctx, rng, fx + Math.cos(pa) * pr * 0.5, fy + Math.sin(pa) * pr * 0.5, pa + Math.PI / 2, pr, pr * 0.5, cardShade(rng, 0.86, 0.1));
            }
        }
    }

    return canvas;
}

// Alpha-tested foliage card, ≤ 256² (§6.3). sRGB colorSpace; mipmapped so
// distant cards dissolve instead of sparkling.
export function createFoliageCardTexture(kind: FoliageCardKind, size: number = 256): THREE.Texture {
    const actual = Math.min(size, 256);
    const tex = new THREE.CanvasTexture(foliageCardCanvas(kind, actual));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}

// Soft radial mist sprite (§2.2 mist blue-grey tint is applied by the
// material; this supplies only the alpha falloff). Used with
// transparent + depthWrite:false per §6.3.
export function createMistTexture(size: number = 128): THREE.Texture {
    const actual = Math.min(size, 256);
    const canvas = document.createElement('canvas');
    canvas.width = actual;
    canvas.height = actual;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        const c = actual / 2;
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.42)');
        g.addColorStop(0.75, 'rgba(255,255,255,0.12)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, actual, actual);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}
