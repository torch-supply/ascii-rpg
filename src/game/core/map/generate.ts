import * as ROT from "rot-js";
import type {
  GameMap,
  ItemInstance,
  LevelConfig,
  MonsterInstance,
  Pos,
  TileType,
} from "@/game/core/types";
import { idx, manhattan } from "@/game/core/grid";
import { seedMapGen, mapInt, mapWeighted } from "@/game/core/rng";
import { levelSeed } from "@/lib/hash";
import { CONFIG } from "@/content/config";
import { ITEMS } from "@/content/items";
import { monsterDef } from "@/content/monsters";

export interface LevelData {
  map: GameMap;
  monsters: MonsterInstance[];
  items: ItemInstance[];
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
  const map: GameMap = { width: w, height: h, tiles };

  const floors: number[] = [];
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === "floor") floors.push(i);

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
    monsters.push({
      id: `m${levelIndex}_${mCounter++}`,
      defId: def.id,
      x: cell % w,
      y: Math.floor(cell / w),
      hp: def.maxHp,
      state: "idle",
    });
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

  return { map, monsters, items, playerStart };
}
