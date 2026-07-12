import { LEVELS } from "@/content/levels";
import type { GameState, GoalConfig } from "./types";

export function goalConfigFor(state: GameState): GoalConfig {
  return LEVELS[state.currentLevel].goal;
}

/** Human-readable goal line for the HUD. */
export function goalLabel(state: GameState): string {
  const goal = goalConfigFor(state);
  switch (goal.type) {
    case "reachLocation":
      return "Find the way out (>)";
    case "collectX": {
      const have = state.questProgress[goal.questTag] ?? 0;
      const names: Record<string, string> = {
        moonstone: "Moonstone Shards",
        sigil: "Dusk Sigils",
      };
      const name = names[goal.questTag] ?? goal.questTag;
      return `Collect ${name} — ${have}/${goal.count}`;
    }
    case "findItem":
      return goal.questTag === "sunblade" ? "Find the Sunblade (*)" : `Find the ${goal.questTag}`;
    case "killTarget": {
      const alive = state.monsters.some((m) => m.isGoalTarget);
      return alive ? "Slay the guardian" : "Guardian slain!";
    }
  }
}

/**
 * Has the current level's goal been met? Checked after the player's action,
 * before monsters move (completing your objective happens on your turn).
 */
export function isGoalComplete(state: GameState): boolean {
  const goal = goalConfigFor(state);
  switch (goal.type) {
    case "reachLocation": {
      const exit = state.map.exit;
      return !!exit && state.player.x === exit.x && state.player.y === exit.y;
    }
    case "collectX":
      return (state.questProgress[goal.questTag] ?? 0) >= goal.count;
    case "findItem":
      return (state.questProgress[goal.questTag] ?? 0) >= 1;
    case "killTarget":
      // Target existed at generation; complete once it's no longer alive.
      return !state.monsters.some((m) => m.isGoalTarget);
  }
}
