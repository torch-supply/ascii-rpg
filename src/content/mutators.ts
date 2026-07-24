import type { LevelConfig, PlayerState } from "@/game/core/types";

// ─────────────────────────────────────────────────────────────────────────
// Run modifiers ("trials") — opt-in, seeded challenges chosen at New Game that
// reshape the WHOLE run. Each is a pure transform over a level's config (and/or
// a one-time tweak to the starting player). They stack, and raise the end-of-run
// score. Data-driven: add one here and it appears in the picker automatically.
// ─────────────────────────────────────────────────────────────────────────
export interface Mutator {
  id: string;
  name: string;
  blurb: string;
  /** added into the run's combined score multiplier (1.0 + Σ) */
  scoreMult: number;
  /** transform applied to every level's config (light, spawns, traps, …) */
  applyLevel?: (c: LevelConfig) => LevelConfig;
  /** one-time tweak to the starting player (e.g. fewer lives) */
  applyPlayer?: (p: PlayerState) => void;
}

export const MUTATORS: Mutator[] = [
  {
    id: "dark",
    name: "The Dark Deepens",
    blurb: "Your light reaches 2 tiles less — the gloom presses in.",
    scoreMult: 0.25,
    applyLevel: (c) => ({ ...c, baseLightRadius: Math.max(2, c.baseLightRadius - 2) }),
  },
  {
    id: "swarm",
    name: "Restless Dead",
    blurb: "50% more monsters prowl each floor.",
    scoreMult: 0.3,
    applyLevel: (c) => ({ ...c, monsterBudget: Math.round(c.monsterBudget * 1.5) }),
  },
  {
    id: "treacherous",
    name: "Treacherous",
    blurb: "Twice the hidden traps underfoot.",
    scoreMult: 0.2,
    applyLevel: (c) => ({ ...c, trapCount: (c.trapCount ?? 0) * 2 }),
  },
  {
    id: "hunted",
    name: "Hunted",
    blurb: "20% less time on the clock before the world turns on you.",
    scoreMult: 0.25,
    applyLevel: (c) => ({ ...c, turnLimit: Math.round(c.turnLimit * 0.8) }),
  },
  {
    id: "champions",
    name: "Champions",
    blurb: "Elite, empowered foes are far more common.",
    scoreMult: 0.2,
    applyLevel: (c) => ({
      ...c,
      eliteChance: Math.min(0.5, Math.max(0.3, (c.eliteChance ?? 0) * 2)),
    }),
  },
  {
    id: "glass",
    name: "Glass",
    blurb: "Begin with a single life. No second chances.",
    scoreMult: 0.4,
    applyPlayer: (p) => {
      p.lives = 1;
    },
  },
];

export function mutatorById(id: string): Mutator | undefined {
  return MUTATORS.find((m) => m.id === id);
}

/** Fold every active mutator's level transform over a level config. */
export function applyLevelMutators(config: LevelConfig, ids: string[]): LevelConfig {
  let c = config;
  for (const id of ids) {
    const m = mutatorById(id);
    if (m?.applyLevel) c = m.applyLevel(c);
  }
  return c;
}

/** Apply the one-time player tweaks (run start). */
export function applyPlayerMutators(player: PlayerState, ids: string[]): void {
  for (const id of ids) mutatorById(id)?.applyPlayer?.(player);
}

/** Combined end-of-run score multiplier from the active mutators (1.0 = none). */
export function mutatorScoreMult(ids: string[]): number {
  return 1 + ids.reduce((s, id) => s + (mutatorById(id)?.scoreMult ?? 0), 0);
}
