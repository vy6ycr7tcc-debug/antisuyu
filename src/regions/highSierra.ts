import * as THREE from 'three';
// @ts-ignore
import type { 
    RegionModule, 
    RegionBuildAPI
} from '../world/contracts.js';


export const highSierra: RegionModule = {
    id: 'high_sierra',
    displayName: 'The High Sierra',
    bounds: { 
        min: { x: -450, y: 0, z: 500 }, 
        max: { x: 450, y: 300, z: 1200 } 
    },
    pois: [
        {
            id: 'hs_qenko_marker',
            name: 'Qenko Solstice Marker',
            position: { x: 100, y: 0, z: 600 },
            radius: 15,
            summary: 'A carved limestone outcrop with gnomons.'
        },
        {
            id: 'hs_chakana_gate',
            name: 'Chakana Gate',
            position: { x: -150, y: 0, z: 750 },
            radius: 20,
            summary: 'A massive stone door set into a canyon wall.',
            discoverFlag: 'q_act2_chakana_reached'
        },
        {
            id: 'hs_sayhuite_table',
            name: 'Sayhuite Map Table',
            position: { x: 200, y: 0, z: 900 },
            radius: 25,
            summary: 'An open-air plaza with a massive carved boulder.'
        },
        {
            id: 'hs_outpost',
            name: 'The Outpost',
            position: { x: 0, y: 0, z: 1050 },
            radius: 30,
            summary: 'A ruined military checkpoint on a ridge.'
        },
        {
            id: 'hs_paqarina_descent',
            name: 'Paqarina Descent',
            position: { x: -50, y: 0, z: 1150 },
            radius: 25,
            summary: 'A massive cave mouth marking the descent.'
        }
    ],
    encounters: [
        {
            id: 'hs_chakana_alignment',
            position: { x: -150, y: 0, z: 750 },
            radius: 15,
            kind: 'puzzle_guard',
            flagsOnStart: [],
            flagsOnResolve: ['q_act2_chakana_solved'],
            notes: 'E cycles 8 positions for the bronze mirror/dial. Correct position opens gate.'
        },
        {
            id: 'hs_sayhuite_waters',
            position: { x: 200, y: 0, z: 900 },
            radius: 15,
            kind: 'puzzle_guard',
            flagsOnStart: [],
            flagsOnResolve: ['q_act2_sayhuite_solved'],
            notes: 'E toggles 3 sluice gates. Correct combination (all 3) routes water and reveals path.'
        },
        {
            id: 'hs_outpost_confrontation',
            position: { x: 0, y: 0, z: 1050 },
            radius: 30,
            kind: 'ambush',
            flagsOnStart: [],
            flagsOnResolve: ['q_act2_outpost_confrontation'],
            notes: 'Entering outpost triggers standoff. Reaching the command crate sets confrontation flag.'
        }
    ],
    questStages: [
        { flag: 'q_act2_chakana_reached', trigger: 'first discovery of the Chakana Gate POI' },
        { flag: 'q_act2_chakana_solved', trigger: 'solving the gate alignment' },
        { flag: 'q_act2_sayhuite_solved', trigger: 'solving the map-table water routing' },
        { flag: 'q_act2_outpost_confrontation', trigger: 'entering the outpost inner perimeter' }
    ],
    shots: [
        { id: 'hs_qenko_marker', camera: { x: 100, y: 10, z: 580 }, lookAt: { x: 100, y: 0, z: 600 } },
        { id: 'hs_chakana_gate', camera: { x: -150, y: 15, z: 720 }, lookAt: { x: -150, y: 5, z: 750 } },
        { id: 'hs_sayhuite_table', camera: { x: 200, y: 20, z: 870 }, lookAt: { x: 200, y: 5, z: 900 } },
        { id: 'hs_outpost', camera: { x: 0, y: 20, z: 1000 }, lookAt: { x: 0, y: 5, z: 1050 } },
        { id: 'hs_paqarina_descent', camera: { x: -50, y: 15, z: 1110 }, lookAt: { x: -50, y: 5, z: 1150 } },
        { id: 'hs_overview', camera: { x: 0, y: 150, z: 600 }, lookAt: { x: 0, y: 0, z: 800 } }
    ],
    build(api: RegionBuildAPI): void {
        const group = new THREE.Group();
        group.name = 'Region_HighSierra';
        api.scene.add(group);

        // Materials (Standard PBR, no TSL, WebGL2 compatible)
        const stoneMat = new THREE.MeshStandardMaterial({ 
            color: 0x9e9e9e, 
            roughness: 0.8, 
            metalness: 0.1 
        });
        const carvedStoneMat = new THREE.MeshStandardMaterial({ 
            color: 0x8a8a8a, 
            roughness: 0.9, 
            metalness: 0.0,
            bumpScale: 0.05
        });
        const bronzeMat = new THREE.MeshStandardMaterial({ 
            color: 0xcd7f32, 
            roughness: 0.4, 
            metalness: 0.8 
        });
        const darkCrateMat = new THREE.MeshStandardMaterial({ 
            color: 0x2b2b2b, 
            roughness: 0.9, 
            metalness: 0.2 
        });
        const darkCaveMat = new THREE.MeshStandardMaterial({ 
            color: 0x050505, 
            roughness: 1.0, 
            metalness: 0.0 
        });

        // 1. Qenko Solstice Marker (Position: x: 100, z: 600)
        const qenkoGroup = new THREE.Group();
        const qX = 100, qZ = 600;
        qenkoGroup.position.set(qX, api.terrainHeight(qX, qZ), qZ);
        
        // Base outcropping
        const outcropGeo = new THREE.CylinderGeometry(15, 18, 5, 8);
        const outcrop = new THREE.Mesh(outcropGeo, stoneMat);
        outcrop.position.y = -2.5; // sunk halfway
        qenkoGroup.add(outcrop);
        
        // Gnomons (shadow-casting stones)
        const gnomonGeo = new THREE.BoxGeometry(1, 4, 1);
        for (let i = 0; i < 4; i++) {
            const gnomon = new THREE.Mesh(gnomonGeo, carvedStoneMat);
            const angle = (i / 4) * Math.PI * 2;
            gnomon.position.set(Math.cos(angle) * 8, 2, Math.sin(angle) * 8);
            gnomon.rotation.y = -angle;
            qenkoGroup.add(gnomon);
        }
        
        // Central altar
        const altarGeo = new THREE.BoxGeometry(3, 1, 3);
        const altar = new THREE.Mesh(altarGeo, carvedStoneMat);
        altar.position.y = 0.5;
        qenkoGroup.add(altar);

        group.add(qenkoGroup);
        
        // 2. Chakana Gate (Position: x: -150, z: 750)
        const chakanaGroup = new THREE.Group();
        const cX = -150, cZ = 750;
        chakanaGroup.position.set(cX, api.terrainHeight(cX, cZ), cZ);

        // Canyon Wall (Rock face)
        const wallGroup = new THREE.Group();
        const cliffGeo = new THREE.BoxGeometry(40, 50, 10);
        for(let i=0; i<3; i++) {
            const cliff = new THREE.Mesh(cliffGeo, stoneMat);
            cliff.position.set((i - 1) * 35, 20, -5 + Math.random() * 5);
            cliff.rotation.y = (Math.random() - 0.5) * 0.2;
            wallGroup.add(cliff);
        }
        chakanaGroup.add(wallGroup);

        // The Stone Door
        const doorGroup = new THREE.Group();
        doorGroup.position.set(0, 0, 1);
        
        const doorGeo = new THREE.BoxGeometry(10, 15, 2);
        const doorMesh = new THREE.Mesh(doorGeo, carvedStoneMat);
        doorMesh.position.y = 7.5;
        doorGroup.add(doorMesh);

        // Stepped cross carving (Chakana)
        const chakanaCrossGroup = new THREE.Group();
        const hBar = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 0.5), carvedStoneMat);
        const vBar = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 0.5), carvedStoneMat);
        chakanaCrossGroup.add(hBar, vBar);
        chakanaCrossGroup.position.set(0, 10, 1.25);
        doorGroup.add(chakanaCrossGroup);

        // Bronze mirror dial (Puzzle element)
        const dialGeo = new THREE.CylinderGeometry(2, 2, 0.5, 16);
        dialGeo.rotateX(Math.PI / 2);
        const dial = new THREE.Mesh(dialGeo, bronzeMat);
        dial.position.set(0, 5, 1.25);
        
        // Add a marker on the dial
        const marker = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.6), bronzeMat);
        marker.position.set(0, 1, 0);
        dial.add(marker);

        doorGroup.add(dial);
        
        // Export refs for animation later
        (chakanaGroup as any).userData = { doorMesh, dial };

        chakanaGroup.add(doorGroup);
        group.add(chakanaGroup);

        // Encounter logic for Chakana Gate
        let chakanaState = 0;
        let chakanaSolved = false;
        
        // Setup a global keyboard listener during build since we are in a simple state machine
        const handleChakanaKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'e' || e.key === 'E') {
                if (!chakanaSolved) {
                    chakanaState = (chakanaState + 1) % 8;
                    dial.rotation.y = (chakanaState / 8) * Math.PI * 2;
                    
                    // Let's say state 4 is correct
                    if (chakanaState === 4) {
                        chakanaSolved = true;
                        api.flags.set('q_act2_chakana_solved');
                        
                        // Slide door open
                        const slide = () => {
                            if (doorMesh.position.x < 10) {
                                doorMesh.position.x += 0.2;
                                requestAnimationFrame(slide);
                            }
                        };
                        slide();
                    }
                }
            }
        };

        api.onEnterRegion(() => {
            window.addEventListener('keydown', handleChakanaKeyDown);
        });

        api.onExitRegion(() => {
            window.removeEventListener('keydown', handleChakanaKeyDown);
        });
        
        // 3. Sayhuite Map Table (Position: x: 200, z: 900)
        const sayhuiteGroup = new THREE.Group();
        const sX = 200, sZ = 900;
        sayhuiteGroup.position.set(sX, api.terrainHeight(sX, sZ), sZ);

        // Open-air plaza base
        const plazaGeo = new THREE.CylinderGeometry(20, 20, 2, 16);
        const plaza = new THREE.Mesh(plazaGeo, stoneMat);
        plaza.position.y = -1;
        sayhuiteGroup.add(plaza);

        // The Map Boulder
        const boulderGroup = new THREE.Group();
        
        const boulderBaseGeo = new THREE.BoxGeometry(10, 6, 10);
        const boulder = new THREE.Mesh(boulderBaseGeo, carvedStoneMat);
        boulder.position.y = 3;
        
        // Miniature landscape details (channels/terraces)
        const terraceGeo = new THREE.BoxGeometry(8, 1, 8);
        const terrace1 = new THREE.Mesh(terraceGeo, carvedStoneMat);
        terrace1.position.y = 6.5;
        const terrace2 = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 6), carvedStoneMat);
        terrace2.position.y = 7.5;
        
        // Sluice gates
        const sluiceGeo = new THREE.BoxGeometry(0.5, 1.5, 0.5);
        const sluices: THREE.Mesh[] = [];
        for (let i = 0; i < 3; i++) {
            const sluice = new THREE.Mesh(sluiceGeo, bronzeMat);
            sluice.position.set(-3 + i * 3, 8.5, 0);
            boulderGroup.add(sluice);
            sluices.push(sluice);
        }

        boulderGroup.add(boulder, terrace1, terrace2);
        sayhuiteGroup.add(boulderGroup);

        (sayhuiteGroup as any).userData = { boulderGroup, sluices };

        group.add(sayhuiteGroup);

        // Encounter logic for Sayhuite Map Table
        const sluiceStates = [false, false, false];
        let sayhuiteSolved = false;

        const handleSayhuiteKeyDown = (e: KeyboardEvent) => {
            if (sayhuiteSolved) return;
            
            let changed = false;
            if (e.key === '1') { sluiceStates[0] = !sluiceStates[0]; changed = true; }
            if (e.key === '2') { sluiceStates[1] = !sluiceStates[1]; changed = true; }
            if (e.key === '3') { sluiceStates[2] = !sluiceStates[2]; changed = true; }

            if (changed) {
                // Update visuals
                sluices.forEach((sluice, idx) => {
                    sluice.position.y = sluiceStates[idx] ? 9.0 : 8.5; // Lift up when toggled
                });

                // Check win condition
                if (sluiceStates[0] && sluiceStates[1] && sluiceStates[2]) {
                    sayhuiteSolved = true;
                    api.flags.set('q_act2_sayhuite_solved');

                    // Animate table section sinking
                    const sink = () => {
                        if (terrace2.position.y > 6.0) {
                            terrace2.position.y -= 0.05;
                            requestAnimationFrame(sink);
                        }
                    };
                    sink();
                }
            }
        };

        api.onEnterRegion(() => {
            window.addEventListener('keydown', handleSayhuiteKeyDown);
        });

        api.onExitRegion(() => {
            window.removeEventListener('keydown', handleSayhuiteKeyDown);
        });
        
        // 4. The Outpost (Position: x: 0, z: 1050)
        const outpostGroup = new THREE.Group();
        const oX = 0, oZ = 1050;
        outpostGroup.position.set(oX, api.terrainHeight(oX, oZ), oZ);

        // Ruined walls
        const wallMat = stoneMat; // Reuse stone
        const wall1 = new THREE.Mesh(new THREE.BoxGeometry(15, 6, 2), wallMat);
        wall1.position.set(-10, 3, -15);
        const wall2 = new THREE.Mesh(new THREE.BoxGeometry(20, 5, 2), wallMat);
        wall2.position.set(10, 2.5, 10);
        wall2.rotation.y = Math.PI / 2;
        outpostGroup.add(wall1, wall2);

        // Watch platform
        const platGeo = new THREE.BoxGeometry(8, 0.5, 8);
        const plat = new THREE.Mesh(platGeo, darkCrateMat);
        plat.position.set(-8, 6, -12);
        const postGeo = new THREE.CylinderGeometry(0.2, 0.2, 6);
        for(let i=0; i<4; i++) {
            const post = new THREE.Mesh(postGeo, darkCrateMat);
            post.position.set(-8 + (i%2==0 ? 3 : -3), 3, -12 + (i<2 ? 3 : -3));
            outpostGroup.add(post);
        }
        outpostGroup.add(plat);

        // Supply crates (Sol Negro)
        const crateGeo = new THREE.BoxGeometry(2, 2, 2);
        for (let i = 0; i < 5; i++) {
            const crate = new THREE.Mesh(crateGeo, darkCrateMat);
            crate.position.set(5 + Math.random() * 5, 1, -5 + Math.random() * 5);
            crate.rotation.y = Math.random() * Math.PI;
            outpostGroup.add(crate);
        }
        
        // Command crate (Target for confrontation)
        const commandCrate = new THREE.Mesh(crateGeo, darkCrateMat);
        commandCrate.position.set(0, 1, 0);
        outpostGroup.add(commandCrate);

        group.add(outpostGroup);

        // Encounter logic for Outpost Confrontation
        let outpostStandoffTriggered = false;
        let outpostConfrontationResolved = false;
        let checkLoopActive = false;
        let cameraRef: THREE.Camera | null = null;
        
        // Lantern patrols (visuals only)
        const patrolLights: THREE.PointLight[] = [];
        
        const checkOutpostProximity = () => {
            if (!checkLoopActive) return;
            
            if (!cameraRef) {
                // Find the main camera
                api.scene.traverse((child: THREE.Object3D) => {
                    if ((child as any).isPerspectiveCamera) {
                        cameraRef = child as THREE.Camera;
                    }
                });
            }

            if (cameraRef && !outpostConfrontationResolved) {
                const dx = cameraRef.position.x - oX;
                const dz = cameraRef.position.z - oZ;
                const distSq = dx * dx + dz * dz;

                // Enter perimeter triggers standoff (radius ~30)
                if (distSq < 900 && !outpostStandoffTriggered) {
                    outpostStandoffTriggered = true;
                    // Spawn 2-3 mercenary lantern patrols (red lights)
                    for (let i = 0; i < 3; i++) {
                        const light = new THREE.PointLight(0xff0000, 2, 20);
                        const angle = (i / 3) * Math.PI * 2;
                        light.position.set(oX + Math.cos(angle) * 15, api.terrainHeight(oX, oZ) + 2, oZ + Math.sin(angle) * 15);
                        api.scene.add(light);
                        patrolLights.push(light);
                    }
                }

                // Reach command crate sets flag (radius ~5)
                if (distSq < 25 && outpostStandoffTriggered) {
                    outpostConfrontationResolved = true;
                    api.flags.set('q_act2_outpost_confrontation');
                    // Lights could turn off or change color to indicate resolution
                    patrolLights.forEach(l => l.color.setHex(0x00ff00));
                }
            }

            requestAnimationFrame(checkOutpostProximity);
        };

        api.onEnterRegion(() => {
            checkLoopActive = true;
            checkOutpostProximity();
        });

        api.onExitRegion(() => {
            checkLoopActive = false;
            patrolLights.forEach(l => {
                if (l.parent) l.parent.remove(l);
            });
            patrolLights.length = 0;
            cameraRef = null;
        });
        
        // 5. Paqarina Descent (Position: x: -50, z: 1150)
        const paqarinaGroup = new THREE.Group();
        const pX = -50, pZ = 1150;
        paqarinaGroup.position.set(pX, api.terrainHeight(pX, pZ), pZ);

        // Massive Cave Mouth
        const mouthGeo = new THREE.BoxGeometry(40, 30, 20);
        const mouth = new THREE.Mesh(mouthGeo, stoneMat);
        mouth.position.y = 10;
        
        const voidGeo = new THREE.BoxGeometry(30, 20, 21);
        const caveVoid = new THREE.Mesh(voidGeo, darkCaveMat);
        caveVoid.position.y = 5;
        // The void is rendered to look deep and dark
        
        paqarinaGroup.add(mouth, caveVoid);
        group.add(paqarinaGroup);
        
    }
};
