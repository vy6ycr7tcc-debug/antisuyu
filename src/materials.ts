import * as THREE from 'three';
import {
  createNoiseTexture,
  createNormalTexture,
  createAshlarTrimSheet,
  createSkinDetailTexture,
  createClothWeaveTexture,
  createHairStrandTexture,
  TRIM_BAND_COUNT,
  type TrimSheetMaps
} from './textures.js';
import type { MeshStandardNodeMaterial } from 'three/webgpu';

// ============================================================================
// V-MAT — the shared material library (visual bible §4.2 / §7.4).
//
// Every factory returns a NEW material instance (callers may tweak per-mesh).
// All parameter values live inside the §4.1 PBR ranges; §2 palette hexes are
// the albedo defaults. No caller may set `.emissive` except via lampEmissive()
// (§4.4 anti-glow law). This module imports textures only from textures.ts;
// it never imports renderer state.
// ============================================================================

export interface RenderCaps { isWebGPU: boolean; tier: 'HIGH' | 'MEDIUM' | 'LOW'; maxAnisotropy: number; }

// --- shared texture caches ----------------------------------------------------
// Procedural textures are generated once and shared across every material
// instance (DataTexture upload is per-TEXTURE, so sharing keeps VRAM flat).

const textureCache = {
    noise: null as THREE.DataTexture | null,
    normal: null as THREE.DataTexture | null,
};

function getNoiseMap(): THREE.DataTexture {
    if (!textureCache.noise) {
        textureCache.noise = createNoiseTexture(256, 10, 4);
    }
    return textureCache.noise;
}

function getNormalMap(): THREE.DataTexture {
    if (!textureCache.normal) {
        textureCache.normal = createNormalTexture(256, 10, 5.0);
    }
    return textureCache.normal;
}

// ============================================================================
// Ashlar trim sheet (companion brief items 1/2/5 — visual bible §4.3).
//
// ONE 1536² sheet carries six vertical masonry bands (fine ashlar → plaster).
// Band selection is GEOMETRY-side: consumers rewrite their UVs into the band
// with mapGeometryToTrimBand() — the textures carry no offset/repeat so a
// single GPU copy serves every wall in the game.
//
// The ORMH texture packs AO (R), roughness (G), metalness (B), height (A).
// On the standard path the baked normal map carries the relief ("baked deep
// normal maps as fallback", brief item 2); on the WebGPU node path the height
// channel drives parallax occlusion mapping with heightfield self-shadowing
// (MEDIUM: 16 linear steps; HIGH: 24 steps + binary refinement + 8-step
// light march — the brief's tier table).
// ============================================================================

let trimSheetCache: TrimSheetMaps | null = null;

function getTrimSheet(): TrimSheetMaps {
  if (!trimSheetCache) {
    trimSheetCache = createAshlarTrimSheet(1536);
    // ORMH feeds aoMap + roughnessMap + metalnessMap from the SAME texture.
    // aoMap would default to uv1; pin every slot to channel 0 (the trim-mapped
    // uv) so geometry needs a single uv attribute.
    trimSheetCache.ormh.channel = 0;
  }
  return trimSheetCache;
}

/**
 * Rewrites `geometry`'s uv attribute so u lands inside trim band `band`
 * (u ∈ [band/6, (band+1)/6]) while v tiles freely (sheet v is
 * wall-base → top with the §4.3.3 weathering gradient baked along it).
 * Call AFTER geometry creation, BEFORE first render. Returns the geometry
 * for chaining.
 */
export function mapGeometryToTrimBand(
  geometry: THREE.BufferGeometry,
  band: number,
  opts: { vScale?: number; vOffset?: number } = {}
): THREE.BufferGeometry {
  const uvAttr = geometry.getAttribute('uv');
  if (!uvAttr) return geometry;
  const u0 = band / TRIM_BAND_COUNT;
  const vScale = opts.vScale ?? 1;
  const vOffset = opts.vOffset ?? 0;
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    uvAttr.setXY(i, u0 + THREE.MathUtils.clamp(u, 0, 1) / TRIM_BAND_COUNT, v * vScale + vOffset);
  }
  uvAttr.needsUpdate = true;
  return geometry;
}

/**
 * Standard-path ashlar trim material (WebGL2 always; WebGPU LOW tier).
 * The sheet's baked normal map carries the relief; ORMH drives AO/rough/metal.
 */
