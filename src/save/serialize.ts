import { CONFIG } from "@/content/config";
import type { GameState } from "@/game/core/types";
import type { Rng } from "@/game/core/rng";
import { SAVE_VERSION, type SavePhase, type SaveV2 } from "./schema";

export function serialize(
  game: GameState,
  rng: Rng,
  playMs: number,
  phase: SavePhase = "playing",
  shopPurchases: Record<string, number> = {},
): SaveV2 {
  return {
    version: SAVE_VERSION,
    contentVersion: CONFIG.contentVersion,
    gameplayRngState: rng.getState(),
    game,
    playMs,
    phase,
    shopPurchases: phase === "shop" ? shopPurchases : {},
  };
}

const PHASES: readonly SavePhase[] = ["playing", "cleared", "shop"];

/**
 * Validate + migrate an unknown parsed blob into a current save, or null if
 * it's incompatible (unknown version, other content version, or malformed).
 * Migrations chain here, oldest first.
 */
export function migrate(raw: unknown): SaveV2 | null {
  if (!raw || typeof raw !== "object") return null;
  let s = raw as Record<string, unknown>;

  // v1 → v2: v1 had no run phase. The only phase it could have been written
  // from with the goal already met is the cleared card or the shop (the store
  // persisted on every purchase), and since v1 reset the shop on resume anyway,
  // `cleared` is the faithful reading: resume onto the card, then the counter.
  if (s.version === 1) {
    const game = s.game as Partial<GameState> | undefined;
    s = {
      ...s,
      version: 2,
      phase: game?.goalDone ? "cleared" : "playing",
      shopPurchases: {},
    };
  }

  const v = s as Partial<SaveV2>;
  if (v.version !== SAVE_VERSION) return null;
  if (v.contentVersion !== CONFIG.contentVersion) return null;
  if (!v.game || !Array.isArray(v.gameplayRngState)) return null;
  if (typeof v.game.currentLevel !== "number" || !v.game.map) return null;
  if (!v.phase || !PHASES.includes(v.phase)) return null;
  if (!v.shopPurchases || typeof v.shopPurchases !== "object") return null;
  return v as SaveV2;
}
