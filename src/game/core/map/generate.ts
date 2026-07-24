import * as ROT from "rot-js";
import type {
  AltarInstance,
  GameMap,
  GeneratorKind,
  ItemInstance,
  LevelConfig,
  MonsterInstance,
  Pos,
  SubBiomeSpec,
  TileType,
} from "@/game/core/types";
import { idx, manhattan, isWalkable } from "@/game/core/grid";
import { seedMapGen, mapInt, mapWeighted } from "@/game/core/rng";
import { ALTAR_KINDS } from "@/game/core/altar";
import { levelSeed } from "@/lib/hash";
import { CONFIG } from "@/content/config";
import { ITEMS } from "@/content/items";
import { monsterDef, ELITE, ELITE_KINDS } from "@/content/monsters";

export interface LevelData {
  map: GameMap;
  monsters: MonsterInstance[];
  items: ItemInstance[];
  altars: AltarInstance[];
  playerStart: Pos;
  floodable?: number[];
  floodSeeds?: number[];
}

function itemIdByQuestTag(tag: string): string {
  for (const id in ITEMS) {
    if (ITEMS[id].questTag === tag) return id;
  }
  throw new Error(`No item registered for quest tag: ${tag}`);
}

/** Generate a floor/wall grid of size w×h with `kind` (no border forcing).
 * value 0 = floor. Used for whole levels and for sub-region wings. */
function genGrid(kind: GeneratorKind, w: number, h: number): TileType[] {
  const tiles: TileType[] = new Array(w * h).fill("wall");
  const paint = (x: number, y: number, value: number) => {
    if (value === 0) tiles[idx(x, y, w)] = "floor";
  };
  if (kind === "cellular") {
    const gen = new ROT.Map.Cellular(w, h);
    gen.randomize(0.5);
    for (let i = 0; i < 4; i++) gen.create();
    gen.connect((x, y, v) => paint(x, y, v), 0); // ensures every empty cell is reachable
  } else {
    const gen =
      kind === "uniform"
        ? new ROT.Map.Uniform(w, h, {})
        : kind === "rogue"
          ? new ROT.Map.Rogue(w, h, {})
          : kind === "maze"
            ? new ROT.Map.DividedMaze(w, h)
            : new ROT.Map.Digger(w, h);
    gen.create(paint);
  }
  return tiles;
}

/**
 * Carve a sub-biome region + tag it with the sub-biome's biome/palette. Two
 * shapes: an organic Simplex-noise blob (default, cosmetic) or a rectangular
 * wing whose STRUCTURE is a secondary generator (`spec.layout`, e.g. a maze).
 * Deterministic (draws from the already-seeded map-gen RNG). Any optional
 * hazard terrain is scattered after. All of this runs BEFORE the connectivity
 * pass, so a severed pocket is simply abandoned/sealed downstream.
 */
function carveSubBiome(map: GameMap, config: LevelConfig) {
  const spec = config.subBiome;
  if (!spec) return;
  if (spec.layout) carveSubBiomeWing(map, config, spec);
  else carveSubBiomeBlob(map, config, spec);
  scatterRegionHazards(map, spec);
}

/** Organic noise-blob region (cosmetic — never touches `tiles`). */
function carveSubBiomeBlob(
  map: GameMap,
  config: LevelConfig,
  spec: SubBiomeSpec,
) {
  const w = map.width;
  const h = map.height;
  const scale = spec.scale ?? 0.13;
  const thresh = spec.threshold ?? 0.2;
  const noise = new ROT.Noise.Simplex();

  const hot = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (noise.get(x * scale, y * scale) > thresh) hot[y * w + x] = 1;
    }
  }

  // largest connected component of the noise blob (4-connected)
  const seen = new Uint8Array(w * h);
  let best: number[] = [];
  const dirs = [-w, w, -1, 1];
  for (let s = 0; s < w * h; s++) {
    if (!hot[s] || seen[s]) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      const cx = cur % w;
      for (const d of dirs) {
        const ni = cur + d;
        if (ni < 0 || ni >= w * h || seen[ni] || !hot[ni]) continue;
        if (d === -1 && cx === 0) continue; // no row-edge wrap
        if (d === 1 && cx === w - 1) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    if (comp.length > best.length) best = comp;
  }
  if (best.length === 0) return;

  const region = new Array(w * h).fill(0);
  for (const i of best) region[i] = 1;
  map.region = region;
  map.regionBiome = [config.biome, spec.biome];
  map.regionPalette = [config.palette, spec.palette];
}

/** A rectangular wing whose layout is a secondary generator (e.g. a maze),
 * stamped into the map and bridged to the main area by a central corridor. */
