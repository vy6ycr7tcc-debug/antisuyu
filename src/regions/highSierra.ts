import * as THREE from 'three';
import type { 
    RegionModule, 
    RegionBuildAPI, 
    POIDef, 
    EncounterDef, 
    QuestStageDef, 
    RegionShotDef
} from '../world/contracts.js';
import { ashlarLight, granite, bronze, woodAged, caveDark, thatchIchu, lichenPatch, terracotta, channelClear } from '../materials.js';
import type { QuestFlagAPI } from '../save/questFlags.js';

// J7: all placement is seeded (Mulberry32, same pattern as volumetrics.ts).
// The pre-p10 file used Math.random() throughout — every page load re-rolled
// cliff jitter, grass and crate scatter (p10 audit defect ①).
const HS_SEED = 0x6501;
function mulberry32(a: number) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const highSierra: RegionModule = {
    id: 'high_sierra',
    displayName: 'The High Sierra',
    bounds: { 
        min: { x: -450, y: 0, z: 500 }, 
        max: { x: 450, y: 300, z: 1200 } 
    },
    pois: <POIDef[]>[
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
    encounters: <EncounterDef[]>[
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
    questStages: <QuestStageDef[]>[
        { flag: 'q_act2_chakana_reached', trigger: 'first discovery of the Chakana Gate POI' },
        { flag: 'q_act2_chakana_solved', trigger: 'solving the gate alignment' },
        { flag: 'q_act2_sayhuite_solved', trigger: 'solving the map-table water routing' },
        { flag: 'q_act2_outpost_confrontation', trigger: 'entering the outpost inner perimeter' }
    ],
    shots: <RegionShotDef[]>[
        { id: 'hs_qenko_marker', camera: { x: 100, y: 10, z: 580 }, lookAt: { x: 100, y: 0, z: 600 } },
        { id: 'hs_chakana_gate', camera: { x: -150, y: 15, z: 720 }, lookAt: { x: -150, y: 5, z: 750 } },
        { id: 'hs_sayhuite_table', camera: { x: 200, y: 20, z: 870 }, lookAt: { x: 200, y: 5, z: 900 } },
        { id: 'hs_outpost', camera: { x: 0, y: 20, z: 1000 }, lookAt: { x: 0, y: 5, z: 1050 } },
        { id: 'hs_paqarina_descent', camera: { x: -50, y: 15, z: 1110 }, lookAt: { x: -50, y: 5, z: 1150 } },
        { id: 'hs_overview', camera: { x: 0, y: 150, z: 600 }, lookAt: { x: 0, y: 0, z: 800 } }
    ],
    build(api: RegionBuildAPI): void {
        const rng = mulberry32(HS_SEED);
        const _flags: QuestFlagAPI = api.flags;
        _flags;
        const group = new THREE.Group();
        group.name = 'Region_HighSierra';
        api.scene.add(group);

        // Materials (Standard PBR, no TSL, WebGL2 compatible)
        const stoneMat = ashlarLight();
        const carvedStoneMat = granite();
        const bronzeMat = bronze();
        const darkCrateMat = woodAged();
        const darkCaveMat = caveDark();
        const lichenMat = lichenPatch();
        const clayMat = terracotta();

        // §2.3 dressing vocabulary helpers (all seeded, J7)

        // Cairn: stacked stone pile (§2.3 vocabulary)
        const cairnGeo = [new THREE.DodecahedronGeometry(1.1), new THREE.DodecahedronGeometry(0.8), new THREE.DodecahedronGeometry(0.5)];
        const cairn = (parent: THREE.Object3D, x: number, z: number, s = 1) => {
            let y = 0;
            for (const g of cairnGeo) {
                const stone = new THREE.Mesh(g, carvedStoneMat);
                stone.position.set(x + (rng() - 0.5) * 0.3, y + 0.5 * s, z + (rng() - 0.5) * 0.3);
                stone.scale.setScalar(s);
                stone.rotation.y = rng() * Math.PI;
                parent.add(stone);
                y += 0.62 * s;
            }
        };

        // Lichen patch: flat decal slightly off the host face (§2.3, roughness 1.0)
        const lichenGeo = new THREE.CircleGeometry(1, 10);
        const lichen = (parent: THREE.Object3D, x: number, y: number, z: number, rx: number, ry: number, s: number) => {
            const p = new THREE.Mesh(lichenGeo, lichenMat);
            p.position.set(x, y, z);
            p.rotation.set(rx, ry, rng() * Math.PI);
            p.scale.setScalar(s);
            parent.add(p);
        };

        // 1. Qenko Solstice Marker (Position: x: 100, z: 600)
        const qenkoGroup = new THREE.Group();
        const qX = 100, qZ = 600;
        qenkoGroup.position.set(qX, api.terrainHeight(qX, qZ), qZ);
        
        // Base outcropping
        const outcropGeo = new THREE.CylinderGeometry(15, 18, 5, 8);
        const outcrop = new THREE.Mesh(outcropGeo, stoneMat);
        outcrop.position.y = -2.5; // sunk halfway
        qenkoGroup.add(outcrop);

        // §2.3 lichen patches on the outcrop rim + a cairn line (vocabulary)
        for (let i = 0; i < 7; i++) {
            const a = rng() * Math.PI * 2;
            lichen(qenkoGroup, Math.cos(a) * (13 + rng() * 3), 0.1 + rng() * 2.4, Math.sin(a) * (13 + rng() * 3), -Math.PI / 2 + (rng() - 0.5) * 0.5, 0, 0.8 + rng() * 1.6);
        }
        cairn(qenkoGroup, 12, 8, 0.9);
        cairn(qenkoGroup, 14, 10.5, 0.7);
        
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

        // Canyon Wall (Rock face) — seeded jitter (J7)
        const wallGroup = new THREE.Group();
        const cliffGeo = new THREE.BoxGeometry(40, 50, 10);
        for (let i = 0; i < 3; i++) {
            const cliff = new THREE.Mesh(cliffGeo, stoneMat);
            cliff.position.set((i - 1) * 35, 20, -5 + rng() * 5);
            cliff.rotation.y = (rng() - 0.5) * 0.2;
            wallGroup.add(cliff);
        }
        // §2.3 lichen patches on the cliff faces
        for (let i = 0; i < 8; i++) {
            const side = i % 2 === 0 ? -1 : 1;
            lichen(wallGroup, side * (12 + rng() * 24), 4 + rng() * 26, 0.6 + rng() * 0.8, 0, side * Math.PI / 2, 1.2 + rng() * 2.2);
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
        
        // Export refs for animation later (typed userData — p10 audit defect ③:
        // the `as any` casts violated the repo rule)
        chakanaGroup.userData = { doorMesh, dial };

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
        

        // Milestone 2: Hard-light response — REMOVED (p10 audit defect ②).
        // The region added its own DirectionalLight(1.5) on enter: the light rig
        // (§7, V-LIGHT/p8) already grades the sierra sun — a second sun
        // double-graded the region and invalidated every capture's light read.
        // High-altitude hardness is owned by §3.3.2 (thin-air sun + exposure).

        // Milestone 2: Gold grass tones & rock/vegetation distribution
        const ichuMat = thatchIchu(); // Inherits the #9A8B4F / #6B6335 tones
        const grassGeo = new THREE.ConeGeometry(0.5, 2, 4);
        grassGeo.translate(0, 1, 0);

        const smallRockGeo = new THREE.DodecahedronGeometry(1.5);

        // Scatter around Qenko (seeded, J7)
        for(let i=0; i<15; i++) {
            const grass = new THREE.Mesh(grassGeo, ichuMat);
            grass.position.set((rng()-0.5)*20, 0, (rng()-0.5)*20);
            qenkoGroup.add(grass);

            if (i % 3 === 0) {
                const rock = new THREE.Mesh(smallRockGeo, carvedStoneMat);
                rock.position.set((rng()-0.5)*25, 0.5, (rng()-0.5)*25);
                qenkoGroup.add(rock);
            }
        }

        // Scatter around Chakana (seeded, J7)
        for(let i=0; i<15; i++) {
            const grass = new THREE.Mesh(grassGeo, ichuMat);
            grass.position.set((rng()-0.5)*20, 0, (rng()-0.5)*20);
            chakanaGroup.add(grass);
        }

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

        sayhuiteGroup.userData = { boulderGroup, sluices };

        // §2.3 stone-lined water channel: runs from the map boulder to the
        // plaza edge; the sluice puzzle "routes water" — the channel water
        // strip is revealed on solve (visual feedback, deterministic).
        const channelGroup = new THREE.Group();
        const channelFloor = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 16), stoneMat);
        channelFloor.position.set(-4, 0.1, 14);
        const channelWallL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 16), stoneMat);
        channelWallL.position.set(-4.95, 0.35, 14);
        const channelWallR = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 16), stoneMat);
        channelWallR.position.set(-3.05, 0.35, 14);
        const channelWater = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 15.6), channelClear());
        channelWater.position.set(-4, 0.42, 14);
        channelWater.visible = false; // revealed when q_act2_sayhuite_solved
        channelGroup.add(channelFloor, channelWallL, channelWallR, channelWater);
        sayhuiteGroup.add(channelGroup);

        // §2.3 terraced retaining walls along the plaza approach
        for (let i = 0; i < 2; i++) {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(18, 1.6, 1.2), stoneMat);
            wall.position.set(-6 + i * 4, 0.4 + i * 1.5, 22 + i * 2.4);
            wall.rotation.y = 0.18;
            sayhuiteGroup.add(wall);
            const grassCap = new THREE.Mesh(new THREE.BoxGeometry(17, 0.25, 1.1), ichuMat);
            grassCap.position.set(-6 + i * 4, 1.3 + i * 1.5, 22 + i * 2.4);
            grassCap.rotation.y = 0.18;
            sayhuiteGroup.add(grassCap);
        }

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

                    // §2.3: routed water becomes visible in the stone channel
                    channelWater.visible = true;

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
        const wall1 = new THREE.Mesh(new THREE.BoxGeometry(14.99, 5.99, 1.99), wallMat);
        wall1.position.set(-10, 3, -15);
        const wall2 = new THREE.Mesh(new THREE.BoxGeometry(19.99, 4.99, 1.99), wallMat);
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

        // Supply crates (Sol Negro) — seeded scatter (J7)
        const crateGeo = new THREE.BoxGeometry(2, 2, 2);
        for (let i = 0; i < 5; i++) {
            const crate = new THREE.Mesh(crateGeo, darkCrateMat);
            crate.position.set(5 + rng() * 5, 1, -5 + rng() * 5);
            crate.rotation.y = rng() * Math.PI;
            outpostGroup.add(crate);
        }

        // §2.3 pottery shards (terracotta, vocabulary) by the crates
        const shardGeo = new THREE.CylinderGeometry(0.6, 0.45, 0.12, 10);
        for (let i = 0; i < 4; i++) {
            const shard = new THREE.Mesh(shardGeo, clayMat);
            shard.position.set(3 + rng() * 8, 0.1, -7 + rng() * 6);
            shard.rotation.set((rng() - 0.5) * 0.4, rng() * Math.PI, (rng() - 0.5) * 0.4);
            outpostGroup.add(shard);
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

            // P-MOBILE: poll only while the sim runs — it reads the character
            // position, which is frozen under the pause menu, so ticking it
            // during pause could fire the confrontation flag one frame after
            // pausing instead of at the same sim moment.
            if (api.isSimPaused()) {
                requestAnimationFrame(checkOutpostProximity);
                return;
            }
            
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
                    // Spawn 3 mercenary lantern patrols — warm lantern tone
                    // (p10 audit defect ④: pure red 0xff0000 read arcade; the
                    // Sol Negro palette §2.2 is muted, torches are warm)
                    for (let i = 0; i < 3; i++) {
                        const light = new THREE.PointLight(0xffaa00, 2, 20);
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
                    // Resolution signal: lanterns dim to embers (was arcade green)
                    patrolLights.forEach(l => l.intensity = 0.35);
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

        // §2.3: lichen around the cave mouth + flanking cairns (vocabulary)
        for (let i = 0; i < 6; i++) {
            const side = i % 2 === 0 ? -1 : 1;
            lichen(paqarinaGroup, side * (14 + rng() * 6), 2 + rng() * 8, 10.6, 0, side * 0.4, 1.0 + rng() * 1.8);
        }
        cairn(paqarinaGroup, -12, 12, 1.0);
        cairn(paqarinaGroup, 12, 12, 1.0);

        group.add(paqarinaGroup);

        // §2.3 condor silhouette — distant, animated (vocabulary). A dark
        // gliding bird on a slow circular path high above the plaza; wing flap
        // + banking are deterministic functions of accumulated fixed-dt time
        // (same fixed-dt discipline as the vanguard timer loop).
        const condorGroup = new THREE.Group();
        const wingMat = new THREE.MeshBasicMaterial({ color: 0x23211E }); // silhouette read
        const wingGeo = new THREE.PlaneGeometry(4.2, 1.4);
        wingGeo.rotateX(-Math.PI / 2); // lie flat in XZ — surface visible from below
        const wingL = new THREE.Mesh(wingGeo, wingMat);
        wingL.position.x = -2.0;
        wingL.rotation.z = 0.12; // slight dihedral
        const wingR = new THREE.Mesh(wingGeo, wingMat);
        wingR.position.x = 2.0;
        wingR.rotation.z = -0.12;
        const condorBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.6, 4, 8), wingMat);
        condorBody.rotation.x = Math.PI / 2;
        const condor = new THREE.Group();
        condor.add(wingL, wingR, condorBody);
        condorGroup.add(condor);
        group.add(condorGroup);

        let condorT = 0;
        // Always-on ambient animation (NOT enter-gated): region enter/exit
        // callbacks never fire in shot mode (regionManager tracks the
        // CHARACTER, hidden at spawn in shot captures — same mechanism p4
        // found for decor.update), so an enter-gated condor is invisible in
        // every §8 capture. Ambient wildlife belongs to the scene, not to
        // the enter transition.
        const fly = () => {
            // P-MOBILE: ambient animation freezes with the sim — condorT is a
            // frame-count clock, so without this gate the condor kept orbiting
            // behind the pause menu while everything else stood still.
            if (!api.isSimPaused()) {
                condorT += 0.016;
            }
            const a = condorT * (Math.PI * 2 / 90); // 90 s orbit
            const cx = 100, cz = 850, r = 130;
            const h = api.terrainHeight(cx, cz) + 95;
            condor.position.set(cx + Math.cos(a) * r, h + Math.sin(a * 3) * 3, cz + Math.sin(a) * r);
            condor.rotation.y = -a;                         // face along the orbit
            condor.rotation.z = 0.28;                        // constant bank
            const flap = Math.sin(condorT * 2.4) * 0.3;
            wingL.rotation.z = 0.12 + flap;
            wingR.rotation.z = -0.12 - flap;
            requestAnimationFrame(fly);
        };
        fly();
        
    }
};
