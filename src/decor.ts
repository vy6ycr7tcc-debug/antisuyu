import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { getGlobalTerrainHeight } from './terrain.js';
import { waterDepthAt } from './river.js';
import {
  createFoliageCardTexture, createMistTexture, createNormalTexture,
  type FoliageCardKind,
} from './textures.js';
import { granite, limestoneSwallowed, woodAged } from './materials.js';
import type { RenderCaps } from './renderer.js';
import type { RegionModule } from './world/contracts.js';

// ============================================================================
// V-FOLIAGE — vegetation / rock / mist instancing redo (visual bible §7.3,
// §5.2 T5, §6.3, J3).
//
// Cone trees and dodecahedron rocks are gone (J3: placeholders, not a style).
// Every species is an alpha-tested instanced CARD (§6.3: alphaTest 0.5,
// DoubleSide, ≤256²) with per-instance color/scale/rotation variation, a
// per-region species palette keyed by region id (§7.3), and the §5.2 T5 wind
// formula implemented IDENTICALLY on both render paths:
//
//   offset.x += sin(time*1.3 + worldPos.x*0.5 + hash) * windAmp * heightFactor
//
// WebGPU: TSL `positionNode` on a MeshStandardNodeMaterial (TSL imported
// dynamically inside the WebGPU branch only — §5.3). WebGL2: `onBeforeCompile`
// injection into <begin_vertex> plus the SAME injection into a
// customDepthMaterial so shadows sway with the cards.
//
// Placement is deterministic (sin-hash of the world cell — same family as the
// terrain color script), camera-following with three spatial grids (coarse /
// mid / fine), and rescans only when the camera moves. Biome selection uses
// the SAME 60 m transition bands as the terrain color script, so foliage
// switches species where the ground color switches. Vegetation never floats:
// every instance is grounded/embedded at its FINAL jittered world position
// (§1.3), which also fixes the deferred Phase 3 "decor Y at altitude" defect
// (props floating on slopes when sampled at cell center only).
// ============================================================================

type RegionId = RegionModule['id'];

// §7.3 — stable foliage instance contract (shape verbatim).
export interface FoliageSpec {
  cardTexture: THREE.Texture;   // alpha-tested leaf/grass card, ≤256²
  colorA: number;               // hex, instance color variation low
  colorB: number;               // hex, instance color variation high
  count: number;                // instances (5000 HIGH, 2500 LOW across species)
  windAmp: number;              // 0.15 default (§5 T5)
  castShadow: boolean;          // true HIGH/MEDIUM, false LOW
}

// --- deterministic placement helpers ----------------------------------------

