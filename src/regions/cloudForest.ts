import * as THREE from 'three';
import {
  woodWet, fabricWorn, ashlarWeathered, ashlarLight, ironDark, lampEmissive,
  humusEarth, mossPatch, broadleafCard, orchidAccent,
} from '../materials.js';
import type {
  RegionModule,
  RegionBuildAPI,
} from '../world/contracts.js';

// J7: all placement is seeded (Mulberry32, same pattern as volumetrics.ts).
// The pre-p10 file used Math.random() throughout — every page load re-rolled
// the mist, masonry scatter and floodlight positions, so §8 captures were not
// reproducible run-to-run (p10 audit defect ①).
const CF_SEED = 0xcf01;
function mulberry32(a: number) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const cloudForest: RegionModule = {
  id: 'cloud_forest',
  displayName: 'The Cloud Forest',
  bounds: {
    min: { x: -450, y: -50, z: -700 },
    max: { x: 450, y: 200, z: 100 }
  },
  pois: [
    {
      id: 'cf_lower_blockade',
      name: 'The Lower Blockade',
      position: { x: -100, y: 0, z: -500 },
      radius: 15,
      summary: 'A muddy barricade held by the local Quechua community.',
      discoverFlag: 'q_act1_met_tomas'
    },
    {
      id: 'cf_excavated_ruin',
      name: 'The Excavated Ruin',
      position: { x: 150, y: 0, z: -300 },
      radius: 25,
      summary: 'A raw-earth excavation pit crawling with Sol Negro equipment.'
    },
    {
      id: 'cf_quipu_archive',
      name: 'The Quipu Archive',
      position: { x: 150, y: 0, z: -350 },
      radius: 10,
      summary: 'A pristine underground chamber housing ancient knotted records.'
    },
    {
      id: 'cf_cliff_staircase',
      name: 'The Cliff Staircase',
      position: { x: 200, y: 0, z: 80 },
      radius: 20,
      summary: 'Ancient stairs climbing steeply into the dense cloud layer.'
    }
  ],
  encounters: [
    {
      id: 'cf_dig_infiltration',
      position: { x: 150, y: 0, z: -300 },
      radius: 30,
      kind: 'stealth',
      flagsOnStart: [],
      flagsOnResolve: ['q_act1_ruin_infiltrated'],
      notes: 'Entering inner perimeter (x:150, z:-300) without crossing abstract patrol cones resolves the stealth.'
    },
    {
      id: 'cf_forest_path',
      position: { x: 0, y: 0, z: -400 },
      radius: 50,
      kind: 'wildlife',
      flagsOnStart: [],
      flagsOnResolve: [],
      notes: 'Ambient wildlife (birds/flutters) using existing particle style on approach path.'
    }
  ],
  questStages: [
    { flag: 'q_act1_met_tomas', trigger: 'First discovery of the blockade POI' },
    { flag: 'q_act1_ruin_infiltrated', trigger: 'Entering the dig-site perimeter undetected' },
    { flag: 'q_act1_quipu_solved', trigger: 'Solving the quipu cipher' }
  ],
  shots: [
    { id: 'cf_lower_blockade', camera: { x: -80, y: 15, z: -480 }, lookAt: { x: -100, y: 0, z: -500 } },
    { id: 'cf_excavated_ruin', camera: { x: 180, y: 20, z: -270 }, lookAt: { x: 150, y: 0, z: -300 } },
    { id: 'cf_quipu_archive', camera: { x: 150, y: -15, z: -340 }, lookAt: { x: 150, y: -20, z: -350 } },
    { id: 'cf_cliff_staircase', camera: { x: 200, y: 5, z: 60 }, lookAt: { x: 200, y: 10, z: 80 } },
    { id: 'cf_overview', camera: { x: 0, y: 150, z: -100 }, lookAt: { x: 150, y: 0, z: -300 } }
  ],
  build(api: RegionBuildAPI): void {
    const rng = mulberry32(CF_SEED);
    const group = new THREE.Group();
    group.name = 'Region_CloudForest';
    api.scene.add(group);

    // Materials (§4.2 library only — the p10 audit replaced the ashlar-on-pit
    // recolor with the humusEarth() factory, §2.2 palette)
    const woodMat = woodWet();
    const fabricMat = fabricWorn(0x7A2E2E);
    const earthMat = humusEarth();
    const stoneMat = ashlarLight();
    const weatheredMat = ashlarWeathered();
    const metalMat = ironDark();
    const emissiveMat = lampEmissive();
    const mossMat = mossPatch();
    const leafLitMat = broadleafCard(0x3E5E2A);
    const leafShadowMat = broadleafCard(0x2D4A22);
    const orchidMat = orchidAccent();

    // --- §2.2 dressing vocabulary helpers (all seeded, J7) -----------------

    // Hanging moss strands: thin vertical strips under structures
    const mossStrandGeo = new THREE.PlaneGeometry(0.4, 2.2);
    const hangMoss = (parent: THREE.Object3D, x: number, y: number, z: number, s: number) => {
      const strand = new THREE.Mesh(mossStrandGeo, mossMat);
      strand.position.set(x, y, z);
      strand.scale.setScalar(s);
      strand.rotation.y = rng() * Math.PI;
      parent.add(strand);
    };

    // Broadleaf cards: crossed plane pairs (V-FOLIAGE card read)
    const leafGeo = new THREE.PlaneGeometry(2.4, 1.6);
    const broadleaf = (parent: THREE.Object3D, x: number, y: number, z: number, s: number) => {
      const a = new THREE.Mesh(leafGeo, rng() > 0.5 ? leafLitMat : leafShadowMat);
      a.position.set(x, y, z);
      a.scale.setScalar(s);
      a.rotation.y = rng() * Math.PI;
      a.rotation.z = (rng() - 0.5) * 0.3;
      const b = a.clone();
      b.rotation.y += Math.PI / 2;
      parent.add(a, b);
    };

    // Orchid clusters on trunks (§2.2: sparse accents, ≤2% of frame)
    const orchidGeo = new THREE.PlaneGeometry(0.5, 0.35);
    const orchids = (parent: THREE.Object3D, x: number, y: number, z: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const f = new THREE.Mesh(orchidGeo, orchidMat);
        f.position.set(x + (rng() - 0.5) * 0.6, y + rng() * 0.5, z + (rng() - 0.5) * 0.6);
        f.rotation.y = rng() * Math.PI;
        parent.add(f);
      }
    };

    // Fallen log (rotting wood, §2.2 vocabulary)
    const logGeo = new THREE.CylinderGeometry(0.8, 0.9, 6, 8);
    logGeo.rotateZ(Math.PI / 2);
    const fallenLog = (parent: THREE.Object3D, x: number, y: number, z: number, ry: number) => {
      const log = new THREE.Mesh(logGeo, woodMat);
      log.position.set(x, y, z);
      log.rotation.y = ry;
      log.rotation.z = (rng() - 0.5) * 0.1;
      parent.add(log);
      // moss blanket on the shaded top
      const blanket = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.15, 1.4), mossMat);
      blanket.position.set(x, y + 0.75, z);
      blanket.rotation.y = ry;
      parent.add(blanket);
    };

    // Milestone 2: Mist Layering (composites with sky fog)
    // fabricWorn(0xA8B8B0) transparent proxy (§2.2 mist blue-grey); placement
    // is seeded (J7) and the tint tracks the V-SKY fog color. The fog sample
    // is taken at build time too — in shot mode onEnterRegion may not fire,
    // and the pre-p10 file relied solely on the enter loop for the first tint.
    const mistGeo = new THREE.PlaneGeometry(20, 10);
    const mistMat = fabricWorn(0xA8B8B0);
    mistMat.transparent = true;
    mistMat.opacity = 0.15;
    mistMat.depthWrite = false;
    mistMat.side = THREE.DoubleSide;

    const syncMistToFog = () => {
      if (api.scene.fog && (api.scene.fog as THREE.Fog).color) {
        mistMat.color.copy((api.scene.fog as THREE.Fog).color);
      }
    };
    syncMistToFog();

    api.onEnterRegion(() => {
      mistMat.userData.active = true;
      const loop = () => {
        if (!mistMat.userData.active) return;
        syncMistToFog();
        requestAnimationFrame(loop);
      };
      loop();
    });
    api.onExitRegion(() => { mistMat.userData.active = false; });

    for (let i = 0; i < 8; i++) {
      const mist = new THREE.Mesh(mistGeo, mistMat);
      mist.position.set(100 + (rng() - 0.5) * 150, 5 + rng() * 5, -300 + (rng() - 0.5) * 200);
      mist.rotation.y = rng() * Math.PI;
      group.add(mist);
    }

    // 1. The Lower Blockade (Position: x: -100, z: -500)
    const blockadeGroup = new THREE.Group();
    blockadeGroup.position.set(-100, 0, -500);
    blockadeGroup.position.y = api.terrainHeight(-100, -500);

    // Felled trees
    const trunkGeo = new THREE.CylinderGeometry(1, 1, 10, 8);
    trunkGeo.rotateZ(Math.PI / 2);
    const tree1 = new THREE.Mesh(trunkGeo, woodMat);
    tree1.position.set(0, 1, 0);
    tree1.rotation.y = 0.2;
    const tree2 = new THREE.Mesh(trunkGeo, woodMat);
    tree2.position.set(2, 1, 4);
    tree2.rotation.y = -0.3;
    blockadeGroup.add(tree1, tree2);

    // Tents
    const tentGeo = new THREE.ConeGeometry(2, 3, 4);
    const tent1 = new THREE.Mesh(tentGeo, fabricMat);
    tent1.position.set(-8, 1.5, 5);
    tent1.rotation.y = Math.PI / 4;
    const tent2 = new THREE.Mesh(tentGeo, fabricMat);
    tent2.position.set(-12, 1.5, 0);
    blockadeGroup.add(tent1, tent2);

    // §2.2 rope bridge (fiber, not chain): rope rails + deck slats across
    // the muddy approach, anchored on timber posts
    const ropeMat = fabricWorn(0x8A7355); // worn fiber
    const bridgeGroup = new THREE.Group();
    bridgeGroup.position.set(6, 0.2, -8);
    const postGeo = new THREE.CylinderGeometry(0.15, 0.18, 2.2, 6);
    const anchorA = new THREE.Mesh(postGeo, woodMat);
    anchorA.position.set(0, 1.1, 0);
    const anchorB = new THREE.Mesh(postGeo, woodMat);
    anchorB.position.set(0, 1.1, 9);
    bridgeGroup.add(anchorA, anchorB);
    const deckSlatGeo = new THREE.BoxGeometry(1.4, 0.1, 0.55);
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const z = t * 9;
      const sag = Math.sin(t * Math.PI) * 0.55; // catenary-ish dip
      const slat = new THREE.Mesh(deckSlatGeo, woodMat);
      slat.position.set(0, 0.9 - sag, z);
      bridgeGroup.add(slat);
      if (i % 2 === 0) {
        const ropeL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 5), ropeMat);
        ropeL.position.set(-0.7, 1.45 - sag * 0.4, z);
        ropeL.rotation.x = 0.5;
        bridgeGroup.add(ropeL);
      }
    }
    blockadeGroup.add(bridgeGroup);

    group.add(blockadeGroup);

    // 2. The Excavated Ruin (Position: x: 150, z: -300)
    const ruinGroup = new THREE.Group();
    const ruinX = 150, ruinZ = -300;
    ruinGroup.position.set(ruinX, 0, ruinZ);
    ruinGroup.position.y = api.terrainHeight(ruinX, ruinZ);

    // Excavation pit (raw earth walls — humusEarth, §2.2)
    const pitGeo = new THREE.BoxGeometry(30, 4, 30);
    const pit = new THREE.Mesh(pitGeo, earthMat);
    pit.position.set(0, -2, 0); // Sunken slightly
    ruinGroup.add(pit);

    // Damaged ashlar masonry (seeded scatter, J7)
    const blockGeo = new THREE.BoxGeometry(1.99, 1.99, 1.99);
    for (let i = 0; i < 15; i++) {
      const block = new THREE.Mesh(blockGeo, stoneMat);
      block.position.set(
        (rng() - 0.5) * 20,
        1,
        (rng() - 0.5) * 20
      );
      block.rotation.set(
        (rng() - 0.5) * 0.2,
        rng() * Math.PI,
        (rng() - 0.5) * 0.2
      );
      ruinGroup.add(block);
    }

    // §2.2 stone blocks half-sunk in humus (pit rim, moss-topped)
    for (let i = 0; i < 6; i++) {
      const sunk = new THREE.Mesh(blockGeo, weatheredMat);
      const a = (i / 6) * Math.PI * 2 + rng() * 0.4;
      sunk.position.set(Math.cos(a) * 17, 0.2, Math.sin(a) * 17);
      sunk.rotation.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
      ruinGroup.add(sunk);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.7), mossMat);
      cap.position.set(sunk.position.x, 1.15, sunk.position.z);
      cap.rotation.y = sunk.rotation.y;
      ruinGroup.add(cap);
    }

    // Heavy machinery silhouettes (excavator)
    const excavatorGeo = new THREE.BoxGeometry(4, 5, 8);
    const excavator = new THREE.Mesh(excavatorGeo, metalMat);
    excavator.position.set(-15, 2.5, 10);
    excavator.rotation.y = 0.5;
    ruinGroup.add(excavator);

    // Sol Negro floodlight rigs (seeded placement, J7)
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 6, 8);
    const lightHeadGeo = new THREE.BoxGeometry(0.5, 0.5, 0.2);
    for (let i = 0; i < 3; i++) {
      const pole = new THREE.Mesh(poleGeo, metalMat);
      pole.position.set(
        (rng() - 0.5) * 25,
        3,
        (rng() - 0.5) * 25
      );
      const head = new THREE.Mesh(lightHeadGeo, emissiveMat);
      head.position.set(0, 3, 0);
      head.rotation.x = -0.5;
      pole.add(head);
      ruinGroup.add(pole);
    }

    // §2.2 canopy dressing: broadleaf cards + hanging moss + orchids +
    // fallen logs around the dig site
    for (let i = 0; i < 10; i++) {
      broadleaf(ruinGroup, (rng() - 0.5) * 38, 2.5 + rng() * 3, (rng() - 0.5) * 38, 0.8 + rng() * 0.7);
    }
    for (let i = 0; i < 6; i++) {
      hangMoss(ruinGroup, (rng() - 0.5) * 24, 3.4 + rng() * 1.5, (rng() - 0.5) * 24, 0.7 + rng() * 0.8);
    }
    fallenLog(ruinGroup, 9, 0.6, 13, rng() * Math.PI);
    orchids(ruinGroup, 9, 1.1, 13, 3);

    group.add(ruinGroup);

    // 3. The Quipu Archive (Position: x: 150, z: -350, hidden/underground interior near ruin)
    const archiveGroup = new THREE.Group();
    const archiveX = 150, archiveZ = -350;
    // Intentionally placed below terrain surface
    archiveGroup.position.set(archiveX, api.terrainHeight(archiveX, archiveZ) - 20, archiveZ);

    // Chamber walls
    const chamberGeo = new THREE.BoxGeometry(20, 10, 20);
    const chamber = new THREE.Mesh(chamberGeo, stoneMat);
    // Make it an interior by rendering backfaces
    chamber.material.side = THREE.BackSide;
    archiveGroup.add(chamber);

    // The Quipu installation
    const quipuGroup = new THREE.Group();
    const mainCordGeo = new THREE.CylinderGeometry(0.1, 0.1, 10, 8);
    mainCordGeo.rotateZ(Math.PI / 2);
    const mainCord = new THREE.Mesh(mainCordGeo, fabricMat);
    mainCord.position.set(0, 3, 0);
    quipuGroup.add(mainCord);

    const hangingCordGeo = new THREE.CylinderGeometry(0.05, 0.05, 4, 8);
    for (let i = 0; i < 8; i++) {
      const hCord = new THREE.Mesh(hangingCordGeo, fabricMat);
      hCord.position.set(-4 + i, 1, 0);
      quipuGroup.add(hCord);
    }
    archiveGroup.add(quipuGroup);

    // Quipu Cipher puzzle state machine (puzzle_guard encounter logic)
    // 3 knots (represented abstractly as small boxes on 3 of the hanging cords)
    const knotGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const knotMat = fabricWorn(0xD8CBB0);

    const knotMeshes: THREE.Mesh[] = [];
    const knotStates = [0, 0, 0];
    const correctCombo = [1, 3, 2]; // The cipher definition

    for (let i = 0; i < 3; i++) {
      const knot = new THREE.Mesh(knotGeo, knotMat);
      // Place them on the 2nd, 4th, and 6th hanging cords
      knot.position.set(-4 + (i * 2 + 1), 0.5, 0.1);
      quipuGroup.add(knot);
      knotMeshes.push(knot);
    }

    const doorGeo = new THREE.BoxGeometry(4, 8, 1);
    const doorMesh = new THREE.Mesh(doorGeo, stoneMat);
    doorMesh.position.set(0, -1, -9.5); // Back wall of the chamber
    archiveGroup.add(doorMesh);

    let puzzleSolved = false;

    // We use api.onEnterRegion to start a loop for logic
    let loopActive = false;

    api.onEnterRegion(() => {
      loopActive = true;
      const checkLogic = () => {
        if (!loopActive) return;

        // The actual player interaction needs to be mocked or we can just
        // implement the state machine ready for an input system.
        // We don't have direct access to the character's position here easily
        // unless we query the scene, or just leave the state machine ready.
        // For now, we will just leave the state machine in the closure, and
        // if this was fully wired, proximity checks would happen here.

        // Simulation of the puzzle check:
        if (!puzzleSolved &&
            knotStates[0] === correctCombo[0] &&
            knotStates[1] === correctCombo[1] &&
            knotStates[2] === correctCombo[2]) {

          puzzleSolved = true;
          api.flags.set('q_act1_quipu_solved');

          // Animate door (simple slide down)
          const slideDoor = () => {
            if (doorMesh.position.y > -9) {
              doorMesh.position.y -= 0.1;
              requestAnimationFrame(slideDoor);
            }
          };
          slideDoor();
        }

        requestAnimationFrame(checkLogic);
      };
      checkLogic();
    });

    api.onExitRegion(() => {
      loopActive = false;
    });

    group.add(archiveGroup);

    // 4. The Cliff Staircase (Position: +z edge around x: 200, z: 80, going up)
    const stairsGroup = new THREE.Group();
    const stairX = 200, stairZ = 80;
    stairsGroup.position.set(stairX, 0, stairZ);
    stairsGroup.position.y = api.terrainHeight(stairX, stairZ);

    const stepGeo = new THREE.BoxGeometry(4, 0.5, 2);
    for (let i = 0; i < 30; i++) {
      const step = new THREE.Mesh(stepGeo, stoneMat);
      // Stairs climbing upwards into the clouds and forward in Z
      step.position.set(0, i * 0.5, i * 1.5);
      stairsGroup.add(step);
      // moss on every 3rd step (§2.2 moss patches)
      if (i % 3 === 0) {
        const mossCap = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.5), mossMat);
        mossCap.position.set(0.2, i * 0.5 + 0.3, i * 1.5);
        stairsGroup.add(mossCap);
      }
    }

    // §2.2 cliff flanks flanking the staircase (wet stone, moss streaks,
    // hanging moss strands — "climbing steeply into the dense cloud layer")
    const cliffGeo = new THREE.BoxGeometry(8, 26, 14);
    const cliffL = new THREE.Mesh(cliffGeo, weatheredMat);
    cliffL.position.set(-7, 10, 20);
    cliffL.rotation.y = -0.12;
    const cliffR = new THREE.Mesh(cliffGeo, weatheredMat);
    cliffR.position.set(7.5, 12, 24);
    cliffR.rotation.y = 0.1;
    stairsGroup.add(cliffL, cliffR);
    for (let i = 0; i < 8; i++) {
      hangMoss(stairsGroup, (rng() > 0.5 ? -7 : 7.5) + (rng() - 0.5) * 4, 14 + rng() * 8, 14 + rng() * 14, 0.9 + rng() * 1.1);
    }
    for (let i = 0; i < 6; i++) {
      broadleaf(stairsGroup, (rng() - 0.5) * 12, 2 + rng() * 8, 6 + rng() * 22, 0.9 + rng() * 0.8);
    }
    fallenLog(stairsGroup, -3.5, 0.5, -6, 0.4 + rng() * 0.3);

    group.add(stairsGroup);
  }
};