function carveSubBiomeWing(
  map: GameMap,
  config: LevelConfig,
  spec: SubBiomeSpec,
) {
  const w = map.width;
  const h = map.height;
  const frac = spec.size ?? 0.42;
  const rw = Math.max(8, Math.min(w - 3, Math.floor(w * frac)));
  const rh = Math.max(8, Math.min(h - 3, Math.floor(h * frac)));
  const rx = Math.max(1, w - 1 - rw); // against the right edge…
  const ry = Math.max(1, Math.floor((h - rh) / 2)); // …vertically centered
  const grid = genGrid(spec.layout!, rw, rh);

  const region = new Array(w * h).fill(0);
  for (let yy = 0; yy < rh; yy++) {
    for (let xx = 0; xx < rw; xx++) {
      const mx = rx + xx;
      const my = ry + yy;
      if (mx <= 0 || my <= 0 || mx >= w - 1 || my >= h - 1) continue; // keep border
      const mi = my * w + mx;
      map.tiles[mi] = grid[yy * rw + xx];
      region[mi] = 1;
    }
  }
  map.region = region;
  map.regionBiome = [config.biome, spec.biome];
  map.regionPalette = [config.palette, spec.palette];

  // Arteries through the wing so the perfect maze has escape routes/loops (not
  // just dead-ends) and stays navigable. A horizontal passage that also bridges
  // LEFT into the main map, plus a vertical passage — together a crossroads that
  // breaks the labyrinth into quadrants you can retreat through.
  const by = Math.min(h - 2, Math.max(1, ry + Math.floor(rh / 2)));
  for (let x = rx; x < rx + rw && x < w - 1; x++)
    map.tiles[by * w + x] = "floor";
  for (let x = rx - 1; x >= 1; x--) {
    if (map.tiles[by * w + x] === "floor") break; // reached the main map
    map.tiles[by * w + x] = "floor";
  }
  const bx = Math.min(w - 2, Math.max(1, rx + Math.floor(rw / 2)));
  for (let y = ry; y < ry + rh && y < h - 1; y++)
    map.tiles[y * w + bx] = "floor";
}

// Default hazard kit per sub-biome, used when a `subBiome` omits `hazards`.
// Each region's terrain expresses its theme (and rewards a matching counter):
// marsh water → Levitation/Rimewalk; scorched oil → Emberstep; frost ice → …
const BIOME_HAZARDS: Partial<
  Record<string, { type: TileType; density?: number }[]>
> = {
  marsh: [{ type: "water", density: 0.16 }],
  throne: [{ type: "oil", density: 0.3 }], // scorched hollow
  mountain: [{ type: "ice", density: 0.25 }], // frozen patch
};

/** Scatter the region's hazard kit as small blobs confined to the tagged region
 * — a bog's water pools, a scorched hollow's oil, etc. Each hazard's density is
 * relative to the floor still free after the previous ones. Pre-connectivity
 * (like `placeWater`), so severed pockets are sealed downstream. */
function scatterRegionHazards(map: GameMap, spec: SubBiomeSpec) {
  if (!map.region) return;
  const hazards = spec.hazards ?? BIOME_HAZARDS[spec.biome] ?? [];
  if (hazards.length === 0) return;
  const w = map.width;
  const region = map.region;

  for (const hz of hazards) {
    const regionFloors: number[] = [];
    for (let i = 0; i < region.length; i++) {
      if (region[i] === 1 && map.tiles[i] === "floor") regionFloors.push(i);
    }
    if (regionFloors.length === 0) break;
    const target = Math.round(regionFloors.length * (hz.density ?? 0.15));
    let placed = 0;
    let guard = 0;
    while (placed < target && guard++ < 1000) {
      let cur = regionFloors[mapInt(0, regionFloors.length - 1)];
      const blob = mapInt(2, 5);
      for (let b = 0; b < blob && placed < target; b++) {
        if (map.tiles[cur] === "floor") {
          map.tiles[cur] = hz.type;
          placed++;
        }
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        const dirs = [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ];
        for (let k = dirs.length - 1; k > 0; k--) {
          const j = mapInt(0, k);
          [dirs[k], dirs[j]] = [dirs[j], dirs[k]];
        }
        let moved = false;
        for (const [dx, dy] of dirs) {
          const ni = (cy + dy) * w + (cx + dx);
          if (
            ni >= 0 &&
            ni < region.length &&
            region[ni] === 1 &&
            map.tiles[ni] === "floor"
          ) {
            cur = ni;
            moved = true;
            break;
          }
        }
        if (!moved) break;
      }
    }
  }
}

/**
 * Carve a hidden vault: a fully-walled room reachable ONLY through a single
 * cracked wall, holding the level's `secretVault.loot`. Because `sealUnreachable`
 * treats cracked walls as passable, the vault survives the seal (kept, but
 * physically gated until the player blasts/bashes in). The room is a separate
 * floor component, so normal placement never spills into it. Skipped silently
 * if no valid all-wall spot is found on this seed.
 */
