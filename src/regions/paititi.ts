import * as THREE from 'three';
import type {
  RegionModule,
  RegionBuildAPI,
} from '../world/contracts.js';

export const paititi: RegionModule = {
  id: 'paititi',
  displayName: 'Paititi',
  bounds: {
    min: { x: 800, y: -50, z: -400 },
    max: { x: 1400, y: 250, z: 200 }
  },
  pois: [
    {
      id: 'pa_outer_terraces',
      name: 'The Outer Terraces',
      position: { x: 900, y: 0, z: -100 },
      radius: 30,
      summary: 'Massive agricultural terraces stepping down the valley sides, doubling as defensive walls.',
      discoverFlag: 'q_act4_paititi_entered'
    },
    {
      id: 'pa_plaza_of_sun',
      name: 'The Plaza of the Sun',
      position: { x: 1100, y: 0, z: -50 },
      radius: 30,
      summary: 'The central gathering space dominated by the Punchao.'
    },
    {
      id: 'pa_sanctuary',
      name: 'The Sanctuary',
      position: { x: 1300, y: 0, z: 50 },
      radius: 20,
      summary: 'The inner chamber containing the grand observatory mechanisms.'
    },
    {
      id: 'pa_aqueduct_line',
      name: 'The Aqueduct Line',
      position: { x: 1200, y: 0, z: 0 },
      radius: 20,
      summary: 'Functional aqueducts carrying water through the city.'
    }
  ],
  encounters: [
    {
      id: 'pa_sanctuary_confrontation',
      position: { x: 1300, y: 0, z: 50 },
      radius: 25,
      kind: 'ambush',
      flagsOnStart: [],
      flagsOnResolve: ['q_act4_sanctuary_confrontation'],
      notes: 'Timer-based explosive standoff.'
    },
    {
      id: 'pa_grand_observatory',
      position: { x: 1300, y: 0, z: 50 },
      radius: 10,
      kind: 'puzzle_guard',
      flagsOnStart: [],
      flagsOnResolve: ['q_act4_observatory_aligned'],
      notes: 'Solar/Lunar dials. Align Solar to PI/2, Lunar to 0.'
    }
  ],
  questStages: [
    { flag: 'q_act4_paititi_entered', trigger: 'pa_outer_terraces' },
    { flag: 'q_act4_sanctuary_confrontation', trigger: 'pa_sanctuary_confrontation' },
    { flag: 'q_act4_observatory_aligned', trigger: 'pa_grand_observatory' }
  ],
  shots: [
    { id: 'pa_overview', camera: { x: 1000, y: 150, z: -200 }, lookAt: { x: 1100, y: 0, z: -50 } },
    { id: 'pa_outer_terraces', camera: { x: 800, y: 50, z: -100 }, lookAt: { x: 900, y: 0, z: -100 } },
    { id: 'pa_plaza_of_sun', camera: { x: 1050, y: 20, z: -50 }, lookAt: { x: 1100, y: 10, z: -50 } },
    { id: 'pa_sanctuary', camera: { x: 1250, y: 20, z: 50 }, lookAt: { x: 1300, y: 15, z: 50 } },
    { id: 'pa_aqueduct_line', camera: { x: 1150, y: 20, z: 0 }, lookAt: { x: 1200, y: 10, z: 0 } }
  ],
  build(api: RegionBuildAPI) {
    const paititiGroup = new THREE.Group();
    paititiGroup.name = 'PaititiGroup';

    // Base materials
    const stoneMaterial = new THREE.MeshStandardMaterial({
      color: 0xdadad0,
      roughness: 0.8,
      metalness: 0.1,
    });

    const goldMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: 0.3,
      metalness: 1.0,
    });

    const bronzeMaterial = new THREE.MeshStandardMaterial({
      color: 0xcd7f32,
      roughness: 0.5,
      metalness: 0.8,
    });

    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x4aa0e0,
      transparent: true,
      opacity: 0.8,
      roughness: 0.1,
      metalness: 0.1,
    });

    // 1. The Outer Terraces
    const terracesCenter = { x: 900, z: -100 };
    this.pois[0].position.y = api.terrainHeight(terracesCenter.x, terracesCenter.z);
    const terracesGroup = new THREE.Group();
    const numTerraces = 5;
    for (let i = 0; i < numTerraces; i++) {
      const radius = 60 - i * 10;
      const tHeight = api.terrainHeight(terracesCenter.x, terracesCenter.z) + (i * 5);
      
      const terraceGeo = new THREE.CylinderGeometry(radius, radius + 5, 5, 32, 1, false, 0, Math.PI);
      const terraceMesh = new THREE.Mesh(terraceGeo, stoneMaterial);
      terraceMesh.position.set(terracesCenter.x, tHeight, terracesCenter.z);
      terraceMesh.rotation.y = Math.PI / 2;
      terraceMesh.castShadow = true;
      terraceMesh.receiveShadow = true;
      terracesGroup.add(terraceMesh);
    }
    paititiGroup.add(terracesGroup);

    // 2. The Plaza of the Sun
    const plazaCenter = { x: 1100, z: -50 };
    const plazaHeight = Math.max(api.terrainHeight(plazaCenter.x, plazaCenter.z), 100);
    this.pois[1].position.y = plazaHeight;
    const plazaGroup = new THREE.Group();
    
    const plazaGeo = new THREE.CylinderGeometry(40, 45, 2, 64);
    const plazaMesh = new THREE.Mesh(plazaGeo, stoneMaterial);
    plazaMesh.position.set(plazaCenter.x, plazaHeight, plazaCenter.z);
    plazaMesh.receiveShadow = true;
    plazaGroup.add(plazaMesh);

    // The Punchao (Golden Disk)
    const diskGeo = new THREE.CylinderGeometry(10, 10, 0.5, 32);
    const diskMesh = new THREE.Mesh(diskGeo, goldMaterial);
    diskMesh.position.set(plazaCenter.x, plazaHeight + 10, plazaCenter.z);
    diskMesh.rotation.x = Math.PI / 2;
    diskMesh.rotation.y = Math.PI / 4;
    diskMesh.castShadow = true;
    plazaGroup.add(diskMesh);

    const ringGeo1 = new THREE.RingGeometry(11, 12, 32);
    const ringMesh1 = new THREE.Mesh(ringGeo1, goldMaterial);
    ringMesh1.position.copy(diskMesh.position);
    ringMesh1.rotation.copy(diskMesh.rotation);
    plazaGroup.add(ringMesh1);

    paititiGroup.add(plazaGroup);

    // 3. The Sanctuary
    const sanctuaryCenter = { x: 1300, z: 50 };
    const sanctuaryHeight = Math.max(api.terrainHeight(sanctuaryCenter.x, sanctuaryCenter.z), 150);
    this.pois[2].position.y = sanctuaryHeight;
    this.encounters[0].position.y = sanctuaryHeight;
    this.encounters[1].position.y = sanctuaryHeight;
    const sanctuaryGroup = new THREE.Group();

    // Rotunda
    const rotundaGeo = new THREE.CylinderGeometry(25, 25, 30, 32, 1, true);
    const rotundaMesh = new THREE.Mesh(rotundaGeo, stoneMaterial);
    rotundaMesh.position.set(sanctuaryCenter.x, sanctuaryHeight + 15, sanctuaryCenter.z);
    rotundaMesh.material.side = THREE.DoubleSide;
    rotundaMesh.castShadow = true;
    rotundaMesh.receiveShadow = true;
    sanctuaryGroup.add(rotundaMesh);

    // Pillars with explosive charges
    const pillarGeo = new THREE.CylinderGeometry(1.5, 1.5, 30, 16);
    const chargeMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const charges: THREE.Mesh[] = [];

    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const px = sanctuaryCenter.x + Math.cos(angle) * 18;
      const pz = sanctuaryCenter.z + Math.sin(angle) * 18;

      const pillar = new THREE.Mesh(pillarGeo, stoneMaterial);
      pillar.position.set(px, sanctuaryHeight + 15, pz);
      sanctuaryGroup.add(pillar);

      const chargeGeo = new THREE.BoxGeometry(1, 1, 1);
      const charge = new THREE.Mesh(chargeGeo, chargeMaterial);
      charge.position.set(px - 1, sanctuaryHeight + 10, pz);
      charge.visible = false;
      charges.push(charge);
      sanctuaryGroup.add(charge);
    }

    // Floor
    const sanctuaryFloorGeo = new THREE.CylinderGeometry(25, 25, 1, 32);
    const sanctuaryFloor = new THREE.Mesh(sanctuaryFloorGeo, stoneMaterial);
    sanctuaryFloor.position.set(sanctuaryCenter.x, sanctuaryHeight, sanctuaryCenter.z);
    sanctuaryFloor.receiveShadow = true;
    sanctuaryGroup.add(sanctuaryFloor);

    // Central Mechanism (Dials)
    const mechanismGroup = new THREE.Group();
    mechanismGroup.position.set(sanctuaryCenter.x, sanctuaryHeight + 5, sanctuaryCenter.z);

    const baseGeo = new THREE.CylinderGeometry(5, 6, 2, 16);
    const baseMesh = new THREE.Mesh(baseGeo, bronzeMaterial);
    mechanismGroup.add(baseMesh);

    const solarDialGeo = new THREE.RingGeometry(3, 4, 32);
    const solarDial = new THREE.Mesh(solarDialGeo, goldMaterial);
    solarDial.rotation.x = -Math.PI / 2;
    solarDial.position.y = 1.1;
    mechanismGroup.add(solarDial);

    const lunarDialGeo = new THREE.RingGeometry(4.5, 5.5, 32);
    const lunarDial = new THREE.Mesh(lunarDialGeo, stoneMaterial);
    lunarDial.rotation.x = -Math.PI / 2;
    lunarDial.position.y = 1.05;
    mechanismGroup.add(lunarDial);

    sanctuaryGroup.add(mechanismGroup);
    paititiGroup.add(sanctuaryGroup);

    // Light shaft for climax
    const lightShaftGeo = new THREE.CylinderGeometry(4, 4, 100, 32);
    const lightShaftMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const lightShaft = new THREE.Mesh(lightShaftGeo, lightShaftMat);
    lightShaft.position.set(sanctuaryCenter.x, sanctuaryHeight + 50, sanctuaryCenter.z);
    paititiGroup.add(lightShaft);

    // 4. The Aqueduct Line
    const aqueductGroup = new THREE.Group();
    const aquaductLength = 200;
    
    const channelGeo = new THREE.BoxGeometry(3, 2, aquaductLength);
    const channelMesh = new THREE.Mesh(channelGeo, stoneMaterial);
    const channelX = 1200;
    const channelZ = 0;
    const channelY = api.terrainHeight(channelX, channelZ) + 5;
    this.pois[3].position.y = channelY;
    channelMesh.position.set(channelX, channelY, channelZ);
    channelMesh.rotation.y = Math.PI / 4;
    aqueductGroup.add(channelMesh);

    const waterGeo = new THREE.PlaneGeometry(2.5, aquaductLength);
    const waterPlane = new THREE.Mesh(waterGeo, waterMaterial);
    waterPlane.position.set(channelX, channelY + 1.1, channelZ);
    waterPlane.rotation.x = -Math.PI / 2;
    waterPlane.rotation.z = Math.PI / 4;
    aqueductGroup.add(waterPlane);

    paititiGroup.add(aqueductGroup);
    api.scene.add(paititiGroup);

    // Encounter and Quest Logic
    let timerInterval: ReturnType<typeof setInterval> | null = null;
    let timerCount = 60; // seconds
    let puzzleActive = false;
    let selectedDial: 'solar' | 'lunar' = 'solar';

    // @ts-ignore
    const checkPlayerProximity = () => {
    };

    // @ts-ignore
    const mockPlayerEnterSanctuary = () => {
      if (!api.flags?.has('q_act4_sanctuary_confrontation')) {
        api.flags?.set('q_act4_sanctuary_confrontation');
        charges.forEach(c => c.visible = true);
        puzzleActive = true;

        timerInterval = setInterval(() => {
          timerCount--;
          const blink = timerCount % 2 === 0;
          charges.forEach(c => (c.material as THREE.MeshBasicMaterial).color.setHex(blink ? 0xff0000 : 0x330000));

          if (timerCount <= 0) {
            const flashGeo = new THREE.SphereGeometry(30, 32, 32);
            const flashMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.8 });
            const flash = new THREE.Mesh(flashGeo, flashMat);
            flash.position.set(sanctuaryCenter.x, sanctuaryHeight + 15, sanctuaryCenter.z);
            api.scene.add(flash);
            setTimeout(() => api.scene.remove(flash), 200);

            resetPuzzle();
          }
        }, 1000);
      }
    };

    const resetPuzzle = () => {
      if (timerInterval) clearInterval(timerInterval);
      timerCount = 60;
      puzzleActive = false;
      charges.forEach(c => c.visible = false);
      solarDial.rotation.z = 0;
      lunarDial.rotation.z = 0;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!puzzleActive) return;

      const rotateStep = Math.PI / 8;
      if (e.key === '1') {
        selectedDial = 'solar';
      } else if (e.key === '2') {
        selectedDial = 'lunar';
      } else if (e.key === 'e' || e.key === 'E') {
        if (selectedDial === 'solar') {
          solarDial.rotation.z += rotateStep;
        } else {
          lunarDial.rotation.z += rotateStep;
        }
        checkAlignment();
      }
    };

    const checkAlignment = () => {
      const solarRot = Math.abs(solarDial.rotation.z % (Math.PI * 2));
      const lunarRot = Math.abs(lunarDial.rotation.z % (Math.PI * 2));

      const isSolarAligned = Math.abs(solarRot - Math.PI / 2) < 0.1;
      const isLunarAligned = lunarRot < 0.1 || Math.abs(lunarRot - Math.PI * 2) < 0.1;

      if (isSolarAligned && isLunarAligned) {
        if (timerInterval) clearInterval(timerInterval);
        charges.forEach(c => c.visible = false);
        puzzleActive = false;

        lightShaftMat.opacity = 0.8;
        
        api.flags?.set('q_act4_observatory_aligned');
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    api.onEnterRegion(() => {
      api.flags?.set('q_act4_paititi_entered');
    });

    api.onExitRegion(() => {
      if (timerInterval) clearInterval(timerInterval);
      window.removeEventListener('keydown', handleKeyDown);
    });
  }
};
