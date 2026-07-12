import { CONFIG } from "@/content/config";
import type { GameState } from "@/game/core/types";
import type { Rng } from "@/game/core/rng";
import { SAVE_VERSION, type SaveV1 } from "./schema";

export function serialize(game: GameState, rng: Rng): SaveV1 {
  return {
    version: SAVE_VERSION,
    contentVersion: CONFIG.contentVersion,
    gameplayRngState: rng.getState(),
    game,
  };
}

/**
 * Validate + migrate an unknown parsed blob into a current SaveV1, or null if
 * it's incompatible (wrong version or content version, or malformed). No older
 * versions exist yet; when they do, migrations chain here.
 */
export function migrate(raw: unknown): SaveV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<SaveV1>;
  if (s.version !== SAVE_VERSION) return null;
  if (s.contentVersion !== CONFIG.contentVersion) return null;
  if (!s.game || !Array.isArray(s.gameplayRngState)) return null;
  if (typeof s.game.currentLevel !== "number" || !s.game.map) return null;
  return s as SaveV1;
}
