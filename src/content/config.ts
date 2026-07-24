import type { Biome } from "@/game/core/types";

// Global, non-per-level tuning knobs.
export const CONFIG = {
  startingLives: 3,
  startingMaxHp: 20,
  startingWeaponId: "w_dagger",
  startingArmorId: "a_rags",
  /** how far a coin pile's value can swing, before coinRichness multiplier */
  coinPile: { min: 5, max: 15 },
  /** keep monsters from spawning right on top of the player */
  minSpawnDistanceFromPlayer: 6,
  /** message log lines kept in memory */
  messageLogMax: 50,
  /** damage a hidden spike trap deals when triggered (reduced by armor) */
  trapDamage: 6,
  /** default torch fuel (turns of light) if an item doesn't specify its own */
  torchFuel: 150,
  /** how far the firebomb cursor may be placed from the player */
  throwRange: 7,
  /** weapon-power bonus while the Might effect is active */
  mightBonus: 4,
  /** armed traps within this many tiles are sensed (revealed as a faint ^) */
  trapSenseRadius: 1,
  /** damage multiplier for striking a monster that hasn't noticed you (sneak) */
  sneakMultiplier: 2,
  /** damage a volatile elite's death-burst deals to an adjacent player */
  eliteExplodeDamage: 6,
  /** melee bumps needed to smash open a cracked wall (knockback breaks instantly) */
  crackedWallToughness: 4,
  /** cap on persistent floor decals per level (drops oldest beyond this) */
  maxDecals: 220,
  /** fraction of an item's base value the shop pays when you sell it */
  sellRate: 0.4,
  /** "survive" levels: an escalating siege — waves close in from a ring around
   * the player, growing as the timer runs down, up to a concurrent cap */
  siege: {
    waveEvery: 3, // spawn a wave every N turns
    ringMin: 5, // waves appear this..
    ringMax: 10, // ..to this many tiles from the player (they arrive in a few turns)
    cap: 22, // max concurrent monsters during the hold
  },
  /** Overtime pressure: on non-"survive" levels, running out the turn budget is
   * NOT an instant death. Instead the level turns hostile — reinforcements close
   * in from a ring (reusing the siege geometry), spawning faster and in larger
   * waves the longer you overstay, so dawdling gets lethal via monsters you can
   * actually fight rather than a silent clock. */
  overtime: {
    startEvery: 9, // at par, a wave every N turns — a gentle trickle, not a flood
    minEvery: 4, // cadence floor as you overstay (never faster than this)
    rampEvery: 30, // tighten the cadence by 1 turn every N turns past par
    rampWave: 50, // +1 to wave size every N turns past par (stays ~1 for a long while)
    cap: 12, // hard ceiling on TOTAL monsters during overtime — keep it fightable
  },
  /** Malachar's boss fight (behavior "bossLich"). Values are indexed by phase
   * (0: HP>2/3, 1: HP>1/3, 2: HP≤1/3) so the fight escalates as he weakens. */
  lich: {
    /** dark-fire barrage: damage per detonating tile (reduced by armor/ward) */
    barrageDamage: 12,
    /** how many tiles the barrage telegraphs, by phase */
    barrageTiles: [3, 5, 7],
    /** turns between special abilities (barrage/summon), by phase */
    abilityCd: [5, 4, 3],
    /** adds summoned per summon, by phase */
    summonCount: [2, 2, 3],
    /** chance an ability is a summon (else a barrage), by phase */
    summonChance: [0.4, 0.45, 0.5],
    /** don't summon past this many living non-boss monsters */
    summonCap: 8,
    /** blink at least this far from the player when cornered */
    teleportMinDist: 4,
  },
  /** Forage heal tiles. Outdoors the land sustains you (small, plentiful heals);
   * the deeper arcane motes heal a touch more but are far rarer (per-level
   * `forageCount`, sparse-to-none in the castle/throne). */
  forage: {
    outdoorBiomes: ["forest", "marsh", "mountain"] as Biome[],
    outdoor: { heal: 1, glyph: "%", color: "#8fd45a", name: "wild growth" },
    arcane: { heal: 2, glyph: "∴", color: "#c86bff", name: "arcane mote" },
  },
  /** while the Shadow effect is active, monsters can't detect you beyond this
   * many tiles (on top of the usual light-limited sight) */
  shadowSightRadius: 2,
  /** an alerted (non-boss) monster gives up the chase after this many turns
   * without detecting you — break line-of-sight and wait it out */
  loseInterestTurns: 6,
  /** how far the Phial of Blinking can teleport you (cursor range) */
  blinkRange: 5,
  /** how long a status debuff lasts when applied by a fire tile (burn refresh) */
  fireBurnDuration: 2,
  /** lingering fire tiles left by a thrown firebomb */
  fire: {
    /** turns a fire tile keeps burning */
    duration: 4,
    /** per-tile chance to catch fire within the blast footprint */
    spawnChance: 0.6,
  },
  /** localStorage key for the single autosave slot */
  saveKey: "emberofdawn:save:v1",
  /** bump content version to invalidate incompatible saves */
  contentVersion: "28",
};

/** Forage flavor + heal for a biome: outdoor growth vs. deeper arcane motes. */
export function forageStyle(biome: Biome) {
  return CONFIG.forage.outdoorBiomes.includes(biome)
    ? CONFIG.forage.outdoor
    : CONFIG.forage.arcane;
}
