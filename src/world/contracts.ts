import { QuestFlagAPI } from '../save/questFlags.js';

export interface Vec3 { x: number; y: number; z: number; }

export interface POIDef {
  id: string;            // '<region>_<slug>', e.g. 'cf_lower_blockade'
  name: string;
  position: Vec3;        // world-space anchor; region sessions use getGlobalTerrainHeight for y
  radius: number;        // discovery trigger radius in meters
  summary: string;       // 1-2 lines, internal working note
  discoverFlag?: string; // EXACT quest flag name from QUEST_FLAG_NAMES, set on first discovery
}

export interface EncounterDef {
  id: string;            // '<region>_<slug>'
  position: Vec3;
  radius: number;
  kind: 'stealth' | 'chase' | 'wildlife' | 'ambush' | 'puzzle_guard';
  flagsOnStart: string[];   // exact flag names
  flagsOnResolve: string[]; // exact flag names
  notes: string;         // internal: intended beat, structural only
}

export interface QuestStageDef {
  flag: string;          // EXACT name from QUEST_FLAG_NAMES
  trigger: string;       // gameplay event that sets it
}

export interface RegionShotDef {
  id: string;            // '<region>_<slug>'; integration will wire ?shot=region:<id>
  camera: Vec3;
  lookAt: Vec3;
}

import type * as THREE from 'three';

export interface RegionBuildAPI {
  scene: THREE.Scene;
  flags: QuestFlagAPI;
  terrainHeight(x: number, z: number): number; // wraps getGlobalTerrainHeight
  onEnterRegion(cb: () => void): void;
  onExitRegion(cb: () => void): void;
}

export interface RegionModule {
  id: 'cloud_forest' | 'high_sierra' | 'jungle_lowlands' | 'paititi';
  displayName: string;
  bounds: { min: Vec3; max: Vec3 };  // normative AABB, assigned per-region below — implement as given
  pois: POIDef[];
  encounters: EncounterDef[];
  questStages: QuestStageDef[];      // EVERY flag the region may set
  shots: RegionShotDef[];            // >= 1 per POI
  build(api: RegionBuildAPI): void;
}

// Normative region bounds (region sessions must implement exactly these — they guarantee zero overlap):
// cloud_forest: x [-450, 450], z [-700, 100]
// high_sierra: x [-450, 450], z [500, 1200]
// jungle_lowlands: x [-450, 450], z [-1400, -700]
// paititi: x [800, 1400], z [-400, 200]