function placeSecretVault(
  config: LevelConfig,
  map: GameMap,
  floors: number[],
  occupied: Set<number>,
  items: ItemInstance[],
  levelIndex: number,
) {
  const spec = config.secretVault;
  if (!spec || floors.length === 0) return;
  const w = map.width;
  const h = map.height;
  const tiles = map.tiles;
  const inB = (x: number, y: number) =>
    x > 0 && y > 0 && x < w - 1 && y < h - 1;

  const shuffle = <T>(arr: T[]) => {
    for (let k = arr.length - 1; k > 0; k--) {
      const j = mapInt(0, k);
      [arr[k], arr[j]] = [arr[j], arr[k]];
    }
    return arr;
  };

  const anchors = shuffle(floors.slice());
  for (const ai of anchors) {
    const ax = ai % w;
    const ay = Math.floor(ai / w);
    for (const [dx, dy] of shuffle([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])) {
      const px = dy; // perpendicular
      const py = dx;
      const crackX = ax + dx;
      const crackY = ay + dy;
      if (!inB(crackX, crackY) || tiles[crackY * w + crackX] !== "wall")
        continue;
      const crackI = crackY * w + crackX;

      // a 3-deep × 3-wide room just past the crack; every tile must be wall
      const room: number[] = [];
      let ok = true;
      for (let s = 0; s < 3 && ok; s++) {
        for (let lat = -1; lat <= 1; lat++) {
          const tx = ax + (2 + s) * dx + lat * px;
          const ty = ay + (2 + s) * dy + lat * py;
          if (!inB(tx, ty) || tiles[ty * w + tx] !== "wall") {
            ok = false;
            break;
          }
          room.push(ty * w + tx);
        }
      }
      if (!ok) continue;

      // enclosure: the ONLY opening may be the crack — every neighbor of a room
      // tile (and of the crack) that isn't room/crack must be solid wall
      const roomSet = new Set(room);
      const nbrs = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ];
      for (const ri of room) {
        const rx = ri % w;
        const ry = Math.floor(ri / w);
        for (const [ndx, ndy] of nbrs) {
          const nx = rx + ndx;
          const ny = ry + ndy;
          const ni = ny * w + nx;
          if (roomSet.has(ni) || ni === crackI) continue;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || tiles[ni] !== "wall") {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }
      if (!ok) continue;
      // the crack's perpendicular sides must be wall (a clean 1-tile breach)
      for (const [ndx, ndy] of [
        [px, py],
        [-px, -py],
      ]) {
        const nx = crackX + ndx;
        const ny = crackY + ndy;
        if (
          nx < 0 ||
          ny < 0 ||
          nx >= w ||
          ny >= h ||
          tiles[ny * w + nx] !== "wall"
        ) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // carve the vault + drop its loot near the center
      tiles[crackI] = "crackedWall";
      for (const ri of room) tiles[ri] = "floor";
      let n = 0;
      for (const entry of spec.loot) {
        const cell =
          room[Math.min(room.length - 1, Math.floor(room.length / 2) + n)];
        occupied.add(cell);
        const def = ITEMS[entry.itemId];
        const inst: ItemInstance = {
          id: `it${levelIndex}_v${n}`,
          defId: entry.itemId,
          x: cell % w,
          y: Math.floor(cell / w),
        };
        if (def.category === "coin") {
          const base = mapInt(CONFIG.coinPile.min, CONFIG.coinPile.max);
          inst.value = Math.max(1, Math.round(base * config.coinRichness * 3)); // a cache
        }
        items.push(inst);
        n++;
      }
      return;
    }
  }
}

/**
 * Plan a level's flood: which floor tiles MAY submerge. A protected dry "spine"
 * — the shortest walkable path from the player to each objective, dilated one
 * tile for room to fight — never floods, so the goal stays reachable the whole
 * time. Everything else reachable is floodable; seeds (the tiles farthest from
 * the player) are the low corners that rise first.
 */
function computeFloodPlan(
  map: GameMap,
  from: Pos,
  objectives: Pos[],
): { floodable: number[]; seeds: number[] } {
  const w = map.width;
  const protectedSet = new Set<number>();
  for (const o of objectives) {
    for (const i of walkablePath(map, from, o)) protectedSet.add(i);
  }
  const dirs = [-w, w, -1, 1];
  for (const i of [...protectedSet]) {
    const cx = i % w;
    for (const d of dirs) {
      if (d === -1 && cx === 0) continue;
      if (d === 1 && cx === w - 1) continue;
      const ni = i + d;
      if (ni >= 0 && ni < map.tiles.length) protectedSet.add(ni);
    }
  }
  const floodable: number[] = [];
  for (const i of walkableReachable(map, from)) {
    if (!protectedSet.has(i) && map.tiles[i] === "floor") floodable.push(i);
  }
  const seeds = floodable
    .slice()
    .sort(
      (a, b) =>
        manhattan(b % w, Math.floor(b / w), from.x, from.y) -
        manhattan(a % w, Math.floor(a / w), from.x, from.y),
    )
    .slice(0, 3);
  return { floodable, seeds };
}

function buildTiles(config: LevelConfig): TileType[] {
  const { mapWidth: w, mapHeight: h } = config;
  const tiles = genGrid(config.generator, w, h);

  // Force a solid wall border regardless of generator.
  for (let x = 0; x < w; x++) {
    tiles[idx(x, 0, w)] = "wall";
    tiles[idx(x, h - 1, w)] = "wall";
  }
  for (let y = 0; y < h; y++) {
    tiles[idx(0, y, w)] = "wall";
    tiles[idx(w - 1, y, w)] = "wall";
  }
  return tiles;
}

/**
 * Largest 4-connected component of floor cells. Confining all placement to
 * this component guarantees the player can always reach the exit / quest items
 * / boss — cellular caves in particular can leave isolated pockets.
 */
function largestFloorComponent(map: GameMap): number[] {
  const { width: w, height: h, tiles } = map;
  const seen = new Uint8Array(w * h);
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  let best: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== "floor" || seen[i]) continue;
    const comp: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni] || tiles[ni] !== "floor") continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

