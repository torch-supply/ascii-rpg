import * as ROT from "rot-js";
import type {
  AltarInstance,
  GameMap,
  GeneratorKind,
  ItemInstance,
  LevelConfig,
  LoreInstance,
  MonsterInstance,
  Pos,
  SubBiomeSpec,
  TileType,
} from "@/game/core/types";
import { idx, manhattan, isWalkable } from "@/game/core/grid";
import { seedMapGen, mapInt, mapWeighted } from "@/game/core/rng";
import { ALTAR_KINDS } from "@/game/core/altar";
import { loreForBiome } from "@/content/lore";
import { levelSeed } from "@/lib/hash";
import { CONFIG } from "@/content/config";
import { ITEMS } from "@/content/items";
import { monsterDef, ELITE, ELITE_KINDS } from "@/content/monsters";

export interface LevelData {
  map: GameMap;
  monsters: MonsterInstance[];
  items: ItemInstance[];
  altars: AltarInstance[];
  lore: LoreInstance[];
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

/** A grand cathedral: a wide central NAVE running the map's length (flanked by
 * two colonnades → a central nave + side aisles) and a row of FLANKING CHAPELS
 * above and below, each opening onto the nave through a doorway. A purpose-built,
 * symmetric castle layout — distinct from the winding digger. Lightly varied per
 * seed (proportions jitter, an optional crossing transept, an occasional chapel
 * collapsed into the void) so no two runs are identical while it stays a
 * recognizable cathedral. Deterministic per seed (draws from the map-gen RNG). */
function genHall(w: number, h: number): TileType[] {
  const t: TileType[] = new Array(w * h).fill("wall");
  const carve = (x: number, y: number) => {
    if (x >= 1 && y >= 1 && x < w - 1 && y < h - 1) t[y * w + x] = "floor";
  };
  const cy = Math.floor(h / 2);
  const nh = Math.max(3, Math.floor(h * (0.14 + mapInt(0, 4) / 100))); // dominant nave, jittered
  const ny0 = cy - nh;
  const ny1 = cy + nh;

  // central nave (full width, inset from the border)
  for (let y = ny0; y <= ny1; y++) for (let x = 2; x < w - 2; x++) carve(x, y);
  // two colonnades near the nave's long edges → a central nave + side aisles
  const colStep = 2 + mapInt(0, 2); // pillar spacing jitter
  for (const py of [ny0 + 2, ny1 - 2]) {
    for (let x = 5; x < w - 5; x += colStep) t[py * w + x] = "wall";
  }

  // flanking chapels, above and below, connected to the nave by doorways
  const roomW = 8 + mapInt(0, 3); // chapel width/count jitter
  const chapels: { rx: number; y0: number; y1: number }[] = [];
  for (const side of ["top", "bottom"] as const) {
    const y0 = side === "top" ? 1 : ny1 + 2;
    const y1 = side === "top" ? ny0 - 2 : h - 2;
    if (y1 < y0) continue;
    const wallRow = side === "top" ? ny0 - 1 : ny1 + 1; // divider vs. the nave
    for (let rx = 2; rx + roomW <= w - 2; rx += roomW + 1) {
      for (let y = y0; y <= y1; y++)
        for (let x = rx; x < rx + roomW; x++) carve(x, y);
      carve(rx + Math.floor(roomW / 2), wallRow); // doorway into the nave
      chapels.push({ rx, y0, y1 });
    }
  }

  // occasional COLLAPSED chapel — its floor dropped into the void (you reach the
  // doorway and peer into the chasm). Done before the transept so a crossing
  // hall can still bridge it.
  if (chapels.length > 0 && mapInt(0, 9) < 4) {
    const c = chapels[mapInt(0, chapels.length - 1)];
    for (let y = c.y0; y <= c.y1; y++)
      for (let x = c.rx; x < c.rx + roomW; x++) t[y * w + x] = "chasm";
  }

  // optional TRANSEPT — a perpendicular crossing hall (a cruciform cathedral),
  // carved last so it re-floors a walkway even through a collapsed chapel
  if (mapInt(0, 9) < 4) {
    const tw = 3 + mapInt(0, 1);
    const tx =
      Math.floor(w * 0.34) + mapInt(0, Math.max(0, Math.floor(w * 0.3)));
    for (let y = 1; y < h - 1; y++)
      for (let x = tx; x < tx + tw && x < w - 1; x++) carve(x, y);
  }

  return t;
}

/** A castle RAMPART: a long horizontal WALL-WALK (the battlement top you fight
 * along), a bottomless CHASM void beyond its outer (lower) edge fronted by a
 * crenellated parapet (merlon teeth + embrasure gaps you can shove the dead
 * through), and the inner castle backing with a few TOWER rooms to fall back to.
 * Linear and exposed — distinct from a blobby digger. Lightly varied per seed
 * (draws from the map-gen RNG); connectivity holds (the walk is one band, towers
 * open onto it, the void is impassable and simply unused). */
function genRampart(w: number, h: number): TileType[] {
  const t: TileType[] = new Array(w * h).fill("wall");
  const carve = (x: number, y: number) => {
    if (x >= 1 && y >= 1 && x < w - 1 && y < h - 1) t[y * w + x] = "floor";
  };

  // the outer void: the bottom band drops away into a bottomless chasm
  const voidH = Math.floor(h * 0.3) + mapInt(0, 3);
  const voidTop = h - 1 - voidH;
  for (let y = voidTop; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) t[y * w + x] = "chasm";

  // the wall-walk: a WIDE floor band above the void (room to hold + kite)
  const walkH = 6 + mapInt(0, 3);
  const walkTop = Math.max(2, voidTop - walkH);
  for (let y = walkTop; y < voidTop; y++)
    for (let x = 2; x < w - 2; x++) carve(x, y);

  // crenellated parapet along the outer edge: merlon teeth (wall) alternating
  // with embrasures (floor gaps over the void — shove enemies through them)
  for (let x = 3; x < w - 3; x += 2) t[(voidTop - 1) * w + x] = "wall";

  // inner tower rooms jutting up from the walk-top — fall-back / hold points
  const towers = 2 + mapInt(0, 2);
  for (let k = 0; k < towers; k++) {
    const tw = 5 + mapInt(0, 2);
    const tx = 3 + mapInt(0, Math.max(0, w - 6 - tw));
    const ty1 = walkTop - 1; // sits just above the walk (so it opens onto it)
    const ty0 = Math.max(1, ty1 - (4 + mapInt(0, Math.max(0, walkTop - 4))));
    for (let y = ty0; y <= ty1; y++)
      for (let x = tx; x < tx + tw; x++) carve(x, y);
  }

  return t;
}

/** A processional STATUE GALLERY (the Dusk Antechamber): a wide central
 * promenade flanked by a double COLONNADE — two rows of statue plinths (wall
 * pillars) just inside the long edges, so the strip behind each pillar row is a
 * narrow SIDE AISLE you can slip into through the gaps between pillars (flank a
 * pursuer, break line-of-sight). STATUE NICHES are recessed into the outer walls
 * at each bay — the alcoves the gallery's figures stand in. Formal, symmetric,
 * and stately — a fitting approach to the throne, distinct from the digger
 * warren. Lightly varied per seed (bay spacing + hall depth jitter). Pair it
 * with gargoyle spawns: `guardChase` "statues" that wake as you walk the hall.
 * Connectivity holds — the promenade is one band, side aisles open onto it
 * through the pillar gaps, and any severed niche is sealed downstream. */
function genGallery(w: number, h: number): TileType[] {
  const t: TileType[] = new Array(w * h).fill("wall");
  const carve = (x: number, y: number) => {
    if (x >= 1 && y >= 1 && x < w - 1 && y < h - 1) t[y * w + x] = "floor";
  };
  const cy = Math.floor(h / 2);
  const hallH = Math.max(3, Math.floor(h * (0.2 + mapInt(0, 3) / 100)));
  const r0 = cy - hallH;
  const r1 = cy + hallH;

  // central promenade (full width, inset from the border)
  for (let y = r0; y <= r1; y++) for (let x = 2; x < w - 2; x++) carve(x, y);

  // double colonnade: a row of plinth pillars just inside each long edge. The
  // strip between a pillar row and the hall edge becomes a side aisle; the gaps
  // between pillars are the passages onto it.
  const bay = 3 + mapInt(0, 1); // pillar spacing jitter
  const inset = 2;
  for (const py of [r0 + inset, r1 - inset]) {
    for (let x = 4; x < w - 4; x += bay) t[py * w + x] = "wall";
  }

  // statue niches recessed into the outer walls — VARIED per bay so no two runs
  // read alike: ~30% stay solid wall (no niche), the rest are alcoves 1–2 deep,
  // and ~40% of the deep ones are sealed behind a CRACKED WALL (bash/blast in for
  // the offering the assembly tucks in the back — a sealed reliquary niche). A
  // gated niche's back is a separate floor pocket (crackedWall stays passable in
  // `sealUnreachable`, so it survives; spawns never leak in through solid floor).
  for (const dir of [-1, 1]) {
    const edgeRow = dir < 0 ? r0 : r1; // the hall's outer floor row on this side
    for (let x = 5; x < w - 5; x += bay * 2) {
      const roll = mapInt(0, 9);
      if (roll < 3) continue; // solid — no niche this bay
      const depth = roll < 8 ? 2 : 1; // mostly 2-deep alcoves, some shallow
      for (let d = 1; d <= depth; d++) carve(x, edgeRow + dir * d);
      if (depth === 2 && mapInt(0, 9) < 4)
        t[(edgeRow + dir) * w + x] = "crackedWall"; // seal the mouth
    }
  }

  // an occasional COLLAPSED section — a stretch of the promenade floor has given
  // way into a bottomless chasm. Kept strictly interior (floor margins on every
  // side + between the colonnades) so you always route around it and it never
  // severs the hall — but a gargoyle can shove you into it (a fall).
  if (mapInt(0, 9) < 5) {
    const pitH = 3 + mapInt(0, 2);
    const pitW = 4 + mapInt(0, 3);
    // vertical: centered in the band between the two colonnades, clamped so a
    // floor row survives above and below the pit
    const bandTop = r0 + inset + 1;
    const bandBot = r1 - inset - 1;
    let py0 = cy - Math.floor(pitH / 2);
    py0 = Math.max(bandTop, Math.min(py0, bandBot - pitH + 1));
    // horizontal: somewhere across the middle, leaving a floor margin each end
    const px0 =
      Math.floor(w * 0.3) + mapInt(0, Math.max(0, Math.floor(w * 0.3)));
    // Erode the OUTLINE so the void reads as a crumbling collapse, not a clean
    // rectangle: the core is always chasm, edge tiles sometimes survive as floor,
    // corners usually do. Only ever LEAVES floor (never adds chasm), so it can't
    // sever the hall.
    for (let y = py0; y < py0 + pitH; y++) {
      for (let x = px0; x < px0 + pitW && x < w - 3; x++) {
        const edgeX = x === px0 || x === px0 + pitW - 1;
        const edgeY = y === py0 || y === py0 + pitH - 1;
        if (edgeX && edgeY && mapInt(0, 9) < 7) continue; // corner: ~70% eroded
        if ((edgeX || edgeY) && mapInt(0, 9) < 4) continue; // edge: ~40% eroded
        t[y * w + x] = "chasm";
      }
    }
  }

  return t;
}

/** Generate a floor/wall grid of size w×h with `kind` (no border forcing).
 * value 0 = floor. Used for whole levels and for sub-region wings. */
function genGrid(kind: GeneratorKind, w: number, h: number): TileType[] {
  if (kind === "hall") return genHall(w, h);
  if (kind === "rampart") return genRampart(w, h);
  if (kind === "gallery") return genGallery(w, h);
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
  const specs = config.subBiomes;
  if (!specs || specs.length === 0) return;
  // Region id 0 is the base biome; each sub-biome gets the next id (1, 2, …).
  // The arrays are set up ONCE here so multiple regions accumulate rather than
  // clobber each other; the carvers just tag cells with their given id.
  map.region = new Array(map.width * map.height).fill(0);
  map.regionBiome = [config.biome];
  map.regionPalette = [config.palette];
  specs.forEach((spec, i) => {
    const id = i + 1;
    map.regionBiome!.push(spec.biome);
    map.regionPalette!.push(spec.palette);
    if (spec.layout) carveSubBiomeWing(map, spec, id);
    else carveSubBiomeBlob(map, spec, id);
    scatterRegionHazards(map, spec, id);
  });
}

/** Organic noise-blob region (cosmetic — never touches `tiles`). Tags the
 * largest noise component with region `id` in the shared `map.region`. */
function carveSubBiomeBlob(map: GameMap, spec: SubBiomeSpec, id: number) {
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

  const region = map.region!;
  for (const i of best) region[i] = id;
}

/** A rectangular wing whose layout is a secondary generator (e.g. a maze),
 * stamped into the map and bridged to the main area by a central corridor. */
function carveSubBiomeWing(map: GameMap, spec: SubBiomeSpec, id: number) {
  const w = map.width;
  const h = map.height;
  const frac = spec.size ?? 0.42;
  const rw = Math.max(8, Math.min(w - 3, Math.floor(w * frac)));
  const rh = Math.max(8, Math.min(h - 3, Math.floor(h * frac)));
  const rx = Math.max(1, w - 1 - rw); // against the right edge…
  const ry = Math.max(1, Math.floor((h - rh) / 2)); // …vertically centered
  const grid = genGrid(spec.layout!, rw, rh);

  const region = map.region!;
  for (let yy = 0; yy < rh; yy++) {
    for (let xx = 0; xx < rw; xx++) {
      const mx = rx + xx;
      const my = ry + yy;
      if (mx <= 0 || my <= 0 || mx >= w - 1 || my >= h - 1) continue; // keep border
      const mi = my * w + mx;
      map.tiles[mi] = grid[yy * rw + xx];
      region[mi] = id;
    }
  }

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
  Record<string, { type: TileType; density?: number; clumps?: number }[]>
> = {
  marsh: [{ type: "water", density: 0.16 }],
  throne: [{ type: "oil", density: 0.3 }], // scorched hollow
  mountain: [{ type: "ice", density: 0.25 }], // frozen patch
  cavern: [{ type: "glowcap", density: 0.12 }], // bioluminescent fungi (light)
  forest: [{ type: "bramble", density: 0.14, clumps: 3 }], // thorn thickets (fire clears)
};

/** Scatter the region's hazard kit as small blobs confined to the tagged region
 * — a bog's water pools, a scorched hollow's oil, etc. Each hazard's density is
 * relative to the floor still free after the previous ones. Pre-connectivity
 * (like `placeWater`), so severed pockets are sealed downstream. */
function scatterRegionHazards(map: GameMap, spec: SubBiomeSpec, id: number) {
  if (!map.region) return;
  const hazards = spec.hazards ?? BIOME_HAZARDS[spec.biome] ?? [];
  if (hazards.length === 0) return;
  const w = map.width;
  const region = map.region;

  const dirs4 = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const regionFloorsNow = () => {
    const arr: number[] = [];
    for (let i = 0; i < region.length; i++) {
      if (region[i] === id && map.tiles[i] === "floor") arr.push(i);
    }
    return arr;
  };

  for (const hz of hazards) {
    const regionFloors = regionFloorsNow();
    if (regionFloors.length === 0) break;
    const target = Math.round(regionFloors.length * (hz.density ?? 0.15));
    if (target <= 0) continue;

    // Clustered: a few CONTIGUOUS patches grown by flood-fill from single seeds
    // — reads as distinct "pockets" (a glowing hollow) rather than scattered dots.
    if (hz.clumps && hz.clumps > 0) {
      const per = Math.max(1, Math.round(target / hz.clumps));
      for (let c = 0; c < hz.clumps; c++) {
        const floors = regionFloorsNow();
        if (floors.length === 0) break;
        const seed = floors[mapInt(0, floors.length - 1)];
        const seen = new Set<number>([seed]);
        const q = [seed];
        let placed = 0;
        let qi = 0;
        while (qi < q.length && placed < per) {
          const cur = q[qi++];
          if (map.tiles[cur] === "floor") {
            map.tiles[cur] = hz.type;
            placed++;
          }
          const cx = cur % w;
          const cy = Math.floor(cur / w);
          for (const [dx, dy] of dirs4) {
            const ni = (cy + dy) * w + (cx + dx);
            if (
              ni >= 0 &&
              ni < region.length &&
              !seen.has(ni) &&
              region[ni] === id &&
              map.tiles[ni] === "floor"
            ) {
              seen.add(ni);
              q.push(ni);
            }
          }
        }
      }
      continue;
    }

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
            region[ni] === id &&
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
 * gate — a cracked wall to blast/bash (default) or a shut door to open —
 * holding the level's `secretVault.loot`. Because `sealUnreachable` treats both
 * cracked walls and shut doors as passable, the vault survives the seal (kept,
 * but physically gated until the player breaks/opens in). The room is carved
 * after normal placement, so it's a separate floor component that spawns/items
 * never spill into. Skipped silently if no valid all-wall spot is found.
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

      // carve the vault + drop its loot near the center. The gate is a cracked
      // wall (blast/bash) by default, or a shut door you simply open.
      tiles[crackI] = spec.gate === "door" ? "door" : "crackedWall";
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
 * Stamp a FREESTANDING building onto open ground: a wall ring with a floor
 * interior and one shut door, loot inside. Unlike `placeSecretVault` (a room dug
 * into existing wall mass, so outdoors you only see a lone door), this reads as
 * an actual structure standing in the clearing. Called BEFORE the component
 * pass, so the door-sealed interior falls out of `largestFloorComponent` (no
 * spawns/items land inside) while the surrounding clearing keeps its
 * connectivity around the wall box. Requires the footprint PLUS a one-tile
 * margin to be clear floor, so it only ever sits in an open clearing and can
 * never sever a corridor. Skipped silently if no spot fits this seed.
 */
function placeOneStructure(
  spec: NonNullable<LevelConfig["structures"]>[number],
  config: LevelConfig,
  map: GameMap,
  items: ItemInstance[],
  levelIndex: number,
  sIndex: number,
  main: Set<number>,
) {
  const w = map.width;
  const h = map.height;
  const tiles = map.tiles;

  // Try the requested size first (default 4×4), then smaller footprints, so a
  // hut still lands in tighter clearings rather than being skipped. Every size
  // keeps a ≥2-tile interior for the loot.
  const want = spec.size ?? { w: 4, h: 4 };
  const sizes = [want, { w: 4, h: 3 }, { w: 3, h: 4 }];

  const cands: number[] = [];
  for (let i = 0; i < tiles.length; i++)
    if (tiles[i] === "floor" && main.has(i)) cands.push(i);
  for (let k = cands.length - 1; k > 0; k--) {
    const j = mapInt(0, k);
    [cands[k], cands[j]] = [cands[j], cands[k]];
  }

  // the rect [x0,y0) of size ww×hh must be entirely in-bounds clear floor
  const allFloor = (x0: number, y0: number, ww: number, hh: number) => {
    for (let y = y0; y < y0 + hh; y++)
      for (let x = x0; x < x0 + ww; x++) {
        if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return false;
        if (tiles[y * w + x] !== "floor") return false;
      }
    return true;
  };

  for (const { w: bw, h: bh } of sizes) {
    for (const c of cands) {
      const x0 = c % w;
      const y0 = Math.floor(c / w);
      if (!allFloor(x0 - 1, y0 - 1, bw + 2, bh + 2)) continue; // footprint + margin

      const interior: number[] = [];
      for (let y = y0; y < y0 + bh; y++)
        for (let x = x0; x < x0 + bw; x++) {
          const i = y * w + x;
          const edge =
            x === x0 || x === x0 + bw - 1 || y === y0 || y === y0 + bh - 1;
          if (edge) tiles[i] = "wall";
          else {
            tiles[i] = "floor";
            interior.push(i);
          }
        }
      // one shut door on the south wall, offset from the corner (faces the margin)
      tiles[(y0 + bh - 1) * w + (x0 + 1)] = "door";

      // Give the hut its own cosmetic region so its walls/floor render as built
      // timber (a warm `#` + wood-brown palette) — distinct from the biome's own
      // wall glyph (e.g. the forest's trees). The door keeps its tile-based gold
      // `+`. Region is purely visual; tile TYPES still drive all mechanics.
      if (!map.region) {
        map.region = new Array(w * h).fill(0);
        map.regionBiome = [config.biome];
        map.regionPalette = [config.palette];
      }
      const hutId = map.regionBiome!.length;
      map.regionBiome!.push("dungeon"); // no wall override → "#", no weather
      map.regionPalette!.push(
        spec.palette ?? {
          wall: "#9c6b3f",
          floor: "#4a3626",
          accent: "#c98a4a",
        }, // warm timber default
      );
      for (let y = y0; y < y0 + bh; y++)
        for (let x = x0; x < x0 + bw; x++) map.region![y * w + x] = hutId;

      let n = 0;
      for (const entry of spec.loot) {
        const cell = interior[Math.min(interior.length - 1, n)];
        const def = ITEMS[entry.itemId];
        const inst: ItemInstance = {
          id: `it${levelIndex}_s${sIndex}_${n}`,
          defId: entry.itemId,
          x: cell % w,
          y: Math.floor(cell / w),
        };
        if (def.category === "coin") {
          const base = mapInt(CONFIG.coinPile.min, CONFIG.coinPile.max);
          inst.value = Math.max(1, Math.round(base * config.coinRichness * 3));
        }
        items.push(inst);
        n++;
      }
      return; // one building placed for this spec
    }
  }
}

/** Place each freestanding building in `config.structures` — several clustered
 * reads as a hamlet. Stamped in turn, each re-scanning for its own clearing so
 * they never overlap (a prior building's walls are no longer floor). */
function placeStructures(
  config: LevelConfig,
  map: GameMap,
  items: ItemInstance[],
  levelIndex: number,
  main: Set<number>,
) {
  const specs = config.structures;
  if (!specs) return;
  // Only build on the main reachable component (passed in) — a hut stranded in
  // an isolated pocket would be sealed off later (its door + loot walled away).
  specs.forEach((spec, i) =>
    placeOneStructure(spec, config, map, items, levelIndex, i, main),
  );
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
    if (protectedSet.has(i)) continue;
    const t = map.tiles[i];
    // Floor floods; an OPEN door is a conduit the water flows through, so it's
    // floodable too — but a CLOSED door holds the water back (checked live in
    // `tickFlood`), so pulling a door shut ([c]) walls off the flood that way.
    if (t === "floor" || t === "doorOpen") floodable.push(i);
  }
  // Origin seeds are pools, so pick from FLOOR tiles only (not doorways), spread
  // across the whole near→far range (count scaled to area) so black water wells
  // up ALL OVER the crypt — including just off the player's route — rather than
  // as one distant tide. The dry spine still keeps the objective path safe.
  const floorFloodable = floodable.filter((i) => map.tiles[i] === "floor");
  const byDist = floorFloodable
    .slice()
    .sort(
      (a, b) =>
        manhattan(a % w, Math.floor(a / w), from.x, from.y) -
        manhattan(b % w, Math.floor(b / w), from.x, from.y),
    ); // near → far
  const seedCount = Math.min(
    5,
    Math.max(3, Math.round(floorFloodable.length / 90)),
  );
  const seedSet = new Set<number>();
  for (let k = 0; k < seedCount && byDist.length; k++) {
    seedSet.add(byDist[Math.floor(((k + 0.5) / seedCount) * byDist.length)]);
  }
  return { floodable, seeds: [...seedSet] };
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

/** The 4-connected floor component reachable from `start` (over "floor" tiles
 * only). Used so the player + all spawns share the SAME component the
 * freestanding huts opened onto — stamping huts can flip which component is
 * "largest", so we anchor to a known main-area tile instead of re-taking the
 * largest. A shut door isn't "floor", so hut interiors stay excluded. */
function floorComponentFrom(map: GameMap, start: number): number[] {
  const { width: w, height: h, tiles } = map;
  if (tiles[start] !== "floor") return [];
  const seen = new Uint8Array(w * h);
  seen[start] = 1;
  const comp = [start];
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
      if (seen[ni] || tiles[ni] !== "floor") continue;
      seen[ni] = 1;
      comp.push(ni);
      stack.push(ni);
    }
  }
  return comp;
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

/** Convert floor cells into impassable blobs of `type` (water or chasm). Done
 * BEFORE the connected-component pass, so any pockets it seals off are simply
 * never used. */
function placeImpassable(
  tiles: TileType[],
  w: number,
  h: number,
  type: TileType,
  count: number,
) {
  let remaining = count;
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
        tiles[cur] = type;
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

/** Scatter isolated `sporeVent` tiles (a bog's poison fumaroles). Unlike the
 * blob hazards, vents are placed as SINGLETONS spaced ≥ `SPORE_VENT_GAP` apart,
 * so each seeps its own small poison pocket instead of merging into one big
 * lethal cloud. Placed on plain floor, off the start, before the connectivity
 * pass (a vent stranded in a severed pocket is simply sealed away). */
const SPORE_VENT_GAP = 5;
function placeSporeVents(
  config: LevelConfig,
  tiles: TileType[],
  occupied: Set<number>,
  w: number,
) {
  let remaining = config.sporeVentCount ?? 0;
  if (remaining <= 0) return;
  const placed: number[] = [];
  let guard = 0;
  while (remaining > 0 && guard++ < 400) {
    const floors: number[] = [];
    for (let i = 0; i < tiles.length; i++)
      if (tiles[i] === "floor" && !occupied.has(i)) floors.push(i);
    if (floors.length === 0) break;
    const cand = floors[mapInt(0, floors.length - 1)];
    const cx = cand % w;
    const cy = Math.floor(cand / w);
    const tooClose = placed.some((p) => {
      const dx = (p % w) - cx;
      const dy = Math.floor(p / w) - cy;
      return Math.abs(dx) + Math.abs(dy) < SPORE_VENT_GAP;
    });
    if (tooClose) continue;
    tiles[cand] = "sporeVent";
    placed.push(cand);
    remaining--;
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
  const count = Math.round((config.forageCount ?? 0) * CONFIG.forageScale);
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

/** Place environmental-storytelling props (lore) on reachable floor, biased
 * toward NOOKS off the main path (`openOrthoCount <= 2`) so they reward
 * exploration rather than sitting on the beeline. Each gets a DISTINCT entry
 * from the level biome's `LORE_POOLS` pool (text/kind stored inline so it
 * roundtrips in the save). Walkable — step on one to read it. */
function placeLore(
  config: LevelConfig,
  tiles: TileType[],
  floors: number[],
  occupied: Set<number>,
  w: number,
  levelIndex: number,
): LoreInstance[] {
  const count = config.loreCount ?? 0;
  if (count <= 0) return [];
  const pool = loreForBiome(config.biome);
  if (pool.length === 0) return [];

  // candidate floor cells, nooks first (off the path), then the rest
  const nooks: number[] = [];
  const rest: number[] = [];
  for (const i of floors) {
    if (occupied.has(i) || tiles[i] !== "floor") continue;
    (openOrthoCount(tiles, w, i) <= 2 ? nooks : rest).push(i);
  }
  for (let k = nooks.length - 1; k > 0; k--) {
    const j = mapInt(0, k);
    [nooks[k], nooks[j]] = [nooks[j], nooks[k]];
  }
  for (let k = rest.length - 1; k > 0; k--) {
    const j = mapInt(0, k);
    [rest[k], rest[j]] = [rest[j], rest[k]];
  }
  const cells = [...nooks, ...rest];

  const lore: LoreInstance[] = [];
  const usedEntries = new Set<number>();
  const want = Math.min(count, pool.length, cells.length);
  let ci = 0;
  while (lore.length < want && ci < cells.length) {
    const i = cells[ci++];
    // pick an unused entry (distinct fragments per level)
    let e = mapInt(0, pool.length - 1);
    let guard = 0;
    while (usedEntries.has(e) && guard++ < pool.length)
      e = (e + 1) % pool.length;
    if (usedEntries.has(e)) break;
    usedEntries.add(e);
    occupied.add(i);
    const entry = pool[e];
    lore.push({
      id: `lore${levelIndex}_${lore.length}`,
      x: i % w,
      y: Math.floor(i / w),
      kind: entry.kind,
      title: entry.title,
      text: entry.text,
      read: false,
    });
  }
  return lore;
}

/** A tile the player could stand on or pass through. Cracked walls count —
 * they're breakable, so a region reached only through one is still reachable. */
function isOpenTile(t: TileType): boolean {
  return (
    t === "floor" ||
    t === "doorOpen" ||
    t === "door" || // a shut door is traversable (open it) — keeps door-gated
    t === "exit" || // areas (e.g. a door-gated vault) reachable through the seal
    t === "trap" ||
    t === "trapSprung" ||
    t === "oil" ||
    t === "forage" ||
    t === "ice" ||
    t === "glowcap" ||
    t === "bramble" ||
    t === "sporeVent" ||
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
  // impassable terrain BEFORE the component calc so severed pockets are dropped
  placeImpassable(tiles, w, h, "water", config.waterCount ?? 0);
  placeImpassable(tiles, w, h, "chasm", config.chasmCount ?? 0);
  const map: GameMap = { width: w, height: h, tiles };
  carveSubBiome(map, config); // cosmetic region tag; doesn't touch tiles

  // Freestanding buildings are stamped BEFORE the component pass so their
  // door-sealed interiors drop out of `floors` (no spawns/items land inside).
  // They build on the current main component; we then anchor `floors` to THAT
  // same component — stamping huts can flip which component is "largest" on a
  // fragmented (water-heavy) map, which would otherwise strand player and huts
  // in different regions.
  const mainComp = largestFloorComponent(map);
  const items: ItemInstance[] = [];
  placeStructures(config, map, items, levelIndex, new Set(mainComp));

  // The player + all spawns live on the component the huts opened onto (excludes
  // their door-sealed interiors — a floor-only flood can't cross a shut door).
  // Only re-anchor when structures were stamped; without them this equals
  // `mainComp`, so structure-free levels keep their exact prior layouts.
  const anchor = mainComp.find((i) => map.tiles[i] === "floor") ?? mainComp[0];
  const floors = config.structures?.length
    ? floorComponentFrom(map, anchor)
    : mainComp;

  const occupied = new Set<number>();
  const monsters: MonsterInstance[] = [];
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

  // Ambient wildlife (wisps, …) — placed OUTSIDE the combat budget, on ordinary
  // reachable floor (no elite roll, no far-from-player rule; they're harmless
  // atmosphere that drifts and flees).
  for (const spec of config.ambient ?? []) {
    const def = monsterDef(spec.monsterId);
    for (let n = 0; n < spec.count; n++) {
      const cell = pickCell(floors, occupied, w);
      if (cell === null) break;
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

  // Ordinary drops from the weighted drop table (scaled by the global loot dial).
  const dropWeights: Record<string, number> = {};
  for (const d of config.dropTable) dropWeights[d.itemId] = d.weight;
  const dropCount = Math.round(config.itemDropCount * CONFIG.lootScale);
  for (let n = 0; n < dropCount; n++) {
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

  // Gallery "statue offerings" — tuck a cache into some niche dead-ends (incl.
  // the cracked-wall-gated ones: bash in for the reward). Scans tiles directly,
  // because a gated niche's back is a separate floor pocket (not in the main
  // `floors` component). Runs before the connectivity seal, which keeps the
  // crackedWall-gated pockets reachable.
  if (config.generator === "gallery") {
    const passish = (t: TileType) =>
      t === "floor" || t === "doorOpen" || t === "crackedWall";
    const backs: number[] = [];
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== "floor" || occupied.has(i) || i === startIdx) continue;
      let open = 0;
      if (passish(tiles[i - w])) open++;
      if (passish(tiles[i + w])) open++;
      if (passish(tiles[i - 1])) open++;
      if (passish(tiles[i + 1])) open++;
      if (open === 1) backs.push(i); // a dead-end nook = a niche back
    }
    for (let k = backs.length - 1; k > 0; k--) {
      const j = mapInt(0, k);
      [backs[k], backs[j]] = [backs[j], backs[k]];
    }
    const offerN = Math.min(backs.length, 3 + mapInt(0, 2));
    for (let k = 0; k < offerN; k++) {
      const cell = backs[k];
      const itemId = mapWeighted(dropWeights);
      if (!itemId) break;
      occupied.add(cell);
      const def = ITEMS[itemId];
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
  }

  // Hidden traps last, on free reachable floor (not under the player/items/exit).
  placeTraps(config, tiles, floors, occupied, w, playerStart);

  // Environmental terrain: oil slicks (walkable) + destructible cracked walls.
  placeOil(config, tiles, occupied, w, h);
  placeSporeVents(config, tiles, occupied, w); // isolated poison fumaroles
  placeCrackedWalls(config, tiles, w, h);
  placeDoors(config, tiles, occupied, w, h, playerStart); // interactive doors (open)
  placeForage(config, tiles, occupied, w, h, playerStart); // heal tiles in nooks

  // Risk/reward shrines on open floor.
  const altars = placeAltars(config, floors, occupied, w, levelIndex);

  // Environmental-storytelling props (readable lore), tucked into nooks.
  const lore = placeLore(config, tiles, floors, occupied, w, levelIndex);

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
    // Altars are interactive POIs (you step onto them to trigger the offer), so
    // keep a dry path to each — otherwise the flood submerges the altar tile and
    // it renders as a stranded `+` you can't reach.
    for (const a of altars) objectives.push({ x: a.x, y: a.y });
    // Keep lore props readable too — a drowned inscription you can't reach is
    // just a stranded glyph (same reasoning as altars).
    for (const l of lore) objectives.push({ x: l.x, y: l.y });
    const plan = computeFloodPlan(map, playerStart, objectives);
    floodable = plan.floodable;
    floodSeeds = plan.seeds;
  }

  return {
    map,
    monsters,
    items,
    altars,
    lore,
    playerStart,
    floodable,
    floodSeeds,
  };
}