export function ashlarTrimMaterial(): THREE.MeshStandardMaterial {
  const sheet = getTrimSheet();
  return new THREE.MeshStandardMaterial({
    color: 0xFFFFFF,        // albedo anchors live IN the sheet (§2 hexes)
    map: sheet.albedo,
    normalMap: sheet.normal,
    roughnessMap: sheet.ormh,   // scalar 1.0 → G channel passes through
    metalnessMap: sheet.ormh,   // B channel is 0 for stone
    aoMap: sheet.ormh,          // baked cavity AO in the joints (§4.3.2)
    aoMapIntensity: 0.8,        // §4.1 range 0.6–1.0
    roughness: 1.0,
    metalness: 1.0,
    envMapIntensity: 1.0,
  });
}

// --- WebGPU node path: POM + self-shadowing (brief item 2, tier table) -------

export interface TrimNodeMaterialResult {
  material: MeshStandardNodeMaterial;
  /** View-space direction TOWARD the active sun/moon. The consumer copies
   *  the light-rig direction into `.value` once per frame (transformDirection
   *  by the camera view matrix). Only used by the HIGH-tier shadow march. */
  sunDirectionView: { value: THREE.Vector3 };
  pomSteps: number;
}

/**
 * WebGPU node material for the ashlar trim sheet with parallax occlusion
 * mapping. Returns null when the tier cannot afford POM (LOW tier, or any
 * failure while building the node graph) — callers must fall back to
 * ashlarTrimMaterial().
 *
 * TSL is dynamically imported here only, inside the WebGPU branch (§5.3).
 */
export async function buildAshlarTrimNodeMaterial(
  caps: RenderCaps,
  opts: { heightScale?: number } = {}
): Promise<TrimNodeMaterialResult | null> {
  if (!caps.isWebGPU || caps.tier === 'LOW') return null;

  try {
    const [WEBGPU, TSL] = await Promise.all([
      import('three/webgpu'),
      import('three/tsl'),
    ]);
    const {
      uv, texture, float, vec3,
      normalize, max, mix,
      Loop, If, Break,
      dFdx, dFdy, positionView, normalView,
      normalMap, uniform,
    } = TSL;

    const sheet = getTrimSheet();
    const heightScaleNode = float(opts.heightScale ?? 0.03);

    const material = new WEBGPU.MeshStandardNodeMaterial();
    material.envMapIntensity = 1.0;

    // Band UV is geometry-side: uv.x already lands inside the band.
    const uv0 = uv();

    // --- tangent frame (Mikkelsen screen-space derivatives) ------------------
    // Trim-mapped geometry carries no tangent attribute; the classic
    // cotangent frame reconstructs the TBN from screen-space derivatives of
    // position and uv, evaluated at the top level (uniform control flow).
    const dp1 = dFdx(positionView);
    const dp2 = dFdy(positionView);
    const duv1 = dFdx(uv0);
    const duv2 = dFdy(uv0);
    const dp2perp = dp2.cross(dp1);
    const dp1perp = dp1.cross(dp2);
    const tDir = dp2perp.mul(duv1.x).add(dp1perp.mul(duv2.x)).normalize();
    const bDir = dp2perp.mul(duv1.y).add(dp1perp.mul(duv2.y)).normalize();
    const nDir = normalize(normalView);

    const viewDirV = normalize(positionView.negate());
    const viewTs = vec3(tDir.dot(viewDirV), bDir.dot(viewDirV), nDir.dot(viewDirV)).toVar();

    // Total parallax offset per unit of heightfield depth.
    const parallax = viewTs.xy.div(max(viewTs.z, 0.08)).mul(heightScaleNode).toVar();

    // --- linear search (MEDIUM 16 / HIGH 24) ---------------------------------
    const steps = caps.tier === 'HIGH' ? 24 : 16;
    const layerDepth = float(1.0 / steps);
    const depth = float(0).toVar();
    const h = texture(sheet.ormh, uv0).a.toVar();

    Loop(steps, () => {
      If(h.lessThanEqual(depth), () => { Break(); });
      depth.addAssign(layerDepth);
      h.assign(texture(sheet.ormh, uv0.sub(parallax.mul(depth))).a);
    });

    // --- binary refinement (HIGH only) ---------------------------------------
    const depthFinal = depth;
    if (caps.tier === 'HIGH') {
      const lo = depth.sub(layerDepth).toVar();
      const hi = depth.toVar();
      Loop(5, () => {
        const mid = lo.add(hi).mul(0.5);
        const hMid = texture(sheet.ormh, uv0.sub(parallax.mul(mid))).a;
        If(hMid.greaterThan(mid), () => { lo.assign(mid); }).Else(() => { hi.assign(mid); });
      });
      depthFinal.assign(lo.add(hi).mul(0.5));
    }
    const uvPom = uv0.sub(parallax.mul(depthFinal));

    // --- heightfield self-shadowing (HIGH only, brief item 2) ----------------
    // March from the surface point toward the light in tangent space; any
    // sample rising above the ray darkens the fragment (soft accumulation).
    const sunDirectionView = uniform(new THREE.Vector3(0.2, 0.9, 0.2));
    const shadow = float(1).toVar();
    if (caps.tier === 'HIGH') {
      const sunTs = vec3(
        tDir.dot(sunDirectionView),
        bDir.dot(sunDirectionView),
        nDir.dot(sunDirectionView)
      ).normalize().toVar();
      If(sunTs.z.greaterThan(0.02), () => {
        const sunParallax = sunTs.xy.div(max(sunTs.z, 0.08)).mul(heightScaleNode).toVar();
        const s = float(0).toVar();
        Loop(8, () => {
          s.addAssign(float(1.0 / 8));
          const hS = texture(sheet.ormh, uvPom.add(sunParallax.mul(s))).a;
          If(hS.greaterThan(depthFinal.add(s)), () => {
            shadow.mulAssign(mix(float(0.45), float(1.0), s.mul(0.5)));
          });
        });
      });
    }

    // --- wire the packed sheet ------------------------------------------------
    material.colorNode = texture(sheet.albedo, uvPom).rgb.mul(shadow);
    material.normalNode = normalMap(texture(sheet.normal, uvPom));
    material.roughnessNode = texture(sheet.ormh, uvPom).g;
    material.metalnessNode = texture(sheet.ormh, uvPom).b;
    material.aoNode = texture(sheet.ormh, uvPom).r;

    return { material, sunDirectionView, pomSteps: steps };
  } catch (e) {
    console.warn('materials: POM node material unavailable, falling back to baked normals', e);
    return null;
  }
}

