import * as ROT from "rot-js";
import type { GameMap } from "@/game/core/types";
import { idx, isTransparent } from "@/game/core/grid";

/**
 * Compute the set of tile indices currently visible from (x,y) within `radius`,
 * using precise shadowcasting against the map's opacity. Recomputed every player
 * turn — cheap for our map sizes.
 */
export function computeVisible(
  map: GameMap,
  x: number,
  y: number,
  radius: number
): number[] {
  const fov = new ROT.FOV.PreciseShadowcasting(
    (cx, cy) => isTransparent(map, cx, cy),
    { topology: 8 }
  );
  const out: number[] = [];
  fov.compute(x, y, radius, (fx, fy, _r, visibility) => {
    if (
      visibility > 0 &&
      fx >= 0 &&
      fy >= 0 &&
      fx < map.width &&
      fy < map.height
    ) {
      out.push(idx(fx, fy, map.width));
    }
  });
  return out;
}
