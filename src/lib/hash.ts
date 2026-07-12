// Deterministic string -> 32-bit int hash (FNV-1a variant). Used to derive a
// per-level map-generation seed from (masterSeed, levelIndex) so a level's
// geometry is a pure function of the seed + index.
export function hashStringToInt(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // force unsigned 31-bit positive
  return (h >>> 0) % 0x7fffffff;
}

/** The map-generation seed for a given level of a run. */
export function levelSeed(masterSeed: string, levelIndex: number): number {
  return hashStringToInt(`${masterSeed}:lvl:${levelIndex}`);
}

/** Numeric seed for the gameplay RNG stream (independent of map-gen). */
export function gameplaySeed(masterSeed: string): number {
  return hashStringToInt(`${masterSeed}:play`);
}
