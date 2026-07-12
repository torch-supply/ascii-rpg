import type { GameState } from "@/game/core/types";

export const SAVE_VERSION = 1;

// Single autosave slot. GameState is already fully serializable (plain numbers,
// strings, arrays, and records — no Sets or class instances), so we snapshot it
// directly. masterSeed lives inside game, so the run stays reproducible.
export interface SaveV1 {
  version: 1;
  contentVersion: string;
  gameplayRngState: number[];
  game: GameState;
}

export type AnySave = SaveV1;
