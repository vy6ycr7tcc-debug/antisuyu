import { cloudForest } from './cloudForest.js';
import { highSierra } from './highSierra.js';
import { jungleLowlands } from './jungleLowlands.js';
import { paititi } from './paititi.js';
import { QUEST_FLAG_NAMES } from '../save/questFlags.js';
import type { RegionModule } from '../world/contracts.js';

export const REGIONS: RegionModule[] = [
  cloudForest,
  highSierra,
  jungleLowlands,
  paititi
];

const validFlags = new Set(QUEST_FLAG_NAMES);

// Validate Registry
function validateRegistry() {
  const ids = new Set<string>();

  for (let i = 0; i < REGIONS.length; i++) {
    const region = REGIONS[i];

    // Check unique ID
    if (ids.has(region.id)) {
      throw new Error(`Duplicate region ID found: ${region.id}`);
    }
    ids.add(region.id);

    // Check overlapping bounds AABB
    for (let j = i + 1; j < REGIONS.length; j++) {
      const other = REGIONS[j];
      const r1 = region.bounds;
      const r2 = other.bounds;

      const overlapX = r1.max.x >= r2.min.x && r1.min.x <= r2.max.x;
      const overlapY = r1.max.y >= r2.min.y && r1.min.y <= r2.max.y;
      const overlapZ = r1.max.z >= r2.min.z && r1.min.z <= r2.max.z;

      if (overlapX && overlapY && overlapZ) {
        throw new Error(`Region bounds overlap between ${region.id} and ${other.id}`);
      }
    }

    // Validate flags
    for (const poi of region.pois) {
      if (poi.discoverFlag && !validFlags.has(poi.discoverFlag as any)) {
        throw new Error(`Invalid discoverFlag '${poi.discoverFlag}' in POI '${poi.id}' of region '${region.id}'`);
      }
    }

    for (const enc of region.encounters) {
      for (const flag of enc.flagsOnStart) {
        if (!validFlags.has(flag as any)) {
          throw new Error(`Invalid flagsOnStart '${flag}' in encounter '${enc.id}' of region '${region.id}'`);
        }
      }
      for (const flag of enc.flagsOnResolve) {
        if (!validFlags.has(flag as any)) {
          throw new Error(`Invalid flagsOnResolve '${flag}' in encounter '${enc.id}' of region '${region.id}'`);
        }
      }
    }

    for (const qs of region.questStages) {
      if (!validFlags.has(qs.flag as any)) {
        throw new Error(`Invalid QuestStageDef flag '${qs.flag}' in region '${region.id}'`);
      }
    }
  }
}

validateRegistry();
