import type { GameState } from "@/game/core/types";

export const SAVE_VERSION = 2;

/**
 * Where in the run the save was taken. A run is not only "inside a level": the
 * player can quit on the level-cleared card or at the shop counter, and a save
 * that can't say so resumes into `playing` on a level whose goal is already
 * met — so the next step re-clears it, paying the par bonus twice and handing
 * back a fresh shop with every purchase cap reset.
 *
 * - `playing`  — inside a level (any over-the-map mode: altar, lore, gear…)
 * - `cleared`  — on the level-cleared card; the next step is the shop / next level
 * - `shop`     — at the counter, with `shopPurchases` so far
 *
 * Dying with lives left needs no phase of its own: the store saves the
 * RESTARTED level, which is exactly a `playing` save.
 */
export type SavePhase = "playing" | "cleared" | "shop";

// Single autosave slot. GameState is already fully serializable (plain numbers,
// strings, arrays, and records — no Sets or class instances), so we snapshot it
// directly. masterSeed lives inside game, so the run stays reproducible.
export interface SaveV2 {
  version: 2;
  contentVersion: string;
  gameplayRngState: number[];
  game: GameState;
  /** accumulated wall-clock play time for this run, ms (optional on old saves) */
  playMs?: number;
  phase: SavePhase;
  /** purchases at the current shop, keyed by item id — only meaningful in `shop` */
  shopPurchases: Record<string, number>;
}

/** v1 had no run phase — see `SavePhase` for why that was a bug. */
export interface SaveV1 {
  version: 1;
  contentVersion: string;
  gameplayRngState: number[];
  game: GameState;
  playMs?: number;
}

export type AnySave = SaveV1 | SaveV2;