function hash2(x: number, z: number, salt = 0): number {
  const s = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothstepf(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Biome weights — SAME 60 m transition bands as the terrain color script
// (terrain.ts, Phase 3): z 280–340 → high sierra, z −430…−370 → jungle,
// x 570–630 → paititi (paititi precedence), cloud forest = remainder.
function biomeWeights(x: number, z: number): { cf: number; hs: number; jl: number; pa: number } {
  const pa = smoothstepf(570, 630, x);
  const hs = smoothstepf(280, 340, z) * (1 - pa);
  const jl = (1 - smoothstepf(-430, -370, z)) * (1 - pa) * (1 - hs);
  const cf = Math.max(0, 1 - pa - hs - jl);
  return { cf, hs, jl, pa };
}

// Paititi keeps a maintained stone core (§2.5): vegetation density is scaled
// by this falloff from the city center — green only at the city's edges.
const PAITITI_CENTER = { x: 1100, z: -100 };
function paititiEdgeFalloff(x: number, z: number): number {
  const d = Math.hypot(x - PAITITI_CENTER.x, z - PAITITI_CENTER.z);
  return smoothstepf(120, 340, d);
}

// --- per-region species palettes (§7.3: "keyed by region id") ----------------

interface SpeciesPalette {
  id: string;
  kind: FoliageCardKind;
  cardW: number; cardH: number;   // world-space card size (m)
  planes: 1 | 2 | 3;              // crossed-card count (silhouette depth)
  y0: number;                     // local height where sway starts (0 = base)
  // Per-grid placement probability. Trees list TWO grids: mid carries the
  // near-field forest read (§1.1.1 anchors at 8–25 m), coarse a sparse
  // background scatter out to 560 m; beyond ~300 m silhouette and atmosphere
  // carry the frame (§1.1.1), so no impostor layer is needed.
  grids: Partial<Record<'coarse' | 'mid' | 'fine', number>>;
  colorA: number; colorB: number; // §7.3 instance tint ramp (§2 palette)
  scaleMin: number; scaleMax: number;
  count: number;                  // capacity HIGH/MEDIUM; LOW takes half (§6.3)
  windAmp: number;                // §5.2 T5 default 0.15
  shadow: boolean;                // castShadow HIGH/MEDIUM; LOW forces false (§7.3)
  trunk?: boolean;                // pair with an instanced trunk mesh
  riverGap?: number;              // min |x| — river bed exclusion (default 22)
  snowFade?: boolean;             // thin out toward the sierra snow line
}

const REGION_SPECIES: Record<RegionId, SpeciesPalette[]> = {
  cloud_forest: [
    // §2.2: canopy deep/mid green, broadleaf cards, orchid accents (≤2% frame)
    { id: 'cf_broadleaf', kind: 'broadleaf', cardW: 5.5, cardH: 4.8, planes: 3, y0: 2.2,
      grids: { mid: 0.55, coarse: 0.1 }, colorA: 0x2c3e22, colorB: 0x32442f,
      scaleMin: 0.75, scaleMax: 1.35, count: 700, windAmp: 0.15, shadow: true, trunk: true },
    { id: 'cf_fern', kind: 'fern', cardW: 1.7, cardH: 1.5, planes: 3, y0: 0,
      grids: { mid: 0.5 }, colorA: 0x2c3e22, colorB: 0x32442f,
      scaleMin: 0.65, scaleMax: 1.3, count: 850, windAmp: 0.15, shadow: false },
    { id: 'cf_tuft', kind: 'grass', cardW: 1.0, cardH: 0.85, planes: 2, y0: 0,
      grids: { fine: 0.55 }, colorA: 0x2c3e15, colorB: 0x32442f,
      scaleMin: 0.7, scaleMax: 1.5, count: 800, windAmp: 0.15, shadow: false },
    { id: 'cf_orchid', kind: 'orchid', cardW: 0.55, cardH: 0.5, planes: 2, y0: 0,
      grids: { mid: 0.09 }, colorA: 0xC9A0DC, colorB: 0xB892CC,
      scaleMin: 0.8, scaleMax: 1.3, count: 300, windAmp: 0.15, shadow: false },
  ],
  high_sierra: [
    // §2.3: ichu grass lit/shadowed, thin air — treeline + snow line fade-outs
    { id: 'hs_ichu', kind: 'grass', cardW: 1.4, cardH: 1.1, planes: 2, y0: 0,
      grids: { fine: 0.85 }, colorA: 0x9A8B4F, colorB: 0x6B6335,
      scaleMin: 0.9, scaleMax: 1.8, count: 2100, windAmp: 0.15, shadow: false, snowFade: true },
    { id: 'hs_broadleaf', kind: 'broadleaf', cardW: 4.5, cardH: 4.0, planes: 3, y0: 1.9,
      grids: { mid: 0.06, coarse: 0.02 }, colorA: 0x6B6335, colorB: 0x8A7D4A,
      scaleMin: 0.6, scaleMax: 1.1, count: 300, windAmp: 0.15, shadow: true, trunk: true, snowFade: true },
    { id: 'hs_tuft', kind: 'grass', cardW: 0.9, cardH: 0.75, planes: 2, y0: 0,
      grids: { mid: 0.06 }, colorA: 0x6B6335, colorB: 0x9A8B4F,
      scaleMin: 0.6, scaleMax: 1.2, count: 250, windAmp: 0.15, shadow: false, snowFade: true },
  ],
  jungle_lowlands: [
    // §2.4: canopy dark / understory green — dense, swallowed by vegetation
    { id: 'jl_fern', kind: 'fern', cardW: 1.9, cardH: 1.65, planes: 3, y0: 0,
      grids: { mid: 0.55 }, colorA: 0x2a3e20, colorB: 0x2f4229,
      scaleMin: 0.7, scaleMax: 1.4, count: 950, windAmp: 0.15, shadow: false },
    { id: 'jl_broadleaf', kind: 'broadleaf', cardW: 6.0, cardH: 5.2, planes: 3, y0: 2.4,
      grids: { mid: 0.5, coarse: 0.12 }, colorA: 0x2a3e20, colorB: 0x2f4229,
      scaleMin: 0.8, scaleMax: 1.5, count: 850, windAmp: 0.15, shadow: true, trunk: true },
    { id: 'jl_tuft', kind: 'grass', cardW: 1.1, cardH: 0.9, planes: 2, y0: 0,
      grids: { fine: 0.55 }, colorA: 0x2f4229, colorB: 0x2a3e20,
      scaleMin: 0.7, scaleMax: 1.5, count: 850, windAmp: 0.15, shadow: false },
  ],
  paititi: [
    // §2.5: encroaching green at the city's edges only — the city itself is
    // maintained stone (paititiEdgeFalloff scales all three probabilities).
    { id: 'pa_tuft', kind: 'grass', cardW: 1.0, cardH: 0.85, planes: 2, y0: 0,
      grids: { fine: 0.25 }, colorA: 0x2c3e15, colorB: 0x32442f,
      scaleMin: 0.7, scaleMax: 1.4, count: 500, windAmp: 0.15, shadow: false },
    { id: 'pa_fern', kind: 'fern', cardW: 1.6, cardH: 1.4, planes: 3, y0: 0,
      grids: { mid: 0.12 }, colorA: 0x2c3e15, colorB: 0x32442f,
      scaleMin: 0.7, scaleMax: 1.3, count: 450, windAmp: 0.15, shadow: false },
    { id: 'pa_broadleaf', kind: 'broadleaf', cardW: 5.0, cardH: 4.4, planes: 3, y0: 2.0,
      grids: { mid: 0.06, coarse: 0.02 }, colorA: 0x2c3e15, colorB: 0x32442f,
      scaleMin: 0.7, scaleMax: 1.2, count: 250, windAmp: 0.15, shadow: true, trunk: true },
  ],
};

// --- shared geometry builders -------------------------------------------------

// Crossed alpha-tested cards: N planes rotated about Y, merged into one
// geometry. Plane size (cardW × cardH), base at y=0 (planted), optionally
// lifted by `y0` (tree canopies start at trunk-top height).
function crossedCardGeometry(cardW: number, cardH: number, planes: 1 | 2 | 3, y0: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < planes; i++) {
    const p = new THREE.PlaneGeometry(cardW, cardH);
    p.rotateY((i / planes) * Math.PI);
    p.translate(0, y0 + cardH / 2, 0);
    parts.push(p);
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('decor: card merge failed');
  for (const p of parts) p.dispose();
  return merged;
}

// Irregular boulder: icosphere with deterministic position-hashed radial
// displacement (duplicated verts displace identically — hash is by direction —
// so no cracks), welded for smooth normals. Replaces the placeholder
// DodecahedronGeometry (§0: reads as low-poly at any distance under 60 m).
function displacedRockGeometry(): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const welded = mergeVertices(ico);
  ico.dispose();
  const pos = welded.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = hash2(v.x * 3.7 + v.y * 7.9, v.z * 5.3 - v.y * 2.1, 17);
    const r = 1 + (h - 0.5) * 0.55;
    pos.setXYZ(i, v.x * r, v.y * r * 0.8, v.z * r);
  }
  welded.computeVertexNormals();
  return welded;
}

