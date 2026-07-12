import * as ROT from "rot-js";

// ── Two RNG streams (see plan): ─────────────────────────────────────────────
// 1. MAP-GEN stream — the GLOBAL ROT.RNG. rot.js map generators draw from it
//    internally, so we seed the global to `levelSeed(master, index)` right
//    before generating/placing a level. Geometry becomes a pure function of
//    seed + index, independent of gameplay rolls.
// 2. GAMEPLAY stream — an independent cloned RNG whose state we persist in the
//    save. Used for monster wandering etc. Never touches the global singleton.

/** Seed the GLOBAL rot.js RNG for deterministic map generation + placement. */
export function seedMapGen(seed: number): void {
  ROT.RNG.setSeed(seed);
}

/** Weighted pick from the map-gen (global) stream. */
export function mapWeighted(weights: Record<string, number>): string | undefined {
  return ROT.RNG.getWeightedValue(weights);
}

/** Integer in [lo, hi] inclusive from the map-gen (global) stream. */
export function mapInt(lo: number, hi: number): number {
  return ROT.RNG.getUniformInt(lo, hi);
}

/** Independent gameplay RNG. State is serialized into saves. */
export class Rng {
  // ROT.RNG is a singleton instance; `typeof` gives its instance type.
  private gen: typeof ROT.RNG;

  constructor(seed: number, state?: number[]) {
    // clone() yields a fresh RNG independent of the global singleton.
    this.gen = ROT.RNG.clone();
    if (state) this.gen.setState(state);
    else this.gen.setSeed(seed);
  }

  int(lo: number, hi: number): number {
    return this.gen.getUniformInt(lo, hi);
  }

  next(): number {
    return this.gen.getUniform();
  }

  chance(p: number): boolean {
    return this.gen.getUniform() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.gen.getUniformInt(0, arr.length - 1)];
  }

  getState(): number[] {
    return this.gen.getState();
  }

  setState(state: number[]): void {
    this.gen.setState(state);
  }
}
