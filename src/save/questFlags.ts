export const QUEST_FLAG_NAMES = [
  'q_act1_met_tomas',
  'q_act1_ruin_infiltrated',
  'q_act1_quipu_solved',
  'q_act2_chakana_reached',
  'q_act2_chakana_solved',
  'q_act2_sayhuite_solved',
  'q_act2_outpost_confrontation',
  'q_act3_amaru_navigated',
  'q_act3_tunnels_survived',
  'q_act3_vanguard_secured',
  'q_act4_paititi_entered',
  'q_act4_sanctuary_confrontation',
  'q_act4_observatory_aligned'
] as const;

export type QuestFlagName = typeof QUEST_FLAG_NAMES[number];

export interface QuestFlagAPI {
  set(flag: string): void;
  clear(flag: string): void;
  has(flag: string): boolean;
  snapshot(): Record<string, boolean>;
  restore(s: Record<string, boolean>): void;
  onChange(cb: (flag: string, value: boolean) => void): () => void;
}

export function createQuestFlags(): QuestFlagAPI {
  let flags: Record<string, boolean> = {};
  const validFlags = new Set(QUEST_FLAG_NAMES);
  const listeners: Set<(flag: string, value: boolean) => void> = new Set();

  function validateFlag(flag: string) {
    if (!validFlags.has(flag as QuestFlagName)) {
      throw new Error(`Unknown quest flag: "${flag}"`);
    }
  }

  function notify(flag: string, value: boolean) {
    for (const cb of listeners) {
      cb(flag, value);
    }
  }

  return {
    set(flag: string) {
      validateFlag(flag);
      if (!flags[flag]) {
        flags[flag] = true;
        notify(flag, true);
      }
    },
    clear(flag: string) {
      validateFlag(flag);
      if (flags[flag]) {
        flags[flag] = false;
        notify(flag, false);
      }
    },
    has(flag: string) {
      validateFlag(flag);
      return !!flags[flag];
    },
    snapshot() {
      return { ...flags };
    },
    restore(s: Record<string, boolean>) {
      flags = {};
      for (const [k, v] of Object.entries(s)) {
        if (validFlags.has(k as QuestFlagName)) {
          flags[k] = !!v;
        }
      }
    },
    onChange(cb: (flag: string, value: boolean) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }
  };
}