function pickCell(
  floors: number[],
  occupied: Set<number>,
  w: number,
  filter?: (x: number, y: number) => boolean,
): number | null {
  const cands = filter
    ? floors.filter((i) => !occupied.has(i) && filter(i % w, Math.floor(i / w)))
    : floors.filter((i) => !occupied.has(i));
  if (cands.length === 0) {
    const relaxed = floors.filter((i) => !occupied.has(i));
    if (relaxed.length === 0) return null;
    return relaxed[mapInt(0, relaxed.length - 1)];
  }
  return cands[mapInt(0, cands.length - 1)];
}

function farthestCell(
  floors: number[],
  occupied: Set<number>,
  w: number,
  from: Pos,
): number | null {
  let best = -1;
  let bestD = -1;
  for (const i of floors) {
    if (occupied.has(i)) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    const d = manhattan(x, y, from.x, from.y);
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return best === -1 ? null : best;
}

/** Count open tiles reachable from `from`, optionally treating `blockIdx` as
 * solid. Used to test whether occupying a cell severs part of the map. */
function openFloodCount(map: GameMap, from: Pos, blockIdx: number): number {
  const w = map.width;
  const h = map.height;
  const seen = new Uint8Array(w * h);
  const start = idx(from.x, from.y, w);
  seen[start] = 1;
  let count = 1;
  const stack = [start];
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  while (stack.length) {
    const cur = stack.pop()!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || ni === blockIdx || !isOpenTile(map.tiles[ni])) continue;
      seen[ni] = 1;
      count++;
      stack.push(ni);
    }
  }
  return count;
}

/**
 * Like `farthestCell`, but skips any cell whose occupation would cut the map in
 * two — so a reachLocation exit is never planted mid-corridor as the sole
 * gateway to an unexplored area (stepping on it ends the level, so that area
 * would be unreachable). Prefers the farthest such non-articulation cell; falls
 * back to the plain farthest cell if somehow none qualify.
 */
function farthestSafeCell(
  floors: number[],
  occupied: Set<number>,
  w: number,
  from: Pos,
  map: GameMap,
): number | null {
  const cands = floors
    .filter((i) => !occupied.has(i))
    .map((i) => ({ i, d: manhattan(i % w, Math.floor(i / w), from.x, from.y) }))
    .sort((a, b) => b.d - a.d);
  if (cands.length === 0) return null;
  // A cell is "safe" if blocking it leaves every OTHER open tile still reachable
  // — i.e. the flood loses exactly that one cell (full − 1), not a whole region.
  const full = openFloodCount(map, from, -1);
  for (const { i } of cands) {
    if (openFloodCount(map, from, i) === full - 1) return i;
  }
  return cands[0].i;
}

/** Convert floor cells into water blobs (impassable). Done BEFORE computing the
 * connected component, so any pockets water seals off are simply never used. */
