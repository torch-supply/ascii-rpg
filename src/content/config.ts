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
  contentVersion: "4",
};
