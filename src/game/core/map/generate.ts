import * as ROT from "rot-js";
import type {
  AltarInstance,
  GameMap,
  ItemInstance,
  LevelConfig,
  MonsterInstance,
  Pos,
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
}

function itemIdByQuestTag(tag: string): string {
  for (const id in ITEMS) {
    if (ITEMS[id].questTag === tag) return id;
  }
  throw new Error(`No item registered for quest tag: ${tag}`);
}

function buildTiles(config: LevelConfig): TileType[] {
  const { mapWidth: w, mapHeight: h } = config;
  const tiles: TileType[] = new Array(w * h).fill("wall");

  if (config.generator === "cellular") {
    const gen = new ROT.Map.Cellular(w, h);
    gen.randomize(0.5);
    for (let i = 0; i < 4; i++) gen.create();
    // connect() ensures every empty (value 0) cell is reachable.
    gen.connect((x, y, value) => {
      if (value === 0) tiles[idx(x, y, w)] = "floor";
    }, 0);
  } else {
    const gen =
      config.generator === "uniform"
        ? new ROT.Map.Uniform(w, h, {})
        : new ROT.Map.Digger(w, h);
    gen.create((x, y, value) => {
      if (value === 0) tiles[idx(x, y, w)] = "floor";
    });
  }

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
  filter?: (x: number, y: number) => boolean
): number | null {
  const cands = filter
    ? floors.filter(
        (i) => !occupied.has(i) && filter(i % w, Math.floor(i / w))
      )
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
  from: Pos
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

/** Convert floor cells into water blobs (impassable). Done BEFORE computing the
 * connected component, so any pockets water seals off are simply never used. */
function placeWater(config: LevelConfig, tiles: TileType[], w: number, h: number) {
  let remaining = config.waterCount ?? 0;
  let guard = 0;
  while (remaining > 0 && guard < 200) {
    guard++;
    const floors: number[] = [];
    for (let i = 0; i < tiles.length; i++) if (tiles[i] === "floor") floors.push(i);
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
        if (nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && tiles[ny * w + nx] === "floor") {
          cur = ny * w + nx;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
  }
}

/** Scatter hidden spike traps on free reachable floor cells (never right next
 * to the player's start, so the first step is always safe). */
function placeTraps(
  config: LevelConfig,
  tiles: TileType[],
  floors: number[],
  occupied: Set<number>,
  w: number,
  playerStart: Pos
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
  h: number
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
        if (nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && tiles[ni] === "floor" && !occupied.has(ni)) {
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
  h: number
) {
  const count = config.crackedWallCount ?? 0;
  if (count <= 0) return;
  const open = (i: number) =>
    tiles[i] === "floor" ||
    tiles[i] === "oil" ||
    tiles[i] === "door" ||
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
  for (let n = 0; n < count && n < cands.length; n++) tiles[cands[n]] = "crackedWall";
}

/** Place risk/reward shrines on free floor (in the reachable region), each with
 * a pre-rolled bargain. They sit on walkable floor — the player interacts by
 * bumping; monsters ignore them. */
function placeAltars(
  config: LevelConfig,
  floors: number[],
  occupied: Set<number>,
  w: number,
  levelIndex: number
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
 * Fairness guarantee: every objective must be reachable WITHOUT crossing a
 * trap. For any objective that isn't, demote the traps along a route to it back
 * to floor — so traps stay as optional risk/reward, never a mandatory toll.
 */
function ensureTrapFreeRoutes(map: GameMap, from: Pos, objectives: Pos[]) {
  for (const obj of objectives) {
    const reachable = trapFreeReachable(map, from);
    if (reachable.has(idx(obj.x, obj.y, map.width))) continue;
    for (const i of walkablePath(map, from, obj)) {
      if (map.tiles[i] === "trap") map.tiles[i] = "floor";
    }
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
  masterSeed: string
): LevelData {
  seedMapGen(levelSeed(masterSeed, levelIndex));

  const w = config.mapWidth;
  const h = config.mapHeight;
  const tiles = buildTiles(config);
  placeWater(config, tiles, w, h); // before component calc — seals off nothing reachable
  const map: GameMap = { width: w, height: h, tiles };

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

  // Exit (reachLocation goal): the floor cell farthest from the player.
  if (config.goal.type === "reachLocation") {
    const exitIdx = farthestCell(floors, occupied, w, playerStart);
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

  // Risk/reward shrines on open floor.
  const altars = placeAltars(config, floors, occupied, w, levelIndex);

  // Fairness: guarantee a trap-free route to every objective.
  const objectives: Pos[] = [];
  if (map.exit) objectives.push(map.exit);
  for (const m of monsters) if (m.isGoalTarget) objectives.push({ x: m.x, y: m.y });
  for (const it of items) if (it.questTag) objectives.push({ x: it.x, y: it.y });
  ensureTrapFreeRoutes(map, playerStart, objectives);

  return { map, monsters, items, altars, playerStart };
}