function placeWater(
  config: LevelConfig,
  tiles: TileType[],
  w: number,
  h: number,
) {
  let remaining = config.waterCount ?? 0;
  let guard = 0;
  while (remaining > 0 && guard < 200) {
    guard++;
    const floors: number[] = [];
    for (let i = 0; i < tiles.length; i++)
      if (tiles[i] === "floor") floors.push(i);
    if (floors.length === 0) break;
    let cur = floors[mapInt(0, floors.length - 1)];
    const blob = mapInt(3, 7);
    for (let b = 0; b < blob && remaining > 0; b++) {
      if (tiles[cur] === "floor") {
        tiles[cur] = "water";
        remaining--;
      }
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      const dirs = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ];
      for (let k = dirs.length - 1; k > 0; k--) {
        const j = mapInt(0, k);
        [dirs[k], dirs[j]] = [dirs[j], dirs[k]];
      }
      let moved = false;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (
          nx > 0 &&
          ny > 0 &&
          nx < w - 1 &&
          ny < h - 1 &&
          tiles[ny * w + nx] === "floor"
        ) {
          cur = ny * w + nx;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
  }
}

const TRAP_OPEN: TileType[] = [
  "floor",
  "doorOpen",
  "exit",
  "oil",
  "forage",
  "ice",
];
/** Count a cell's open orthogonal neighbors — a trap wants ≥3 so there's a way
 * around it (never dropped in a 1-wide corridor / chokepoint you're forced through). */
function openOrthoCount(tiles: TileType[], w: number, i: number): number {
  const h = tiles.length / w;
  const x = i % w;
  const y = Math.floor(i / w);
  let n = 0;
  if (y > 0 && TRAP_OPEN.includes(tiles[i - w])) n++;
  if (y < h - 1 && TRAP_OPEN.includes(tiles[i + w])) n++;
  if (x > 0 && TRAP_OPEN.includes(tiles[i - 1])) n++;
  if (x < w - 1 && TRAP_OPEN.includes(tiles[i + 1])) n++;
  return n;
}

/** Scatter hidden spike traps on free reachable floor cells (never right next
 * to the player's start, so the first step is always safe; only where a bypass
 * exists, so a trap is an avoidable risk, not a forced toll). */
function placeTraps(
  config: LevelConfig,
  tiles: TileType[],
  floors: number[],
  occupied: Set<number>,
  w: number,
  playerStart: Pos,
) {
  let placed = 0;
  let attempts = 0;
  const count = config.trapCount ?? 0;
  while (placed < count && attempts < count * 20 + 20) {
    attempts++;
    const i = floors[mapInt(0, floors.length - 1)];
    if (occupied.has(i) || tiles[i] !== "floor") continue;
    const x = i % w;
    const y = Math.floor(i / w);
    if (manhattan(x, y, playerStart.x, playerStart.y) <= 1) continue;
    if (openOrthoCount(tiles, w, i) < 3) continue; // must have a way around it
    tiles[i] = "trap";
    occupied.add(i);
    placed++;
  }
}

/** Scatter walkable oil slicks in small blobs on free floor (harmless until
 * ignited — fire then races across them). */
function placeOil(
  config: LevelConfig,
  tiles: TileType[],
  occupied: Set<number>,
  w: number,
  h: number,
) {
  let remaining = config.oilCount ?? 0;
  let guard = 0;
  while (remaining > 0 && guard < 200) {
    guard++;
    const floors: number[] = [];
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === "floor" && !occupied.has(i)) floors.push(i);
    }
    if (floors.length === 0) break;
    let cur = floors[mapInt(0, floors.length - 1)];
    const blob = mapInt(2, 5);
    for (let b = 0; b < blob && remaining > 0; b++) {
      if (tiles[cur] === "floor" && !occupied.has(cur)) {
        tiles[cur] = "oil";
        remaining--;
      }
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      const dirs = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ];
      for (let k = dirs.length - 1; k > 0; k--) {
        const j = mapInt(0, k);
        [dirs[k], dirs[j]] = [dirs[j], dirs[k]];
      }
      let moved = false;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        const ni = ny * w + nx;
        if (
          nx > 0 &&
          ny > 0 &&
          nx < w - 1 &&
          ny < h - 1 &&
          tiles[ni] === "floor" &&
          !occupied.has(ni)
        ) {
          cur = ni;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
  }
}

/** Fracture some interior walls that separate two open spaces into destructible
 * "cracked walls" — an explosion blows them open into a shortcut. */
function placeCrackedWalls(
  config: LevelConfig,
  tiles: TileType[],
  w: number,
  h: number,
) {
  const count = config.crackedWallCount ?? 0;
  if (count <= 0) return;
  const open = (i: number) =>
    tiles[i] === "floor" ||
    tiles[i] === "oil" ||
    tiles[i] === "doorOpen" ||
    tiles[i] === "trap" ||
    tiles[i] === "trapSprung" ||
    tiles[i] === "exit";
  const cands: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (tiles[i] !== "wall") continue;
      // a thin wall: open on opposite sides, so breaking it links two spaces
      const lr = open(i - 1) && open(i + 1);
      const ud = open(i - w) && open(i + w);
      if (lr || ud) cands.push(i);
    }
  }
  for (let k = cands.length - 1; k > 0; k--) {
    const j = mapInt(0, k);
    [cands[k], cands[j]] = [cands[j], cands[k]];
  }
  for (let n = 0; n < count && n < cands.length; n++)
    tiles[cands[n]] = "crackedWall";
}

/** Place interactive doors on 1-wide chokepoints (a floor cell open on one axis,
 * walled on the other). Generated OPEN, so connectivity + pathing are unchanged;
 * the player can shut one to break line-of-sight or wall off a chaser. */
function placeDoors(
  config: LevelConfig,
  tiles: TileType[],
  occupied: Set<number>,
  w: number,
  h: number,
  playerStart: Pos,
) {
  const count = config.doorCount ?? 0;
  if (count <= 0) return;
  const solid = (i: number) =>
    tiles[i] === "wall" || tiles[i] === "crackedWall";
  const open = (i: number) =>
    tiles[i] === "floor" ||
    tiles[i] === "oil" ||
    tiles[i] === "exit" ||
    tiles[i] === "trap" ||
    tiles[i] === "trapSprung" ||
    tiles[i] === "doorOpen";
  const cands: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (tiles[i] !== "floor" || occupied.has(i)) continue;
      if (manhattan(x, y, playerStart.x, playerStart.y) <= 2) continue; // not on the doorstep
      const horiz = open(i - 1) && open(i + 1) && solid(i - w) && solid(i + w);
      const vert = open(i - w) && open(i + w) && solid(i - 1) && solid(i + 1);
      if (horiz || vert) cands.push(i);
    }
  }
  for (let k = cands.length - 1; k > 0; k--) {
    const j = mapInt(0, k);
    [cands[k], cands[j]] = [cands[j], cands[k]];
  }
  for (let n = 0; n < count && n < cands.length; n++) {
    tiles[cands[n]] = "doorOpen";
    occupied.add(cands[n]);
  }
}

