import * as THREE from 'three';
import { createNormalTexture } from './textures.js';
import { getGlobalTerrainHeight } from './terrain.js';
import type { RenderCaps } from './renderer.js';

// §7.5 Water contract (interface verbatim). RenderCaps imported from
// renderer.ts (§7.2) — this file previously re-declared the interface
// locally, the same hygiene defect Phase 4 removed from decor.ts.
export interface WaterSpec {
  color: number;          // e.g. 0x335566 river, 0x14261E jungle pool
  roughness: number;      // 0.05–0.15
  opacity: number;        // 0.85 WebGL2 / 1.0 w/ transmission WebGPU
  flowSpeed: number;      // uv scroll units/sec, e.g. 0.6
  flowDir: [number, number];
  foamAtEdges: boolean;   // true for rivers/channels
}

// Named presets for the §7.5 rule "region sessions create water through
// createWaterSurface, never raw planes": §7.5 river example + the normative
// §2.4 jungle dark water and §2.5 Paititi channel hexes.
export const WATER_PRESETS: Record<'river' | 'junglePool' | 'paititiChannel', WaterSpec> = {
  river:          { color: 0x335566, roughness: 0.08, opacity: 0.85, flowSpeed: 0.6, flowDir: [0, 1], foamAtEdges: true },
  junglePool:     { color: 0x14261E, roughness: 0.12, opacity: 0.88, flowSpeed: 0.15, flowDir: [0, 1], foamAtEdges: true },
  paititiChannel: { color: 0x2E5A6E, roughness: 0.06, opacity: 0.8, flowSpeed: 0.4, flowDir: [1, 0], foamAtEdges: false },
};

export interface WaterSurfaceOptions {
  // 'channel' (default): water level derives from the carved river trench —
  //   Wc(z) = bed(0,z) + DEPTH_CENTER, soft-draped onto the bed with a
  //   minimum 0.35 m clearance (z-fight-proof) and depth-based alpha fade.
  // 'level': flat absolute water level — the form region sessions (V-REG1/2)
  //   use for pools/channels away from the main river.
  conform?: 'channel' | 'level';
  level?: number;
  // Verification A/B: &nf=1 disables the foam band (isolates the foam read).
  foam?: boolean;
  lowTier?: boolean;
}

// Shared constants — consumed by BOTH shader paths with identical values
// (§5.4 convergence discipline; the TSL branch and the onBeforeCompile
// injection must produce the same image by construction).
const DEPTH_CENTER = 6.0;   // m of water above the channel-centerline bed
const PLANE_W = 120;        // covers measured max waterline half-width (~60 m)
const ABSORB: [number, number, number] = [0.35, 0.12, 0.08]; // Beer-Lambert σ per meter (r,g,b) — tuned for the §2.4 near-black-green deep read
const FOAM_NEAR = 0.3;      // depth (m) at which foam reaches full strength
const FOAM_FAR = 1.0;       // depth (m) where the foam band ends
const FADE_NEAR = 0.15;     // depth-alpha fade: transparent below this depth…
const FADE_FAR = 1.2;       // …opaque above it (kills floodplain spill visually)
const TILE_A: [number, number] = [20, 166.7];   // ripple layer, ~6 m tiles
const TILE_B: [number, number] = [8.6, 71.4];   // swell layer, ~14 m tiles
const UV_SHEAR = 0.618;     // golden-ratio shear on layer B — breaks the
                            // vertical moiré of aligned tile columns
const NORMAL_STRENGTH = 1.6;                    // applied to the blended normal
const CASCADE_DROP = 2.0;   // m drop per 4 m step that warrants a cascade sheet.
                            // Measured (p5 probe): max profile drop 1.67 m/4 m
                            // — DORMANT in this height field (the original
                            // |Δh|>4 trigger was unreachable dead code; a 1.6
                            // threshold fired exactly once and produced a
                            // floating dark quad). Kept generic for region
                            // sessions whose terrain produces true drops.
const JUNGLE_WATER = 0x14261E; // §2.4 dark water (normative)
const FOAM_COLOR = 0xdde4e2;   // NOT pure white — §8.3 clipped-whites safety