// ============================================================================
// §7.4 factory catalog — stone / masonry
// ============================================================================

// Ashlar light (Paititi primary stone, sunlit faces) — fresh ashlar 0.75–0.85
export function ashlarLight(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xCFC6B4,
        roughness: 0.8,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Ashlar weathered (Paititi shadow faces / older structures) — weathered 0.85–0.95
export function ashlarWeathered(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xA89E86,
        roughness: 0.9,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Granite (High Sierra cliff faces, outcrops)
export function granite(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x6E6A63,
        roughness: 0.85,
        metalness: 0.05,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Limestone swallowed (Jungle lowlands ruined stone, heavy moss)
export function limestoneSwallowed(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xB8B0A0,
        roughness: 0.9,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Plaza worn (worn paving, polished by feet) — 0.45–0.55
export function plazaWorn(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x9A917E,
        roughness: 0.5,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Cave dark (deep interior stone) — envMapIntensity 0.3 per §4.1
export function caveDark(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x4A4A48,
        roughness: 0.7,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 0.3,
    });
}

// ============================================================================
// V-REG1 dressing factories (§2.2 cloud forest / §2.3 high sierra palette)
// The region dressing pass consumes these instead of recolor-hacking stone
// factories (the p10 audit found the pit read as ashlar, not raw earth).
// ============================================================================

// Humus/earth (§2.2: ground, excavation pit) — raw wet earth
export function humusEarth(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x3B2E22,
        roughness: 0.95,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Moss (§2.2: stone/wood moss patches) — roughness 0.95 per palette row
export function mossPatch(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x5A7247,
        roughness: 0.95,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Lichen (§2.3: lichen patches on rock #7A8A5A) — roughness 1.0 per palette row
export function lichenPatch(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x7A8A5A,
        roughness: 1.0,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Broadleaf card (§2.2 canopy greens #2D4A22 / #3E5E2A) — foliage card read,
// two-sided because cards are flat planes seen from both sides (V-FOLIAGE style)
export function broadleafCard(hex: number = 0x3E5E2A): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: hex,
        roughness: 0.8,
        metalness: 0.0,
        side: THREE.DoubleSide,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Orchid accent (§2.2 #C9A0DC, sparse clusters, ≤2% of frame) — no emissive (§4)
export function orchidAccent(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xC9A0DC,
        roughness: 0.6,
        metalness: 0.0,
        side: THREE.DoubleSide,
        envMapIntensity: 1.0,
    });
}

// Terracotta (§2.3: village roofs, pottery shards #A85B32) — fired clay
export function terracotta(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xA85B32,
        roughness: 0.8,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// ============================================================================
// Metal (§4.2 catalog: gold / bronze / ironDark / copperWorn)
// ============================================================================

// Gold (sun disk, rings, inlay) — metalness 1.0, roughness 0.32–0.38
export function gold(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xD4A017,
        roughness: 0.35,
        metalness: 1.0,
        envMapIntensity: 1.0,
    });
}

// Bronze (mechanisms, dials) — metalness 0.85, roughness 0.4–0.5
export function bronze(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x8C6A3F,
        roughness: 0.45,
        metalness: 0.85,
        envMapIntensity: 1.0,
    });
}

// Iron dark (Sol Negro gear, heavy mechanisms)
export function ironDark(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x4A4D50,
        roughness: 0.6,
        metalness: 0.8,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Copper worn (roofing, drains, decorative strips — §4.2 catalog)
export function copperWorn(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x9C6B45,
        roughness: 0.55,
        metalness: 0.85,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// ============================================================================
// Organic (wood / thatch / fabric / leather)
// ============================================================================

// Wood aged (old structures, barricades) — wood 0.8–0.9
export function woodAged(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x5C4033,
        roughness: 0.85,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Wood wet (jungle / near-water structures) — wet lowers roughness
export function woodWet(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x4A3025,
        roughness: 0.6,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Thatch / ichu grass (roofs, dry high-sierra vegetation)
export function thatchIchu(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x9A8B4F,
        roughness: 0.9,
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Fabric worn (tents, banners) — cloth 0.9–1.0
export function fabricWorn(hex: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: hex,
        roughness: 0.95,
        metalness: 0.0,
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// Leather dark (gear, straps) — p7: roughness variation wired (same noise map
// the other organic factories use; §4.1 "roughness story" at pack/strap scale)
export function leatherDark(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x2C1A10,
        roughness: 0.75,
        metalness: 0.05,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 1.0,
    });
}

// ============================================================================
// Special — lampEmissive is the ONLY emissive factory (§4.4 anti-glow law)
// ============================================================================

export function lampEmissive(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xFFB45E,          // warm lamp color — never white-blue/green/magenta
        emissive: 0xFFB45E,
        emissiveIntensity: 2.0,   // lamp budget cap (§4.4); requires lamp geometry
        roughness: 0.2,
        metalness: 0.0,
    });
}

// ============================================================================
// Water (constructed through these helpers; full water spec is §7.5/V-WATER)
// ============================================================================

// River water (flowing river surface) — water roughness 0.05–0.15, env 1.2
export function riverWater(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x335566,
        roughness: 0.1,
        metalness: 0.0,
        transparent: true,
        opacity: 0.85,
        normalMap: getNormalMap(),
        envMapIntensity: 1.2,
    });
}

// Pool still (still/slow pool water)
export function poolStill(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x14261E,
        roughness: 0.08,
        metalness: 0.0,
        transparent: true,
        opacity: 0.85,
        normalMap: getNormalMap(),
        envMapIntensity: 1.2,
    });
}

// Channel clear (clear flowing channel water)
export function channelClear(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x2E5A6E,
        roughness: 0.08,
        metalness: 0.0,
        transparent: true,
        opacity: 0.85,
        normalMap: getNormalMap(),
        envMapIntensity: 1.2,
    });
}

