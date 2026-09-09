import * as ROT from "rot-js";
import type {
  DecalKind,
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
import { biomeAtTile, SCONCE_BIOMES } from "@/game/core/light";
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
  /** Scorch/blood stains present the moment the level opens (currently only the
   * ashen wastes pre-seed themselves). Runtime decals accumulate on top. */
  decals?: Record<number, DecalKind>;
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

  // Flanking chapels, above and below, each connected to the nave by a doorway.
  //
  // These used to floor their ENTIRE depth from the nave to the map border,
  // separated by single-column dividers — which is why the hall carved 74% floor
  // where every other level runs 18-40%, and why it was the sparsest level in
  // the game at 1.11 POIs per 100 walkable tiles. A cathedral is mostly MASONRY.
  // Each chapel is now a room of jittered depth cut into solid rock, with real
  // wall between and behind them, and some bays left unbuilt entirely.
  const roomW = 7 + mapInt(0, 3); // chapel width/count jitter
  const chapels: { rx: number; y0: number; y1: number }[] = [];
  for (const side of ["top", "bottom"] as const) {
    const slot0 = side === "top" ? 1 : ny1 + 2;
    const slot1 = side === "top" ? ny0 - 2 : h - 2;
    if (slot1 < slot0) continue;
    const slotDepth = slot1 - slot0 + 1;
    const wallRow = side === "top" ? ny0 - 1 : ny1 + 1; // divider vs. the nave
    for (let rx = 2; rx + roomW <= w - 2; rx += roomW + 2) {
      // ~1 bay in 5 is never built — solid stone, so the colonnade has blind
      // stretches and the nave isn't ringed by an unbroken corridor of rooms
      if (mapInt(0, 9) < 2) continue;
      // depth cut back from the border, so masonry remains behind the chapel
      const depth = Math.max(
        3,
        Math.min(slotDepth, 3 + mapInt(0, Math.max(0, slotDepth - 3))),
      );
      const y0 = side === "top" ? slot1 - depth + 1 : slot0;
      const y1 = side === "top" ? slot1 : slot0 + depth - 1;
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

  // NARTHEX + APSE — the two ENDS are rooms, not more corridor. Without them the
  // gallery is one uniform band for its whole length: you enter mid-corridor, and
  // the Herald (placed farthest-from-start) makes its stand in a stretch of hall
  // identical to every other stretch. Each end swells a few rows into the dead
  // rock above and below, so arrival reads as a vestibule and the far end as an
  // apse worth fighting in. Only ever ADDS floor, so it cannot sever the hall.
  for (const far of [false, true]) {
    const endW = 6 + mapInt(0, 3);
    const swell = 2 + mapInt(0, 2);
    const x0 = far ? w - 2 - endW : 2;
    for (let y = r0 - swell; y <= r1 + swell; y++)
      for (let x = x0; x < x0 + endW; x++) carve(x, y);
  }

  // FLANKING CHAMBERS — side rooms cut into the dead rock BEYOND the outer wall,
  // each reached by a single passage off a side aisle. Over half a `gallery` map
  // is untouched rock (the hall band is ~17 of 40 rows), so these cost no map
  // size; what they buy is a reason to leave the processional axis — loot and
  // threats off the spine, in rooms whose count, size, side and position all
  // jitter per seed. They may overlap into one larger chamber, which is its own
  // variety. Kept out of the end bays' x-range so they never merge with the apse.
  const chambers = 2 + mapInt(0, 2);
  for (let c = 0; c < chambers; c++) {
    const dir = mapInt(0, 1) === 0 ? -1 : 1; // above / below the hall
    const cw = 5 + mapInt(0, 4);
    const chH = 3 + mapInt(0, 2);
    const cx0 = Math.floor(w * 0.2) + mapInt(0, Math.floor(w * 0.45));
    const edgeRow = dir < 0 ? r0 : r1; // the hall's outer floor row on this side
    // Stand the chamber off by 4 rows: the niches already reach 2 deep, so this
    // leaves a course of masonry between room and aisle and the chamber reads as
    // cut into rock rather than as the aisle bulging outward.
    const near = edgeRow + dir * 4;
    const y0 = dir < 0 ? near - chH + 1 : near;
    if (y0 < 2 || y0 + chH > h - 2) continue; // no room on this side this seed
    for (let y = y0; y < y0 + chH; y++)
      for (let x = cx0; x < cx0 + cw && x < w - 2; x++) carve(x, y);
    // the one doorway, punched through the intervening masonry to the aisle
    const doorX = Math.min(w - 3, cx0 + 1 + mapInt(0, Math.max(0, cw - 3)));
    for (let y = Math.min(near, edgeRow); y <= Math.max(near, edgeRow); y++)
      carve(doorX, y);
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
 * A wing that looks GROWN rather than BUILT.
 *
 * `genGrid("maze")` is a perfect rectilinear lattice. That is exactly right for
 * the Sunken Crypt's bone catacombs, which are masonry — and exactly wrong for
 * the Mire's reed thicket, where it put a hedge maze in a bog: the level's one
 * NATURAL feature was the only one generated as architecture, next to a temple
 * and wayshrines whose straight walls are deliberate. Hence the opt-in flag
 * rather than a change to `maze` itself.
 *
 * Two operations, and it needs BOTH — either alone leaves the grid legible:
 *
 *  • the lattice is cut at HALF resolution and doubled. This is what kills the
 *    uniform one-tile pitch, which erosion alone cannot touch (thinning a
 *    1-thick wall only makes it gappy, never thicker, so the lattice survives as
 *    a dotted lattice). It also makes the erosion below SAFE: channels are 2
 *    tiles wide, so removing wall can never sever one, and the pass stays
 *    monotone — floor only ever grows, so no connectivity guarantee can break.
 *
 *  • the walls are then eroded two ways. Any nub with 3+ open neighbours goes,
 *    which is what removes the right angles and rounds the wing's own
 *    rectangular outline into the surrounding bog; and a noise field punches
 *    wandering channels through the banks, breaking the long straight runs into
 *    segments of irregular length and thickness.
 *
 * Neighbour counts read the PRE-erosion grid on purpose. Reading the live grid
 * makes erosion cascade — each removal opens its neighbour's third side — and
 * the thicket dissolves into open water.
 */
const ORGANIC_LAYOUTS = new Set<GeneratorKind>(["maze", "cellular", "digger"]);

function organicGrid(
  kind: GeneratorKind,
  w: number,
  h: number,
  scale = 0.22,
  thresh = 0.42,
): TileType[] {
  // Only the layouts this is designed for. The room-based generators cannot take
  // it — asked for a half-resolution grid, `ROT.Map.Rogue` throws inside
  // `_createCorridors` — and they should not want to: a `rogue` warren, a `hall`
  // nave and a `rampart` wall-walk are BUILDINGS, and their straight lines are
  // the point. Failing here names the mistake; without it the same content error
  // surfaces as a stack trace from inside rot.js.
  if (!ORGANIC_LAYOUTS.has(kind))
    throw new Error(
      `subBiome organic: true supports layout ${[...ORGANIC_LAYOUTS].join("/")}, not "${kind}" — a built layout is rectilinear on purpose`,
    );
  const hw = Math.max(4, Math.ceil(w / 2));
  const hh = Math.max(4, Math.ceil(h / 2));
  const small = genGrid(kind, hw, hh);
  const t: TileType[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(hw - 1, x >> 1);
      const sy = Math.min(hh - 1, y >> 1);
      t[y * w + x] = small[sy * hw + sx];
    }
  }

  const before = t.slice();
  // Off-grid counts as OPEN, so the wing's outer edge erodes too and the
  // rectangle's corners round off into the base biome instead of reading as a
  // stamped boundary. Only ever adds floor at the seam, which helps `connectWing`.
  const openAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h || before[y * w + x] !== "wall";
  const noise = new ROT.Noise.Simplex();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (before[y * w + x] !== "wall") continue;
      const open =
        (openAt(x, y - 1) ? 1 : 0) +
        (openAt(x, y + 1) ? 1 : 0) +
        (openAt(x - 1, y) ? 1 : 0) +
        (openAt(x + 1, y) ? 1 : 0);
      // TWO octaves, and the fine one is not decoration. Doubling the lattice
      // makes every row an exact copy of its pair, and a single low-frequency
      // field barely changes over two tiles — so the pair erodes identically and
      // the result carries visible 2-row banding, trading the old lattice for a
      // subtler one. The finer term decorrelates the pair and ragged-edges the
      // banks; at a third the weight it grains the edges without speckling.
      const channel = noise.get(x * scale, y * scale);
      const grain = noise.get(x * scale * 3.1 + 11, y * scale * 3.1 + 7);
      if (open >= 3 || channel + grain * 0.45 > thresh) t[y * w + x] = "floor";
    }
  }
  return t;
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
  // Wings are anchored by their ORDINAL among wings, not by spec index, so two
  // structural wings on one level never stamp the same rectangle (see
  // `carveSubBiomeWing`). Blobs don't take an anchor — they're noise-shaped.
  let wingOrdinal = 0;
  const wingIds: number[] = [];
  specs.forEach((spec, i) => {
    const id = i + 1;
    map.regionBiome!.push(spec.biome);
    map.regionPalette!.push(spec.palette);
    if (spec.layout) {
      carveSubBiomeWing(map, spec, id, wingOrdinal++);
      wingIds.push(id);
    } else carveSubBiomeBlob(map, spec, id);
    scatterRegionHazards(map, spec, id);
  });
  for (const id of wingIds) connectWing(map, id);
}

/**
 * Guarantee a wing is reachable — carve a corridor from it to the map's largest
 * floor mass if nothing already joins them.
 *
 * The artery `carveSubBiomeWing` draws is carved BEFORE that wing's hazards are
 * scattered, so a water clump can cut it afterwards; and on an organic base it
 * can dead-end in a pocket. Either way `sealUnreachable` then walls the whole
 * wing off, leaving a region that is still TAGGED but has no walkable tile —
 * a level silently losing a third of its content, on a third of its seeds.
 *
 * Measured by REGION ID (not by biome — a wing whose biome matches its level's
 * base, like the reed maze in a marsh, otherwise counts base tiles and reads as
 * a false 100%): the Mire's maze was severed on 40% of seeds and the Crypt's on
 * 12%, both long before any of this rework.
 */
function connectWing(map: GameMap, id: number) {
  const w = map.width;
  const h = map.height;
  const isFloor = (i: number) => map.tiles[i] === "floor";

  const wing: number[] = [];
  for (let i = 0; i < map.tiles.length; i++)
    if ((map.region?.[i] ?? 0) === id && isFloor(i)) wing.push(i);
  if (wing.length === 0) return; // nothing survived the carve; nothing to join

  // the biggest floor mass OUTSIDE this wing — what the wing has to reach
  const seen = new Uint8Array(map.tiles.length);
  let best: number[] = [];
  for (let start = 0; start < map.tiles.length; start++) {
    if (seen[start] || !isFloor(start) || (map.region?.[start] ?? 0) === id)
      continue;
    const comp: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        const ni = ny * w + nx;
        if (seen[ni] || !isFloor(ni) || (map.region?.[ni] ?? 0) === id)
          continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    if (comp.length > best.length) best = comp;
  }
  if (best.length === 0) return;

  // already joined? (a wing tile orthogonally touching the main mass)
  const inBest = new Set(best);
  for (const i of wing) {
    const x = i % w;
    const y = Math.floor(i / w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = (y + dy) * w + (x + dx);
      if (inBest.has(ni)) return;
    }
  }

  // otherwise dig the shortest L between the closest pair, clearing whatever is
  // in the way (walls and water alike — a corridor to a marooned wing beats a
  // wing nobody can enter)
  let a = wing[0];
  let b = best[0];
  let bestD = Infinity;
  for (const i of wing) {
    const ix = i % w;
    const iy = Math.floor(i / w);
    for (const j of best) {
      const d = Math.abs((j % w) - ix) + Math.abs(Math.floor(j / w) - iy);
      if (d < bestD) {
        bestD = d;
        a = i;
        b = j;
      }
    }
  }
  const ax = a % w;
  const ay = Math.floor(a / w);
  const bx = b % w;
  const by = Math.floor(b / w);
  for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++)
    if (x > 0 && x < w - 1) map.tiles[ay * w + x] = "floor";
  for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++)
    if (y > 0 && y < h - 1) map.tiles[y * w + bx] = "floor";
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
function carveSubBiomeWing(
  map: GameMap,
  spec: SubBiomeSpec,
  id: number,
  ordinal = 0,
) {
  const w = map.width;
  const h = map.height;
  const frac = spec.size ?? 0.42;
  const rw = Math.max(8, Math.min(w - 3, Math.floor(w * frac)));
  const rh = Math.max(8, Math.min(h - 3, Math.floor(h * frac)));
  // ANCHOR BY ORDINAL. Every wing used to stamp the right edge, vertically
  // centred — fine while no level had two, but the Mire's temple then landed
  // directly on top of its reed maze, destroying the maze and severing itself.
  // Ordinal 0 keeps the old anchor exactly, so every existing single-wing level
  // generates bit-identically.
  const anchors: [number, number][] = [
    [w - 1 - rw, Math.floor((h - rh) / 2)], // right, centred (the original)
    [1, Math.floor((h - rh) / 2)], // left, centred
    [Math.floor((w - rw) / 2), 1], // top, centred
    [Math.floor((w - rw) / 2), h - 1 - rh], // bottom, centred
  ];
  const [ax, ay] = anchors[ordinal % anchors.length];
  const rx = Math.max(1, ax);
  const ry = Math.max(1, ay);
  const grid = spec.organic
    ? organicGrid(spec.layout!, rw, rh)
    : genGrid(spec.layout!, rw, rh);

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
  // Tunnel LEFT until we reach real space. The stop condition used to be "the
  // first floor tile", which is wrong on an organic base: a `cellular` marsh is
  // full of one-tile pockets, so the artery would join the wing to a dead pocket
  // and `sealUnreachable` would then wall BOTH away. Measured on the Mire's
  // temple, that severed the whole wing on 35% of seeds — and it never showed up
  // before because the existing wings (maze/cellular, which fill their rectangle
  // densely) happened to overlap real floor anyway.
  //
  // "Real space" = a floor tile with an open neighbourhood, which a pocket
  // fails and a cavern passes immediately, so levels that already worked are
  // untouched.
  const roomy = (i: number) => {
    const cx = i % w;
    const cy = Math.floor(i / w);
    let open = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        if (map.tiles[ny * w + nx] === "floor") open++;
      }
    return open >= 8;
  };
  for (let x = rx - 1; x >= 1; x--) {
    const i = by * w + x;
    if (map.tiles[i] === "floor" && roomy(i)) break; // reached the main map
    map.tiles[i] = "floor";
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
  ashen: [{ type: "oil", density: 0.22 }], // pooled pitch/ember — catches + spreads fire
  grove: [{ type: "glowcap", density: 0.16, clumps: 3 }], // luminous fungal beds
  undercity: [{ type: "water", density: 0.2 }], // flooded channels to weave
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
  monsters: MonsterInstance[],
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

      // Enclosure: the ONLY opening may be the crack — every neighbour of a
      // room tile (and of the crack) that isn't room/crack must be solid wall.
      // DIAGONALS COUNT: FOV runs at `topology: 8`, so a single transparent
      // corner tile lets you see the whole vault (and its guardian) straight
      // through the "sealed" wall — measured at 15+ outside tiles with a view.
      const roomSet = new Set(room);
      const nbrs = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
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
      // a guardian sealed in with the hoard — placed on the far side of the
      // room from the gate, so breaking in doesn't drop you straight onto it
      if (spec.guardian) {
        const def = monsterDef(spec.guardian);
        const far = room.reduce((a, b) =>
          manhattan(
            b % w,
            Math.floor(b / w),
            crackI % w,
            Math.floor(crackI / w),
          ) >
          manhattan(
            a % w,
            Math.floor(a / w),
            crackI % w,
            Math.floor(crackI / w),
          )
            ? b
            : a,
        );
        occupied.add(far);
        monsters.push({
          id: `m${levelIndex}_guard`,
          defId: def.id,
          x: far % w,
          y: Math.floor(far / w),
          hp: def.maxHp,
          state: "idle", // dormant until you break in and draw near
        });
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
      // …but record that this is a STRUCTURE, not a dungeon. The biome tag is
      // borrowed for its glyph; without this the renderer can't tell the two
      // apart and lights the hut like a garrisoned room (see `structureRegions`).
      (map.structureRegions ??= []).push(hutId);
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
/**
 * Pre-seed scorch stains across any burned-ground region, so the ashen wastes read
 * as *scorched* rather than merely palette-dark. Without this the only difference
 * between ash and ordinary stone is hue, which the eye stops registering after a few
 * seconds; actual stains on the floor say "something burned here".
 *
 * Deterministic — drawn from the map-gen stream, so it's a pure function of
 * (seed, level) like every other placement, and the same seed always scorches the
 * same tiles. Density is per-tile so it scales with however big the region is.
 *
 * Only floor-ish tiles get stained: a stain on water reads as a bug, and the decal
 * layer is clipped to the visible FOV anyway.
 *
 * Uses the `ash` decal, NOT `scorch`: scorch is near-black and vanishes against the
 * ashen floor (distance 56, under the 110 legibility bar). Pale settled soot reads,
 * and is the truer image for ground that already burned.
 */
const ASHEN_SCORCH_CHANCE = 22; // percent of eligible tiles in a burned region
function scatterRegionDecals(map: GameMap): Record<number, DecalKind> {
  const out: Record<number, DecalKind> = {};
  if (!map.region || !map.regionBiome) return out;
  const STAINABLE: TileType[] = ["floor", "oil", "trap", "trapSprung"];
  for (let i = 0; i < map.tiles.length; i++) {
    const rid = map.region[i];
    if (map.regionBiome[rid] !== "ashen") continue;
    if (!STAINABLE.includes(map.tiles[i])) continue;
    if (mapInt(1, 100) <= ASHEN_SCORCH_CHANCE) out[i] = "ash";
  }
  return out;
}

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

/**
 * The far end of the map — where a quest item or boss goes so the level is a
 * real journey.
 *
 * Prefers OPEN ground near the far end over the single farthest tile. The
 * literal maximum-distance cell is almost always the tip of a corridor or a
 * dead-end stub (measured: the Sunblade landed in a 1-wide corridor on 7 of 8
 * seeds), which reads as an item plugging a passage, is anticlimactic for the
 * quest's payoff, and on a FLOODING level is a death trap. So take everything
 * within `SLACK` of the maximum and pick the most open cell among them —
 * a destination, not a cul-de-sac. Falls back to the strict farthest if the
 * map has no open ground out there.
 */
const FAR_SLACK = 6; // tiles of distance we'll trade for a better-shaped spot
function farthestCell(
  floors: number[],
  occupied: Set<number>,
  w: number,
  from: Pos,
  tiles?: TileType[],
): number | null {
  let bestD = -1;
  const free: { i: number; d: number }[] = [];
  for (const i of floors) {
    if (occupied.has(i)) continue;
    const d = manhattan(i % w, Math.floor(i / w), from.x, from.y);
    free.push({ i, d });
    if (d > bestD) bestD = d;
  }
  if (free.length === 0) return null;
  const strictFarthest = free.reduce((a, b) => (b.d > a.d ? b : a)).i;
  if (!tiles) return strictFarthest;
  // among the far-end candidates, prefer the most open (then the farthest)
  const near = free.filter((c) => c.d >= bestD - FAR_SLACK);
  let best: { i: number; d: number; open: number } | null = null;
  for (const c of near) {
    const open = openOrthoCount(tiles, w, c.i);
    if (!best || open > best.open || (open === best.open && c.d > best.d))
      best = { i: c.i, d: c.d, open };
  }
  return best && best.open >= 3 ? best.i : strictFarthest;
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
  map: GameMap,
  floors: number[],
  occupied: Set<number>,
  levelIndex: number,
): LoreInstance[] {
  const count = config.loreCount ?? 0;
  if (count <= 0) return [];
  const tiles = map.tiles;
  const w = map.width;
  // A fragment speaks for WHERE IT LIES: read the biome of the prop's own
  // region, not the level's. Sub-region-only biomes (grove / undercity / cavern
  // / ashen) are otherwise unreachable — their pools were dead content, since
  // no level carries them as a base biome.
  const biomeAt = (i: number) =>
    map.regionBiome?.[map.region?.[i] ?? 0] ?? config.biome;

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
  const usedTitles = new Set<string>(); // distinct fragments per level
  // ONE clue is seeded first, then the rest draw normally.
  //
  // A fragment carrying `claims` is advice — which gate a vault is behind, what
  // a boss shrugs off — and it is only worth writing if it reaches the player.
  // Drawn purely at random it did not: measured, the Great Hall's strongroom
  // hint landed on 21% of runs and the Frostspine's on ~40%, so the "read lore,
  // learn something useful" loop mostly never happened. Seeding exactly ONE
  // guarantees an edge without turning the level's whole allowance into advice
  // — at `loreCount` 2 the Frostspine would otherwise have spent both props on
  // clues and never shown its flavour at all.
  let clueSeeded = false;
  let ci = 0;
  while (lore.length < count && ci < cells.length) {
    const i = cells[ci++];
    const pool = loreForBiome(biomeAt(i), config.id);
    // an unused entry from THIS prop's own regional pool; skip the cell if the
    // pool is exhausted (another cell in a different region may still serve)
    const fresh = pool.filter((e) => !usedTitles.has(e.title));
    if (fresh.length === 0) continue;
    const clues = clueSeeded ? [] : fresh.filter((e) => e.claims);
    const from = clues.length > 0 ? clues : fresh;
    const entry = from[mapInt(0, from.length - 1)];
    if (entry.claims) clueSeeded = true;
    usedTitles.add(entry.title);
    occupied.add(i);
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

/**
 * Lit wall sconces. Light tracks HABITATION, not floor area — a garrisoned
 * gatehouse burns, a sealed tomb doesn't — so the count is per level.
 *
 * Moved here from the renderer when light became a CORE concern: a sconce is
 * often the only reason a room down a dark hall is visible at all, so
 * `recomputeFOV` has to know about it. Placement is unchanged and still
 * deterministic from the level index (a hash, no RNG), so it consumes none of
 * the map-gen stream and every existing level lights exactly as before.
 */
function placeSconces(
  map: GameMap,
  config: LevelConfig,
  levelIndex: number,
): number[] {
  // per-level count: light tracks habitation, not floor area
  const want = config.sconces ?? CONFIG.sconces;
  if (want <= 0) return [];
  const w = map.width;
  const seed = (levelIndex + 1) * 0x9e3779b1;
  const openTile = (i: number) => {
    const t = map.tiles[i];
    return t === "floor" || t === "oil" || t === "trap" || t === "trapSprung";
  };
  const cand: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] !== "wall") continue;
    const x = i % w;
    const y = Math.floor(i / w);
    if (x < 1 || y < 1 || x >= w - 1 || y >= map.height - 1) continue;
    // must face open floor, or the flame is buried inside solid rock
    const faces =
      openTile(i - 1) || openTile(i + 1) || openTile(i - w) || openTile(i + w);
    if (!faces) continue;
    // built places only, resolved PER REGION — a bracket belongs on a
    // gatehouse wall, not on a graveyard wall two tiles outside it
    if (!SCONCE_BIOMES.has(biomeAtTile(map, i, config.biome))) continue;
    // …and never on a FREESTANDING structure. A hut tags its region `dungeon`
    // to borrow that biome's plain `#` wall, which put it in SCONCE_BIOMES by
    // accident: on the Blackwood and the Mire those hut/wayshrine walls were
    // the only eligible ones on the map, so the whole budget burned on an
    // abandoned woodcutters' cottage. Nobody is home to light them.
    if (map.structureRegions?.includes(map.region?.[i] ?? 0)) continue;
    // Prefer walls facing a ROOM over walls in a one-tile passage. A bracket
    // was mounted where people gathered — a hall, a guard chamber — not in a
    // crawlspace, and structurally it puts the light where it can actually
    // pool. Openness dominates the sort; the hash only breaks ties, so the
    // scatter stays deterministic and unclustered.
    let room = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= map.height) continue;
        if (openTile(ny * w + nx)) room++;
      }
    let h = (i ^ seed) >>> 0;
    h = (h ^ (h >>> 16)) * 0x7feb352d;
    h = (h ^ (h >>> 15)) >>> 0;
    // sort key: openness descending, then hash — 24 is the max open count in a 5x5
    cand.push((24 - Math.min(24, room)) * 1e10 + (h % 4096) * 1e6 + i);
  }
  cand.sort((a, b) => a - b);
  const picked: number[] = [];
  for (const key of cand) {
    if (picked.length >= want) break;
    const i = key % 1e6;
    const x = i % w;
    const y = Math.floor(i / w);
    // spread them down a hall rather than clustering on one corner
    if (
      picked.every((j) => Math.hypot((j % w) - x, Math.floor(j / w) - y) >= 7)
    )
      picked.push(i);
  }
  return picked;
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

  // Player start — a random floor cell, minus any region a level says you must
  // not begin in (`SubBiomeSpec.noStart`). Matched by REGION ID: a sub-region
  // often shares its level's base biome (the Mire's reed maze is `marsh`, the
  // crypt's catacomb is `crypt`), so a biome-keyed blocklist would take the base
  // region with it. Falls back to the unconstrained pick if that leaves nothing,
  // so a seed can never be stranded.
  const noStart = new Set<number>();
  (config.subBiomes ?? []).forEach((spec, k) => {
    if (spec.noStart) noStart.add(k + 1); // ids are assigned 1,2,… in spec order
  });
  // Regions a level says its OBJECTIVE belongs in (`SubBiomeSpec.goalHere`).
  // One set, honoured by the exit, the boss and the quest item alike, so a
  // level that is a journey INTO somewhere reads that way whatever its goal is.
  const goalRegions = new Set<number>();
  (config.subBiomes ?? []).forEach((spec, k) => {
    if (spec.goalHere) goalRegions.add(k + 1);
  });
  const inGoalRegion = (pool: number[]) =>
    goalRegions.size > 0 && map.region
      ? pool.filter((i) => goalRegions.has(map.region![i] ?? 0))
      : [];

  let startPool =
    noStart.size > 0 && map.region
      ? floors.filter((i) => !noStart.has(map.region![i] ?? 0))
      : floors;

  // THE APPROACH. `noStart` keeps you out of the destination region, but not
  // AWAY from it — you could begin three steps from the gatehouse door and walk
  // straight in, skipping the outdoor half the level is built around. A
  // multi-source BFS out from the goal region gives the real walking distance;
  // starts nearer than `minStartToGoalRegion` are dropped from the pool.
  // Falls through if that would empty it, so a seed is never stranded.
  if (goalRegions.size > 0 && map.region) {
    const dist = new Int32Array(w * h).fill(-1);
    let frontier: number[] = [];
    for (let i = 0; i < map.tiles.length; i++) {
      if (goalRegions.has(map.region[i] ?? 0) && isOpenTile(tiles[i])) {
        dist[i] = 0;
        frontier.push(i);
      }
    }
    while (frontier.length) {
      const next: number[] = [];
      for (const i of frontier) {
        for (const d of [1, -1, w, -w]) {
          const j = i + d;
          if (j < 0 || j >= dist.length || dist[j] >= 0) continue;
          if (Math.abs(((i % w) - (j % w)) as number) > 1) continue; // no row wrap
          if (!isOpenTile(tiles[j])) continue;
          dist[j] = dist[i] + 1;
          next.push(j);
        }
      }
      frontier = next;
    }
    const far = startPool.filter(
      (i) => dist[i] < 0 || dist[i] >= CONFIG.minStartToGoalRegion,
    );
    if (far.length > 0) startPool = far;
  }

  const pool = startPool.length > 0 ? startPool : floors;
  const startIdx =
    pool.length > 0 ? pool[mapInt(0, pool.length - 1)] : idx(1, 1, w);
  const playerStart: Pos = { x: startIdx % w, y: Math.floor(startIdx / w) };
  occupied.add(startIdx);

  /**
   * A DESTINATION REGION CAN BE CARVED NEXT TO THE START.
   *
   * `goalHere` takes the farthest cell WITHIN a region, which is only far if the
   * region is — so on the Mire ~2% of seeds put the exit within 20 steps and the
   * worst put it at 3, and pinning the Gate Warden inside the gatehouse took the
   * Iron Gate's shortest run from 43 steps to 17. Constraining WHERE the goal
   * goes necessarily loosens how far away it is; this puts the floor back.
   *
   * Corrected by moving the START, not the goal: the goal stays inside the region
   * that makes it the destination, and the start is re-drawn from the SAME pool,
   * so `noStart` and the component anchor still hold. A random eligible cell
   * rather than the farthest one — on a triggering seed the farthest is always
   * the opposite corner, which would swap a rare short run for a predictable one.
   */
  const pushStartAwayFrom = (gx: number, gy: number) => {
    if (
      manhattan(playerStart.x, playerStart.y, gx, gy) >= CONFIG.minStartToExit
    )
      return;
    const eligible = pool.filter(
      (i) =>
        !occupied.has(i) &&
        manhattan(i % w, Math.floor(i / w), gx, gy) >= CONFIG.minStartToExit,
    );
    const moved =
      eligible.length > 0
        ? eligible[mapInt(0, eligible.length - 1)]
        : farthestCell(pool, occupied, w, { x: gx, y: gy });
    if (moved === null || moved === undefined) return;
    occupied.delete(idx(playerStart.x, playerStart.y, w));
    playerStart.x = moved % w;
    playerStart.y = Math.floor(moved / w);
    occupied.add(moved);
  };

  // Exit (reachLocation goal): the farthest floor cell that isn't a chokepoint
  // gating the only path to some area — stepping on the exit ends the level, so
  // it must never wall off a reachable region behind it.
  if (config.goal.type === "reachLocation") {
    // `goalHere` makes a region the DESTINATION — the farthest safe cell
    // WITHIN it, so the level reads as a journey to somewhere rather than to
    // wherever the map happened to trail off. Falls back to the whole map if
    // that region has no eligible floor, so a seed always gets an exit.
    const inRegion = inGoalRegion(floors);
    const exitIdx =
      (inRegion.length > 0
        ? farthestSafeCell(inRegion, occupied, w, playerStart, map)
        : null) ?? farthestSafeCell(floors, occupied, w, playerStart, map);
    if (exitIdx !== null) {
      tiles[exitIdx] = "exit";
      map.exit = { x: exitIdx % w, y: Math.floor(exitIdx / w) };
      occupied.add(exitIdx);

      pushStartAwayFrom(map.exit.x, map.exit.y);
    }
  }

  const farFromPlayer = (x: number, y: number) =>
    manhattan(x, y, playerStart.x, playerStart.y) >=
    CONFIG.minSpawnDistanceFromPlayer;

  // Boss for killTarget goals — placed far from the player.
  if (config.goal.type === "killTarget") {
    const def = monsterDef(config.goal.monsterId);
    // NOTE: no open-ground preference here (unlike quest items). A boss on a
    // chokepoint is thematic — the Gate Warden *holds the gate* — and it also
    // matters mechanically: a corridor lets you fight it one-on-one, while an
    // open room lets its escort flank you. Forcing bosses into open ground
    // dropped the Iron Gate's bot floor 50%→17%.
    // …and inside the region that OWNS the fight, when the level names one: the
    // Gate Warden holds the gatehouse, so placing it at the farthest cell of the
    // whole map put it out on the graves 60% of the time.
    const inRegion = inGoalRegion(floors);
    const bossIdx =
      (inRegion.length > 0
        ? farthestCell(inRegion, occupied, w, playerStart)
        : null) ??
      farthestCell(floors, occupied, w, playerStart) ??
      pickCell(floors, occupied, w);
    if (bossIdx !== null) {
      occupied.add(bossIdx);
      pushStartAwayFrom(bossIdx % w, Math.floor(bossIdx / w));
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
    // Place the quest item far away so the level is a real search — on OPEN
    // ground (see `farthestCell`), never a corridor stub: the strict farthest
    // tile is nearly always a dead-end, which reads as the item plugging a
    // passage and, on a flooding level, is a death trap.
    const inRegion = inGoalRegion(floors);
    const cell =
      (inRegion.length > 0
        ? farthestCell(inRegion, occupied, w, playerStart, tiles)
        : null) ??
      farthestCell(floors, occupied, w, playerStart, tiles) ??
      pickCell(floors, occupied, w);
    if (cell !== null) {
      occupied.add(cell);
      pushStartAwayFrom(cell % w, Math.floor(cell / w));
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
  // WHAT gets hidden is a design decision, not a placement detail.
  //
  // Ordinary loot used to scatter uniformly, so 49% of the game's items lay on
  // open floor: you collected them by walking the route you were walking anyway,
  // and loot rewarded traversal rather than exploration. Nooks-first fixes that —
  // the same bias `placeForage` and `placeLore` already use.
  //
  // But it cannot apply to EVERYTHING. Hiding the lot took the carried-run gate
  // from depth 3 to depth 2: the balance bot beelines and never detours for
  // loot, so it models a player who explores nothing, and that player starved.
  // The honest split is by what the item is FOR. TREASURE — gold, weapons,
  // armour — goes in the dead ends, because wealth should be the reward for
  // looking. SUPPLIES — potions, ammo, torches — stay on the route, because
  // running dry on heals because you failed to search a corridor stub is a
  // punishment for the wrong thing. Explore and you get rich; beeline and you
  // stay alive but poor.
  const TREASURE = new Set(["coin", "weapon", "armor"]);
  const nookPool: number[] = [];
  const openPool: number[] = [];
  for (const i of floors) {
    if (occupied.has(i) || tiles[i] !== "floor") continue;
    if (!farFromPlayer(i % w, Math.floor(i / w))) continue;
    (openOrthoCount(tiles, w, i) <= 2 ? nookPool : openPool).push(i);
  }
  for (const pool of [nookPool, openPool])
    for (let k = pool.length - 1; k > 0; k--) {
      const j = mapInt(0, k);
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
  const takeFrom = (pools: number[][]) => {
    for (const pool of pools) {
      while (pool.length && occupied.has(pool[pool.length - 1])) pool.pop();
      if (pool.length) return pool.pop()!;
    }
    return null;
  };

  for (let n = 0; n < dropCount; n++) {
    const itemId = mapWeighted(dropWeights);
    if (!itemId) break;
    const def = ITEMS[itemId];
    // treasure prefers dead ends; supplies fall where they may
    const cell = TREASURE.has(def.category)
      ? takeFrom([nookPool, openPool])
      : takeFrom([openPool, nookPool]);
    if (cell === null) break;
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
  const lore = placeLore(config, map, floors, occupied, levelIndex);

  // Hidden vault: a sealed room reachable only by breaking a cracked wall.
  placeSecretVault(config, map, floors, occupied, items, monsters, levelIndex);

  // Fairness: guarantee every walkable tile is reachable without crossing a
  // trap — traps stay an avoidable risk, never a forced toll on the only path.
  ensureTrapsAvoidable(map, playerStart);

  // No teasing dead pockets: seal every open tile the player can't reach.
  sealUnreachable(map, playerStart);

  // Lit wall sconces — AFTER sealing, so a bracket is never mounted on a wall
  // facing a pocket that just got walled off. Light is core now (it decides
  // `state.visible`), so this belongs to the map, not to the renderer.
  map.sconces = placeSconces(map, config, levelIndex);

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
    decals: scatterRegionDecals(map),
  };
}