/** Tuck forage (heal) tiles into nooks off the main path — preferring dead-ends
 * / corridor ends (≤2 open neighbors) so grabbing one costs a small detour,
 * never sits on the beeline. Generated as `forage`, spent to floor on step. */
function placeForage(
  config: LevelConfig,
  tiles: TileType[],
  occupied: Set<number>,
  w: number,
  h: number,
  playerStart: Pos,
) {
  const count = config.forageCount ?? 0;
  if (count <= 0) return;
  const nooks: number[] = [];
  const rest: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (tiles[i] !== "floor" || occupied.has(i)) continue;
      if (manhattan(x, y, playerStart.x, playerStart.y) <= 2) continue; // not on the doorstep
      (openOrthoCount(tiles, w, i) <= 2 ? nooks : rest).push(i);
    }
  }
  const shuffle = (a: number[]) => {
    for (let k = a.length - 1; k > 0; k--) {
      const j = mapInt(0, k);
      [a[k], a[j]] = [a[j], a[k]];
    }
    return a;
  };
  const pool = [...shuffle(nooks), ...shuffle(rest)]; // nooks first (off the path)
  for (let n = 0; n < count && n < pool.length; n++) {
    tiles[pool[n]] = "forage";
    occupied.add(pool[n]);
  }
}

/** Place risk/reward shrines on free floor (in the reachable region), each with
 * a pre-rolled bargain. They sit on walkable floor — the player interacts by
 * bumping; monsters ignore them. */
function placeAltars(
  config: LevelConfig,
  floors: number[],
  occupied: Set<number>,
  w: number,
  levelIndex: number,
): AltarInstance[] {
  const count = config.altarCount ?? 0;
  const altars: AltarInstance[] = [];
  let attempts = 0;
  while (altars.length < count && attempts < count * 20 + 20) {
    attempts++;
    const i = floors[mapInt(0, floors.length - 1)];
    if (occupied.has(i)) continue;
    occupied.add(i);
    const kind = ALTAR_KINDS[mapInt(0, ALTAR_KINDS.length - 1)];
    altars.push({
      id: `altar${levelIndex}_${altars.length}`,
      x: i % w,
      y: Math.floor(i / w),
      kind,
      used: false,
    });
  }
  return altars;
}

/** A tile the player could stand on or pass through. Cracked walls count —
 * they're breakable, so a region reached only through one is still reachable. */
function isOpenTile(t: TileType): boolean {
  return (
    t === "floor" ||
    t === "doorOpen" ||
    t === "exit" ||
    t === "trap" ||
    t === "trapSprung" ||
    t === "oil" ||
    t === "forage" ||
    t === "ice" ||
    t === "crackedWall"
  );
}

/**
 * Guarantee no unreachable open areas: flood-fill from the player over every
 * passable tile (cracked walls included — you can break them), then turn any
 * open tile the flood didn't reach into solid wall. So every clearing you can
 * see is actually reachable, and nothing important is affected (the player,
 * exit, monsters, items, and altars all sit in the reachable component).
 */
function sealUnreachable(map: GameMap, from: Pos) {
  const w = map.width;
  const h = map.height;
  const seen = new Uint8Array(w * h);
  const start = idx(from.x, from.y, w);
  seen[start] = 1;
  const stack = [start];
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  while (stack.length) {
    const cur = stack.pop()!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || !isOpenTile(map.tiles[ni])) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  for (let i = 0; i < map.tiles.length; i++) {
    if (!seen[i] && isOpenTile(map.tiles[i])) map.tiles[i] = "wall";
  }
}

/** Tiles reachable from `from` WITHOUT stepping on an (armed) trap. */
function trapFreeReachable(map: GameMap, from: Pos): Set<number> {
  const w = map.width;
  const seen = new Set<number>([idx(from.x, from.y, w)]);
  const q = [idx(from.x, from.y, w)];
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  while (q.length) {
    const cur = q.shift()!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = idx(nx, ny, w);
      if (seen.has(ni) || map.tiles[ni] === "trap") continue;
      seen.add(ni);
      q.push(ni);
    }
  }
  return seen;
}