// ============================================================================
// Character (owned by V-MAT, applied in character.ts by V-CHAR; detail maps
// from textures.ts give the close-up read the §1.1 photo test demands)
// ============================================================================

interface SkinDetailMaps { normal: THREE.DataTexture; roughness: THREE.DataTexture; }
const detailCache: {
  skin?: SkinDetailMaps;
  cloth?: SkinDetailMaps;
  hair?: THREE.DataTexture;
} = {};

function getSkinDetail(): SkinDetailMaps {
  if (!detailCache.skin) detailCache.skin = createSkinDetailTexture(256);
  return detailCache.skin;
}

function getClothDetail(): SkinDetailMaps {
  if (!detailCache.cloth) detailCache.cloth = createClothWeaveTexture(256);
  return detailCache.cloth;
}

function getHairDetail(): THREE.DataTexture {
  if (!detailCache.hair) detailCache.hair = createHairStrandTexture(256);
  return detailCache.hair;
}

// p7 gate A/B suspension (&ncm=1 in main.ts): the character detail maps wired
// in this phase must PROVE they render — the p4 wind lesson (an injection that
// diffs to exactly zero is inert). With maps disabled the factories return the
// pre-p7 flat-surface read for the A/B pair.
let characterMapsEnabled = true;
export function setCharacterDetailMapsEnabled(v: boolean): void {
  characterMapsEnabled = v;
}

