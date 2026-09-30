export interface SaveData {
  schema: 'schema_v1';
  savedAt: number;
  player: {
    position: { x: number; y: number; z: number };
    rotationY: number;
    regionId: string;
  };
  questFlags: Record<string, boolean>;
  inventory: string[];
  solvedPuzzles: string[];
  worldState: Record<string, boolean | number | string>;
}

export interface SaveAPI {
  save(slot?: number): void;
  load(slot?: number): SaveData | null;
  hasSave(slot?: number): boolean;
  deleteSave(slot?: number): void;
  collectAutosave(
    player: SaveData['player'],
    flags: Record<string, boolean>,
    inventory: string[],
    solved: string[],
    world: Record<string, boolean | number | string>
  ): void;
  migrate(raw: unknown): SaveData;
}

const OLD_STORAGE_PREFIX = 'antisuyu.save.v1.slot';
const NEW_STORAGE_PREFIX = 'juzu.save.v1.slot';

export function createSaveSystem(storage?: Storage): SaveAPI {
  // Graceful fallback if storage isn't available
  const actualStorage = storage || (typeof window !== 'undefined' ? window.localStorage : ({} as Storage));

  // Safe wrapper around storage to prevent crashes on missing methods
  const safeGetItem = (key: string): string | null => {
    try {
      return actualStorage.getItem ? actualStorage.getItem(key) : null;
    } catch {
      return null;
    }
  };

  const safeSetItem = (key: string, value: string): void => {
    try {
      if (actualStorage.setItem) actualStorage.setItem(key, value);
    } catch {
      // Ignore
    }
  };

  const safeRemoveItem = (key: string): void => {
    try {
      if (actualStorage.removeItem) actualStorage.removeItem(key);
    } catch {
      // Ignore
    }
  };

  const migrate = (raw: unknown): SaveData => {
    // Fill defaults for schema_v1, dropping unknown fields and never throwing
    const defaultData: SaveData = {
      schema: 'schema_v1',
      savedAt: Date.now(),
      player: {
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        regionId: 'cloud_forest'
      },
      questFlags: {},
      inventory: [],
      solvedPuzzles: [],
      worldState: {}
    };

    if (!raw || typeof raw !== 'object') {
      return defaultData;
    }

    const typedRaw = raw as any;

    return {
      schema: 'schema_v1',
      savedAt: typeof typedRaw.savedAt === 'number' ? typedRaw.savedAt : defaultData.savedAt,
      player: {
        position: {
          x: typeof typedRaw.player?.position?.x === 'number' ? typedRaw.player.position.x : defaultData.player.position.x,
          y: typeof typedRaw.player?.position?.y === 'number' ? typedRaw.player.position.y : defaultData.player.position.y,
          z: typeof typedRaw.player?.position?.z === 'number' ? typedRaw.player.position.z : defaultData.player.position.z
        },
        rotationY: typeof typedRaw.player?.rotationY === 'number' ? typedRaw.player.rotationY : defaultData.player.rotationY,
        regionId: typeof typedRaw.player?.regionId === 'string' ? typedRaw.player.regionId : defaultData.player.regionId,
      },
      questFlags: typeof typedRaw.questFlags === 'object' && typedRaw.questFlags !== null ? { ...typedRaw.questFlags } : defaultData.questFlags,
      inventory: Array.isArray(typedRaw.inventory) ? [...typedRaw.inventory] : defaultData.inventory,
      solvedPuzzles: Array.isArray(typedRaw.solvedPuzzles) ? [...typedRaw.solvedPuzzles] : defaultData.solvedPuzzles,
      worldState: typeof typedRaw.worldState === 'object' && typedRaw.worldState !== null ? { ...typedRaw.worldState } : defaultData.worldState
    };
  };

  let pendingAutosave: SaveData | null = null;

  return {
    save(slot = 0) {
      if (!pendingAutosave) return;
      const key = `${NEW_STORAGE_PREFIX}${slot}`;
      pendingAutosave.savedAt = Date.now();
      const json = JSON.stringify(pendingAutosave);
      safeSetItem(key, json);
    },

    load(slot = 0) {
      const newKey = `${NEW_STORAGE_PREFIX}${slot}`;
      const newJson = safeGetItem(newKey);

      if (newJson) {
        try {
          const raw = JSON.parse(newJson);
          return migrate(raw);
        } catch (e) {
          console.error(`Failed to parse save data for slot ${slot}:`, e);
          return null;
        }
      }

      const oldKey = `${OLD_STORAGE_PREFIX}${slot}`;
      const oldJson = safeGetItem(oldKey);

      if (!oldJson) return null;

      try {
        const raw = JSON.parse(oldJson);
        const migrated = migrate(raw);

        // Write migrated data to new prefix
        const migratedJson = JSON.stringify(migrated);
        safeSetItem(newKey, migratedJson);

        // Verify it was written successfully
        if (safeGetItem(newKey) === migratedJson) {
          safeRemoveItem(oldKey);
        }

        return migrated;
      } catch (e) {
        console.error(`Failed to parse save data for slot ${slot}:`, e);
        return null; // Corrupt JSON returns null, never throws
      }
    },

    hasSave(slot = 0) {
      const newKey = `${NEW_STORAGE_PREFIX}${slot}`;
      const oldKey = `${OLD_STORAGE_PREFIX}${slot}`;
      return safeGetItem(newKey) !== null || safeGetItem(oldKey) !== null;
    },

    deleteSave(slot = 0) {
      const newKey = `${NEW_STORAGE_PREFIX}${slot}`;
      const oldKey = `${OLD_STORAGE_PREFIX}${slot}`;
      safeRemoveItem(newKey);
      safeRemoveItem(oldKey);
    },

    collectAutosave(player, flags, inventory, solved, world) {
      pendingAutosave = {
        schema: 'schema_v1',
        savedAt: Date.now(),
        player: { ...player },
        questFlags: { ...flags },
        inventory: [...inventory],
        solvedPuzzles: [...solved],
        worldState: { ...world }
      };
    },

    migrate
  };
}
