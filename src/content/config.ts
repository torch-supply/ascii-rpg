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
  /** localStorage key for the single autosave slot */
  saveKey: "emberofdawn:save:v1",
  /** bump content version to invalidate incompatible saves */
  contentVersion: "1",
};