function smoothstepf(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Shared water-presence probe for other systems (decor vegetation exclusion):
// returns the water column depth (m) at a world position under the SAME
// channel solve the surface mesh uses. 0 = dry. Keeps trees/grass out of the
// flooded trench without duplicating the solve (decor p5 cross-file touch).
export function waterDepthAt(x: number, z: number): number {
  const bed = getGlobalTerrainHeight(x, z);
  const wc = getGlobalTerrainHeight(0, z) + DEPTH_CENTER;
  return Math.max(0, wc - bed);
}

// Build the conforming water geometry for one surface. Vertices carry three
// custom attributes consumed identically by both shader paths:
//   aDepth  — water column above the bed at this vertex (m; 0 on dry land)
//   aShore  — 1 interior → 0 at the plane border (geometry-edge alpha fade)
//   aTint   — final water albedo (spec.color blended toward §2.4 dark water
//             across the jungle band, the same 60 m transition the terrain
//             color script uses — Phase 3 bands, reused verbatim)
function buildWaterGeometry(
  spec: WaterSpec, width: number, length: number, opts: WaterSurfaceOptions, lowTier: boolean
): THREE.PlaneGeometry {
  const segX = lowTier ? 36 : 60;
  const segZ = lowTier ? 125 : 250;
  const geometry = new THREE.PlaneGeometry(width, length, segX, segZ);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const depths = new Float32Array(count);
  const shores = new Float32Array(count);
  const tints = new Float32Array(count * 3);

  const cRiver = new THREE.Color(spec.color);
  const cJungle = new THREE.Color(JUNGLE_WATER);
  const tint = new THREE.Color();

  const halfW = width / 2;
  const halfL = length / 2;
  const edgeFade = 6; // m of alpha ramp at the plane border
  const conform: 'channel' | 'level' = opts.conform ?? 'channel';

  for (let i = 0; i < count; i++) {
    const wx = pos.getX(i);
    const wz = pos.getZ(i);
    const bed = getGlobalTerrainHeight(wx, wz);

    let y: number;
    if (conform === 'level') {
      y = opts.level ?? 0;
    } else {
      // Channel solve: the water surface is the trench fill level —
      // Wc(z) = bed(0,z) + DEPTH_CENTER — with NO conform clamping. In the
      // trench the surface stands DEPTH_CENTER above the bed (real water
      // column); on the banks it passes BELOW the terrain and the depth
      // test hides it. The old code used min(bed(0,z)+8, bed(x,z)), which
      // glued the surface ONTO the bed (exact coplanarity = the documented
      // poke-through/z-fight family) and over-topped the trench in dip
      // phases. A earlier p5 draft clamped y to bed+0.35 ("shelf") with an
      // inverted min() — the whole river rendered as a 0.35 m foam sheet
      // (alpha ≈ 0.1, foam ≈ 1.0 — measured dead in the first probe).
      y = getGlobalTerrainHeight(0, wz) + DEPTH_CENTER;
    }
    pos.setY(i, y);

    depths[i] = Math.max(0, y - bed);

    // Geometry-edge alpha ramp (both x borders and both z ends).
    const fx = Math.min(wx + halfW, halfW - wx) / edgeFade;
    const fz = Math.min(wz + halfL, halfL - wz) / edgeFade;
    shores[i] = Math.min(1, fx, fz);

    if (conform === 'channel') {
      // §2.4 jungle dark water across the same band as the terrain script
      // (wJl = 1 − smoothstep(−430, −370, z)).
      const wJl = 1 - smoothstepf(-430, -370, wz);
      tint.copy(cRiver).lerp(cJungle, wJl * 0.9);
      tints[i * 3] = tint.r;
      tints[i * 3 + 1] = tint.g;
      tints[i * 3 + 2] = tint.b;
    } else {
      tints[i * 3] = cRiver.r; tints[i * 3 + 1] = cRiver.g; tints[i * 3 + 2] = cRiver.b;
    }
  }

  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
  geometry.setAttribute('aShore', new THREE.BufferAttribute(shores, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  return geometry;
}

interface CascadeSheet {
  mesh: THREE.Mesh;
  mat: THREE.MeshPhysicalMaterial;
  baseOpacity: number;
  z: number;
}

// The old waterfall trigger |h(z+5)−h(z)| > 4 is unreachable in this height
// field (measured max Δh over 5 m ≈ 1.5–2.7 m — dead code since Phase 1).
// The cascade scan below runs on the ACTUAL solved water profile and is
// measured to stay dormant too (max drop 1.67 m per 4 m < threshold), but it
// is generic: any future terrain (region sessions) that produces a true
// drop gets a sheet, built from the water material family — never the old
// raw-white MeshStandardMaterial glow planes (§4.4 anti-glow law).
function buildCascadeSheets(
  scene: THREE.Scene, spec: WaterSpec, lowTier: boolean
): { sheets: CascadeSheet[]; count: number; maxDrop: number } {
  const sheets: CascadeSheet[] = [];
  let maxDrop = 0;
  const step = 4;
  const drops: { z: number; drop: number }[] = [];
  for (let z = -500; z < 500; z += step) {
    const a = getGlobalTerrainHeight(0, z) + DEPTH_CENTER;
    const b = getGlobalTerrainHeight(0, z + step) + DEPTH_CENTER;
    const drop = a - b;
    maxDrop = Math.max(maxDrop, drop);
    if (drop > CASCADE_DROP) drops.push({ z: z + step / 2, drop });
  }
  const budget = lowTier ? Math.min(3, drops.length) : drops.length;
  for (let i = 0; i < budget; i++) {
    const { z, drop } = drops[i];
    const topY = getGlobalTerrainHeight(0, z) + DEPTH_CENTER;
    const hgt = drop + 2;
    const geo = new THREE.PlaneGeometry(40, hgt, 1, 8);
    const mat = new THREE.MeshPhysicalMaterial({
      color: spec.color, roughness: 0.3, metalness: 0.0,
      transparent: true, opacity: Math.min(1, spec.opacity + 0.1),
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, topY - hgt / 2, z);
    mesh.receiveShadow = true;
    scene.add(mesh);
    sheets.push({ mesh, mat, baseOpacity: Math.min(1, spec.opacity + 0.1), z });
  }
  return { sheets, count: sheets.length, maxDrop };
}

export function createWaterSurface(
  scene: THREE.Scene, spec: WaterSpec, width: number, length: number,
  caps: RenderCaps, opts: WaterSurfaceOptions = {}
): { mesh: THREE.Mesh; update: (time: number) => void; cascadeStats: { count: number; maxDrop: number } } {
  const lowTier = opts.lowTier ?? caps.tier === 'LOW';
  const foamOn = opts.foam ?? spec.foamAtEdges;

  const geometry = buildWaterGeometry(spec, width, length, opts, lowTier);

  // §6.3 texture budget: normal maps ≤ 256² (LOW tier 128²).
  const texA = createNormalTexture(lowTier ? 128 : 256, 30, 2.0);
  const texB = createNormalTexture(lowTier ? 128 : 256, 9, 1.4);
  for (const t of [texA, texB]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = caps.maxAnisotropy;
  }

  // Shared uniform objects — written by update(), read by the compiled
  // WebGL2 program every frame (onBeforeCompile installs THESE objects, so
  // updates are live before and after compilation — the p4 lesson about
  // uniform writes not sticking does not apply to shared objects).
  const flowA = { value: new THREE.Vector2(0, 0) };
  const flowB = { value: new THREE.Vector2(0, 0) };
  const foamUniform = { value: foamOn ? 1 : 0 };

  // WebGL2 path (T6 fallback): MeshPhysicalMaterial, transmission 0
  // (unsupported cost on mobile), opacity from spec, flowing normal layers
  // injected below. This material is ALSO the §5.3 fallback if the WebGPU
  // node material fails to build — degraded, never black.
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, // albedo arrives per-vertex via aTint (shader)
    roughness: spec.roughness,
    metalness: 0.05,
    transparent: true,
    opacity: spec.opacity,
    normalMap: texA, // provides USE_NORMALMAP_TANGENTSPACE + TBN frame
    normalScale: new THREE.Vector2(NORMAL_STRENGTH, NORMAL_STRENGTH),
    depthWrite: false,
    // The smooth-water fresnel mirror at full IBL strength reads as pale
    // concrete (measured p5-iter: the whole surface washed to sky value).
    // 0.35 keeps sun glints (§4.4-legal) but restores the dark-water read.
    envMapIntensity: 0.35,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlowA = flowA;
    shader.uniforms.uFlowB = flowB;
    shader.uniforms.uNormalB = { value: texB };
    shader.uniforms.uTileA = { value: new THREE.Vector2(TILE_A[0], TILE_A[1]) };
    shader.uniforms.uTileB = { value: new THREE.Vector2(TILE_B[0], TILE_B[1]) };
    shader.uniforms.uAbsorb = { value: new THREE.Vector3(ABSORB[0], ABSORB[1], ABSORB[2]) };
    shader.uniforms.uFoamColor = { value: new THREE.Color(FOAM_COLOR) };
    shader.uniforms.uFoamOn = foamUniform;
    shader.uniforms.uNormalStrength = { value: NORMAL_STRENGTH };
    shader.uniforms.uOpacity = { value: spec.opacity };

    shader.vertexShader = (
      'attribute float aDepth;\n' +
      'attribute float aShore;\n' +
      'attribute vec3 aTint;\n' +
      'varying vec2 vWaterUv;\n' +
      'varying float vWaterDepth;\n' +
      'varying float vShore;\n' +
      'varying vec3 vTint;\n' +
      'varying vec3 vWorldPos;\n' +
      shader.vertexShader
    ).replace(
      '#include <uv_vertex>',
      '#include <uv_vertex>\n' +
      'vWaterUv = uv;\n' +
      'vWaterDepth = aDepth;\n' +
      'vShore = aShore;\n' +
      'vTint = aTint;\n'
    ).replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' +
      'vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n'
    );

    shader.fragmentShader = (
      'varying vec2 vWaterUv;\n' +
      'varying float vWaterDepth;\n' +
      'varying float vShore;\n' +
      'varying vec3 vTint;\n' +
      'varying vec3 vWorldPos;\n' +
      'uniform vec2 uFlowA;\n' +
      'uniform vec2 uFlowB;\n' +
      'uniform sampler2D uNormalB;\n' +
      'uniform vec2 uTileA;\n' +
      'uniform vec2 uTileB;\n' +
      'uniform vec3 uAbsorb;\n' +
      'uniform vec3 uFoamColor;\n' +
      'uniform float uFoamOn;\n' +
      'uniform float uNormalStrength;\n' +
      'uniform float uOpacity;\n' +
      'float p5Foam;\n' +
      shader.fragmentShader
    ).replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n' +
      '{\n' +
      '  vec3 viewDirW = normalize( cameraPosition - vWorldPos );\n' +
      '  float pathM = vWaterDepth / clamp( abs( viewDirW.y ), 0.30, 1.0 );\n' +
      '  vec3 transmittance = exp( -uAbsorb * pathM );\n' +
      // spec-clean inverted ramp (GLSL smoothstep is undefined for edge0 > edge1)
      '  p5Foam = uFoamOn * ( 1.0 - smoothstep( ' + FOAM_NEAR.toFixed(2) + ', ' + FOAM_FAR.toFixed(2) + ', vWaterDepth ) );\n' +
      // intermittent patches: modulate the band by the swell-layer texture
      // (r-channel ~0.5 mean) so the shore foam reads broken, not painted-on
      '  float foamNoise = texture2D( uNormalB, vWaterUv * uTileB * 0.5 + uFlowB + vec2( 0.0, vWaterUv.x * ' + UV_SHEAR.toFixed(3) + ' ) ).g;\n' +
      '  p5Foam *= 0.35 + 0.85 * foamNoise;\n' +
      '  vec3 albedo = vTint * transmittance;\n' +
      '  diffuseColor.rgb = mix( albedo, uFoamColor, p5Foam );\n' +
      '  float depthFade = smoothstep( ' + FADE_NEAR.toFixed(2) + ', ' + FADE_FAR.toFixed(2) + ', vWaterDepth );\n' +
      '  diffuseColor.a *= uOpacity * vShore * depthFade;\n' +
      '}\n'
    ).replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n' +
      'roughnessFactor = mix( roughnessFactor, 0.85, p5Foam );\n'
    ).replace(
      '#include <normal_fragment_maps>',
      '#ifdef USE_NORMALMAP_TANGENTSPACE\n' +
      '  vec2 uvA = vWaterUv * uTileA + uFlowA;\n' +
      '  vec2 uvB = vWaterUv * uTileB + uFlowB + vec2( 0.0, vWaterUv.x * ' + UV_SHEAR.toFixed(3) + ' );\n' +
      '  vec3 nA = texture2D( normalMap, uvA ).xyz * 2.0 - 1.0;\n' +
      '  vec3 nB = texture2D( uNormalB, uvB ).xyz * 2.0 - 1.0;\n' +
      '  vec3 mapN = normalize( vec3( nA.xy + nB.xy, nA.z * nB.z ) );\n' +
      '  mapN.xy *= normalScale;\n' +
      '  normal = normalize( tbn * mapN );\n' +
      '#endif\n'
    );
  };

  const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false; // one 120×1000 m surface — bounding-sphere
                              // culling would pop it off in far vantages
  scene.add(mesh);

  // WebGPU path (§5.2 T6 reference): MeshPhysicalMaterial transmission 0.6
  // on HIGH tier (§6.3), TSL nodes computing the IDENTICAL Beer-Lambert /
  // foam / two-layer normal math. Built async per the §5.3 rules (dynamic
  // import inside the isWebGPU branch only) and swapped in on success —
  // on failure the WebGL2-equivalent material above keeps rendering.
  let tslFlowA: { value: THREE.Vector2 } | null = null;
  let tslFlowB: { value: THREE.Vector2 } | null = null;
  if (caps.isWebGPU) {
    buildWaterNodeMaterial(spec, texA, texB, caps, foamOn)
      .then((built) => {
        if (built) {
          mesh.material = built.mat;
          tslFlowA = built.flowA;
          tslFlowB = built.flowB;
        }
      })
      .catch(() => { /* fallback stays */ });
  }

  const cascades = buildCascadeSheets(scene, spec, lowTier);

  return {
    mesh,
    cascadeStats: { count: cascades.count, maxDrop: cascades.maxDrop },
    update: (time: number) => {
      // Bounded, allocation-free flow clocks (§6.3 no per-frame allocations;
      // % 1 wrap keeps float precision stable over long sessions).
      const ax = (spec.flowSpeed * spec.flowDir[0] * time) % 1;
      const ay = (spec.flowSpeed * spec.flowDir[1] * time) % 1;
      const bx = (spec.flowSpeed * 0.55 * spec.flowDir[0] * time) % 1;
      const by = (spec.flowSpeed * 0.55 * spec.flowDir[1] * time) % 1;
      flowA.value.set(ax, ay);
      flowB.value.set(bx, by);
      if (tslFlowA) tslFlowA.value.set(ax, ay);
      if (tslFlowB) tslFlowB.value.set(bx, by);
      for (const s of cascades.sheets) {
        s.mat.opacity = s.baseOpacity * (0.9 + 0.1 * Math.sin(time * 2.0 + s.z));
      }
    },
  };
}

