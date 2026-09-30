import * as THREE from 'three';
import type {
  RegionModule,
  RegionBuildAPI,
} from '../world/contracts.js';

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
    const group = new THREE.Group();
    group.name = 'Region_CloudForest';
    api.scene.add(group);

    // Materials
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9, metalness: 0.0 });
    const fabricMat = new THREE.MeshStandardMaterial({ color: 0x8b0000, roughness: 1.0, metalness: 0.0 }); // red tents
    const earthMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 1.0, metalness: 0.0 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.8, metalness: 0.1 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.8 });
    const emissiveMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffee, emissiveIntensity: 2.0 });

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

    group.add(blockadeGroup);

    // 2. The Excavated Ruin (Position: x: 150, z: -300)
    const ruinGroup = new THREE.Group();
    const ruinX = 150, ruinZ = -300;
    ruinGroup.position.set(ruinX, 0, ruinZ);
    ruinGroup.position.y = api.terrainHeight(ruinX, ruinZ);

    // Excavation pit (raw earth walls)
    const pitGeo = new THREE.BoxGeometry(30, 4, 30);
    const pit = new THREE.Mesh(pitGeo, earthMat);
    pit.position.set(0, -2, 0); // Sunken slightly
    ruinGroup.add(pit);

    // Damaged ashlar masonry
    const blockGeo = new THREE.BoxGeometry(2, 2, 2);
    for (let i = 0; i < 15; i++) {
      const block = new THREE.Mesh(blockGeo, stoneMat);
      block.position.set(
        (Math.random() - 0.5) * 20,
        1,
        (Math.random() - 0.5) * 20
      );
      block.rotation.set(
        (Math.random() - 0.5) * 0.2,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 0.2
      );
      ruinGroup.add(block);
    }

    // Heavy machinery silhouettes (excavator)
    const excavatorGeo = new THREE.BoxGeometry(4, 5, 8);
    const excavator = new THREE.Mesh(excavatorGeo, metalMat);
    excavator.position.set(-15, 2.5, 10);
    excavator.rotation.y = 0.5;
    ruinGroup.add(excavator);

    // Sol Negro floodlight rigs
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 6, 8);
    const lightHeadGeo = new THREE.BoxGeometry(0.5, 0.5, 0.2);
    for (let i = 0; i < 3; i++) {
      const pole = new THREE.Mesh(poleGeo, metalMat);
      pole.position.set(
        (Math.random() - 0.5) * 25,
        3,
        (Math.random() - 0.5) * 25
      );
      const head = new THREE.Mesh(lightHeadGeo, emissiveMat);
      head.position.set(0, 3, 0);
      head.rotation.x = -0.5;
      pole.add(head);
      ruinGroup.add(pole);
    }

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
    for(let i=0; i<8; i++) {
      const hCord = new THREE.Mesh(hangingCordGeo, fabricMat);
      hCord.position.set(-4 + i, 1, 0);
      quipuGroup.add(hCord);
    }
    archiveGroup.add(quipuGroup);

    // Quipu Cipher puzzle state machine (puzzle_guard encounter logic)
    // 3 knots (represented abstractly as small boxes on 3 of the hanging cords)
    const knotGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const knotMat = new THREE.MeshStandardMaterial({ color: 0xaaaa00, roughness: 0.8 }); // Yellowish knots

    const knotMeshes: THREE.Mesh[] = [];
    const knotStates = [0, 0, 0];
    const correctCombo = [1, 3, 2]; // The cipher definition

    for(let i=0; i<3; i++) {
      const knot = new THREE.Mesh(knotGeo, knotMat);
      // Place them on the 2nd, 4th, and 6th hanging cords
      knot.position.set(-4 + (i*2 + 1), 0.5, 0.1);
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
        if(!loopActive) return;

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
    for(let i=0; i<30; i++) {
      const step = new THREE.Mesh(stepGeo, stoneMat);
      // Stairs climbing upwards into the clouds and forward in Z
      step.position.set(0, i * 0.5, i * 1.5);
      stairsGroup.add(step);
    }

    group.add(stairsGroup);
  }
};
