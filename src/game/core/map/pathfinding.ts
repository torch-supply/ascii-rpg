import * as ROT from "rot-js";
import type { GameMap, Pos } from "@/game/core/types";
import { isWalkable } from "@/game/core/grid";

/**
 * Next step from `from` toward `to` using A* (4-directional, matching movement).
 * Passability = walkable tiles; other monsters are ignored here (the mover's
 * turn resolution prevents stacking), which keeps chasers from getting stuck.
 * Returns null if already adjacent-at-target or no path exists.
 */
export function stepToward(map: GameMap, from: Pos, to: Pos): Pos | null {
  const passable = (x: number, y: number) =>
    isWalkable(map, x, y) || (x === to.x && y === to.y);

  const astar = new ROT.Path.AStar(to.x, to.y, passable, { topology: 4 });
  const path: Pos[] = [];
  astar.compute(from.x, from.y, (x, y) => path.push({ x, y }));

  // path[0] is `from`, path[1] is the first step.
  if (path.length < 2) return null;
  return path[1];
}