// Skin Naira — §4.1 skin roughness 0.55–0.65. p7 audit fixes:
//  - roughnessMap WAS GENERATED BUT NEVER WIRED (the audit found it): pore
//    map (mean ~0.55, T-zone lows to 0.40) now multiplies base 1.0 — nominal
//    roughness lands at the §4.1 floor with oily-zone catchlights.
//  - transmission 0.1 "fake SSS" measured a no-op at 2 m (p7 A/B) while paying
//    the transmissive-pass cost — replaced by sheen (peach-fuzz back-scatter),
//    which the §4.4 spirit prefers: no glow, no extra render pass.
//  - pore normalScale 0.35 → 0.5: the pores were invisible at the 2 m audit
//    distance; 0.5 keeps them sub-millimeter but present.
export function skinNaira(): THREE.MeshPhysicalMaterial {
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0x8D5524,
        roughness: 1.0,           // × pore map (0.40–0.70) — see note above
        metalness: 0.0,
        sheen: 0.3,
        sheenRoughness: 0.5,
        sheenColor: 0xFFD9B0,     // warm peach-fuzz — restrained, §2.1 accent rules
        clearcoat: 0.05,          // sweat sheen (was 0.1 alongside transmission)
        envMapIntensity: 1.0,
    });
    if (characterMapsEnabled) {
        mat.normalMap = getSkinDetail().normal;
        mat.normalScale = new THREE.Vector2(0.5, 0.5);
        mat.roughnessMap = getSkinDetail().roughness;
    }
    return mat;
}

// Cloth Field — §4.1 cloth roughness 0.9–1.0, "weather-worn, never clean"
// (§1.2 Tomb Raider row). p7 audit fixes:
//  - roughnessMap WAS GENERATED BUT NEVER WIRED: weave map (mean ~0.86,
//    thread-crest polish lows 0.80) × base 1.08 → effective 0.86–1.0 — the
//    crest sheen IS the wear story.
//  - weave normalScale 0.5 → 0.3: at the 2 m audit distance the 8 px thread
//    pattern aliased into moiré scanlines; 0.3 keeps a fabric read without
//    the interference.
export function clothField(): THREE.MeshPhysicalMaterial {
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0x4A5D23,          // field-jacket olive (§2 quipu-dye family)
        roughness: 1.08,          // × weave map (0.80–0.92, clamped ≤1.0)
        metalness: 0.0,
        envMapIntensity: 1.0,
    });
    if (characterMapsEnabled) {
        mat.normalMap = getClothDetail().normal;
        mat.normalScale = new THREE.Vector2(0.3, 0.3);
        mat.roughnessMap = getClothDetail().roughness;
    }
    return mat;
}

// Cloth field — pants tone (p7): torso and legs shared ONE flat olive, reading
// as a bodysuit; the darker ground-grime tone splits the costume into jacket +
// work pants (§1.2: weather-worn; ground contact takes the grime).
export function clothFieldDark(): THREE.MeshPhysicalMaterial {
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0x3B4A1E,          // darker olive — ground-grime tone
        roughness: 1.0,           // muddiest cloth: map × 1.0 clamps at 1.0 in dips
        metalness: 0.0,
        envMapIntensity: 1.0,
    });
    if (characterMapsEnabled) {
        mat.normalMap = getClothDetail().normal;
        mat.normalScale = new THREE.Vector2(0.3, 0.3);
        mat.roughnessMap = getClothDetail().roughness;
    }
    return mat;
}

// Hair Dark (braid; strand roughness streaks + anisotropic highlight)
export function hairDark(): THREE.MeshPhysicalMaterial {
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0x0A0A0A,
        roughness: 1.0,           // multiplied by the strand streak map (0.35–0.65)
        metalness: 0.1,
        clearcoat: 0.25,
        roughnessMap: getHairDetail(),
        envMapIntensity: 1.0,
    });
    mat.anisotropy = 0.5;
    // Braid tube UVs run the strand direction along V; texture streaks run
    // along V, so rotate the anisotropy frame a quarter turn.
    mat.anisotropyRotation = Math.PI / 2;
    return mat;
}