/** Tiles reachable from `from` over walkable terrain WITH traps allowed. */
function walkableReachable(map: GameMap, from: Pos): Set<number> {
  const w = map.width;
  const seen = new Set<number>([idx(from.x, from.y, w)]);
  const q = [idx(from.x, from.y, w)];
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  while (q.length) {
    const cur = q.shift()!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = idx(nx, ny, w);
      if (seen.has(ni)) continue;
      seen.add(ni);
      q.push(ni);
    }
  }
  return seen;
}

/** Shortest walkable path (traps allowed) from `from` to `to`, as tile indices. */
function walkablePath(map: GameMap, from: Pos, to: Pos): number[] {
  const w = map.width;
  const start = idx(from.x, from.y, w);
  const goal = idx(to.x, to.y, w);
  if (start === goal) return [start];
  const prev = new Map<number, number>();
  const seen = new Set<number>([start]);
  const q = [start];
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === goal) break;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = idx(nx, ny, w);
      if (seen.has(ni)) continue;
      seen.add(ni);
      prev.set(ni, cur);
      q.push(ni);
    }
  }
  if (!prev.has(goal)) return [];
  const path: number[] = [];
  let c = goal;
  while (c !== start) {
    path.push(c);
    c = prev.get(c)!;
  }
  path.push(start);
  return path;
}

/**
 * Fairness guarantee: EVERY walkable tile must be reachable WITHOUT stepping on
 * a trap — so a trap is never the sole way to anywhere (an avoidable risk, never
 * a forced toll). Repeatedly find a tile the player can walk to but can't reach
 * trap-free, and demote the trap(s) bridging to it back to floor, until the
 * trap-free region covers the whole walkable area.
 */
function ensureTrapsAvoidable(map: GameMap, from: Pos) {
  const w = map.width;
  const walkable = walkableReachable(map, from); // traps → floor keeps this set the same
  for (let guard = 0; guard <= walkable.size; guard++) {
    const trapFree = trapFreeReachable(map, from);
    let target = -1;
    for (const i of walkable) {
      if (map.tiles[i] === "trap") continue; // the trap tiles are the toll itself
      if (!trapFree.has(i)) {
        target = i;
        break;
      }
    }
    if (target < 0) return; // the whole walkable area is trap-free reachable — done
    let demoted = false;
    for (const i of walkablePath(map, from, {
      x: target % w,
      y: Math.floor(target / w),
    })) {
      if (map.tiles[i] === "trap") {
        map.tiles[i] = "floor";
        demoted = true;
      }
    }
    if (!demoted) return; // safety: nothing to demote (shouldn't happen)
  }
}

/**
 * Generate a level deterministically from (masterSeed, levelIndex). Seeds the
 * GLOBAL rot.js RNG (the map-gen stream) so geometry + placement are a pure
 * function of the seed and index.
 */
