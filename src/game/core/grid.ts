import type { GameMap, TileType } from "./types";

export function idx(x: number, y: number, width: number): number {
  return y * width + x;
}

export function unidx(i: number, width: number): { x: number; y: number } {
  return { x: i % width, y: Math.floor(i / width) };
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function tileAt(map: GameMap, x: number, y: number): TileType {
  if (!inBounds(map, x, y)) return "wall";
  return map.tiles[idx(x, y, map.width)];
}

/** Can an actor stand here? Water/chasm and walls block; traps/oil are walkable. */
export function isWalkable(map: GameMap, x: number, y: number): boolean {
  const t = tileAt(map, x, y);
  return (
    t === "floor" ||
    t === "doorOpen" || // a closed "door" blocks like a wall until opened
    t === "exit" ||
    t === "trap" ||
    t === "trapSprung" ||
    t === "oil" ||
    t === "forage" ||
    t === "ice" ||
    t === "glowcap" ||
    t === "bramble" || // walkable, but snags/bleeds you as you push through
    t === "sporeVent" // walkable fumarole (you can cross it — and get gassed)
  );
}

/** Every tile reachable on foot from `from` (4-connected over `isWalkable`), as
 * a 0/1 mask indexed like `map.tiles`. Shut doors and cracked walls stop it, so
 * a door-gated vault or hut interior is NOT reachable — which is the point for
 * a live spawn: a monster placed in there can never come for you. */
export function walkableFrom(
  map: GameMap,
  from: { x: number; y: number },
): Uint8Array {
  const { width: w, height: h } = map;
  const seen = new Uint8Array(w * h);
  if (!isWalkable(map, from.x, from.y)) return seen;
  const start = idx(from.x, from.y, w);
  seen[start] = 1;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = idx(nx, ny, w);
      if (seen[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return seen;
}

/** Does light/vision pass through here? Walls (incl. cracked) block; you see
 * across water and oil. */
export function isTransparent(map: GameMap, x: number, y: number): boolean {
  const t = tileAt(map, x, y);
  return t !== "wall" && t !== "crackedWall" && t !== "door"; // a shut door blocks sight
}

export function chebyshev(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function manhattan(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}