// WebGPU TSL node material — the §5.2 T6 reference technique. Mirrors the
// WebGL2 injection exactly: aTint × Beer-Lambert transmittance, depth-band
// foam, shore/depth alpha fade, whiteout-blended two-layer flowing normals
// (blended in TANGENT space, then transformed by the TBN frame — the same
// order as the GLSL injection).
async function buildWaterNodeMaterial(
  spec: WaterSpec, texA: THREE.Texture, texB: THREE.Texture, caps: RenderCaps, foamOn: boolean
): Promise<{ mat: THREE.Material; flowA: { value: THREE.Vector2 }; flowB: { value: THREE.Vector2 } } | null> {
  try {
    const [WEBGPU, TSL] = await Promise.all([
      import('three/webgpu'),
      import('three/tsl'),
    ]);
    const {
      texture, attribute, positionWorld, cameraPosition, TBNViewMatrix,
      float, vec2, vec3, uniform, mix, exp, max, min, abs, normalize,
      uv, color, mul, smoothstep,
    } = TSL;

    const mat = new WEBGPU.MeshPhysicalNodeMaterial();
    mat.roughness = spec.roughness;
    mat.metalness = 0.05;
    mat.transparent = true;
    mat.envMapIntensity = 0.35; // same dark-water read as the WebGL2 path
    // §6.3: transmission 0.6 is WebGPU HIGH only; LOW/MEDIUM ride the
    // opacity fallback exactly like the WebGL2 path.
    const highTier = caps.tier === 'HIGH';
    if (highTier) {
      mat.transmission = 0.6;
      mat.ior = 1.33;
      mat.opacity = 1.0;
    } else {
      mat.opacity = spec.opacity;
    }
    mat.depthWrite = false;

    const depth = attribute('aDepth', 'float');
    const shore = attribute('aShore', 'float');
    const tint = attribute('aTint', 'vec3');

    const flowA = uniform(new THREE.Vector2(0, 0));
    const flowB = uniform(new THREE.Vector2(0, 0));

    // View path length through the water column (same clamp as WebGL2).
    const dirW = normalize(positionWorld.sub(cameraPosition));
    const pathM = depth.div(max(float(0.30), min(abs(dirW.y), float(1.0))));
    const transmittance = exp(vec3(ABSORB[0], ABSORB[1], ABSORB[2]).mul(pathM).negate());

    const foamBand = float(1.0).sub(smoothstep(float(FOAM_NEAR), float(FOAM_FAR), depth));
    const depthFade = smoothstep(float(FADE_NEAR), float(FADE_FAR), depth);

    // Two-layer flowing normals, whiteout blend in tangent space, then the
    // TBN transform — identical formula to the WebGL2 injection. TBNViewMatrix
    // is typed as the bare Node in @types/three; at runtime it IS a mat3
    // node (three's own NormalMapNode does TBNViewMatrix.mul(n).normalize()),
    // so the single Matrix3-shaped assertion below only satisfies the mul()
    // (a: Mat3, b: Vec) overload — no runtime conversion happens.
    const uvShear = vec2(0, uv().x.mul(UV_SHEAR));
    const uvA = uv().mul(vec2(TILE_A[0], TILE_A[1])).add(flowA);
    const uvB = uv().mul(vec2(TILE_B[0], TILE_B[1])).add(flowB).add(uvShear);
    const nA = texture(texA, uvA).rgb.mul(2).sub(1);
    const nB = texture(texB, uvB).rgb.mul(2).sub(1);
    // same intermittent-patch foam modulation as the WebGL2 color injection
    const foamNoise = texture(texB, uv().mul(vec2(TILE_B[0], TILE_B[1])).mul(0.5).add(flowB).add(uvShear)).g;
    const foam = foamBand.mul(float(foamOn ? 1 : 0)).mul(foamNoise.mul(0.85).add(0.35));

    mat.colorNode = mix(tint.mul(transmittance), color(FOAM_COLOR), foam);
    mat.roughnessNode = mix(float(spec.roughness), float(0.85), foam);
    mat.opacityNode = shore.mul(depthFade).mul(float(highTier ? 1.0 : spec.opacity));

    const blendedXY = vec3(nA.x.add(nB.x), nA.y.add(nB.y), nA.z.mul(nB.z));
    const tbn = TBNViewMatrix as unknown as THREE.Matrix3;
    mat.normalNode = normalize(mul(tbn, vec3(
      blendedXY.xy.mul(vec2(NORMAL_STRENGTH, NORMAL_STRENGTH)),
      blendedXY.z
    )));

    return { mat, flowA, flowB };
  } catch (e) {
    console.warn('water: TSL node material build failed, WebGL2-style fallback stays', e);
    return null;
  }
}

export function createRiver(scene: THREE.Scene, caps?: RenderCaps, opts?: { foam?: boolean }) {
  // §7.2: visual modules take RenderCaps, never re-detect. The old callsite
  // in main.ts passed nothing — the WebGPU transmission branch never ran.
  const safeCaps: RenderCaps = caps ?? { isWebGPU: false, tier: 'HIGH', maxAnisotropy: 8 };
  const spec: WaterSpec = { ...WATER_PRESETS.river };

  const surface = createWaterSurface(scene, spec, PLANE_W, 1000, safeCaps, {
    conform: 'channel',
    foam: opts?.foam,
  });

  return {
    mesh: surface.mesh,
    cascadeStats: surface.cascadeStats,
    update: (time: number) => surface.update(time),
  };
}