export function generateLevel(
  config: LevelConfig,
  levelIndex: number,
  masterSeed: string,
): LevelData {
  seedMapGen(levelSeed(masterSeed, levelIndex));

  const w = config.mapWidth;
  const h = config.mapHeight;
  const tiles = buildTiles(config);
  placeWater(config, tiles, w, h); // before component calc — seals off nothing reachable
  const map: GameMap = { width: w, height: h, tiles };
  carveSubBiome(map, config); // cosmetic region tag; doesn't touch tiles

  // Only ever place onto the largest connected region so nothing is unreachable.
  const floors = largestFloorComponent(map);

  const occupied = new Set<number>();
  const monsters: MonsterInstance[] = [];
  const items: ItemInstance[] = [];
  let mCounter = 0;
  let iCounter = 0;

  // Player start — a random floor cell.
  const startIdx =
    floors.length > 0 ? floors[mapInt(0, floors.length - 1)] : idx(1, 1, w);
  const playerStart: Pos = { x: startIdx % w, y: Math.floor(startIdx / w) };
  occupied.add(startIdx);

  // Exit (reachLocation goal): the farthest floor cell that isn't a chokepoint
  // gating the only path to some area — stepping on the exit ends the level, so
  // it must never wall off a reachable region behind it.
  if (config.goal.type === "reachLocation") {
    const exitIdx = farthestSafeCell(floors, occupied, w, playerStart, map);
    if (exitIdx !== null) {
      tiles[exitIdx] = "exit";
      map.exit = { x: exitIdx % w, y: Math.floor(exitIdx / w) };
      occupied.add(exitIdx);
    }
  }

  const farFromPlayer = (x: number, y: number) =>
    manhattan(x, y, playerStart.x, playerStart.y) >=
    CONFIG.minSpawnDistanceFromPlayer;

  // Boss for killTarget goals — placed far from the player.
  if (config.goal.type === "killTarget") {
    const def = monsterDef(config.goal.monsterId);
    const bossIdx =
      farthestCell(floors, occupied, w, playerStart) ??
      pickCell(floors, occupied, w);
    if (bossIdx !== null) {
      occupied.add(bossIdx);
      monsters.push({
        id: `m${levelIndex}_${mCounter++}`,
        defId: def.id,
        x: bossIdx % w,
        y: Math.floor(bossIdx / w),
        hp: def.maxHp,
        state: "idle",
        isGoalTarget: true,
      });
    }
  }

  // Regular monsters from the weighted spawn table.
  const spawnWeights: Record<string, number> = {};
  for (const s of config.spawnTable) spawnWeights[s.monsterId] = s.weight;
  for (let n = 0; n < config.monsterBudget; n++) {
    const cell = pickCell(floors, occupied, w, farFromPlayer);
    if (cell === null) break;
    const monsterId = mapWeighted(spawnWeights);
    if (!monsterId) break;
    const def = monsterDef(monsterId);
    occupied.add(cell);
    const inst: MonsterInstance = {
      id: `m${levelIndex}_${mCounter++}`,
      defId: def.id,
      x: cell % w,
      y: Math.floor(cell / w),
      hp: def.maxHp,
      state: "idle",
    };
    // Roll an elite/champion modifier (bosses never qualify).
    const eliteChance = config.eliteChance ?? 0;
    if (!def.isBoss && eliteChance > 0 && mapInt(1, 100) <= eliteChance * 100) {
      const kind = ELITE_KINDS[mapInt(0, ELITE_KINDS.length - 1)];
      inst.elite = kind;
      inst.hp = Math.round(def.maxHp * ELITE[kind].hpMult);
    }
    monsters.push(inst);
  }

  // Quest items (collectX / findItem).
  if (config.goal.type === "collectX") {
    const questItemId = itemIdByQuestTag(config.goal.questTag);
    for (let n = 0; n < config.goal.count; n++) {
      const cell = pickCell(floors, occupied, w, farFromPlayer);
      if (cell === null) break;
      occupied.add(cell);
      items.push({
        id: `it${levelIndex}_${iCounter++}`,
        defId: questItemId,
        x: cell % w,
        y: Math.floor(cell / w),
        questTag: config.goal.questTag,
      });
    }
  } else if (config.goal.type === "findItem") {
    const questItemId = itemIdByQuestTag(config.goal.questTag);
    // Place the quest item far away so the level is a real search.
    const cell =
      farthestCell(floors, occupied, w, playerStart) ??
      pickCell(floors, occupied, w);
    if (cell !== null) {
      occupied.add(cell);
      items.push({
        id: `it${levelIndex}_${iCounter++}`,
        defId: questItemId,
        x: cell % w,
        y: Math.floor(cell / w),
        questTag: config.goal.questTag,
      });
    }
  }

  // Ordinary drops from the weighted drop table.
  const dropWeights: Record<string, number> = {};
  for (const d of config.dropTable) dropWeights[d.itemId] = d.weight;
  for (let n = 0; n < config.itemDropCount; n++) {
    const cell = pickCell(floors, occupied, w, farFromPlayer);
    if (cell === null) break;
    const itemId = mapWeighted(dropWeights);
    if (!itemId) break;
    const def = ITEMS[itemId];
    occupied.add(cell);
    const inst: ItemInstance = {
      id: `it${levelIndex}_${iCounter++}`,
      defId: itemId,
      x: cell % w,
      y: Math.floor(cell / w),
    };
    if (def.category === "coin") {
      const base = mapInt(CONFIG.coinPile.min, CONFIG.coinPile.max);
      inst.value = Math.max(1, Math.round(base * config.coinRichness));
    }
    items.push(inst);
  }

  // Hidden traps last, on free reachable floor (not under the player/items/exit).
  placeTraps(config, tiles, floors, occupied, w, playerStart);

  // Environmental terrain: oil slicks (walkable) + destructible cracked walls.
  placeOil(config, tiles, occupied, w, h);
  placeCrackedWalls(config, tiles, w, h);
  placeDoors(config, tiles, occupied, w, h, playerStart); // interactive doors (open)
  placeForage(config, tiles, occupied, w, h, playerStart); // heal tiles in nooks

  // Risk/reward shrines on open floor.
  const altars = placeAltars(config, floors, occupied, w, levelIndex);

  // Hidden vault: a sealed room reachable only by breaking a cracked wall.
  placeSecretVault(config, map, floors, occupied, items, levelIndex);

  // Fairness: guarantee every walkable tile is reachable without crossing a
  // trap — traps stay an avoidable risk, never a forced toll on the only path.
  ensureTrapsAvoidable(map, playerStart);

  // No teasing dead pockets: seal every open tile the player can't reach.
  sealUnreachable(map, playerStart);

  // Flood plan (levels with a flood set-piece) — computed on the final geometry.
  let floodable: number[] | undefined;
  let floodSeeds: number[] | undefined;
  if (config.flood) {
    const objectives: Pos[] = [];
    if (map.exit) objectives.push(map.exit);
    for (const m of monsters)
      if (m.isGoalTarget) objectives.push({ x: m.x, y: m.y });
    for (const it of items)
      if (it.questTag) objectives.push({ x: it.x, y: it.y });
    const plan = computeFloodPlan(map, playerStart, objectives);
    floodable = plan.floodable;
    floodSeeds = plan.seeds;
  }

  return { map, monsters, items, altars, playerStart, floodable, floodSeeds };
}