// Instanced trunk: 7-sided tapered cylinder, base embedded 0.25 m (§1.3).
function trunkGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.18, 0.42, 3.4, 7);
  g.translate(0, 1.45, 0);
  return g;
}

// --- §5.2 T5 wind — WebGL2 injection -----------------------------------------
// Exact formula, injected into <begin_vertex> (local space, pre-instance —
// identical to the TSL path's positionLocal.add). Per-instance hash arrives
// via the aHash instanced attribute; phase uses the instance-transformed world
// x (meshes live at the scene root, so instanceMatrix space == world space).
function injectWindGLSL(
  shader: THREE.WebGLProgramParametersWithUniforms, y0: number, hnorm: number, windAmp: number,
  ownerMat: THREE.Material
): void {
  shader.uniforms.uTime = { value: 0 };
  shader.uniforms.uWindAmp = { value: windAmp };
  shader.vertexShader =
    'uniform float uTime;\nuniform float uWindAmp;\nattribute float aHash;\n' +
    shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    // §5.2 T5: offset.x += sin(time*1.3 + worldPos.x*0.5 + hash) * amp * heightFactor
    #ifdef USE_INSTANCING
      vec4 windWPos = instanceMatrix * vec4(position, 1.0);
      float windHF = clamp((position.y - (${y0.toFixed(4)})) * (${hnorm.toFixed(6)}), 0.0, 1.0);
      transformed.x += sin(uTime * 1.3 + windWPos.x * 0.5 + aHash) * uWindAmp * windHF;
    #endif
    `
  );
  // The wind clock is driven through this ref — without it the uniform write
  // silently hits nothing and the foliage never sways (caught by the §8.3
  // wind A/B pair diffing to exactly zero).
  ownerMat.userData.shader = shader;
}

// --- runtime species record ----------------------------------------------------

interface SpeciesRuntime {
  regionId: RegionId;
  pal: SpeciesPalette;
  spec: FoliageSpec;
  mesh: THREE.InstancedMesh;
  trunkMesh: THREE.InstancedMesh | null;
  hashAttr: THREE.InstancedBufferAttribute | null; // card species only
  salt: number;
  cursor: number;
}

interface ScatterRuntime {  // rocks + mist (no §7.3 spec, no wind, no tint)
  mesh: THREE.InstancedMesh;
  count: number;
  salt: number;
  cursor: number;
  prob: Partial<Record<RegionId, number>>;
  riverGap: number;
}

const GRID_PARAMS = {
  coarse: { step: 28, radius: 560 },
  mid: { step: 14, radius: 210 },
  fine: { step: 4, radius: 88 },
} as const;

const RESCAN_DIST_SQ = 12 * 12;

export class DecorManager {
  scene: THREE.Scene;
  caps: RenderCaps;
  dummy = new THREE.Object3D();
  colorDummy = new THREE.Color();

  species: SpeciesRuntime[] = [];
  rocks: ScatterRuntime[] = [];
  mist: ScatterRuntime;

  private windGlslMats: THREE.Material[] = [];        // WebGL2: uTime holders
  private tslTimeUniforms: Array<{ value: number }> = []; // WebGPU: uniform(0) nodes
  private scanCam = new THREE.Vector3(1e9, 0, 1e9);
  private regionBias: Record<RegionId, number> = {
    cloud_forest: 1, high_sierra: 1, jungle_lowlands: 1, paititi: 1,
  };

  constructor(scene: THREE.Scene, caps?: RenderCaps) {
    this.scene = scene;
    // §7.2: modules take RenderCaps, never re-detect. (The old local
    // RenderCaps re-declaration + falsy default silently forced HIGH tier and
    // disabled the WebGPU branch — main.ts now passes real caps.)
    this.caps = caps ?? { isWebGPU: false, tier: 'HIGH', maxAnisotropy: 4 };
    const tier = this.caps.tier;
    const lowTier = tier === 'LOW';
    const countScale = lowTier ? 0.5 : 1; // §6.3: instance count 5000→2500 on LOW

    const leafNormal = createNormalTexture(128, 4, 1.6);
    const barkNormal = createNormalTexture(128, 3, 2.4);
    const trunkGeo = trunkGeometry();
    const rockGeo = displacedRockGeometry();

    let salt = 3;
    const cardCache = new Map<FoliageCardKind, THREE.Texture>();
    for (const [regionId, palettes] of Object.entries(REGION_SPECIES) as Array<[RegionId, SpeciesPalette[]]>) {
      for (const pal of palettes) {
        // One deterministic card per KIND, shared across palettes.
        let cardTexture = cardCache.get(pal.kind);
        if (!cardTexture) {
          cardTexture = createFoliageCardTexture(pal.kind);
          cardCache.set(pal.kind, cardTexture);
        }
        const count = Math.max(8, Math.round(pal.count * countScale));
        const spec: FoliageSpec = {
          cardTexture,
          colorA: pal.colorA,
          colorB: pal.colorB,
          count,
          windAmp: pal.windAmp,
          castShadow: pal.shadow && !lowTier, // §7.3: false LOW
        };

        const mat = this.buildCardMaterial(pal, spec, leafNormal);
        const geo = crossedCardGeometry(pal.cardW, pal.cardH, pal.planes, pal.y0);
        const hashAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
        hashAttr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('aHash', hashAttr);

        const mesh = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>(geo, mat, count);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = spec.castShadow;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // instances span the camera surroundings
        this.scene.add(mesh);

        // Shadow pass renders the alpha-tested silhouette WITH wind — a
        // static-depth shadow would detach from the swaying cards.
        const depthMat = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          map: spec.cardTexture,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        });
        depthMat.onBeforeCompile = (shader) => injectWindGLSL(shader, pal.y0, 1 / pal.cardH, spec.windAmp, depthMat);
        this.windGlslMats.push(depthMat);
        mesh.customDepthMaterial = depthMat;

        let trunkMesh: THREE.InstancedMesh | null = null;
        if (pal.trunk) {
          const trunkMat = woodAged();
          trunkMat.normalMap = barkNormal;
          trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
          trunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          trunkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
          trunkMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
          trunkMesh.castShadow = spec.castShadow;
          trunkMesh.receiveShadow = true;
          trunkMesh.frustumCulled = false;
          this.scene.add(trunkMesh);
        }

        this.species.push({ regionId, pal, spec, mesh, trunkMesh, hashAttr, salt: (salt += 7), cursor: 0 });

        // WebGPU node material (T5 via positionNode). TSL is imported
        // dynamically inside the WebGPU branch only (§5.3); on failure the
        // WebGL2-style material above keeps rendering — degraded, never black.
        if (this.caps.isWebGPU) {
          this.buildCardNodeMaterial(pal, spec, leafNormal).then((nodeMat) => {
            if (nodeMat) mesh.material = nodeMat;
          }).catch(() => { /* fallback stays */ });
        }
      }
    }

    // Rocks: two material sets (§2.3 granite / §2.2+§2.4 mossy limestone),
    // region-gated. Capacity trimmed to what placement actually fills — the
    // old 2000-per-mesh capacity processed ~336k parked vertices per frame.
    this.rocks = [
      {
        mesh: this.makeScatterMesh(rockGeo, granite(), Math.round(800 * countScale)),
        count: Math.round(800 * countScale), salt: 901, cursor: 0,
        prob: { cloud_forest: 0.05, high_sierra: 0.6, jungle_lowlands: 0.03, paititi: 0.2 },
        riverGap: 12,
      },
      {
        mesh: this.makeScatterMesh(rockGeo, limestoneSwallowed(), Math.round(800 * countScale)),
        count: Math.round(800 * countScale), salt: 908, cursor: 0,
        prob: { cloud_forest: 0.2, high_sierra: 0.03, jungle_lowlands: 0.3, paititi: 0.06 },
        riverGap: 12,
      },
    ];

    // Mist (§2.2 mist blue-grey, §6.3: depthWrite false, 200→80 on LOW).
    // NormalBlending with a radial alpha sprite — the previous ADDITIVE white
    // quads read as glow, not fog. Probability trimmed so capacity ≈ candidates
    // (the first build rolled 470 candidates into 200 slots and stacked every
    // plane on the west side of the scan — the whiteout wall in the probe).
    const mistGeo = new THREE.PlaneGeometry(20, 10);
    const mistMat = new THREE.MeshBasicMaterial({
      color: 0xA8B8B0,
      map: createMistTexture(),
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mist = {
      mesh: this.makeScatterMesh(mistGeo, mistMat, lowTier ? 80 : 200),
      count: lowTier ? 80 : 200,
      salt: 915, cursor: 0,
      prob: { cloud_forest: 0.12, high_sierra: 0, jungle_lowlands: 0.1, paititi: 0 },
      riverGap: 0, // mist over the river is the money shot
    };
  }

  private makeScatterMesh(geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  // WebGL2 foliage material (also the fallback base on WebGPU — §5.3).
  private buildCardMaterial(pal: SpeciesPalette, spec: FoliageSpec, leafNormal: THREE.Texture): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, // tint via instanceColor (§7.3 colorA..colorB)
      map: spec.cardTexture,
      alphaTest: 0.5,   // §6.3: alpha-TEST, never alpha-blend
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0.0,
      normalMap: leafNormal,
    });
    mat.onBeforeCompile = (shader) => injectWindGLSL(shader, pal.y0, 1 / pal.cardH, spec.windAmp, mat);
    this.windGlslMats.push(mat);
    return mat;
  }

  // WebGPU foliage material: TSL positionNode wind (§5.2 T5), texture color,
  // instanceColor multiplies automatically in NodeMaterial.setupDiffuseColor.
  private async buildCardNodeMaterial(
    pal: SpeciesPalette, spec: FoliageSpec, leafNormal: THREE.Texture
  ): Promise<THREE.Material | null> {
    try {
      const [WEBGPU, TSL] = await Promise.all([
        import('three/webgpu'),
        import('three/tsl'),
      ]);
      const { texture, attribute, positionLocal, positionWorld, sin, clamp, float, vec3, uniform, normalMap } = TSL;

      const mat = new WEBGPU.MeshStandardNodeMaterial();
      mat.roughness = 0.9;
      mat.metalness = 0.0;
      mat.alphaTest = 0.5;
      mat.side = THREE.DoubleSide;
      mat.colorNode = texture(spec.cardTexture);
      mat.normalNode = normalMap(texture(leafNormal));

      // §5.2 T5 — IDENTICAL formula to the WebGL2 injection: sin over
      // (time*1.3 + worldPos.x*0.5 + aHash), scaled by windAmp and the
      // height factor, applied to positionLocal.x.
      const timeU = uniform(0);
      const hashN = attribute('aHash', 'float');
      const heightFactor = clamp(
        float(positionLocal.y).sub(pal.y0).mul(1 / pal.cardH), 0.0, 1.0
      );
      const offset = sin(timeU.mul(1.3).add(positionWorld.x.mul(0.5)).add(hashN))
        .mul(spec.windAmp).mul(heightFactor);
      mat.positionNode = positionLocal.add(vec3(offset, 0, 0));
      this.tslTimeUniforms.push(timeU);
      return mat;
    } catch (e) {
      console.warn('decor: WebGPU foliage node material unavailable, keeping WebGL2 material', e);
      return null;
    }
  }

  // §7.3: region sessions request density biases through this — they never
  // place their own vegetation.
  setRegionFoliageBias(regionId: RegionId, density: number): void {
    this.regionBias[regionId] = Math.min(3, Math.max(0, density));
  }

  // Wind clock + camera-following placement. `timeSeconds` lets shot mode
  // (?shot=, §8) freeze/advance wind deterministically for the motion gate
  // ("foliage shows wind displacement between two t= captures").
  update(camera: THREE.Camera, timeSeconds?: number): void {
    const t = timeSeconds !== undefined ? timeSeconds : performance.now() / 1000;
    for (const m of this.windGlslMats) {
      const sh = m.userData.shader as
        | { uniforms: { uTime: { value: number } } }
        | undefined;
      if (sh) sh.uniforms.uTime.value = t;
    }
    for (const u of this.tslTimeUniforms) u.value = t;

    const cam = camera.position;
    if (this.scanCam.distanceToSquared(cam) > RESCAN_DIST_SQ) {
      this.rebuild(cam);
    }
  }

  // ------------------------------------------------------------------
  // Placement — three grids around the camera; rescan only on camera move.
  // No allocations inside the loops (dummy + colorDummy reused).
  // ------------------------------------------------------------------
  private rebuild(cam: THREE.Vector3): void {
    this.scanCam.copy(cam);
    const camX = cam.x, camZ = cam.z;

    for (const s of this.species) s.cursor = 0;
    for (const r of this.rocks) r.cursor = 0;
    this.mist.cursor = 0;

    const scan = (grid: 'coarse' | 'mid' | 'fine') => {
      const { step, radius } = GRID_PARAMS[grid];
      const cx0 = Math.floor((camX - radius) / step);
      const cx1 = Math.floor((camX + radius) / step);
      const cz0 = Math.floor((camZ - radius) / step);
      const cz1 = Math.floor((camZ + radius) / step);

      for (let ci = cx0; ci <= cx1; ci++) {
        const qx = ci * step + step / 2;
        for (let cj = cz0; cj <= cz1; cj++) {
          const qz = cj * step + step / 2;

          // Dominant biome at the CELL (species switch where ground color
          // switches — same bands as the terrain color script).
          const w = biomeWeights(qx, qz);
          let best = w.cf, domId: RegionId = 'cloud_forest';
          if (w.hs > best) { best = w.hs; domId = 'high_sierra'; }
          if (w.jl > best) { best = w.jl; domId = 'jungle_lowlands'; }
          if (w.pa > best) { best = w.pa; domId = 'paititi'; }

          for (const s of this.species) {
            if (s.cursor >= s.spec.count) continue;
            if (s.regionId !== domId) continue;
            const gridProb = s.pal.grids[grid];
            if (!gridProb) continue;
            this.placeSpecies(s, qx, qz, step, domId, gridProb, grid);
          }
          if (grid === 'coarse') {
            for (const r of this.rocks) {
              if (r.cursor >= r.count) continue;
              this.placeScatter(r, qx, qz, step, domId, 'rock');
            }
            if (this.mist.cursor < this.mist.count) {
              this.placeScatter(this.mist, qx, qz, step, domId, 'mist');
            }
          }
        }
      }
    };

    scan('coarse');
    scan('mid');
    scan('fine');

    // Park unused instances below the world, out of every frustum.
    const d = this.dummy;
    d.position.set(0, -1000, 0);
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(1);
    d.updateMatrix();
    for (const s of this.species) {
      for (let i = s.cursor; i < s.spec.count; i++) s.mesh.setMatrixAt(i, d.matrix);
      if (s.trunkMesh) {
        for (let i = s.cursor; i < s.spec.count; i++) s.trunkMesh.setMatrixAt(i, d.matrix);
        s.trunkMesh.instanceMatrix.needsUpdate = true;
      }
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
      if (s.hashAttr) s.hashAttr.needsUpdate = true;
    }
    for (const r of this.rocks) {
      for (let i = r.cursor; i < r.count; i++) r.mesh.setMatrixAt(i, d.matrix);
      r.mesh.instanceMatrix.needsUpdate = true;
    }
    for (let i = this.mist.cursor; i < this.mist.count; i++) this.mist.mesh.setMatrixAt(i, d.matrix);
    this.mist.mesh.instanceMatrix.needsUpdate = true;
  }

  private placeSpecies(
    s: SpeciesRuntime, qx: number, qz: number, step: number, domId: RegionId,
    gridProb: number, grid: 'coarse' | 'mid' | 'fine'
  ): void {
    const pal = s.pal;
    // Salt is per (species, grid) so the mid and coarse scans of a tree
    // species decorrelate — no lattice echo between the two rings.
    const salt = s.salt + (grid === 'coarse' ? 7919 : grid === 'mid' ? 15803 : 0);
    const r0 = hash2(qx, qz, salt);

    let prob = gridProb * this.regionBias[domId];
    if (domId === 'paititi') prob *= paititiEdgeFalloff(qx, qz);
    if (r0 >= prob) return;

    // In-cell jitter + grounding at the FINAL position (§1.3 no floating —
    // cell-center-only sampling is what let props hover on slopes).
    const r1 = hash2(qx, qz, salt + 1);
    const r2 = hash2(qx, qz, salt + 2);
    const r3 = hash2(qx, qz, salt + 3);
    const r4 = hash2(qx, qz, salt + 4);
    const fx = qx + (r3 - 0.5) * step * 0.7;
    const fz = qz + (r4 - 0.5) * step * 0.7;

    const gap = pal.riverGap ?? 22;
    if (Math.abs(fx) < gap) return; // river bed exclusion
    // p5 cross-file touch: the Phase 5 water solve filled the carved trench
    // (up to ±60 m in wide sections — the old riverGap was tuned against the
    // dry-bed read). Vegetation standing in the river fails the §8.3
    // photograph test; rocks deliberately stay (half-submerged boulders are
    // the §2.4 bank vocabulary) and mist stays (over-water mist intended).
    // 0.25 m: the trench walls are steep, so the visible waterline contour
    // is sharp — anything deeper than ankle-water is out.
    if (waterDepthAt(fx, fz) > 0.25) return;

    const y = getGlobalTerrainHeight(fx, fz);
    if (pal.snowFade) {
      const fade = 1 - smoothstepf(62, 78, y);
      if (r2 > fade) return; // thin out toward the sierra snow line
    }

    const scale = pal.scaleMin + (pal.scaleMax - pal.scaleMin) * r1;
    const d = this.dummy;
    d.position.set(fx, y - 0.05 * scale, fz); // slight embed, slope-safe
    d.rotation.set((r2 - 0.5) * 0.12, r1 * Math.PI * 2, (r4 - 0.5) * 0.12);
    d.scale.set(scale, scale, scale);
    d.updateMatrix();

    const i = s.cursor;
    s.mesh.setMatrixAt(i, d.matrix);
    // §7.3 tint: colorA → colorB by instance hash.
    this.colorDummy.setHex(pal.colorA).lerp(_tmpColor.setHex(pal.colorB), r2);
    s.mesh.setColorAt(i, this.colorDummy);
    if (s.hashAttr) s.hashAttr.setX(i, r3 * 6.2831853); // per-instance wind phase
    if (s.trunkMesh) {
      s.trunkMesh.setMatrixAt(i, d.matrix);
      // Bark value jitter, pulled DARK (0.45–0.72): near-white jitter made the
      // instanced trunks read flesh-toned against the cloud-forest palette.
      this.colorDummy.setScalar(0.45 + r4 * 0.27);
      s.trunkMesh.setColorAt(i, this.colorDummy);
    }
    s.cursor++;
  }

  private placeScatter(
    r: ScatterRuntime, qx: number, qz: number, step: number, domId: RegionId, kind: 'rock' | 'mist'
  ): void {
    const r0 = hash2(qx, qz, r.salt);
    let prob = r.prob[domId] ?? 0;
    if (domId === 'paititi' && kind === 'rock') prob *= paititiEdgeFalloff(qx, qz);
    if (r0 >= prob) return;
    const r1 = hash2(qx, qz, r.salt + 1);
    const r2 = hash2(qx, qz, r.salt + 2);
    const r3 = hash2(qx, qz, r.salt + 3);
    const fx = qx + (r1 - 0.5) * step * 0.7;
    const fz = qz + (r2 - 0.5) * step * 0.7;
    if (Math.abs(fx) < r.riverGap) return;

    const y = getGlobalTerrainHeight(fx, fz);
    const d = this.dummy;
    if (kind === 'rock') {
      const scale = 0.45 + r1 * 1.95;
      d.position.set(fx, y - 0.3 * scale, fz); // embedded — sits into slopes
      d.rotation.set(r2 * Math.PI, r3 * Math.PI * 2, r1 * Math.PI);
      d.scale.set(scale * (0.8 + r2 * 0.5), scale * (0.7 + r3 * 0.5), scale * (0.8 + r1 * 0.5));
    } else {
      if (y > 26) return; // mist sits in valleys/forest floors, not peaks
      // Never envelop the camera — a 20 m sprite at 5 m fills half the frame
      // with white and defeats the fog it is supposed to thicken.
      if (Math.hypot(fx - this.scanCam.x, fz - this.scanCam.z) < 40) return;
      d.position.set(fx, y + 3.5 + r3 * 5.5, fz);
      d.rotation.set(0, r2 * Math.PI, 0);
      d.scale.set(1 + r1 * 1.4, 0.9 + r2 * 0.9, 1);
    }
    d.updateMatrix();
    r.mesh.setMatrixAt(r.cursor, d.matrix);
    r.cursor++;
  }
}

const _tmpColor = new THREE.Color();

export function createDecor(scene: THREE.Scene, caps?: RenderCaps) {
  return new DecorManager(scene, caps);
}
