import { REGIONS } from '../regions/registry.js';
import type { RegionModule, RegionBuildAPI, Vec3 } from './contracts.js';
import type { SaveAPI } from '../save/saveSystem.js';
import type { QuestFlagAPI } from '../save/questFlags.js';

export interface RegionManagerAPI {
  saveAPI: SaveAPI;
  flags: QuestFlagAPI;
  worldState: Record<string, boolean | number | string>;
  inventory: string[];
  solvedPuzzles: string[];
}

export function createRegionManager(api: RegionManagerAPI) {
  let currentRegionId: string | null = null;
  let activeRegion: RegionModule | null = null;

  // Track state
  const discoveredPOIs = new Set<string>();
  const startedEncounters = new Set<string>();
  const resolvedEncounters = new Set<string>();

  // Initialize from worldState if applicable
  for (const key of Object.keys(api.worldState)) {
    if (key.startsWith('poi_discovered_') && api.worldState[key]) {
      discoveredPOIs.add(key.replace('poi_discovered_', ''));
    }
  }

  // Callbacks
  const enterCallbacks = new Map<string, Array<() => void>>();
  const exitCallbacks = new Map<string, Array<() => void>>();

  for (const region of REGIONS) {
    enterCallbacks.set(region.id, []);
    exitCallbacks.set(region.id, []);
  }

  function getRegionAt(pos: Vec3): RegionModule | null {
    for (const region of REGIONS) {
      const b = region.bounds;
      if (pos.x >= b.min.x && pos.x <= b.max.x &&
          pos.y >= b.min.y && pos.y <= b.max.y &&
          pos.z >= b.min.z && pos.z <= b.max.z) {
        return region;
      }
    }
    return null;
  }

  return {
    get currentRegionId() { return currentRegionId; },

    registerEnterCallback(regionId: string, cb: () => void) {
      enterCallbacks.get(regionId)?.push(cb);
    },

    registerExitCallback(regionId: string, cb: () => void) {
      exitCallbacks.get(regionId)?.push(cb);
    },

    resolveEncounter(id: string) {
      if (resolvedEncounters.has(id)) return;
      resolvedEncounters.add(id);

      for (const region of REGIONS) {
        const enc = region.encounters.find(e => e.id === id);
        if (enc) {
          for (const flag of enc.flagsOnResolve) {
            api.flags.set(flag);
          }
          break;
        }
      }
    },

    update(playerPos: Vec3) {
      const newRegion = getRegionAt(playerPos);
      const newRegionId = newRegion ? newRegion.id : null;

      // Region transition
      if (newRegionId !== currentRegionId) {
        if (currentRegionId) {
          const cbs = exitCallbacks.get(currentRegionId);
          if (cbs) cbs.forEach(cb => cb());
        }

        currentRegionId = newRegionId;
        activeRegion = newRegion;

        if (currentRegionId) {
          const cbs = enterCallbacks.get(currentRegionId);
          if (cbs) cbs.forEach(cb => cb());
        }

        // Autosave on region change, but skip in shot mode (handled outside via guard if needed, but we can check window.__shotReady or URL)
        const isShotMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('shot');
        if (!isShotMode && newRegionId) {
          api.saveAPI.collectAutosave(
            { position: { x: playerPos.x, y: playerPos.y, z: playerPos.z }, rotationY: 0, regionId: newRegionId },
            api.flags.snapshot(),
            api.inventory,
            api.solvedPuzzles,
            api.worldState
          );
          api.saveAPI.save(0);
        }
      }

      if (activeRegion) {
        // POI Check
        for (const poi of activeRegion.pois) {
          if (!discoveredPOIs.has(poi.id)) {
            const dx = playerPos.x - poi.position.x;
            const dy = playerPos.y - poi.position.y;
            const dz = playerPos.z - poi.position.z;
            const distSq = dx*dx + dy*dy + dz*dz;

            if (distSq <= poi.radius * poi.radius) {
              discoveredPOIs.add(poi.id);
              api.worldState[`poi_discovered_${poi.id}`] = true;
              if (poi.discoverFlag) {
                api.flags.set(poi.discoverFlag);
              }
            }
          }
        }

        // Encounter check
        for (const enc of activeRegion.encounters) {
          if (!startedEncounters.has(enc.id)) {
            const dx = playerPos.x - enc.position.x;
            const dy = playerPos.y - enc.position.y;
            const dz = playerPos.z - enc.position.z;
            const distSq = dx*dx + dy*dy + dz*dz;

            if (distSq <= enc.radius * enc.radius) {
              startedEncounters.add(enc.id);
              for (const flag of enc.flagsOnStart) {
                api.flags.set(flag);
              }
            }
          }
        }
      }
    }
  };
}
