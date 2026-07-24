import { LEVELS } from "@/content/levels";
import { MONSTERS } from "@/content/monsters";
import { ITEMS } from "@/content/items";
import { CONFIG } from "@/content/config";
import type { GameState, GoalConfig, LevelConfig } from "./types";

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
      // Append the collectible's real map glyph (moonstone/sigil render as "*").
      const def = Object.values(ITEMS).find(
        (d) => d.questTag === goal.questTag,
      );
      const glyph = def ? ` (${def.glyph})` : "";
      return `Collect ${name}${glyph} — ${have}/${goal.count}`;
    }
    case "findItem": {
      // Show the item's real map glyph (and name), so the hint matches what the
      // player actually sees on the ground — e.g. the Sunblade renders as "/".
      const def = Object.values(ITEMS).find(
        (d) => d.questTag === goal.questTag,
      );
      return def
        ? `Find ${def.name} (${def.glyph})`
        : `Find the ${goal.questTag}`;
    }
    case "killTarget": {
      const name = MONSTERS[goal.monsterId]?.name ?? "the guardian";
      const alive = state.monsters.some((m) => m.isGoalTarget);
      return alive ? `Slay ${name}` : `${name} — slain!`;
    }
    case "killCount": {
      const have = Math.min(state.levelKills, goal.count);
      return `Cull the horde — ${have}/${goal.count}`;
    }
    case "survive": {
      const left = Math.max(0, goal.turns - state.turnCount);
      return left > 0 ? `Hold out — ${left} turns` : "You held the line!";
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
    case "killCount":
      return state.levelKills >= goal.count;
    case "survive":
      return state.turnCount >= goal.turns;
  }
}

/**
 * Par-for-score bonus for clearing `config` in `turnCount` turns. The turn limit
 * is no longer a threat (no countdown/overtime on non-survive levels) — it's a
 * PAR TIME: finishing under it grants up to `CONFIG.parBonusMax`, scaling from
 * full (instant clear) down to 0 (at/over par). Survive levels earn nothing —
 * spending turns IS their goal, so "efficiency" doesn't apply.
 */
export function levelParBonus(config: LevelConfig, turnCount: number): number {
  if (config.goal.type === "survive") return 0;
  const frac = Math.max(
    0,
    Math.min(1, (config.turnLimit - turnCount) / config.turnLimit),
  );
  return Math.round(CONFIG.parBonusMax * frac);
}
