// Temporary end-to-end verification of the pure game engine (no DOM).
// Run with: npx tsx verify-core.mts   — deleted after verification.
import { generateLevel } from "@/game/core/map/generate";
import { LEVELS } from "@/content/levels";
import {
  createPlayer,
  beginLevel,
  clonePlayer,
  recomputeLight,
  recomputeFOV,
} from "@/game/core/state";
import { resolveTurn } from "@/game/core/actions";
import { Rng } from "@/game/core/rng";
import {
  isGoalComplete,
  levelParBonus,
  goalTitle,
  goalLabel,
  goalProgress,
} from "@/game/core/goals";
import {
  idx,
  isWalkable,
  isTransparent,
  tileAt,
  chebyshev,
  manhattan,
} from "@/game/core/grid";
import {
  monsterAttackDamage,
  playerAttackDamage,
  mitigate,
} from "@/game/core/combat";
import { STATUS, applyStatus } from "@/game/core/status";
import { ventState } from "@/game/core/gas";
import { applyAltar } from "@/game/core/altar";
import {
  applyLevelMutators,
  applyPlayerMutators,
  mutatorScoreMult,
  MUTATORS,
} from "@/content/mutators";
import { MONSTERS, ELITE } from "@/content/monsters";
import { ITEMS, SHOP_TIERS, sellPrice } from "@/content/items";
import type { ShopEntry } from "@/content/items";
import { CLASS_LIST } from "@/content/classes";
import { LORE_POOLS } from "@/content/lore";
import {
  giveItem,
  equipWeapon,
  equipArmor,
  addToBag,
  removeOneFromBag,
} from "@/game/core/inventory";
import {
  HOTBAR_SLOTS,
  bagEntryForSlot,
  hotbar,
  syncBagSlots,
} from "@/game/core/hotbar";
import { CONFIG } from "@/content/config";
import { gameplaySeed } from "@/lib/hash";
import {
  colorDistance,
  DECAL_STYLE,
  CRACKED_WALL_CRACK_DIM,
  dim,
  terrainColor,
  SPORE_VENT_PRIMING_GLYPH,
  SPORE_VENT_PRIMING_COLOR,
  TERRAIN_GLYPH,
  CHASM_BG,
  GAS_COLOR,
  SPORE_VENT_COLOR,
  TRAP_COLOR,
  WATER_COLOR,
  GLOWCAP_COLOR,
  PLAYER_COLOR,
  EXIT_COLOR,
  contrastRatio,
} from "@/render/tiles";
import { beatAmbient, ambientForBiome } from "@/render/lighting";
import { cameraOrigin } from "@/render/CanvasRenderer";
import { causeOfDeath, classifyLog } from "@/components/hud/logStyle";
import { BG, MARK, TEXT } from "@/components/hud/palette";
import type {
  GameMap,
  GameState,
  Pos,
  TileType,
  StatusKind,
} from "@/game/core/types";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ FAIL: ${name} ${extra}`);
  }
}

/**
 * Index of the level matching `pred` — or a loud, named failure.
 *
 * Many tests are PREMISED on a level with some goal type / id existing. When
 * content moves that premise away, a bare `findIndex` returns -1 and the test
 * crashes cryptically or quietly exercises `LEVELS[-1]` (this really happened:
 * retiring the last `killCount` level broke two tests that way). Naming the
 * premise turns "Cannot read properties of undefined" into a one-line reason.
 */
function levelIndexBy(
  label: string,
  pred: (l: (typeof LEVELS)[number]) => boolean,
): number {
  const i = LEVELS.findIndex(pred);
  if (i < 0) {
    console.log(
      `\n  ✗ FAIL: test premise gone — no level ${label}. A test assumed one ` +
        `exists; update or retire that test to match the content.`,
    );
    process.exit(1);
  }
  return i;
}

/**
 * Assert `pred` holds for EVERY item — and that there was at least `min` item to
 * check. Guards against the vacuous pass: `[].every(...)` is `true`, so a setup
 * that silently produces an empty collection would otherwise report a green
 * check having verified nothing. Use this for any assertion over a collection
 * built at runtime (generated monsters/items/levels), not a hand-built literal.
 */
function checkOver<T>(
  name: string,
  items: T[],
  pred: (item: T, i: number) => boolean,
  min = 1,
) {
  if (items.length < min) {
    failures++;
    console.log(
      `  ✗ FAIL: ${name} (vacuous — only ${items.length} item(s), expected ≥${min})`,
    );
    return;
  }
  const bad = items.findIndex((it, i) => !pred(it, i));
  // name the offender, not just its index — for a 124-reference sweep,
  // "(item 30 failed)" sends you counting; the value itself sends you to the fix
  let why = "";
  if (bad >= 0) {
    const v = items[bad];
    const desc =
      typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
    why = `(item ${bad} failed: ${desc.length > 120 ? desc.slice(0, 117) + "…" : desc})`;
  }
  check(name, bad < 0, why);
}

// BFS over walkable tiles; returns list of steps from -> to (exclusive of from).
function bfsPath(map: GameMap, from: Pos, to: Pos): Pos[] | null {
  const w = map.width;
  const start = idx(from.x, from.y, w);
  const goal = idx(to.x, to.y, w);
  const prev = new Map<number, number>();
  const seen = new Set<number>([start]);
  const q: number[] = [start];
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
  if (!prev.has(goal) && start !== goal) return null;
  const path: Pos[] = [];
  let cur = goal;
  while (cur !== start) {
    path.push({ x: cur % w, y: Math.floor(cur / w) });
    cur = prev.get(cur)!;
  }
  path.reverse();
  return path;
}
// ─── 0. Content integrity: every referenced id exists, every color is real ──
// RUNS FIRST, deliberately: an id typo makes generation throw a raw stack trace
// from whichever later test happens to touch it. Validating the data up front
// turns that into one clear line naming the bad reference.
// The render tables are compile-enforced (`Record<TileType,…>` + exhaustive
// switches), but the STRING IDS wiring content together are not: a typo'd
// `itemId` in a drop table / structure loot / shop tier, or a `monsterId` in a
// spawn table, type-checks fine and only explodes at generation time — on one
// level, on some seeds. Same for palettes: a malformed hex renders as garbage
// rather than failing. This sweeps every reference in one pass.
console.log("\n[0] Content integrity: id references + color validity");
{
  const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);
  const itemExists = (id: string) => !!ITEMS[id];
  const monExists = (id: string) => !!MONSTERS[id];

  // ── every monster id referenced by a level ──
  const monRefs: { where: string; id: string }[] = [];
  const itemRefs: { where: string; id: string }[] = [];
  const colors: { where: string; hex: string }[] = [];
  LEVELS.forEach((l, i) => {
    const at = `${l.id}[${i}]`;
    for (const s of l.spawnTable)
      monRefs.push({ where: `${at}.spawnTable`, id: s.monsterId });
    for (const a of l.ambient ?? [])
      monRefs.push({ where: `${at}.ambient`, id: a.monsterId });
    if (l.goal.type === "killTarget")
      monRefs.push({ where: `${at}.goal`, id: l.goal.monsterId });
    for (const d of l.dropTable)
      itemRefs.push({ where: `${at}.dropTable`, id: d.itemId });
    for (const v of l.secretVault?.loot ?? [])
      itemRefs.push({ where: `${at}.secretVault`, id: v.itemId });
    for (const st of l.structures ?? [])
      for (const v of st.loot ?? [])
        itemRefs.push({ where: `${at}.structures`, id: v.itemId });
    // palettes (level + every sub-biome + every structure)
    for (const [k, hex] of Object.entries(l.palette))
      colors.push({ where: `${at}.palette.${k}`, hex });
    for (const sb of l.subBiomes ?? [])
      for (const [k, hex] of Object.entries(sb.palette ?? {}))
        colors.push({ where: `${at}.subBiome.${k}`, hex });
    for (const st of l.structures ?? [])
      for (const [k, hex] of Object.entries(st.palette ?? {}))
        colors.push({ where: `${at}.structure.${k}`, hex });
  });
  // monster loot tables + shop tiers reference items too
  for (const m of Object.values(MONSTERS)) {
    for (const e of m.loot?.table ?? [])
      itemRefs.push({ where: `monster ${m.id}.loot`, id: e.itemId });
    colors.push({ where: `monster ${m.id}.color`, hex: m.color });
  }
  for (const [tier, stock] of Object.entries(SHOP_TIERS))
    for (const e of stock)
      itemRefs.push({ where: `SHOP_TIERS[${tier}]`, id: e.itemId });
  for (const it of Object.values(ITEMS))
    colors.push({ where: `item ${it.id}.color`, hex: it.color });

  checkOver(
    `every monster id referenced by content exists (${monRefs.length} refs)`,
    monRefs,
    (r) => monExists(r.id),
  );
  checkOver(
    `every item id referenced by content exists (${itemRefs.length} refs)`,
    itemRefs,
    (r) => itemExists(r.id),
  );
  checkOver(
    `every declared color is a valid #rrggbb hex (${colors.length} colors)`,
    colors,
    (c) => isHex(c.hex),
  );

  // ── ambient species must actually BE ambient (a hostile here would maul you) ──
  const ambientRefs = LEVELS.flatMap((l) =>
    (l.ambient ?? []).map((a) => ({ lvl: l.id, id: a.monsterId })),
  );
  checkOver(
    "every `ambient` entry names a non-hostile ambient-behavior monster",
    ambientRefs,
    (r) => MONSTERS[r.id]?.behavior === "ambient",
  );

  // ── quest goals must have a matching quest item registered ──
  const questRefs = LEVELS.filter(
    (l) => l.goal.type === "collectX" || l.goal.type === "findItem",
  ).map((l) => ({
    lvl: l.id,
    tag: (l.goal as { questTag: string }).questTag,
  }));
  checkOver(
    "every collect/find goal has an item registered for its questTag",
    questRefs,
    (r) => Object.values(ITEMS).some((it) => it.questTag === r.tag),
  );

  // ── a level's shopTier must exist in SHOP_TIERS (else the shop is empty) ──
  const tierRefs = LEVELS.filter((l) => l.shopTier != null).map((l) => ({
    lvl: l.id,
    tier: l.shopTier!,
  }));
  checkOver(
    "every level's shopTier resolves to real stock",
    tierRefs,
    (r) => (SHOP_TIERS[r.tier]?.length ?? 0) > 0,
  );

  // ── each class's starting kit must reference real items ──
  const kitRefs = CLASS_LIST.flatMap((c) => [
    { who: c.id, id: c.weaponId },
    { who: c.id, id: c.armorId },
    ...(c.bag ?? []).map((b) => ({ who: c.id, id: b.defId })),
  ]);
  checkOver("every class's starting kit references real items", kitRefs, (r) =>
    itemExists(r.id),
  );

  // ── biomes a level actually uses should have their OWN lore pool (the
  //    fallback silently serves dungeon fragments in, say, a mountain) ──
  const usedBiomes = [
    ...new Set(
      LEVELS.flatMap((l) => [
        ...(l.loreCount ? [l.biome] : []),
        ...(l.subBiomes ?? []).map((s) => s.biome),
      ]),
    ),
  ];
  // Lore is placed per REGION, so a prop can draw from any biome the level
  // carries — base OR sub-biome. Every one of those needs its own pool, else
  // the fallback silently serves dungeon fragments in, say, a fungal grove.
  const loreBiomes = [
    ...new Set(
      LEVELS.filter((l) => (l.loreCount ?? 0) > 0).flatMap((l) => [
        l.biome,
        ...(l.subBiomes ?? []).map((s) => s.biome),
      ]),
    ),
  ];
  checkOver(
    "every biome a lore prop can land in has its own pool (no silent fallback)",
    loreBiomes,
    (b) => (LORE_POOLS[b]?.length ?? 0) > 0,
  );
  // …and a fragment must not name a place its pool can appear OUTSIDE of (the
  // marsh pilgrim said "The Mire kept them" while turning up in the Blackwood).
  // match the bare proper noun, case-insensitively — "the Mire" missed "The
  // Mire kept them", so the guard passed on the very line that motivated it
  const placeNames = ["blackwood", "mire", "frostspine", "veldrin"];
  const homes = new Map<string, Set<string>>();
  for (const l of LEVELS)
    for (const b of [l.biome, ...(l.subBiomes ?? []).map((s) => s.biome)])
      homes.set(b, (homes.get(b) ?? new Set()).add(l.id));
  const named = Object.entries(LORE_POOLS).flatMap(([b, pool]) =>
    pool.flatMap((e) =>
      placeNames
        .filter((p) => e.text.toLowerCase().includes(p))
        .map((p) => ({ biome: b, title: e.title, place: p })),
    ),
  );
  check(
    "no lore fragment names a place its biome can appear outside of",
    named.every((n) => (homes.get(n.biome)?.size ?? 0) <= 1),
    named
      .filter((n) => (homes.get(n.biome)?.size ?? 0) > 1)
      .map((n) => `"${n.title}" names ${n.place} but ${n.biome} spans levels`)
      .join("; "),
  );
}

// ─── 1. Determinism ─────────────────────────────────────────────────────────
console.log("\n[1] Map-gen determinism (two RNG streams)");
{
  const a = generateLevel(LEVELS[0], 0, "seed-abc");
  const b = generateLevel(LEVELS[0], 0, "seed-abc");
  const c = generateLevel(LEVELS[0], 0, "seed-xyz");
  check(
    "same (seed,index) → identical tiles",
    JSON.stringify(a.map.tiles) === JSON.stringify(b.map.tiles),
  );
  check(
    "same (seed,index) → identical monster positions",
    JSON.stringify(a.monsters.map((m) => [m.defId, m.x, m.y])) ===
      JSON.stringify(b.monsters.map((m) => [m.defId, m.x, m.y])),
  );
  check(
    "same (seed,index) → identical player start",
    a.playerStart.x === b.playerStart.x && a.playerStart.y === b.playerStart.y,
  );
  check(
    "different seed → different tiles",
    JSON.stringify(a.map.tiles) !== JSON.stringify(c.map.tiles),
  );
}

// ─── 2. Gameplay RNG independence + save roundtrip ──────────────────────────
console.log("\n[2] Gameplay RNG stream");
{
  const r1 = new Rng(12345);
  const r2 = new Rng(12345);
  const s1 = [r1.int(0, 1000), r1.int(0, 1000), r1.int(0, 1000)];
  const s2 = [r2.int(0, 1000), r2.int(0, 1000), r2.int(0, 1000)];
  check("same seed → same sequence", JSON.stringify(s1) === JSON.stringify(s2));
  const state = r1.getState();
  const nextA = r1.int(0, 1e6);
  const restored = new Rng(0, state);
  const nextB = restored.int(0, 1e6);
  check("getState/setState roundtrip resumes sequence", nextA === nextB);
}

// ─── 3. Full playthrough of Level 1 (reachLocation) ─────────────────────────
console.log("\n[3] Level 1 playthrough → reach the exit");
{
  const player = createPlayer();
  // make the tester invincible + strong so it can bulldoze to the exit
  player.maxHp = 100000;
  player.hp = 100000;
  player.weaponPower = 999;
  const game = beginLevel("play-seed", 0, player);
  const rng = new Rng(1);

  check("exit tile exists (reachLocation)", !!game.map.exit);
  check(
    "exit tile is walkable",
    !!game.map.exit && isWalkable(game.map, game.map.exit.x, game.map.exit.y),
  );
  check(
    "player starts on a floor/exit tile",
    isWalkable(game.map, game.player.x, game.player.y),
  );
  check("initial FOV is non-empty", game.visible.length > 0);
  check("goal not complete at start", !isGoalComplete(game));

  const path = bfsPath(
    game.map,
    { x: game.player.x, y: game.player.y },
    game.map.exit!,
  );
  check(
    "BFS finds a path to the exit (connectivity)",
    !!path && path.length > 0,
  );

  let completed = false;
  let iterations = 0;
  const startExplored = game.explored.length;
  if (path) {
    for (const step of path) {
      let guard = 0;
      // keep issuing this step until the player actually reaches it
      while (
        (game.player.x !== step.x || game.player.y !== step.y) &&
        guard < 40
      ) {
        const dx = Math.sign(step.x - game.player.x);
        const dy = Math.sign(step.y - game.player.y);
        const res = resolveTurn(game, { type: "move", dx, dy }, rng);
        iterations++;
        guard++;
        if (res.goalComplete) {
          completed = true;
          break;
        }
        if (res.playerDied) break;
      }
      if (completed) break;
    }
  }
  check(
    "reached exit → goalComplete fired",
    completed,
    `(after ${iterations} turns)`,
  );
  check("turnCount advanced during play", game.turnCount > 0);
  check(
    "fog-of-war expanded while exploring",
    game.explored.length >= startExplored,
  );
}

// ─── 4. collectX goal (Level 2 — Moonstone Shards) ──────────────────────────
console.log("\n[4] Level 2 collectX goal");
{
  const idx2 = 1;
  const goal = LEVELS[idx2].goal;
  const player = createPlayer();
  const game = beginLevel("collect-seed", idx2, player);
  const shards = game.items.filter((it) => it.questTag === "moonstone");
  check(
    "3 moonstone shards placed",
    goal.type === "collectX" && shards.length === goal.count,
  );
  check("goal incomplete initially", !isGoalComplete(game));

  // Move the player next to the first shard, then step onto it.
  const rng = new Rng(2);
  const shard = shards[0];
  const neighbor = [
    { x: shard.x, y: shard.y - 1 },
    { x: shard.x, y: shard.y + 1 },
    { x: shard.x - 1, y: shard.y },
    { x: shard.x + 1, y: shard.y },
  ].find((n) => isWalkable(game.map, n.x, n.y));
  if (neighbor) {
    game.player.x = neighbor.x;
    game.player.y = neighbor.y;
    resolveTurn(
      game,
      {
        type: "move",
        dx: Math.sign(shard.x - neighbor.x),
        dy: Math.sign(shard.y - neighbor.y),
      },
      rng,
    );
  }
  check(
    "picking up a shard increments questProgress",
    (game.questProgress["moonstone"] ?? 0) === 1,
  );
  check(
    "shard removed from ground after pickup",
    !game.items.some((it) => it.id === shard.id),
  );

  // Directly complete to verify threshold logic
  game.questProgress["moonstone"] = 3;
  check("questProgress >= count → goalComplete", isGoalComplete(game));

  // every collectX level must spawn EXACTLY `count` quest items on every seed —
  // fewer would be an unwinnable goal (you could never reach the threshold)
  const seeds = ["c1", "c2", "c3", "c4", "c5", "c6"];
  let short = 0;
  for (let li = 0; li < LEVELS.length; li++) {
    const cfg = LEVELS[li];
    if (cfg.goal.type !== "collectX") continue;
    const { questTag, count } = cfg.goal;
    for (const seed of seeds) {
      const g = beginLevel(seed, li, createPlayer());
      if (g.items.filter((it) => it.questTag === questTag).length !== count)
        short++;
    }
  }
  check(
    "every collectX level spawns exactly its required item count",
    short === 0,
  );
}

// ─── 5. killTarget goal (Level 3 — Frost Troll) ─────────────────────────────
console.log("\n[5] Level 3 killTarget goal");
{
  const idx3 = levelIndexBy(
    "with the frost_troll killTarget goal",
    (l) => l.goal.type === "killTarget" && l.goal.monsterId === "frost_troll",
  );
  const player = createPlayer();
  const game = beginLevel("kill-seed", idx3, player);
  const boss = game.monsters.find((m) => m.isGoalTarget);
  check("boss (isGoalTarget) placed", !!boss && boss.defId === "frost_troll");
  check("goal incomplete while boss alive", !isGoalComplete(game));
  game.monsters = game.monsters.filter((m) => !m.isGoalTarget);
  check("goal complete once boss removed", isGoalComplete(game));
}

// ─── 6. findItem goal (Level 4 — Sunblade) ──────────────────────────────────
console.log("\n[6] Level 4 findItem goal");
{
  const idx4 = levelIndexBy(
    "with a findItem goal",
    (l) => l.goal.type === "findItem",
  );
  const player = createPlayer();
  const game = beginLevel("find-seed", idx4, player);
  const sun = game.items.find((it) => it.questTag === "sunblade");
  check("sunblade placed on the map", !!sun);
  check("goal incomplete initially", !isGoalComplete(game));
  game.questProgress["sunblade"] = 1;
  check("questProgress sunblade >= 1 → goalComplete", isGoalComplete(game));
}

// ─── 7. Turn budget is inert on non-survive levels (par-for-score only) ──────
console.log("\n[7] Turn-budget exhaustion is harmless (no countdown/overtime)");
{
  const game = beginLevel("combat-seed", 0, createPlayer()); // dungeon: reachLocation
  const rng = new Rng(3);
  // an invincible, stationary player never completes the reach-goal, so we can
  // overstay the budget freely and watch what (doesn't) happen
  game.player.hp = 99999;
  game.player.maxHp = 99999;
  const before = game.monsters.length;
  game.turnsLeft = 1;
  let died = false;
  for (let i = 0; i < 80; i++) {
    if (resolveTurn(game, { type: "wait" }, rng).playerDied) died = true;
  }
  check("running out the turn budget never kills you", !died);
  check(
    "the spent clock spawns NO reinforcements (overtime removed)",
    game.monsters.length <= before,
  );
}

// ─── 8. Connectivity — no more "trapped with no way out" (regression) ───────
console.log("\n[8] Connectivity: player can reach every objective");
{
  const seeds = [
    "s1",
    "s2",
    "s3",
    "trap-check",
    "xyzzy",
    "blackwood",
    "abc",
    "999",
  ];
  let checked = 0;
  let unreachable = 0;
  for (const seed of seeds) {
    for (let li = 0; li < LEVELS.length; li++) {
      const g = beginLevel(seed, li, createPlayer());
      const from: Pos = { x: g.player.x, y: g.player.y };
      for (const it of g.items) {
        if (!it.questTag) continue;
        checked++;
        if (bfsPath(g.map, from, { x: it.x, y: it.y }) === null) unreachable++;
      }
      if (g.map.exit) {
        checked++;
        if (bfsPath(g.map, from, g.map.exit) === null) unreachable++;
      }
      const boss = g.monsters.find((m) => m.isGoalTarget);
      if (boss) {
        checked++;
        if (bfsPath(g.map, from, { x: boss.x, y: boss.y }) === null)
          unreachable++;
      }
    }
  }
  check(
    `all objectives reachable across ${seeds.length} seeds × ${LEVELS.length} levels`,
    unreachable === 0,
    `(${unreachable}/${checked} unreachable)`,
  );
}

// ─── 9. Phase 2: wraith armor-pierce ────────────────────────────────────────
console.log("\n[9] Wraith armor-pierce");
{
  const p = createPlayer();
  p.armorReduction = 4;
  // wraith: dmg 6, pierce 2 → effective armor 2 → 4 damage
  check(
    "wraith pierces 2 of armor",
    monsterAttackDamage(MONSTERS.wraith, p) === 4,
  );
  // goblin: dmg 3, no pierce, armor 4 → min-1 floor
  check(
    "non-piercer respects armor + min-1 floor",
    monsterAttackDamage(MONSTERS.goblin, p) === 1,
  );
}

// ─── 10. Phase 2: firebomb (auto-target + AoE + consume) ────────────────────
console.log("\n[10] Firebomb potion");
{
  const game = beginLevel("bomb-seed", 0, createPlayer());
  const rng = new Rng(9);
  // place a lone weak monster on a walkable neighbor of the player, in view
  const p = game.player;
  const neighbor = [
    { x: p.x + 1, y: p.y },
    { x: p.x - 1, y: p.y },
    { x: p.x, y: p.y + 1 },
    { x: p.x, y: p.y - 1 },
  ].find((n) => isWalkable(game.map, n.x, n.y))!;
  game.monsters = [
    {
      id: "test-rat",
      defId: "rat",
      x: neighbor.x,
      y: neighbor.y,
      hp: 4,
      state: "idle",
    },
  ];
  game.visible = [...game.visible, idx(neighbor.x, neighbor.y, game.map.width)];
  game.player.bag = [{ defId: "p_bomb", count: 1 }];
  const coinsBefore = game.player.coins;

  const res = resolveTurn(game, { type: "useItem", defId: "p_bomb" }, rng);
  check("firebomb consumed a turn", res.tookTurn);
  check("firebomb slew the target", game.monsters.length === 0);
  check(
    "firebomb removed from bag",
    !game.player.bag.some((b) => b.defId === "p_bomb"),
  );
  check("kill awarded coins", game.player.coins > coinsBefore);
  check(
    "firebomb emitted a projectile effect",
    res.events.some((e) => e.kind === "projectile"),
  );
}

// ─── 11. Traps ──────────────────────────────────────────────────────────────
console.log("\n[11] Hidden traps");
{
  const g = beginLevel("trap-seed", 0, createPlayer()); // dungeon has trapCount
  check(
    "dungeon scatters hidden traps",
    g.map.tiles.some((t) => t === "trap"),
  );

  const p = g.player;
  const nb = [
    { x: p.x + 1, y: p.y },
    { x: p.x - 1, y: p.y },
    { x: p.x, y: p.y + 1 },
    { x: p.x, y: p.y - 1 },
  ].find((n) => tileAt(g.map, n.x, n.y) === "floor");
  if (nb) {
    g.map.tiles[idx(nb.x, nb.y, g.map.width)] = "trap";
    g.monsters = [];
    g.player.armorReduction = 0; // read the raw trap damage, unmitigated
    const hp0 = g.player.hp;
    resolveTurn(
      g,
      { type: "move", dx: Math.sign(nb.x - p.x), dy: Math.sign(nb.y - p.y) },
      new Rng(5),
    );
    // ABSOLUTE, not `hp < hp0`: `springTrap` applies its own `Math.max(1, …)`
    // floor, so the loose version can't tell a 6-damage spike pit from a dial
    // neutered to 0 — a mutation audit set `trapDamage: 0` and this stayed green.
    check(
      "stepping on a trap deals its configured damage",
      hp0 - g.player.hp === CONFIG.trapDamage,
      `(lost ${hp0 - g.player.hp}, expected ${CONFIG.trapDamage})`,
    );
    check(
      "trap becomes sprung (one-shot)",
      tileAt(g.map, nb.x, nb.y) === "trapSprung",
    );
  }
}

// ─── 12. Torch fuel ─────────────────────────────────────────────────────────
console.log("\n[12] Torch fuel");
{
  const g = beginLevel("torch-seed", 0, createPlayer());
  g.monsters = [];
  const base = g.player.baseLightRadius;
  g.player.hasTorch = true;
  g.player.torchId = "i_torch";
  g.player.torchFuel = 3;
  recomputeLight(g.player);
  check(
    "a lit torch widens the light radius",
    g.player.lightRadius === base + (ITEMS.i_torch.lightBonus ?? 0),
  );
  const rng = new Rng(6);
  for (let i = 0; i < 3; i++) resolveTurn(g, { type: "wait" }, rng);
  check(
    "torch burns out at 0 fuel",
    !g.player.hasTorch && g.player.torchFuel === 0,
  );
  check("light reverts to base once unlit", g.player.lightRadius === base);

  // the lantern grants its OWN (larger) bonus, not the torch's
  const lp = createPlayer();
  lp.baseLightRadius = 5;
  lp.hasTorch = true;
  lp.torchFuel = 10;
  lp.torchId = "i_lantern";
  recomputeLight(lp);
  check(
    "lantern grants its own light bonus (not the torch's)",
    lp.lightRadius === 5 + (ITEMS.i_lantern.lightBonus ?? 0) &&
      (ITEMS.i_lantern.lightBonus ?? 0) > (ITEMS.i_torch.lightBonus ?? 0),
  );
}

// ─── 13. Cursor firebomb throw ──────────────────────────────────────────────
console.log("\n[13] Cursor firebomb throw (throwAt)");
{
  const g = beginLevel("throw-seed", 0, createPlayer());
  const spot = { x: g.player.x + 2, y: g.player.y };
  g.monsters = [
    { id: "t1", defId: "rat", x: spot.x, y: spot.y, hp: 4, state: "idle" },
  ];
  g.player.bag = [{ defId: "p_bomb", count: 1 }];
  const res = resolveTurn(
    g,
    { type: "throwAt", defId: "p_bomb", x: spot.x, y: spot.y },
    new Rng(7),
  );
  check("throwAt consumes a turn", res.tookTurn);
  check("throwAt detonates on the targeted tile", g.monsters.length === 0);
  check(
    "throwAt consumes the firebomb",
    !g.player.bag.some((b) => b.defId === "p_bomb"),
  );

  const g2 = beginLevel("throw-seed2", 0, createPlayer());
  g2.player.bag = [{ defId: "p_bomb", count: 1 }];
  const r2 = resolveTurn(
    g2,
    {
      type: "throwAt",
      defId: "p_bomb",
      x: g2.player.x + 40,
      y: g2.player.y + 40,
    },
    new Rng(1),
  );
  check(
    "throwAt out of range is rejected (no turn, keeps bomb)",
    !r2.tookTurn && g2.player.bag.some((b) => b.defId === "p_bomb"),
  );
}

// ─── 14. Status potions: ward, might, detect, blast ─────────────────────────
console.log("\n[14] Status potions & trap sense");
{
  // ward halves incoming damage
  {
    const g = beginLevel("ward-seed", 0, createPlayer());
    g.player.armorReduction = 0;
    const dmgNoWard = monsterAttackDamage(MONSTERS.skeleton, g.player); // 4
    g.player.effects.ward = 5;
    const dmgWard = monsterAttackDamage(MONSTERS.skeleton, g.player);
    check("ward reduces incoming damage", dmgWard < dmgNoWard && dmgWard >= 1);
  }
  // might boosts weapon damage
  {
    const g = beginLevel("might-seed", 0, createPlayer());
    const base = g.player.weaponPower; // 3
    g.player.effects.might = 5;
    const withMight = 3 + 4; // weaponPower + mightBonus, vs 0-armor rat
    check("might boosts player damage", withMight > base);
  }
  // effects tick down and expire
  {
    const g = beginLevel("tick-seed", 0, createPlayer());
    g.monsters = [];
    g.player.effects.ward = 2;
    const rng = new Rng(11);
    resolveTurn(g, { type: "wait" }, rng);
    check("effect ticks down each turn", g.player.effects.ward === 1);
    resolveTurn(g, { type: "wait" }, rng);
    check("effect expires at 0", g.player.effects.ward === undefined);
  }
  // detect reveals all traps; blast clears nearby monsters
  {
    const g = beginLevel("detect-seed", 0, createPlayer()); // dungeon has traps
    g.monsters = [];
    g.player.bag = [{ defId: "p_detect", count: 1 }];
    const trapCountOnMap = g.map.tiles.filter((t) => t === "trap").length;
    resolveTurn(g, { type: "useItem", defId: "p_detect" }, new Rng(12));
    check(
      "detect reveals every trap",
      trapCountOnMap > 0 && g.knownTraps.length >= trapCountOnMap,
    );
  }
  {
    const g = beginLevel("blast-seed", 0, createPlayer());
    g.monsters = [
      {
        id: "b1",
        defId: "rat",
        x: g.player.x + 1,
        y: g.player.y,
        hp: 4,
        state: "idle",
      },
      {
        id: "b2",
        defId: "rat",
        x: g.player.x,
        y: g.player.y + 1,
        hp: 4,
        state: "idle",
      },
    ];
    g.player.bag = [{ defId: "p_ruin", count: 1 }];
    resolveTurn(g, { type: "useItem", defId: "p_ruin" }, new Rng(13));
    check("ruin blast clears adjacent monsters", g.monsters.length === 0);
  }
  // adjacency trap sense
  {
    const g = beginLevel("sense-seed", 0, createPlayer());
    g.monsters = [];
    const p = g.player;
    const nb = [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 },
    ].find((n) => tileAt(g.map, n.x, n.y) === "floor");
    if (nb) {
      g.map.tiles[idx(nb.x, nb.y, g.map.width)] = "trap";
      // wait a turn so senseTraps runs
      resolveTurn(g, { type: "wait" }, new Rng(14));
      check(
        "adjacent armed trap is sensed",
        g.knownTraps.includes(idx(nb.x, nb.y, g.map.width)),
      );
    }
  }
}

// ─── 15. Ranged reload cadence ──────────────────────────────────────────────
console.log("\n[15] Ranged attackers reload (fire every other turn)");
{
  const g = beginLevel("imp-seed", 0, createPlayer());
  g.monsters = [];
  const p = g.player;
  const w = g.map.width;
  // carve a clear line of sight east and park an imp 2 tiles away
  g.map.tiles[idx(p.x + 1, p.y, w)] = "floor";
  g.map.tiles[idx(p.x + 2, p.y, w)] = "floor";
  g.monsters = [
    { id: "i1", defId: "imp", x: p.x + 2, y: p.y, hp: 5, state: "chase" },
  ];
  // count actual shots (projectile events) — HP-drop is confounded by the
  // imp's poison DoT, which ticks even on reload turns
  let fireTurns = 0;
  for (let t = 0; t < 4; t++) {
    const res = resolveTurn(g, { type: "wait" }, new Rng(20 + t));
    if (res.events.some((e) => e.kind === "projectile")) fireTurns++;
  }
  check(
    "imp fires on a reload cadence, not every turn",
    fireTurns > 0 && fireTurns < 4,
    `(fired on ${fireTurns}/4 turns)`,
  );
}

// ─── 16. Survive goal & escalating siege ────────────────────────────────────
console.log("\n[16] Survive goal & escalating siege");
{
  const si = levelIndexBy(
    "with a survive goal",
    (l) => l.goal.type === "survive",
  );
  const target = (LEVELS[si].goal as { turns: number }).turns;
  const g = beginLevel("survive-seed", si, createPlayer());
  g.player.maxHp = 999999;
  g.player.hp = 999999; // stay alive so we're testing the goal, not combat
  let done = false;
  for (let t = 0; t < target + 12 && !done; t++) {
    if (resolveTurn(g, { type: "wait" }, new Rng(30 + t)).goalComplete)
      done = true;
  }
  check(
    "survive goal completes after holding out",
    done && g.turnCount >= target,
  );

  // the siege must actually escalate and close in — not "stand still and win"
  {
    const gs = beginLevel("siege-seed", si, createPlayer());
    gs.player.maxHp = 999999;
    gs.player.hp = 999999;
    gs.monsters = []; // isolate the reinforcement waves
    const rng = new Rng(7);
    for (let t = 0; t < 6; t++) resolveTurn(gs, { type: "wait" }, rng);
    const early = gs.monsters.length;
    for (let t = 6; t < 30; t++) resolveTurn(gs, { type: "wait" }, rng);
    check("siege escalates as the hold wears on", gs.monsters.length > early);
    check(
      "siege stays within the concurrent cap",
      gs.monsters.length <= CONFIG.siege.cap,
    );
    check(
      "the horde closes on a stationary player",
      gs.monsters.some(
        (m) => chebyshev(m.x, m.y, gs.player.x, gs.player.y) <= 2,
      ),
    );
  }

  // ── The cap must leave room to escalate INTO ──────────────────────────────
  // Regression: `siege.cap` was a flat 22 while Restless Dead raised the Ramparts
  // garrison to 21, so the rising waves could only trickle in as fast as the
  // player killed — the level's signature beat, silently inverted by a trial. The
  // cap is now a FLOOR: `max(cap, monsterBudget + headroom)`.
  {
    const cfg = LEVELS[si];
    const effCap = (ids: string[]) =>
      Math.max(
        CONFIG.siege.cap,
        applyLevelMutators(cfg, ids).monsterBudget + CONFIG.siege.headroom,
      );
    check(
      "baseline siege cap is unchanged by the headroom rule",
      effCap([]) === CONFIG.siege.cap,
    );
    check(
      "a denser (mutated) siege still gets room above its own garrison",
      effCap(["swarm"]) - applyLevelMutators(cfg, ["swarm"]).monsterBudget >=
        CONFIG.siege.headroom,
    );
    // …and end-to-end: under Restless Dead the hold really does grow past the old
    // flat cap instead of jamming against it.
    //
    // Count only COMBATANTS. The Ramparts also carries 3 ambient ravens, and a
    // raw `monsters.length` peak is already 24 at spawn under this trial — so the
    // naive version of this check passed while the siege was completely dead.
    const combatants = (g: GameState) =>
      g.monsters.filter((m) => MONSTERS[m.defId].behavior !== "ambient").length;
    const gm = beginLevel("siege-seed", si, createPlayer(), ["swarm"]);
    gm.player.maxHp = 999999;
    gm.player.hp = 999999;
    const rngS = new Rng(7);
    const startCombat = combatants(gm);
    let peak = startCombat;
    for (let t = 0; t < 40; t++) {
      resolveTurn(gm, { type: "wait" }, rngS);
      peak = Math.max(peak, combatants(gm));
    }
    // Assert GROWTH, not "peak beats the flat cap": this trial's garrison (21)
    // already exceeds `cap` (19) at spawn, so a bare threshold passes on turn zero
    // with a totally dead siege — which is exactly how an earlier version of this
    // check stayed green while reinforcements never arrived at all.
    check(
      "Restless Dead siege can still escalate above its own garrison",
      peak > startCombat,
      `(start ${startCombat} → peak ${peak}; cap ${CONFIG.siege.cap}, headroom ${CONFIG.siege.headroom})`,
    );

    // Ambient wildlife must not consume siege capacity. The Ramparts' 3 ravens
    // used to hold 3 of the 22 slots hostage, and under Restless Dead (21
    // combatants + 3 ravens vs a flat cap of 22) it killed the siege outright:
    // spawnWave bailed on turn one and not a single wave ever arrived.
    //
    // Discriminator: flood the map with HARMLESS birds until the raw monster
    // count is past the cap while combatants stay far below it. Counting ambient
    // (the old behavior) freezes the siege dead; counting combatants lets it keep
    // escalating. Note the player needs `levitate` as well as huge HP — the
    // gargoyles here SHOVE, and a chasm fall costs a life regardless of HP, which
    // silently ended an earlier version of this scenario on turn 8.
    const gb = beginLevel("siege-seed", si, createPlayer());
    gb.player.maxHp = 999999;
    gb.player.hp = 999999;
    gb.player.effects.levitate = 999999;
    const ambId = LEVELS[si].ambient![0].monsterId;
    const w2 = gb.map.width;
    for (let i = 0; i < gb.map.tiles.length; i++) {
      if (gb.monsters.length >= CONFIG.siege.cap + 5) break;
      if (gb.map.tiles[i] !== "floor") continue;
      const x = i % w2;
      const y = Math.floor(i / w2);
      if (x === gb.player.x && y === gb.player.y) continue;
      if (gb.monsters.some((m) => m.x === x && m.y === y)) continue;
      gb.monsters.push({
        id: `pad${i}`,
        defId: ambId,
        x,
        y,
        hp: MONSTERS[ambId].maxHp,
        state: "idle",
      });
    }
    const paddedTotal = gb.monsters.length;
    const startCombat2 = combatants(gb);
    const rngB = new Rng(7);
    let peakB = startCombat2;
    for (let t = 0; t < 30; t++) {
      resolveTurn(gb, { type: "wait" }, rngB);
      peakB = Math.max(peakB, combatants(gb));
    }
    check(
      "ambient wildlife doesn't consume siege capacity",
      paddedTotal > CONFIG.siege.cap &&
        startCombat2 < CONFIG.siege.cap &&
        peakB > startCombat2,
      `(${paddedTotal} total monsters vs cap ${CONFIG.siege.cap}; combatants ${startCombat2} → ${peakB})`,
    );
  }

  // ── Reinforcements roll for champion status, like the garrison does ────────
  // Champions used to have NO effect on this level at all: `spawnWave` never
  // rolled elites, and the siege is where most of its enemies come from.
  {
    const gc = beginLevel("elite-wave", si, createPlayer(), ["champions"]);
    gc.player.maxHp = 999999;
    gc.player.hp = 999999;
    gc.monsters = []; // isolate the waves from the initial garrison
    const rngE = new Rng(3);
    let sawElite = false;
    for (let t = 0; t < 45 && !sawElite; t++) {
      resolveTurn(gc, { type: "wait" }, rngE);
      sawElite = gc.monsters.some((m) => m.id.startsWith("rf") && m.elite);
    }
    check(
      "Champions reaches siege reinforcements (a wave can be elite)",
      sawElite,
    );
  }

  // (No level currently uses `killCount` — the Iron Gate is now killTarget — so
  // the cull-completion mechanic isn't exercised here; the goal type stays
  // supported in goals.ts for future reuse.)
}

// ─── 17. Monster loot drops ─────────────────────────────────────────────────
console.log("\n[17] Monster loot drops");
{
  // a guaranteed-drop boss leaves an item on its tile when slain by melee
  const g = beginLevel("loot-seed", 0, createPlayer());
  const p = g.player;
  p.weaponPower = 999; // one-shot it
  const spot = [
    { x: p.x + 1, y: p.y },
    { x: p.x - 1, y: p.y },
    { x: p.x, y: p.y + 1 },
    { x: p.x, y: p.y - 1 },
  ].find((n) => isWalkable(g.map, n.x, n.y))!;
  g.monsters = [
    {
      id: "boss",
      defId: "frost_troll",
      x: spot.x,
      y: spot.y,
      hp: 5,
      state: "chase",
    },
  ];
  g.items = [];
  resolveTurn(
    g,
    { type: "move", dx: Math.sign(spot.x - p.x), dy: Math.sign(spot.y - p.y) },
    new Rng(40),
  );
  check("guaranteed-drop boss leaves loot on its tile", g.items.length >= 1);
  check(
    "loot dropped on the corpse tile",
    g.items.some((it) => it.x === spot.x && it.y === spot.y),
  );
}

// ─── 18. Trap-free route to every objective (fairness) ──────────────────────
console.log("\n[18] Trap-free route to objectives");
{
  const trapFree = (map: GameMap, from: Pos): Set<number> => {
    const w = map.width;
    const start = idx(from.x, from.y, w);
    const seen = new Set<number>([start]);
    const q: number[] = [start];
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
  };

  const seeds = ["f1", "f2", "f3", "f4", "f5", "f6"];
  let bad = 0;
  let checked = 0;
  for (const seed of seeds) {
    for (let li = 0; li < LEVELS.length; li++) {
      const g = beginLevel(seed, li, createPlayer());
      const free = trapFree(g.map, { x: g.player.x, y: g.player.y });
      const objs: Pos[] = [];
      if (g.map.exit) objs.push(g.map.exit);
      for (const m of g.monsters)
        if (m.isGoalTarget) objs.push({ x: m.x, y: m.y });
      for (const it of g.items)
        if (it.questTag) objs.push({ x: it.x, y: it.y });
      for (const o of objs) {
        checked++;
        if (!free.has(idx(o.x, o.y, g.map.width))) bad++;
      }
    }
  }
  check(
    `every objective is reachable without crossing a trap (${seeds.length}×${LEVELS.length} levels)`,
    bad === 0,
    `(${bad}/${checked} required a trap)`,
  );
}

// ─── 19. Status effects, cures & environmental fire ─────────────────────────
console.log("\n[19] Status effects, cures & fire");
{
  const DIRS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const adjacentWalkable = (g: ReturnType<typeof beginLevel>): Pos => {
    for (const [dx, dy] of DIRS) {
      const x = g.player.x + dx;
      const y = g.player.y + dy;
      if (isWalkable(g.map, x, y)) return { x, y };
    }
    throw new Error("player has no walkable neighbor");
  };

  // poison bites through armor and expires on schedule
  {
    const game = beginLevel("status-seed", 0, createPlayer());
    game.monsters = [];
    game.player.armorReduction = 10;
    game.player.effects.poison = 2;
    const before = game.player.hp;
    const rng = new Rng(1);
    resolveTurn(game, { type: "wait" }, rng);
    check(
      "poison ticks full damage despite armor",
      game.player.hp === before - STATUS.poison.dmgPerTurn,
    );
    check("poison timer counts down", (game.player.effects.poison ?? 0) === 1);
    resolveTurn(game, { type: "wait" }, rng);
    check(
      "poison expires when its timer ends",
      !("poison" in game.player.effects),
    );
  }

  // a status tick can be lethal (routes through the death path)
  {
    const game = beginLevel("status-seed", 0, createPlayer());
    game.monsters = [];
    game.player.hp = 1;
    game.player.effects.bleed = 3;
    const res = resolveTurn(game, { type: "wait" }, new Rng(1));
    check("a status tick can kill the player", res.playerDied);
  }

  // antidote clears damaging debuffs but leaves buffs alone
  {
    const game = beginLevel("status-seed", 0, createPlayer());
    game.monsters = [];
    Object.assign(game.player.effects, {
      poison: 4,
      bleed: 4,
      burn: 4,
      ward: 5,
    });
    game.player.bag.push({ defId: "p_antidote", count: 1 });
    resolveTurn(game, { type: "useItem", defId: "p_antidote" }, new Rng(1));
    const e = game.player.effects;
    check(
      "antidote cures poison/bleed/burn",
      !("poison" in e) && !("bleed" in e) && !("burn" in e),
    );
    check("antidote leaves buffs (ward) intact", (e.ward ?? 0) > 0);
  }

  // fire under an entity inflicts burn and burns down each turn
  {
    const game = beginLevel("status-seed", 0, createPlayer());
    game.monsters = [];
    game.fireTiles = [
      { i: idx(game.player.x, game.player.y, game.map.width), life: 2 },
    ];
    const before = game.player.hp;
    resolveTurn(game, { type: "wait" }, new Rng(1));
    check(
      "standing in fire inflicts burn",
      (game.player.effects.burn ?? 0) > 0,
    );
    check("fire deals burn damage", game.player.hp < before);
    check(
      "a fire tile burns down each turn",
      (game.fireTiles[0]?.life ?? 0) === 1,
    );
  }

  // a chilled monster forfeits its turn (no attack)
  {
    const game = beginLevel("status-seed", 0, createPlayer());
    const spot = adjacentWalkable(game);
    game.monsters = [
      {
        id: "frozey",
        defId: "spider",
        x: spot.x,
        y: spot.y,
        hp: 6,
        state: "chase",
        effects: { chill: 3 },
      },
    ];
    const before = game.player.hp;
    resolveTurn(game, { type: "wait" }, new Rng(1));
    check("a chilled monster cannot attack", game.player.hp === before);
    check(
      "chill counts down while frozen",
      (game.monsters[0]?.effects?.chill ?? 0) === 2,
    );
  }

  // a thrown firebomb sears monsters that survive the blast (player → monster)
  {
    const game = beginLevel("status-seed", 0, createPlayer());
    const spot = adjacentWalkable(game);
    game.monsters = [
      {
        id: "tank",
        defId: "frost_troll",
        x: spot.x,
        y: spot.y,
        hp: 40,
        state: "idle",
      },
    ];
    game.player.bag.push({ defId: "p_bomb", count: 1 });
    resolveTurn(
      game,
      { type: "throwAt", defId: "p_bomb", x: spot.x, y: spot.y },
      new Rng(1),
    );
    const tank = game.monsters.find((m) => m.id === "tank");
    check(
      "firebomb burns a monster that survives the blast",
      !!tank && (tank.effects?.burn ?? 0) > 0,
    );
  }
}

// ─── 20. Environmental interplay: knockback / oil / cracked walls ────────────
console.log("\n[20] Environmental interplay");
{
  const DIRS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  // knockback shoves a surviving monster into water — an instant kill
  {
    const game = beginLevel("env-seed", 0, createPlayer());
    const w = game.map.width;
    const h = game.map.height;
    const px = game.player.x;
    const py = game.player.y;
    game.player.weaponId = "w_mace"; // power 6, knockback 1
    game.player.weaponPower = 6;
    let dir: number[] | null = null;
    let spot: Pos | null = null;
    let far: Pos | null = null;
    for (const [dx, dy] of DIRS) {
      const sx = px + dx;
      const sy = py + dy;
      const fx = px + 2 * dx;
      const fy = py + 2 * dy;
      if (
        isWalkable(game.map, sx, sy) &&
        fx > 0 &&
        fy > 0 &&
        fx < w - 1 &&
        fy < h - 1
      ) {
        dir = [dx, dy];
        spot = { x: sx, y: sy };
        far = { x: fx, y: fy };
        break;
      }
    }
    if (!dir || !spot || !far) throw new Error("no knockback lane found");
    game.map.tiles[idx(far.x, far.y, w)] = "water";
    game.monsters = [
      {
        id: "kb",
        defId: "skeleton",
        x: spot.x,
        y: spot.y,
        hp: 12,
        state: "chase",
      },
    ];
    const killsBefore = game.player.kills;
    resolveTurn(game, { type: "move", dx: dir[0], dy: dir[1] }, new Rng(1));
    check(
      "knockback shoves a survivor into water",
      !game.monsters.some((m) => m.id === "kb"),
    );
    check(
      "the drowned monster counts as a kill",
      game.player.kills === killsBefore + 1,
    );
  }

  // a firebomb blows open a cracked wall
  {
    const game = beginLevel("env-seed", 0, createPlayer());
    const w = game.map.width;
    const h = game.map.height;
    game.monsters = [];
    let spot: Pos | null = null;
    for (const [dx, dy] of DIRS) {
      const x = game.player.x + dx;
      const y = game.player.y + dy;
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        spot = { x, y };
        break;
      }
    }
    if (!spot) throw new Error("no adjacent tile");
    game.map.tiles[idx(spot.x, spot.y, w)] = "crackedWall";
    game.player.bag.push({ defId: "p_bomb", count: 1 });
    resolveTurn(
      game,
      { type: "throwAt", defId: "p_bomb", x: spot.x, y: spot.y },
      new Rng(1),
    );
    check(
      "a firebomb blows open a cracked wall",
      game.map.tiles[idx(spot.x, spot.y, w)] === "floor",
    );
  }

  // fire ignites and spreads across adjacent oil
  {
    const game = beginLevel("env-seed", 0, createPlayer());
    const w = game.map.width;
    game.monsters = [];
    const pIdx = idx(game.player.x, game.player.y, w);
    let a = -1;
    let b = -1;
    for (let i = 0; i < game.map.tiles.length && a < 0; i++) {
      if (game.map.tiles[i] !== "floor" || i === pIdx) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      for (const [dx, dy] of DIRS) {
        const ni = (y + dy) * w + (x + dx);
        if (game.map.tiles[ni] === "floor" && ni !== pIdx) {
          a = i;
          b = ni;
          break;
        }
      }
    }
    if (a < 0) throw new Error("no adjacent floor pair");
    game.map.tiles[a] = "oil";
    game.map.tiles[b] = "oil";
    game.fireTiles = [{ i: a, life: 4 }];
    resolveTurn(game, { type: "wait" }, new Rng(1));
    check(
      "fire spreads onto adjacent oil (which burns to floor)",
      game.map.tiles[b] === "floor" && game.fireTiles.some((f) => f.i === b),
    );
  }
}

// ─── 21. Elites & stealth (sneak attacks) ───────────────────────────────────
console.log("\n[21] Elites & stealth");
{
  const DIRS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const adj = (g: ReturnType<typeof beginLevel>): Pos => {
    for (const [dx, dy] of DIRS) {
      const x = g.player.x + dx;
      const y = g.player.y + dy;
      if (isWalkable(g.map, x, y)) return { x, y };
    }
    throw new Error("no walkable neighbor");
  };
  const stepInto = (g: ReturnType<typeof beginLevel>, s: Pos) =>
    resolveTurn(
      g,
      {
        type: "move",
        dx: Math.sign(s.x - g.player.x),
        dy: Math.sign(s.y - g.player.y),
      },
      new Rng(1),
    );

  // sneak attack: striking an unaware chaser hits for the sneak multiplier
  {
    const g = beginLevel("elite-seed", 0, createPlayer());
    g.player.weaponPower = 6;
    const s = adj(g);
    g.monsters = [
      { id: "z", defId: "skeleton", x: s.x, y: s.y, hp: 100, state: "idle" },
    ];
    stepInto(g, s);
    const sneakLoss = 100 - g.monsters[0].hp;

    const g2 = beginLevel("elite-seed", 0, createPlayer());
    g2.player.weaponPower = 6;
    const s2 = adj(g2);
    g2.monsters = [
      { id: "z", defId: "skeleton", x: s2.x, y: s2.y, hp: 100, state: "chase" },
    ];
    stepInto(g2, s2);
    const openLoss = 100 - g2.monsters[0].hp;

    check(
      "sneak attack on an unaware monster hits harder",
      sneakLoss === openLoss * CONFIG.sneakMultiplier,
    );
  }

  // elite brute shrugs off part of every blow
  {
    const g = beginLevel("elite-seed", 0, createPlayer());
    g.player.weaponPower = 10;
    const s = adj(g);
    g.monsters = [
      {
        id: "b",
        defId: "skeleton",
        x: s.x,
        y: s.y,
        hp: 100,
        state: "chase",
        elite: "brute",
      },
    ];
    stepInto(g, s);
    check(
      "elite brute reduces incoming damage",
      100 - g.monsters[0].hp === 10 - ELITE.brute.armorBonus,
    );
  }

  // volatile elite bursts on death, catching an adjacent player
  {
    const g = beginLevel("elite-seed", 0, createPlayer());
    g.player.weaponPower = 50;
    const s = adj(g);
    g.monsters = [
      {
        id: "v",
        defId: "rat",
        x: s.x,
        y: s.y,
        hp: 2,
        state: "chase",
        elite: "volatile",
      },
    ];
    const hp0 = g.player.hp;
    stepInto(g, s);
    check(
      "volatile elite explodes on death",
      !g.monsters.some((m) => m.id === "v"),
    );
    // The `hp0 - CONFIG.eliteExplodeDamage` form alone is self-referential: at a
    // dial of 0 it reads `hp === hp0` and passes on a blast that never happened.
    // Keep the exact-wiring check AND require real damage.
    check(
      "its blast catches an adjacent player",
      g.player.hp === hp0 - CONFIG.eliteExplodeDamage && g.player.hp < hp0,
      `(hp ${hp0}→${g.player.hp}, dial ${CONFIG.eliteExplodeDamage})`,
    );
  }

  // elites pay double coins and always drop loot
  {
    const g = beginLevel("elite-seed", 0, createPlayer());
    g.player.weaponPower = 60;
    const s = adj(g);
    g.monsters = [
      {
        id: "e",
        defId: "skeleton",
        x: s.x,
        y: s.y,
        hp: 2,
        state: "chase",
        elite: "brute",
      },
    ];
    const coins0 = g.player.coins;
    stepInto(g, s);
    check(
      "elite pays double coins",
      g.player.coins === coins0 + MONSTERS.skeleton.coinReward * 2,
    );
    check(
      "elite always drops loot",
      g.items.some((it) => it.x === s.x && it.y === s.y),
    );
  }
}

// ─── 22. Ranged weapon + altars ─────────────────────────────────────────────
console.log("\n[22] Ranged weapon & altars");
{
  const DIRS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const adj = (g: ReturnType<typeof beginLevel>): Pos => {
    for (const [dx, dy] of DIRS) {
      const x = g.player.x + dx;
      const y = g.player.y + dy;
      if (isWalkable(g.map, x, y)) return { x, y };
    }
    throw new Error("no walkable neighbor");
  };
  const equipBow = (g: ReturnType<typeof beginLevel>) => {
    g.player.weaponId = "w_bow";
    g.player.weaponPower = 6;
  };

  // firing the bow consumes an arrow and wounds a target in range + LOS
  {
    const g = beginLevel("ranged-seed", 0, createPlayer());
    g.monsters = [];
    equipBow(g);
    g.player.bag.push({ defId: "am_arrow", count: 5 });
    const s = adj(g);
    const ti = idx(s.x, s.y, g.map.width);
    if (!g.visible.includes(ti)) g.visible.push(ti);
    g.monsters = [
      { id: "t", defId: "skeleton", x: s.x, y: s.y, hp: 20, state: "chase" },
    ];
    const res = resolveTurn(g, { type: "shootAt", x: s.x, y: s.y }, new Rng(1));
    check("firing the bow takes a turn", res.tookTurn);
    check("the arrow wounds the target", g.monsters[0].hp < 20);
    check(
      "firing consumes one arrow",
      (g.player.bag.find((b) => b.defId === "am_arrow")?.count ?? 0) === 4,
    );
  }

  // an empty quiver refuses the shot (no turn spent)
  {
    const g = beginLevel("ranged-seed", 0, createPlayer());
    g.monsters = [];
    equipBow(g);
    const s = adj(g);
    const ti = idx(s.x, s.y, g.map.width);
    if (!g.visible.includes(ti)) g.visible.push(ti);
    g.monsters = [
      { id: "t", defId: "skeleton", x: s.x, y: s.y, hp: 20, state: "chase" },
    ];
    const res = resolveTurn(g, { type: "shootAt", x: s.x, y: s.y }, new Rng(1));
    check("firing with no arrows spends no turn", !res.tookTurn);
    check(
      "an empty quiver leaves the target unharmed",
      g.monsters[0].hp === 20,
    );
  }

  // a bow-wielder out of arrows falls back to a 1-damage jab on a bump
  {
    const g = beginLevel("ranged-seed", 0, createPlayer());
    g.monsters = [];
    equipBow(g);
    const s = adj(g);
    g.monsters = [
      { id: "t", defId: "skeleton", x: s.x, y: s.y, hp: 20, state: "chase" },
    ];
    resolveTurn(
      g,
      { type: "move", dx: s.x - g.player.x, dy: s.y - g.player.y },
      new Rng(1),
    );
    check("out of arrows, a bow bump jabs for 1", 20 - g.monsters[0].hp === 1);
  }

  // altar: vigor pays gold for max HP + a full heal
  {
    const g = beginLevel("altar-seed", 0, createPlayer());
    g.player.coins = 40;
    g.player.maxHp = 20;
    g.player.hp = 10;
    const m = applyAltar(g, {
      id: "a",
      x: 0,
      y: 0,
      kind: "vigor",
      used: false,
    });
    check(
      "vigor altar grants max HP + full heal for gold",
      m != null &&
        g.player.maxHp === 26 &&
        g.player.hp === 26 &&
        g.player.coins === 0,
    );
  }

  // altar: warblood trades permanent max HP for permanent weapon power
  {
    const g = beginLevel("altar-seed", 0, createPlayer());
    g.player.maxHp = 20;
    g.player.hp = 20;
    applyAltar(g, { id: "b", x: 0, y: 0, kind: "warblood", used: false });
    check(
      "warblood altar trades blood for lasting power",
      g.player.maxHp === 14 && g.player.weaponBonus === 3,
    );
  }

  // altar: an unaffordable bargain is a no-op
  {
    const g = beginLevel("altar-seed", 0, createPlayer());
    g.player.coins = 10;
    const m = applyAltar(g, {
      id: "c",
      x: 0,
      y: 0,
      kind: "vigor",
      used: false,
    });
    check(
      "an unaffordable altar changes nothing",
      m === null && g.player.coins === 10,
    );
  }
}

// ─── 23. Cracked-wall demolition (knockback + melee bash) ───────────────────
console.log("\n[23] Cracked-wall demolition");
{
  const DIRS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  // knockback smashes a monster clean through a cracked wall
  {
    const g = beginLevel("cw-seed", 0, createPlayer());
    const w = g.map.width;
    const h = g.map.height;
    const px = g.player.x;
    const py = g.player.y;
    g.player.weaponId = "w_mace"; // knockback 1
    g.player.weaponPower = 6;
    let dir: number[] | null = null;
    let spot: Pos | null = null;
    let far: Pos | null = null;
    for (const [dx, dy] of DIRS) {
      const sx = px + dx;
      const sy = py + dy;
      const fx = px + 2 * dx;
      const fy = py + 2 * dy;
      if (
        isWalkable(g.map, sx, sy) &&
        fx > 0 &&
        fy > 0 &&
        fx < w - 1 &&
        fy < h - 1
      ) {
        dir = [dx, dy];
        spot = { x: sx, y: sy };
        far = { x: fx, y: fy };
        break;
      }
    }
    if (!dir || !spot || !far) throw new Error("no knockback lane");
    g.map.tiles[idx(far.x, far.y, w)] = "crackedWall";
    g.monsters = [
      {
        id: "k",
        defId: "skeleton",
        x: spot.x,
        y: spot.y,
        hp: 100,
        state: "chase",
      },
    ];
    resolveTurn(g, { type: "move", dx: dir[0], dy: dir[1] }, new Rng(1));
    check(
      "knockback shatters a cracked wall",
      g.map.tiles[idx(far.x, far.y, w)] === "floor",
    );
    check(
      "the slammed monster survives (driven through, not killed)",
      g.monsters.some((m) => m.id === "k"),
    );
  }

  // melee bash: it takes `crackedWallToughness` bumps to break
  {
    const g = beginLevel("cw-seed", 0, createPlayer());
    const w = g.map.width;
    const h = g.map.height;
    const px = g.player.x;
    const py = g.player.y;
    g.monsters = [];
    let spot: Pos | null = null;
    let dir: number[] | null = null;
    for (const [dx, dy] of DIRS) {
      const sx = px + dx;
      const sy = py + dy;
      if (sx > 0 && sy > 0 && sx < w - 1 && sy < h - 1) {
        spot = { x: sx, y: sy };
        dir = [dx, dy];
        break;
      }
    }
    if (!spot || !dir) throw new Error("no adjacent tile");
    g.map.tiles[idx(spot.x, spot.y, w)] = "crackedWall";
    const T = CONFIG.crackedWallToughness;
    // The loop below is written in terms of T, so it would pass VACUOUSLY at
    // T === 1: zero bumps happen and "withstands the first blows" is trivially
    // true of an untouched wall. Pin the design intent — a shortcut you earn.
    check(
      "breaking a cracked wall takes more than one bash",
      T >= 2,
      `(T=${T})`,
    );
    for (let n = 0; n < T - 1; n++)
      resolveTurn(g, { type: "move", dx: dir[0], dy: dir[1] }, new Rng(1));
    check(
      "cracked wall withstands the first blows",
      g.map.tiles[idx(spot.x, spot.y, w)] === "crackedWall",
    );
    const res = resolveTurn(
      g,
      { type: "move", dx: dir[0], dy: dir[1] },
      new Rng(1),
    );
    check(
      "a final bash crumbles it to floor",
      res.tookTurn && g.map.tiles[idx(spot.x, spot.y, w)] === "floor",
    );
  }
}

// ─── 24. Persistent decals (blood on kills, scorch on burnout) ──────────────
console.log("\n[24] Persistent decals");
{
  const DIRS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const adj = (g: ReturnType<typeof beginLevel>): Pos => {
    for (const [dx, dy] of DIRS) {
      const x = g.player.x + dx;
      const y = g.player.y + dy;
      if (isWalkable(g.map, x, y)) return { x, y };
    }
    throw new Error("no walkable neighbor");
  };

  // a slain monster leaves a blood stain on its tile
  {
    const g = beginLevel("decal-seed", 0, createPlayer());
    g.monsters = [];
    g.player.weaponPower = 50;
    const s = adj(g);
    g.monsters = [
      { id: "d", defId: "rat", x: s.x, y: s.y, hp: 2, state: "chase" },
    ];
    resolveTurn(
      g,
      { type: "move", dx: s.x - g.player.x, dy: s.y - g.player.y },
      new Rng(1),
    );
    check(
      "a slain monster leaves a blood stain",
      g.decals[idx(s.x, s.y, g.map.width)] === "blood",
    );
  }

  // a fire tile that burns out leaves a scorch mark
  {
    const g = beginLevel("decal-seed", 0, createPlayer());
    g.monsters = [];
    const s = adj(g);
    const fi = idx(s.x, s.y, g.map.width);
    g.fireTiles = [{ i: fi, life: 1 }];
    resolveTurn(g, { type: "wait" }, new Rng(1));
    check("burnt-out fire leaves a scorch mark", g.decals[fi] === "scorch");
    check(
      "the spent fire tile is cleared",
      !g.fireTiles.some((f) => f.i === fi),
    );
  }
}

// ─── 25. Shop selling (flat % of base value) ────────────────────────────────
console.log("\n[25] Shop selling");
{
  check(
    "sellable gear returns a positive price",
    sellPrice(ITEMS.a_leather) > 0,
  );
  check(
    "sell price is below the shop's buy price",
    sellPrice(ITEMS.w_short) < 15,
  );
  check(
    "quest items and coins can't be sold",
    sellPrice(ITEMS.q_shard) === 0 && sellPrice(ITEMS.c_gold) === 0,
  );
  check(
    "stronger gear is worth more",
    sellPrice(ITEMS.w_sun) > sellPrice(ITEMS.w_dagger),
  );
}

// ─── 26. Turn "par" vs map size ─────────────────────────────────────────────
// The turn limit is no longer a threat — just a par-for-score target (see
// `levelParBonus`), so this is now only a sanity floor: par must be at least
// *reachable* (the shortest walkable beeline to the farthest objective fits
// within it), so the efficiency bonus is earnable rather than impossible. This
// no longer constrains map size — a bigger, slower level just means a tighter
// (still-beatable) par. Informational ratio table below.
console.log("\n[26] Turn par vs map size (reachability floor only)");
{
  const seeds = ["s1", "s2", "s3", "xyzzy", "blackwood", "999"];
  const EXPLORE_FACTOR = 1.0;
  let bad = 0;
  let checked = 0;

  for (let li = 0; li < LEVELS.length; li++) {
    const cfg = LEVELS[li];
    // cull / survive have no fixed objective tile — not traversal-bound
    if (cfg.goal.type === "killCount" || cfg.goal.type === "survive") continue;

    let worstFar = 0; // longest objective beeline across seeds (worst case)
    for (const seed of seeds) {
      const g = beginLevel(seed, li, createPlayer());
      const from: Pos = { x: g.player.x, y: g.player.y };
      const objs: Pos[] = [];
      if (g.map.exit) objs.push(g.map.exit);
      for (const m of g.monsters)
        if (m.isGoalTarget) objs.push({ x: m.x, y: m.y });
      for (const it of g.items)
        if (it.questTag) objs.push({ x: it.x, y: it.y });
      for (const o of objs) {
        const path = bfsPath(g.map, from, o);
        if (path) worstFar = Math.max(worstFar, path.length - 1);
      }
      checked++;
    }
    const ratio = cfg.turnLimit / Math.max(1, worstFar);
    console.log(
      `  · ${cfg.id.padEnd(16)} ${ratio.toFixed(1)}× (${worstFar} steps / ${cfg.turnLimit} turns)`,
    );
    if (worstFar * EXPLORE_FACTOR > cfg.turnLimit) bad++;
  }

  check(
    `every objective's beeline fits within its turn par (par is earnable, ${checked} level×seed)`,
    bad === 0,
    `(a level's beeline exceeded its turn par — see the per-level list above)`,
  );
}

// ─── 27. Equipment swapping — never lose a weapon; switching is clean ────────
console.log("\n[27] Equipment swapping");
{
  const p = createPlayer(); // Rusty Dagger wielded, empty bag
  giveItem(p, "w_short"); // an upgrade → auto-equips
  check("an upgrade auto-equips", p.weaponId === "w_short");
  check(
    "the replaced weapon is stowed, not discarded",
    p.bag.some((b) => b.defId === "w_dagger"),
  );

  equipWeapon(p, "w_dagger"); // switch back to the stowed weapon
  check("re-equipping a stowed weapon swaps in", p.weaponId === "w_dagger");
  check(
    "the swap leaves no duplicate and loses nothing",
    p.bag.filter((b) => b.defId === "w_dagger").length === 0 &&
      p.bag.some((b) => b.defId === "w_short"),
  );

  // Torches aren't bag items — a second one ADDS fuel (extra turns to burn),
  // and a brighter one upgrades the light without a plain torch downgrading it.
  const t = createPlayer();
  giveItem(t, "i_torch"); // first torch → full fuel
  const torchFuel = t.torchFuel;
  check("a torch equips at full fuel", torchFuel === ITEMS.i_torch.fuel);
  giveItem(t, "i_torch"); // second torch → fuel STACKS (the bug: it used to reset)
  check(
    "buying a second torch adds its fuel (not a no-op)",
    t.torchFuel === torchFuel + (ITEMS.i_torch.fuel ?? 0),
  );
  giveItem(t, "i_lantern"); // brighter → upgrades light + adds its fuel
  check("a brighter lantern upgrades the light", t.torchId === "i_lantern");
  giveItem(t, "i_torch"); // dimmer → refuels only, keeps the lantern
  check(
    "a plain torch over a lantern refuels without downgrading",
    t.torchId === "i_lantern",
  );
}

// ─── 28. No unreachable open areas ──────────────────────────────────────────
// Every open tile the player can see must be reachable (cracked walls AND shut
// doors count as passable — you break/open them). Guards against teasing
// walled-off pockets. Mirrors the engine's canonical `isOpenTile`.
console.log("\n[28] No unreachable open areas");
{
  const OPEN = new Set<string>([
    "floor",
    "doorOpen",
    "door",
    "exit",
    "trap",
    "trapSprung",
    "oil",
    "forage",
    "ice",
    "glowcap",
    "bramble",
    "sporeVent",
    "crackedWall",
  ]);
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const seeds = ["u1", "u2", "u3", "u4", "u5", "cave", "abc", "777"];
  let orphans = 0;
  let openTiles = 0;
  for (let li = 0; li < LEVELS.length; li++) {
    for (const seed of seeds) {
      const g = beginLevel(seed, li, createPlayer());
      const w = g.map.width;
      const h = g.map.height;
      const seen = new Uint8Array(w * h);
      const start = idx(g.player.x, g.player.y, w);
      seen[start] = 1;
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop()!;
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        for (const [dx, dy] of dirs) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (seen[ni] || !OPEN.has(g.map.tiles[ni])) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      for (let i = 0; i < g.map.tiles.length; i++) {
        if (!OPEN.has(g.map.tiles[i])) continue;
        openTiles++;
        if (!seen[i]) orphans++;
      }
    }
  }
  check(
    `every open tile is reachable (${openTiles} tiles across ${seeds.length}×${LEVELS.length})`,
    orphans === 0,
    `(${orphans} orphaned)`,
  );
}

// ─── 29. Boss mechanics (Malachar) ──────────────────────────────────────────
console.log("\n[29] Boss mechanics — Malachar's phases/barrage/summon/blink");
{
  const ti = levelIndexBy(
    "with the lich killTarget goal",
    (l) =>
      l.goal.type === "killTarget" &&
      (l.goal as { monsterId?: string }).monsterId === "lich",
  );
  const bossHp = MONSTERS.lich.maxHp;

  // (a) telegraphed barrage: gathers on one turn, detonates the next
  {
    const g = beginLevel("lich-barrage", ti, createPlayer());
    const p = g.player;
    const w = g.map.width;
    p.maxHp = 9999;
    p.hp = 9999;
    p.armorReduction = 0;
    for (let dx = 1; dx <= 4; dx++)
      g.map.tiles[idx(p.x + dx, p.y, w)] = "floor";
    // filler adds push the summon-vs-barrage choice to always barrage
    const filler = Array.from({ length: CONFIG.lich.summonCap }, (_, i) => ({
      id: `f${i}`,
      defId: "skeleton",
      x: 1,
      y: 1,
      hp: 1,
      state: "idle" as const,
    }));
    g.monsters = [
      ...filler,
      {
        id: "M",
        defId: "lich",
        x: p.x + 3,
        y: p.y,
        hp: bossHp,
        state: "chase",
        abilityCd: 0,
        phase: 0,
        isGoalTarget: true,
      },
    ];
    resolveTurn(g, { type: "wait" }, new Rng(1));
    const pIdx = idx(p.x, p.y, w);
    check(
      "lich telegraphs a barrage centered on the player",
      g.barrage.length >= 1 &&
        g.barrage.length <= CONFIG.lich.barrageTiles[0] &&
        g.barrage.includes(pIdx),
      `(${g.barrage.length} tiles)`,
    );
    const hpBefore = p.hp;
    resolveTurn(g, { type: "wait" }, new Rng(2)); // stand still → eat the fire
    check(
      "standing in the barrage takes damage on detonation",
      p.hp < hpBefore,
    );
    check("barrage tiles clear after detonating", g.barrage.length === 0);
  }

  // (b) summon: raises adds around the lich
  {
    const g = beginLevel("lich-summon", ti, createPlayer());
    const p = g.player;
    const w = g.map.width;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        g.map.tiles[idx(p.x + 2 + dx, p.y + dy, w)] = "floor";
    const saved = CONFIG.lich.summonChance;
    CONFIG.lich.summonChance = [1, 1, 1]; // force the summon branch
    g.monsters = [
      {
        id: "M",
        defId: "lich",
        x: p.x + 2,
        y: p.y,
        hp: bossHp,
        state: "chase",
        abilityCd: 0,
        phase: 0,
        isGoalTarget: true,
      },
    ];
    const before = g.monsters.length;
    resolveTurn(g, { type: "wait" }, new Rng(3));
    CONFIG.lich.summonChance = saved;
    check(
      "lich summons adds when its ability is ready",
      g.monsters.length > before,
    );
  }

  // (c) blink: cornered (phase 2+) the lich teleports away instead of trading blows
  {
    const g = beginLevel("lich-blink", ti, createPlayer());
    const p = g.player;
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    const adj = dirs
      .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
      .find((c) => isWalkable(g.map, c.x, c.y));
    if (adj) {
      g.monsters = [
        {
          id: "M",
          defId: "lich",
          x: adj.x,
          y: adj.y,
          hp: Math.floor(bossHp / 3), // phase 2
          state: "chase",
          abilityCd: 5,
          phase: 2,
          isGoalTarget: true,
        },
      ];
      resolveTurn(g, { type: "wait" }, new Rng(4));
      const m = g.monsters.find((x) => x.defId === "lich")!;
      check(
        "a cornered lich blinks clear of the player",
        chebyshev(m.x, m.y, g.player.x, g.player.y) >=
          CONFIG.lich.teleportMinDist,
      );
    } else {
      check(
        "a cornered lich blinks clear of the player",
        true,
        "(no adjacent tile — skipped)",
      );
    }
  }

  // (d) phases announce as HP falls
  {
    const g = beginLevel("lich-phase", ti, createPlayer());
    const p = g.player;
    const w = g.map.width;
    p.maxHp = 9999;
    p.hp = 9999;
    for (let dx = 1; dx <= 4; dx++)
      g.map.tiles[idx(p.x + dx, p.y, w)] = "floor";
    g.monsters = [
      {
        id: "M",
        defId: "lich",
        x: p.x + 3,
        y: p.y,
        hp: Math.floor(bossHp * 0.6),
        state: "chase",
        abilityCd: 5,
        phase: 0,
        isGoalTarget: true,
      },
    ];
    const res = resolveTurn(g, { type: "wait" }, new Rng(5));
    check(
      "entering a new phase announces itself",
      res.events.some(
        (e) => e.kind === "message" && e.text.includes("wreathing shadow"),
      ),
    );
  }
}

// ─── 30. Same-turn resolution (goal vs. death) ──────────────────────────────
console.log(
  "\n[30] Same-turn resolution — decisive action wins, passive tick kills",
);
{
  // (a) A goal-completing ACTION wins before end-of-turn hazards can tick you
  // out — you don't die to your own lingering DoT on the turn you win.
  {
    const g = beginLevel("sameturn-a", 0, createPlayer()); // dungeon: reachLocation
    const p = g.player;
    g.monsters = [];
    const exit = g.map.exit!;
    const nb = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]
      .map(([dx, dy]) => ({ x: exit.x + dx, y: exit.y + dy }))
      .find((c) => isWalkable(g.map, c.x, c.y))!;
    p.x = nb.x;
    p.y = nb.y;
    p.hp = 1;
    p.maxHp = 20;
    p.effects.burn = 3; // would kill on the end-of-turn tick, if it ran first
    const res = resolveTurn(
      g,
      {
        type: "move",
        dx: Math.sign(exit.x - nb.x),
        dy: Math.sign(exit.y - nb.y),
      },
      new Rng(1),
    );
    check(
      "a goal-completing action wins before your own DoT can tick",
      res.goalComplete && !res.playerDied && g.player.hp === 1,
    );
  }

  // (b) Regression: a lethal end-of-turn tick still kills when no goal is met.
  {
    const g = beginLevel("sameturn-b", 0, createPlayer());
    const p = g.player;
    g.monsters = [];
    p.hp = 1;
    p.maxHp = 20;
    p.effects.burn = 3;
    const res = resolveTurn(g, { type: "wait" }, new Rng(2));
    check(
      "a lethal tick still kills when no goal is completed",
      res.playerDied && !res.goalComplete,
    );
  }

  // (c) The nuance: a PASSIVE tick that kills you wins over a goal that the same
  // tick would have completed (only your own action wins through a tie). Uses a
  // real killTarget level and a goal-target that dies to its OWN burn this tick.
  {
    const ti = levelIndexBy(
      "with a killTarget goal",
      (l) => l.goal.type === "killTarget",
    );
    const g = beginLevel("sameturn-c", ti, createPlayer());
    const p = g.player;
    const spot = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]
      .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
      .find((c) => isWalkable(g.map, c.x, c.y))!;
    // the goal target itself dies to its own burn this tick → completes killTarget
    g.monsters = [
      {
        id: "m",
        defId: "skeleton",
        x: spot.x,
        y: spot.y,
        hp: 1,
        state: "idle",
        isGoalTarget: true,
        effects: { burn: 2 },
      },
    ];
    // ...on the same tick the player's own burn drops them
    p.hp = 1;
    p.maxHp = 20;
    p.effects.burn = 2;
    const res = resolveTurn(g, { type: "wait" }, new Rng(3));
    check(
      "a passive killing tick beats a tick-driven goal completion",
      res.playerDied && !res.goalComplete,
    );
    check(
      "(sanity) that tick did slay the goal target",
      !g.monsters.some((m) => m.isGoalTarget),
    );
  }
}

// ─── 31. Par-for-score bonus ─────────────────────────────────────────────────
// The turn limit is now a par time: clearing under it grants a score bonus that
// scales from full (instant) down to 0 (at/over par); survive levels earn none.
console.log("\n[31] Par-for-score bonus");
{
  const reach = LEVELS.find((l) => l.goal.type !== "survive")!;
  const survive = LEVELS.find((l) => l.goal.type === "survive");

  // Every assertion below is expressed RELATIVE to `CONFIG.parBonusMax`, so with
  // the dial at 0 they all read `0 === 0` and the whole section passes while the
  // reward is switched off (found by mutation audit). Anchor it absolutely first.
  check(
    "the par bonus is actually worth something",
    CONFIG.parBonusMax > 0 && levelParBonus(reach, 0) > 0,
    `(max ${CONFIG.parBonusMax})`,
  );
  check(
    "an instant clear earns ~the full par bonus",
    levelParBonus(reach, 0) === CONFIG.parBonusMax,
  );
  check(
    "clearing at par earns nothing",
    levelParBonus(reach, reach.turnLimit) === 0,
  );
  check(
    "clearing past par earns nothing (never negative)",
    levelParBonus(reach, reach.turnLimit + 200) === 0,
  );
  check(
    "clearing at half par earns ~half the bonus",
    Math.abs(
      levelParBonus(reach, Math.floor(reach.turnLimit / 2)) -
        CONFIG.parBonusMax / 2,
    ) <= 1,
  );
  if (survive)
    check(
      "survive levels earn no par bonus (spending turns is the goal)",
      levelParBonus(survive, 1) === 0,
    );
}

// ─── 32. Traps are always avoidable (never the only path) ───────────────────
// Fairness: every tile the player can walk to must be reachable WITHOUT stepping
// on a trap, so a trap is never a forced toll on the sole route — only a risk
// you can route around. Checked across all levels × several seeds.
console.log("\n[32] Traps never block the sole path");
{
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const seeds = [
    "s1",
    "s2",
    "trap-check",
    "xyzzy",
    "blackwood",
    "999",
    "abc",
    "q7",
  ];
  let bad = 0;
  let checked = 0;
  let withTraps = 0;
  for (let li = 0; li < LEVELS.length; li++) {
    for (const seed of seeds) {
      const g = beginLevel(seed, li, createPlayer());
      const w = g.map.width;
      const s = idx(g.player.x, g.player.y, w);
      if (g.map.tiles.some((t) => t === "trap")) withTraps++;
      // flood allowing traps, and flood blocking traps
      const flood = (blockTraps: boolean) => {
        const seen = new Set<number>([s]);
        const q = [s];
        while (q.length) {
          const c = q.shift()!;
          const cx = c % w;
          const cy = Math.floor(c / w);
          for (const [dx, dy] of dirs) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (!isWalkable(g.map, nx, ny)) continue;
            const ni = ny * w + nx;
            if (seen.has(ni)) continue;
            if (blockTraps && g.map.tiles[ni] === "trap") continue;
            seen.add(ni);
            q.push(ni);
          }
        }
        return seen;
      };
      const walk = flood(false);
      const free = flood(true);
      // every non-trap tile the player can walk to must be reachable trap-free
      for (const i of walk) {
        if (g.map.tiles[i] === "trap") continue;
        if (!free.has(i)) {
          bad++;
          break;
        }
      }
      checked++;
    }
  }
  check(
    `every walkable tile is reachable without stepping on a trap (${checked} level×seed, ${withTraps} had traps)`,
    bad === 0,
  );
}

// ─── 33. Interactive doors ──────────────────────────────────────────────────
console.log("\n[33] Interactive doors");
{
  // (a) door-count levels generate open doors at chokepoints
  let withDoors = 0;
  for (const seed of ["s1", "s2", "s3", "door", "xyzzy", "999"]) {
    const g = beginLevel(seed, 4, createPlayer()); // iron_gate: doorCount 3
    if (g.map.tiles.some((t) => t === "doorOpen")) withDoors++;
  }
  check("door-count levels generate open doors", withDoors > 0);

  // (b) close → blocks move + sight; bump → reopens (without moving onto it)
  const g = beginLevel("door-mech", 0, createPlayer());
  g.monsters = [];
  const w = g.map.width;
  const p = g.player;
  const nb = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
    .find(
      (c) =>
        tileAt(g.map, c.x, c.y) === "floor" &&
        !g.items.some((it) => it.x === c.x && it.y === c.y),
    )!;
  g.map.tiles[idx(nb.x, nb.y, w)] = "doorOpen";

  const r1 = resolveTurn(g, { type: "closeDoor" }, new Rng(1));
  check(
    "closing shuts the adjacent open door",
    tileAt(g.map, nb.x, nb.y) === "door" && r1.tookTurn,
  );
  check("a shut door blocks movement", !isWalkable(g.map, nb.x, nb.y));
  check("a shut door blocks sight", !isTransparent(g.map, nb.x, nb.y));

  const r2 = resolveTurn(
    g,
    { type: "move", dx: nb.x - p.x, dy: nb.y - p.y },
    new Rng(2),
  );
  check(
    "bumping a shut door opens it",
    tileAt(g.map, nb.x, nb.y) === "doorOpen" && r2.tookTurn,
  );
  check(
    "opening a door doesn't move you onto it",
    g.player.x === p.x && g.player.y === p.y,
  );
}

// ─── 34. Character classes (kits + passives) ────────────────────────────────
console.log("\n[34] Character classes");
{
  const warrior = createPlayer("warrior");
  check(
    "class kit equips its weapon + armor",
    warrior.weaponId === "w_short" && warrior.armorId === "a_leather",
  );
  check("class sets its own maxHp", warrior.maxHp === 26 && warrior.hp === 26);
  check(
    "class grants its starting bag",
    warrior.bag.some((b) => b.defId === "p_heal"),
  );
  check("classId is recorded on the player", warrior.classId === "warrior");

  const pyro = createPlayer("pyromancer");
  check(
    "Pyromancer starts with bow + arrows + bombs",
    pyro.weaponId === "w_bow" &&
      pyro.bag.some((b) => b.defId === "am_arrow") &&
      pyro.bag.some((b) => b.defId === "p_bomb"),
  );

  // passive: Warrior damage reduction (via the shared `mitigate` choke point)
  check("Warrior shaves 1 off an incoming hit", mitigate(warrior, 10) === 9);
  check(
    "the plain baseline takes full damage",
    mitigate(createPlayer("wanderer"), 10) === 10,
  );

  // passive: the Rogue's bigger sneak multiplier out-damages the baseline (same
  // dagger, so only the ×3-vs-×2 sneak — plus any crit — differs)
  const sneakDmg = (classId: string): number => {
    const g = beginLevel("cls-sneak", 0, createPlayer(classId));
    const p = g.player;
    const nb = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
      .find((c) => isWalkable(g.map, c.x, c.y))!;
    g.monsters = [
      { id: "t", defId: "skeleton", x: nb.x, y: nb.y, hp: 999, state: "idle" },
    ];
    resolveTurn(
      g,
      { type: "move", dx: nb.x - p.x, dy: nb.y - p.y },
      new Rng(5),
    );
    const m = g.monsters.find((x) => x.id === "t");
    return 999 - (m ? m.hp : 999);
  };
  check(
    "Rogue's sneak strike out-damages the plain baseline",
    sneakDmg("rogue") > sneakDmg("wanderer"),
  );
}

// ─── 35. Forage (heal tiles) ────────────────────────────────────────────────
console.log("\n[35] Forage heal tiles");
{
  const orthoFloor = (g: ReturnType<typeof beginLevel>) => {
    const p = g.player;
    return [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
      .find((c) => tileAt(g.map, c.x, c.y) === "floor")!;
  };

  // (a) forage-count levels grow forage tiles
  let withForage = 0;
  for (const seed of ["s1", "s2", "s3", "f1", "f2"]) {
    const g = beginLevel(seed, 1, createPlayer()); // blackwood: forageCount 6
    if (g.map.tiles.some((t) => t === "forage")) withForage++;
  }
  check("forage-count levels grow forage tiles", withForage > 0);

  // (b) stepping on forage heals (capped) and spends the tile to floor
  {
    const g = beginLevel("forage-mech", 0, createPlayer());
    g.monsters = [];
    const w = g.map.width;
    const p = g.player;
    const nb = orthoFloor(g);
    g.map.tiles[idx(nb.x, nb.y, w)] = "forage";
    p.hp = p.maxHp - 5;
    const before = p.hp;
    resolveTurn(
      g,
      { type: "move", dx: nb.x - p.x, dy: nb.y - p.y },
      new Rng(1),
    );
    check(
      "stepping on forage heals (never past max)",
      g.player.hp > before && g.player.hp <= g.player.maxHp,
    );
    check("forage is spent to floor", tileAt(g.map, nb.x, nb.y) === "floor");
  }

  // (c) at full HP it's left untouched — no waste
  {
    const g = beginLevel("forage-full", 0, createPlayer());
    g.monsters = [];
    const w = g.map.width;
    const p = g.player;
    const nb = orthoFloor(g);
    g.map.tiles[idx(nb.x, nb.y, w)] = "forage";
    p.hp = p.maxHp;
    resolveTurn(
      g,
      { type: "move", dx: nb.x - p.x, dy: nb.y - p.y },
      new Rng(2),
    );
    check(
      "forage is left untouched at full HP",
      tileAt(g.map, nb.x, nb.y) === "forage" && g.player.hp === g.player.maxHp,
    );
  }
}

// ─── 36. Levitation & Emberstep potions ─────────────────────────────────────
console.log("\n[36] Levitation & Emberstep");
{
  const adjFloor = (g: ReturnType<typeof beginLevel>) => {
    const p = g.player;
    return [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
      .find((c) => tileAt(g.map, c.x, c.y) === "floor")!;
  };

  // (a) levitation glides onto water; without it, water blocks
  {
    const g = beginLevel("levit-a", 0, createPlayer());
    g.monsters = [];
    const w = g.map.width;
    const p = g.player;
    const nb = adjFloor(g);
    g.map.tiles[idx(nb.x, nb.y, w)] = "water";
    p.effects.levitate = 5;
    const r = resolveTurn(
      g,
      { type: "move", dx: nb.x - p.x, dy: nb.y - p.y },
      new Rng(1),
    );
    check(
      "levitation glides onto water",
      r.tookTurn && g.player.x === nb.x && g.player.y === nb.y,
    );

    const g2 = beginLevel("levit-a", 0, createPlayer());
    g2.monsters = [];
    const p2 = g2.player;
    const nb2 = adjFloor(g2);
    g2.map.tiles[idx(nb2.x, nb2.y, g2.map.width)] = "water";
    resolveTurn(
      g2,
      { type: "move", dx: nb2.x - p2.x, dy: nb2.y - p2.y },
      new Rng(1),
    );
    check(
      "without levitation water blocks the step",
      g2.player.x !== nb2.x || g2.player.y !== nb2.y,
    );
  }

  // (b) levitation floats over a trap without springing it
  {
    const g = beginLevel("levit-b", 0, createPlayer());
    g.monsters = [];
    const w = g.map.width;
    const p = g.player;
    const nb = adjFloor(g);
    g.map.tiles[idx(nb.x, nb.y, w)] = "trap";
    p.effects.levitate = 5;
    p.hp = p.maxHp;
    resolveTurn(
      g,
      { type: "move", dx: nb.x - p.x, dy: nb.y - p.y },
      new Rng(1),
    );
    check(
      "levitation floats over a trap unsprung",
      g.player.hp === g.player.maxHp && tileAt(g.map, nb.x, nb.y) === "trap",
    );
  }

  // (c) emberstep: standing in fire applies no burn / damage
  {
    const g = beginLevel("ember-c", 0, createPlayer());
    g.monsters = [];
    const p = g.player;
    g.fireTiles.push({ i: idx(p.x, p.y, g.map.width), life: 3 });
    p.effects.emberstep = 5;
    p.hp = p.maxHp;
    resolveTurn(g, { type: "wait" }, new Rng(1));
    check(
      "emberstep: fire doesn't sear you",
      (g.player.effects.burn ?? 0) === 0 && g.player.hp === g.player.maxHp,
    );
  }

  // (d) levitation lapsing over water scrambles you to solid ground
  {
    const g = beginLevel("levit-d", 0, createPlayer());
    g.monsters = [];
    const w = g.map.width;
    const p = g.player;
    const px = p.x;
    const py = p.y;
    g.map.tiles[idx(px, py, w)] = "water"; // simulate standing mid-lake
    p.effects.levitate = 1;
    resolveTurn(g, { type: "wait" }, new Rng(1));
    check(
      "levitation lapsing over water shunts you to land",
      tileAt(g.map, g.player.x, g.player.y) !== "water" &&
        (g.player.x !== px || g.player.y !== py),
    );
  }
}

// ─── 37. Frostwalk / Shadowcloak / Blink ────────────────────────────────────
console.log("\n[37] Frostwalk / Shadow / Blink");
{
  const adjFloor = (g: ReturnType<typeof beginLevel>) => {
    const p = g.player;
    return [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
      .find((c) => tileAt(g.map, c.x, c.y) === "floor")!;
  };

  // (a) frostwalk freezes water you step onto into a walkable ice bridge
  {
    const g = beginLevel("frost-a", 0, createPlayer());
    g.monsters = [];
    const w = g.map.width;
    const p = g.player;
    const nb = adjFloor(g);
    g.map.tiles[idx(nb.x, nb.y, w)] = "water";
    p.effects.frostwalk = 5;
    resolveTurn(
      g,
      { type: "move", dx: nb.x - p.x, dy: nb.y - p.y },
      new Rng(1),
    );
    check(
      "frostwalk freezes water into a walkable ice bridge",
      tileAt(g.map, nb.x, nb.y) === "ice" &&
        g.player.x === nb.x &&
        g.player.y === nb.y,
    );
  }

  // (b) shadow shrinks monster detection — a goblin 3 tiles off (sight 6) won't
  // spot a shadowed player, but does without it
  {
    const spotAt3 = (shadowed: boolean): string => {
      const g = beginLevel("shadow-b", 0, createPlayer());
      const w = g.map.width;
      const p = g.player;
      p.baseLightRadius = 8;
      p.lightRadius = 8;
      const dir = p.x < w - 6 ? 1 : -1; // carve a clear line with room
      for (let k = 1; k <= 4; k++)
        g.map.tiles[idx(p.x + dir * k, p.y, w)] = "floor";
      g.monsters = [
        {
          id: "m",
          defId: "goblin",
          x: p.x + dir * 3,
          y: p.y,
          hp: 20,
          state: "idle",
        },
      ];
      if (shadowed) p.effects.shadow = 5;
      resolveTurn(g, { type: "wait" }, new Rng(1));
      return g.monsters.find((m) => m.id === "m")?.state ?? "gone";
    };
    check(
      "shadow keeps a monster 3 tiles off from spotting you",
      spotAt3(true) === "idle",
    );
    check(
      "without shadow it spots you and gives chase",
      spotAt3(false) === "chase",
    );
  }

  // (c) blink teleports to a chosen tile in range + spends the phial; invalid
  // targets (a wall) are refused with no turn spent
  {
    const g = beginLevel("blink-c", 0, createPlayer());
    g.monsters = [];
    const p = g.player;
    p.bag.push({ defId: "p_blink", count: 1 });
    let dest: { x: number; y: number } | null = null;
    let wall: { x: number; y: number } | null = null;
    for (
      let dy = -CONFIG.blinkRange;
      dy <= CONFIG.blinkRange && (!dest || !wall);
      dy++
    ) {
      for (let dx = -CONFIG.blinkRange; dx <= CONFIG.blinkRange; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = p.x + dx;
        const y = p.y + dy;
        if (!tileAt(g.map, x, y)) continue;
        if (!dest && tileAt(g.map, x, y) === "floor") dest = { x, y };
        if (!wall && tileAt(g.map, x, y) === "wall") wall = { x, y };
      }
    }
    const r = resolveTurn(
      g,
      { type: "blinkTo", defId: "p_blink", x: dest!.x, y: dest!.y },
      new Rng(1),
    );
    check(
      "blink teleports to the chosen tile + spends the phial",
      r.tookTurn &&
        g.player.x === dest!.x &&
        g.player.y === dest!.y &&
        !g.player.bag.some((b) => b.defId === "p_blink"),
    );

    const g2 = beginLevel("blink-c", 0, createPlayer());
    g2.monsters = [];
    g2.player.bag.push({ defId: "p_blink", count: 1 });
    const r2 = resolveTurn(
      g2,
      { type: "blinkTo", defId: "p_blink", x: wall!.x, y: wall!.y },
      new Rng(1),
    );
    check(
      "blink into a wall is refused (no turn, phial kept)",
      !r2.tookTurn && g2.player.bag.some((b) => b.defId === "p_blink"),
    );
  }
}

// ─── 38. Stealth: alerted monsters lose interest ────────────────────────────
console.log("\n[38] Lose-interest (break contact to shake pursuers)");
{
  const adjFloor = (g: ReturnType<typeof beginLevel>) => {
    const p = g.player;
    return [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
      .find((c) => tileAt(g.map, c.x, c.y) === "floor")!;
  };
  // run an alerted goblin for the give-up window under a given light radius,
  // return its final state
  const chaseThenWait = (light: number): string => {
    const g = beginLevel("lose-38", 0, createPlayer());
    const p = g.player;
    p.hp = 9999;
    p.maxHp = 9999;
    p.baseLightRadius = light;
    p.lightRadius = light;
    const nb = adjFloor(g);
    g.monsters = [
      {
        id: "m",
        defId: "goblin",
        x: nb.x,
        y: nb.y,
        hp: 20,
        state: "chase",
        lostTurns: 0,
      },
    ];
    for (let i = 0; i <= CONFIG.loseInterestTurns; i++)
      resolveTurn(g, { type: "wait" }, new Rng(1 + i));
    return g.monsters.find((m) => m.id === "m")?.state ?? "gone";
  };
  // pitch dark (light 0) → it can't detect you → gives up after the window
  check(
    "an alerted monster gives up once it can't detect you",
    chaseThenWait(0) === "idle",
  );
  // still lit → keeps seeing you → stays on the hunt
  check(
    "it stays chasing while it can still see you",
    chaseThenWait(8) === "chase",
  );
}

// ─── 39. Class active abilities ([q]) ───────────────────────────────────────
console.log("\n[39] Class abilities");
{
  // Warrior — Cleave: one use hits EVERY adjacent monster + goes on cooldown,
  // and can't be re-used while cooling down.
  const g = beginLevel("ability-cleave", 0, createPlayer("warrior"));
  const p = g.player;
  p.hp = 9999;
  p.maxHp = 9999;
  const adj = [
    { x: p.x + 1, y: p.y },
    { x: p.x - 1, y: p.y },
    { x: p.x, y: p.y + 1 },
    { x: p.x, y: p.y - 1 },
  ].filter((n) => isWalkable(g.map, n.x, n.y));
  g.monsters = adj.slice(0, 2).map((n, i) => ({
    id: `cl${i}`,
    defId: "skeleton",
    x: n.x,
    y: n.y,
    hp: 30,
    state: "chase" as const,
  }));
  const hp0 = g.monsters.map((m) => m.hp);
  const res = resolveTurn(g, { type: "ability" }, new Rng(1));
  check("cleave takes the turn", res.tookTurn);
  // checkOver: fails if the arena setup produced no adjacent monsters (an empty
  // `.every()` would otherwise pass having verified nothing)
  checkOver(
    "cleave damages every adjacent monster",
    g.monsters,
    (m, i) => m.hp < hp0[i],
  );
  check("cleave sets the cooldown", g.player.abilityCooldown === 5);
  const hp1 = g.monsters.map((m) => m.hp);
  const res2 = resolveTurn(g, { type: "ability" }, new Rng(2));
  check("ability refused while on cooldown (no turn)", !res2.tookTurn);
  checkOver(
    "ability on cooldown deals no damage",
    g.monsters,
    (m, i) => m.hp === hp1[i],
  );

  // Rogue — Dash: leaps in a clear direction (player repositions).
  {
    const gd = beginLevel("ability-dash", 1, createPlayer("rogue"));
    const pd = gd.player;
    gd.monsters = [];
    // find a cardinal with ≥1 clear tile
    const dir = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].find(([dx, dy]) => isWalkable(gd.map, pd.x + dx, pd.y + dy));
    if (dir) {
      const [dx, dy] = dir;
      const x0 = pd.x;
      const y0 = pd.y;
      const rd = resolveTurn(gd, { type: "ability", dx, dy }, new Rng(3));
      check("dash takes the turn", rd.tookTurn);
      check(
        "dash moves the player along the aim",
        (gd.player.x !== x0 || gd.player.y !== y0) &&
          Math.sign(gd.player.x - x0) === dx &&
          Math.sign(gd.player.y - y0) === dy,
      );
      check("dash sets the cooldown", gd.player.abilityCooldown === 4);
    } else {
      check("dash test setup found a clear direction", false);
    }
  }

  // Pyromancer — Scorch: a directional cone lights fire tiles.
  {
    const gs = beginLevel("ability-scorch", 0, createPlayer("pyromancer"));
    const ps = gs.player;
    gs.monsters = [];
    gs.fireTiles = [];
    const dir = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].find(([dx, dy]) => isWalkable(gs.map, ps.x + dx, ps.y + dy));
    const [dx, dy] = dir ?? [1, 0];
    const rs = resolveTurn(gs, { type: "ability", dx, dy }, new Rng(4));
    check("scorch takes the turn", rs.tookTurn);
    check("scorch ignites fire tiles ahead", gs.fireTiles.length > 0);
    check("scorch sets the cooldown", gs.player.abilityCooldown === 6);
  }
}

// ─── 40. Run modifiers (mutators) ────────────────────────────────────────────
console.log("\n[40] Run modifiers");
{
  const base = LEVELS.find((l) => l.id === "blackwood")!;
  const dark = applyLevelMutators(base, ["dark"]);
  check(
    "dark cuts the light radius",
    dark.baseLightRadius === base.baseLightRadius - 2,
  );
  const swarm = applyLevelMutators(base, ["swarm"]);
  check(
    "swarm raises the monster budget",
    swarm.monsterBudget > base.monsterBudget,
  );
  const forsaken = applyLevelMutators(base, ["forsaken"]);
  check(
    "forsaken removes forage heals and thins item drops",
    forsaken.forageCount === 0 && forsaken.itemDropCount < base.itemDropCount,
  );
  const treach = applyLevelMutators(base, ["treacherous"]);
  check(
    "treacherous doubles the traps",
    (treach.trapCount ?? 0) === (base.trapCount ?? 0) * 2 &&
      (treach.trapCount ?? 0) > 0,
  );

  // Champions' `max(0.3, …)` FLOOR is the whole reason it works on the levels
  // that declare no eliteChance at all (the Pit, the Blackwood, the Throne) —
  // a bare `× 2` would leave those three untouched by the trial they paid score
  // for. Assert both halves: the floor, and the raise on a level that has one.
  const champ = applyLevelMutators(base, ["champions"]);
  check(
    "champions lifts elite chance on a level that declares none",
    base.eliteChance === undefined && (champ.eliteChance ?? 0) >= 0.3,
  );
  const mire = LEVELS.find((l) => l.id === "the_mire")!;
  const champMire = applyLevelMutators(mire, ["champions"]);
  check(
    "champions raises an existing elite chance (and stays capped)",
    (champMire.eliteChance ?? 0) > (mire.eliteChance ?? 0) &&
      (champMire.eliteChance ?? 0) <= 0.5,
  );

  check(
    "an unknown mutator id is a no-op",
    applyLevelMutators(base, ["nope"]) === base,
  );

  // The invariant that makes trials work at all: `applyLevelMutators` runs at
  // exactly ONE site (`beginLevel`), so a mutation only lands if the field is
  // consumed during GENERATION. ~30 other sites re-read the raw `LEVELS[...]`
  // entry (goals, maybeReinforce, levelParBonus, the HUD, the renderer) and
  // would ignore it. Locking the touched-key set turns "my new trial does
  // nothing and I can't tell why" into a named failure here.
  const GEN_TIME_FIELDS = new Set([
    "baseLightRadius",
    "monsterBudget",
    "itemDropCount",
    "eliteChance",
    "trapCount",
    "waterCount",
    "chasmCount",
    "oilCount",
    "sporeVentCount",
    "crackedWallCount",
    "doorCount",
    "forageCount",
    "altarCount",
    "loreCount",
  ]);
  checkOver(
    "trials only touch generation-time fields (runtime readers see raw LEVELS)",
    MUTATORS.filter((m) => m.applyLevel).flatMap((m) =>
      LEVELS.map((l) => ({ m, l })),
    ),
    ({ m, l }) => {
      const before = l as unknown as Record<string, unknown>;
      const after = m.applyLevel!(l) as unknown as Record<string, unknown>;
      for (const k of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ])) {
        if (GEN_TIME_FIELDS.has(k)) continue;
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k]))
          return false;
      }
      return true;
    },
  );

  // Drift guard. A multiplicative trial silently becomes DEAD CONTENT the moment
  // its base field is 0/absent on some level — the picker still charges score for
  // it, but that floor plays identically. Levels do lose fields as they're
  // redesigned (the Iron Gate's cull goal went away mid-development), so pin it:
  // every trial must measurably change every level.
  //
  // Compares the generation-time fields with absent NORMALIZED to 0, because a
  // bare `eliteChance: (c.eliteChance ?? 0) * 2` writes a literal 0 over an
  // `undefined` — a different OBJECT that generates an identical level. Raw JSON
  // equality calls that a change; the player can't. (The key-lock check above is
  // what licenses looking at only these fields.)
  const genFingerprint = (c: (typeof LEVELS)[number]) => {
    const r = c as unknown as Record<string, unknown>;
    return JSON.stringify([...GEN_TIME_FIELDS].sort().map((k) => r[k] ?? 0));
  };
  checkOver(
    "every trial measurably changes every level's generation",
    MUTATORS.filter((m) => m.applyLevel).flatMap((m) =>
      LEVELS.map((l) => ({ m, l })),
    ),
    ({ m, l }) => genFingerprint(m.applyLevel!(l)) !== genFingerprint(l),
  );

  check("no mutators → ×1 score", mutatorScoreMult([]) === 1);
  check(
    "mutators raise the score multiplier",
    mutatorScoreMult(["dark", "swarm"]) > 1,
  );

  const gp = createPlayer("warrior");
  applyPlayerMutators(gp, ["glass"]);
  check("glass drops starting lives to 1", gp.lives === 1);

  // beginLevel threads the ids onto state AND applies them to the config
  const g = beginLevel("mut-seed", 1, createPlayer("warrior"), ["dark"]);
  check("beginLevel records the active mutators", g.mutators.includes("dark"));
  check(
    "beginLevel applies the level mutator (dimmer light)",
    g.player.baseLightRadius === base.baseLightRadius - 2,
  );
  // a mutated level still generates a reachable exit/objective (guarantees hold)
  const g2 = beginLevel("mut-seed", 0, createPlayer("warrior"), [
    "swarm",
    "treacherous",
    "forsaken",
  ]);
  check(
    "a heavily-mutated level still has the player on a floor tile",
    isWalkable(g2.map, g2.player.x, g2.player.y),
  );
}

// ─── 41. Flood keeps altars reachable (never submerged) ─────────────────────
// Regression: an altar on a floodable tile drowned into water but still rendered
// its glyph — a stranded `+` you couldn't step on. Altars must be protected.
console.log("\n[41] Flood never submerges an altar");
{
  const floodLevels = LEVELS.map((l, i) => [l, i] as const).filter(
    ([l]) => l.flood && (l.altarCount ?? 0) > 0,
  );
  let bad = 0;
  let checkedAltars = 0;
  for (const [, li] of floodLevels) {
    for (const seed of ["u1", "u2", "u3", "abc", "777", "flood9"]) {
      const g = beginLevel(seed, li, createPlayer());
      const floodable = new Set(g.floodable ?? []);
      for (const a of g.altars) {
        checkedAltars++;
        const ai = idx(a.x, a.y, g.map.width);
        // an altar tile must not be marked floodable, and must be walkable now
        if (floodable.has(ai) || !isWalkable(g.map, a.x, a.y)) bad++;
      }
    }
  }
  check(
    `no altar on a flood level is ever floodable (${checkedAltars} altars across ${floodLevels.length} level(s)×6 seeds)`,
    bad === 0,
    `(${bad} altars would submerge)`,
  );
}

// ─── 42. Flood respects doors (close one to wall off the water) ─────────────
// Water flows THROUGH an open door but a door pulled shut ([c]) holds it back —
// player agency against getting boxed in by the rising flood.
console.log("\n[42] Flood: open door conducts water, closed door blocks it");
{
  const ci = levelIndexBy("sunken_crypt", (l) => l.id === "sunken_crypt");
  const flood = LEVELS[ci].flood!;
  // hand-built patch: water — door — floor in a row; tick one flood step and see
  // whether the water crosses the door tile.
  const runFloodStep = (doorClosed: boolean): string => {
    const g = beginLevel("door-flood", ci, createPlayer());
    g.monsters = [];
    g.player.hp = g.player.maxHp = 1e9;
    const w = g.map.width;
    g.player.x = w - 4;
    g.player.y = g.map.height - 4; // well away from the patch
    const y = 5;
    const a = idx(3, y, w);
    const b = idx(4, y, w);
    const c = idx(5, y, w);
    g.map.tiles[a] = "water"; // the advancing flood
    g.map.tiles[b] = doorClosed ? "door" : "doorOpen";
    g.map.tiles[c] = "floor";
    g.floodable = [b, c]; // only the door + tile beyond may flood
    g.floodSeeds = [];
    g.floodStep = 1; // spread phase (step 0 seeds the origins)
    g.turnCount = flood.startTurn - 1; // → a flood tick fires on this turn
    resolveTurn(g, { type: "wait" }, new Rng(1));
    return g.map.tiles[b];
  };
  check("water flows through an OPEN door", runFloodStep(false) === "water");
  check("a CLOSED door holds the water back", runFloodStep(true) === "door");
}

// ─── 43. Every placed item is reachable ─────────────────────────────────────
// Regression: freestanding-structure / secret-vault loot could strand in a
// floor component the player never reaches (huts placed off the main
// component, or a `floorComponentFrom` mismatch). [8] only checks OBJECTIVES;
// this checks ALL items — walking from the player over everything you can
// traverse OR open/break (doors + cracked walls), mirroring `isOpenTile`.
console.log("\n[43] Every placed item is reachable (incl. gated loot)");
{
  const OPEN = new Set<string>([
    "floor",
    "doorOpen",
    "door", // openable
    "exit",
    "trap",
    "trapSprung",
    "oil",
    "forage",
    "ice",
    "glowcap",
    "bramble", // walkable (snags you)
    "sporeVent", // walkable (gasses you)
    "crackedWall", // breakable
  ]);
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const seeds = ["u1", "u2", "u3", "abc", "777", "hamlet", "vault", "999"];
  let stranded = 0;
  let checkedItems = 0;
  for (let li = 0; li < LEVELS.length; li++) {
    for (const seed of seeds) {
      const g = beginLevel(seed, li, createPlayer());
      const w = g.map.width;
      const h = g.map.height;
      const seen = new Uint8Array(w * h);
      const start = idx(g.player.x, g.player.y, w);
      seen[start] = 1;
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop()!;
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        for (const [dx, dy] of dirs) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (seen[ni] || !OPEN.has(g.map.tiles[ni])) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      for (const it of g.items) {
        checkedItems++;
        if (!seen[idx(it.x, it.y, w)]) stranded++;
      }
    }
  }
  check(
    `no item is stranded unreachable (${checkedItems} items across ${seeds.length}×${LEVELS.length})`,
    stranded === 0,
    `(${stranded} unreachable — a hut/vault sealed off its loot?)`,
  );
}

// ─── 44. Chasm — Levitation glides it, but Rimewalk can't bridge a void ──────
// A chasm is like water (impassable, shove-kill, levitate-glide) EXCEPT it can't
// be frozen into an ice bridge — only Levitation crosses it.
console.log("\n[44] Chasm: Levitation glides, Rimewalk cannot bridge");
{
  // hand-built arena: player on floor, chasm to the east, water to the west
  const setup = () => {
    const g = beginLevel("chasm-test", 0, createPlayer());
    g.monsters = [];
    g.player.hp = g.player.maxHp = 1e9;
    const w = g.map.width;
    const px = 5;
    const py = 5;
    g.player.x = px;
    g.player.y = py;
    g.map.tiles[py * w + px] = "floor";
    g.map.tiles[py * w + (px + 1)] = "chasm";
    g.map.tiles[py * w + (px - 1)] = "water";
    return g;
  };
  const w = setup().map.width;

  const gl = setup();
  gl.player.effects.levitate = 5;
  resolveTurn(gl, { type: "move", dx: 1, dy: 0 }, new Rng(1));
  check("Levitation glides onto a chasm", gl.player.x === 6);

  const gr = setup();
  gr.player.effects.frostwalk = 5;
  resolveTurn(gr, { type: "move", dx: 1, dy: 0 }, new Rng(1));
  check(
    "Rimewalk cannot bridge a chasm (stays put, void unfrozen)",
    gr.player.x === 5 && gr.map.tiles[5 * w + 6] === "chasm",
  );

  const gw = setup();
  gw.player.effects.frostwalk = 5;
  resolveTurn(gw, { type: "move", dx: -1, dy: 0 }, new Rng(1));
  check(
    "Rimewalk still freezes water into an ice bridge (control)",
    gw.player.x === 4 && gw.map.tiles[5 * w + 4] === "ice",
  );
}

// ─── 45. Shover knockback — a gargoyle can hurl you off a ledge ──────────────
// A `knockback` monster's melee shoves you back a tile: into a chasm/water = a
// fall (a death), onto open ground = just thrown back, and Levitation saves you.
console.log("\n[45] Shover: knocked into the void = a fall (unless floating)");
{
  const px = 6;
  const py = 6;
  // gargoyle to the EAST, `behind` tile to the WEST (the shove target)
  const arena = (behind: TileType, levit = false) => {
    const g = beginLevel("brink-seed", 0, createPlayer());
    g.player.hp = g.player.maxHp = 40;
    if (levit) g.player.effects.levitate = 5;
    const w = g.map.width;
    g.player.x = px;
    g.player.y = py;
    g.map.tiles[py * w + px] = "floor";
    g.map.tiles[py * w + (px + 1)] = "floor";
    g.map.tiles[py * w + (px - 1)] = behind;
    g.monsters = [
      { id: "gg", defId: "gargoyle", x: px + 1, y: py, hp: 22, state: "chase" },
    ];
    resolveTurn(g, { type: "wait" }, new Rng(1));
    return g;
  };
  check(
    "shoved off a ledge into a chasm = a fall (dead)",
    arena("chasm").player.hp <= 0,
  );
  const shoved = arena("floor");
  check(
    "on open ground the shove just throws you back (survive)",
    shoved.player.hp > 0 && shoved.player.x === px - 1,
  );
  const flew = arena("chasm", true);
  check(
    "Levitation saves you — you drift out over the void instead of falling",
    flew.player.hp > 0 && flew.player.x === px - 1,
  );
}

// ─── 46. Bramble — thorns bleed you on entry; fire clears the thicket ────────
// Stepping onto bramble snags you (a bleed); Levitation floats over it; and a
// fire tile beside bramble spreads into it, burning the thicket to bare floor.
console.log("\n[46] Bramble: snags/bleeds you; fire clears a path");
{
  const px = 6;
  const py = 6;
  const setup = () => {
    const g = beginLevel("bramble-test", 0, createPlayer());
    g.monsters = [];
    g.player.hp = g.player.maxHp = 40;
    const w = g.map.width;
    g.player.x = px;
    g.player.y = py;
    g.map.tiles[py * w + px] = "floor";
    g.map.tiles[py * w + (px + 1)] = "bramble";
    return { g, w };
  };

  const { g: gb } = setup();
  resolveTurn(gb, { type: "move", dx: 1, dy: 0 }, new Rng(1));
  check(
    "stepping into bramble snags you (bleeding) and you stand on it",
    gb.player.x === px + 1 && (gb.player.effects.bleed ?? 0) > 0,
  );

  const { g: gl } = setup();
  gl.player.effects.levitate = 5;
  resolveTurn(gl, { type: "move", dx: 1, dy: 0 }, new Rng(1));
  check(
    "Levitation floats over the thorns — no bleed",
    gl.player.x === px + 1 && (gl.player.effects.bleed ?? 0) <= 0,
  );

  // fire adjacent to bramble spreads into it and burns it down to floor
  const { g: gf, w } = setup();
  gf.map.tiles[py * w + (px - 2)] = "floor";
  gf.player.x = px - 2; // stand clear of the fire
  gf.player.y = py;
  gf.fireTiles.push({ i: py * w + px, life: CONFIG.fire.duration });
  resolveTurn(gf, { type: "wait" }, new Rng(1));
  check(
    "fire spreads into adjacent bramble, clearing it to floor",
    gf.map.tiles[py * w + (px + 1)] === "floor" &&
      gf.fireTiles.some((t) => t.i === py * w + (px + 1)),
  );
}

// ─── 47. Spore vents — a bounded, drifting poison haze that poisons occupants ─
// A `sporeVent` seeps gas around itself each turn; standing in the haze poisons
// you, and the cloud stays bounded to a small pocket (never fills the map).
console.log("\n[47] Spore vent: seeps a bounded poison haze");
{
  const px = 8;
  const py = 8;
  const setup = () => {
    const g = beginLevel("spore-test", 0, createPlayer());
    g.monsters = [];
    g.player.hp = g.player.maxHp = 40;
    const w = g.map.width;
    // carve a clear room so the haze has open floor to fill
    for (let y = py - 3; y <= py + 3; y++)
      for (let x = px - 3; x <= px + 3; x++) g.map.tiles[y * w + x] = "floor";
    g.map.tiles[py * w + px] = "sporeVent";
    g.player.x = px + 1; // stand on a tile the vent will gas
    g.player.y = py;
    return { g, w };
  };

  // A vent SEEPS ON A DUTY CYCLE and each one is phase-offset by its own tile index,
  // so it may simply be quiet on turn 1. Run up to a full period and assert it seeps
  // at SOME point — a fixed "haze exists on turn 1" assertion passes or fails on where
  // the fixture happens to sit, which is a coin flip disguised as a test.
  const { g } = setup();
  let firstHaze = -1;
  for (let t = 0; t < CONFIG.gas.ventPeriod && firstHaze < 0; t++) {
    resolveTurn(g, { type: "wait" }, new Rng(1 + t));
    if (g.gasTiles.length > 0) firstHaze = g.turnCount;
  }
  check(
    "a vent seeps a poison haze within one duty cycle",
    firstHaze > 0,
    `(first haze on turn ${firstHaze} of ${CONFIG.gas.ventPeriod})`,
  );
  resolveTurn(g, { type: "wait" }, new Rng(2)); // standing in it now bites
  check("standing in the haze poisons you", (g.player.effects.poison ?? 0) > 0);

  // The vent TELEGRAPHS: exactly one turn before it seeps it enters `priming` and the
  // renderer swells/brightens it, so an attentive player can step out of the
  // footprint. Same contract as the lich barrage marking its tiles a turn early.
  // `ventState` is shared by `tickGas` and the renderer precisely so the warning
  // cannot drift out of step with the thing it warns about — which is what this
  // checks: every priming turn must be followed by an actually-seeping one.
  {
    const offenders: number[] = [];
    for (let t = 0; t < CONFIG.gas.ventPeriod * 6; t++)
      if (ventState(t, 0) === "priming" && ventState(t + 1, 0) !== "seeping")
        offenders.push(t);
    check(
      "a vent's warning turn is always immediately before it seeps",
      offenders.length === 0,
      offenders.length
        ? `(priming with no seep next: ${offenders.join(",")})`
        : "",
    );
    // there must BE a warning in each cycle, or the telegraph is decorative
    const cycle = Array.from({ length: CONFIG.gas.ventPeriod }, (_, t) =>
      ventState(t, 0),
    );
    check(
      "every duty cycle contains exactly one warning turn",
      cycle.filter((x) => x === "priming").length === 1,
      `(cycle: ${cycle.map((x) => x[0]).join("")})`,
    );
    // and it has to be VISIBLE — a colour-only tell on a small glyph is the mistake
    // the spore haze already made once, so the shape changes too
    check(
      "the warning state is visually distinct from an idle vent",
      SPORE_VENT_PRIMING_GLYPH !== TERRAIN_GLYPH.sporeVent &&
        colorDistance(SPORE_VENT_PRIMING_COLOR, SPORE_VENT_COLOR) > 110,
      `(glyph ${TERRAIN_GLYPH.sporeVent}→${SPORE_VENT_PRIMING_GLYPH}, distance ${colorDistance(SPORE_VENT_PRIMING_COLOR, SPORE_VENT_COLOR).toFixed(0)})`,
    );
  }

  // …and it must fall QUIET again: the haze clears completely, then returns. A
  // permanently-hazy pocket is static terrain you route around once and forget; the
  // whole point of the cycle is the timing decision (wait for clear air, or push
  // through and take the poison). Assert both halves over two full periods.
  {
    const { g: g2 } = setup();
    g2.player.x = px + 3; // stand clear so poison ticks don't end the run
    const seen: number[] = [];
    for (let t = 0; t < CONFIG.gas.ventPeriod * 2 + CONFIG.gas.ventLife; t++) {
      resolveTurn(g2, { type: "wait" }, new Rng(60 + t));
      seen.push(g2.gasTiles.length);
    }
    check(
      "the vent falls quiet — the haze clears completely and later returns",
      seen.some((n) => n === 0) && seen.some((n) => n > 0),
      `(extent over ${seen.length} turns: min ${Math.min(...seen)}, max ${Math.max(...seen)})`,
    );
    check(
      "the duty cycle leaves a real window of clear air",
      seen.filter((n) => n === 0).length >= CONFIG.gas.ventLife,
      `(${seen.filter((n) => n === 0).length} clear turns of ${seen.length})`,
    );
  }

  // The haze must PULSE, not latch. "Bounded" alone is satisfied by a frozen cloud,
  // which is exactly how a real bug hid here: `breathLife` used to equal `ventLife`,
  // so the diagonal breath ring was refreshed on precisely the turn it should have
  // expired — the pocket swelled once and then sat at full extent forever. The glyph
  // alternation is a renderer clock effect, so it still looked alive on screen.
  {
    const extents: number[] = [];
    for (let t = 0; t < CONFIG.gas.breathPeriod * 3 + 1; t++) {
      resolveTurn(g, { type: "wait" }, new Rng(30 + t));
      extents.push(g.gasTiles.length);
    }
    const lo = Math.min(...extents);
    const hi = Math.max(...extents);
    check(
      "the haze breathes — it swells and settles rather than latching",
      hi > lo,
      `(gas tiles ranged ${lo}..${hi} over ${extents.length} turns)`,
    );
    check(
      "the breath ring is shorter-lived than the core, or it can never lapse",
      CONFIG.gas.breathLife < CONFIG.gas.ventLife,
      `(breathLife ${CONFIG.gas.breathLife} vs ventLife ${CONFIG.gas.ventLife})`,
    );
  }

  // run many turns — the cloud must stay bounded (never engulf the whole room)
  for (let t = 0; t < 20; t++) resolveTurn(g, { type: "wait" }, new Rng(t + 2));
  check(
    "the haze stays bounded to a small pocket (does not fill the map)",
    g.gasTiles.length <= 12,
  );

  // levitation gives NO protection from airborne spores (unlike a chasm/water)
  const { g: gv } = setup();
  gv.player.effects.levitate = 9;
  resolveTurn(gv, { type: "wait" }, new Rng(1));
  resolveTurn(gv, { type: "wait" }, new Rng(2));
  check(
    "Levitation does NOT protect against the airborne haze",
    (gv.player.effects.poison ?? 0) > 0,
  );
}

// ─── 48. Lore props — placed, distinct, and reachable ───────────────────────
// Environmental-storytelling props sit on walkable floor, carry distinct text
// per level, and are always reachable (they live on the main component, so
// `sealUnreachable` never walls them off — a lore glyph you can't reach is dead).
console.log("\n[48] Lore props: placed, distinct, reachable");
{
  const seeds = ["u1", "u2", "abc", "777"];
  let checkedLevels = 0;
  let placedOk = true;
  let walkableOk = true;
  let reachableOk = true;
  let distinctOk = true;
  for (let li = 0; li < LEVELS.length; li++) {
    const want = LEVELS[li].loreCount ?? 0;
    if (want <= 0) continue;
    for (const seed of seeds) {
      const g = beginLevel(seed, li, createPlayer());
      checkedLevels++;
      const lore = g.lore ?? [];
      if (lore.length === 0 || lore.length > want) placedOk = false;
      const titles = new Set<string>();
      const from = { x: g.player.x, y: g.player.y };
      for (const l of lore) {
        if (!isWalkable(g.map, l.x, l.y)) walkableOk = false;
        if (bfsPath(g.map, from, { x: l.x, y: l.y }) === null)
          reachableOk = false;
        titles.add(l.title);
      }
      if (titles.size !== lore.length) distinctOk = false; // no dupes in a level
    }
  }
  check(`lore props placed on ${checkedLevels} lore levels`, checkedLevels > 0);
  check("lore count is within the level's loreCount (and non-empty)", placedOk);
  check("every lore prop sits on a walkable tile", walkableOk);
  check("every lore prop is reachable from the player", reachableOk);
  check("lore fragments are distinct within a level", distinctOk);
}

// ─── 49. Ambient wisps — harmless wildlife: flee, never attack, disperse ─────
// A will-o'-wisp (behavior "ambient") is placed outside the combat budget,
// flees when you approach, deals no damage, and winks out harmlessly if caught
// (no combat / coins / kill credit).
console.log("\n[49] Ambient wisps: placed, flee, harmless, disperse on touch");
{
  const bwi = levelIndexBy("blackwood", (l) => l.id === "blackwood");
  let hasWisps = false;
  for (const seed of ["a", "b", "c"]) {
    const g = beginLevel(seed, bwi, createPlayer());
    if (g.monsters.some((m) => MONSTERS[m.defId].behavior === "ambient"))
      hasWisps = true;
  }
  check("the Blackwood spawns ambient wisps", hasWisps);

  // every level that declares `ambient` species actually spawns them (its
  // exact monsterIds, outside the combat budget) across a few seeds
  // flatten to (level, species) pairs so checkOver can assert we tested a
  // non-empty set — otherwise removing every `ambient:` entry would pass green
  const ambientSpecs = LEVELS.flatMap((l, li) =>
    (l.ambient ?? []).map((spec) => ({ li, spec })),
  );
  checkOver(
    "every level's declared ambient species get placed",
    ambientSpecs,
    ({ li, spec }) =>
      ["a", "b", "c"].some((seed) =>
        beginLevel(seed, li, createPlayer()).monsters.some(
          (m) => m.defId === spec.monsterId,
        ),
      ),
  );

  const px = 8;
  const py = 8;
  const arena = () => {
    const g = beginLevel("wisp-seed", 0, createPlayer());
    g.player.hp = g.player.maxHp = 40;
    const w = g.map.width;
    g.player.x = px;
    g.player.y = py;
    for (let y = py - 4; y <= py + 4; y++)
      for (let x = px - 4; x <= px + 4; x++) g.map.tiles[y * w + x] = "floor";
    return { g, w };
  };

  // flee: a wisp within its shy radius never closes to attack range
  {
    const { g } = arena();
    g.monsters = [
      { id: "wsp", defId: "wisp", x: px + 2, y: py, hp: 1, state: "idle" },
    ];
    let minDist = 2;
    for (let t = 0; t < 5; t++) {
      resolveTurn(g, { type: "wait" }, new Rng(t + 1));
      const wsp = g.monsters[0];
      if (wsp)
        minDist = Math.min(
          minDist,
          Math.abs(wsp.x - g.player.x) + Math.abs(wsp.y - g.player.y),
        );
    }
    check("a wisp flees — never closes to attack range", minDist >= 2);
    check("a wisp deals no damage (player unharmed)", g.player.hp === 40);
  }

  // disperse: bumping a wisp removes it — no damage, coins, or kill credit
  {
    const { g } = arena();
    g.monsters = [
      { id: "wsp", defId: "wisp", x: px + 1, y: py, hp: 1, state: "idle" },
    ];
    const coins0 = g.player.coins;
    const kills0 = g.levelKills;
    resolveTurn(g, { type: "move", dx: 1, dy: 0 }, new Rng(1));
    check("bumping a wisp disperses it (removed)", g.monsters.length === 0);
    check("dispersing a wisp is harmless (no hp loss)", g.player.hp === 40);
    check(
      "dispersing a wisp gives no coins / kill credit",
      g.player.coins === coins0 && g.levelKills === kills0,
    );
    check("bumping a wisp does not move the player onto it", g.player.x === px);
  }
}

// ─── 50. Gallery generator — niche offerings + varied collapsed pit ──────────
// The Antechamber's `gallery` places "offering" caches in niche DEAD-ENDS (incl.
// cracked-wall-gated ones), and drops a ragged COLLAPSED chasm pit on ~half of
// seeds (varied, and — being kept interior — it never severs the hall; [28]/[43]
// already guarantee full reachability, so here we assert the gallery-specific
// bits: offerings reach the niches, and the pit genuinely varies run to run).
console.log("\n[50] Gallery: niche offerings + varied collapsed pit");
{
  const ai = levelIndexBy("antechamber", (l) => l.id === "antechamber");
  const deadEndOpen = (map: GameMap, i: number) => {
    const w = map.width;
    const passish = (t: TileType) =>
      t === "floor" ||
      t === "doorOpen" ||
      t === "exit" ||
      t === "oil" ||
      t === "forage" ||
      t === "ice" ||
      t === "crackedWall";
    let n = 0;
    if (passish(map.tiles[i - w])) n++;
    if (passish(map.tiles[i + w])) n++;
    if (passish(map.tiles[i - 1])) n++;
    if (passish(map.tiles[i + 1])) n++;
    return n;
  };
  const seeds = ["a", "b", "c", "d", "e", "f", "g", "h"];
  let pitSeeds = 0;
  let anyOfferingInNiche = false;
  for (const seed of seeds) {
    const g = beginLevel(seed, ai, createPlayer());
    if (g.map.tiles.some((t) => t === "chasm")) pitSeeds++;
    // at least one item tucked in a dead-end nook = an offering landed in a niche
    const w = g.map.width;
    for (const it of g.items) {
      if (deadEndOpen(g.map, idx(it.x, it.y, w)) <= 1) {
        anyOfferingInNiche = true;
        break;
      }
    }
  }
  check("gallery tucks offerings into niche dead-ends", anyOfferingInNiche);
  check(
    "the collapsed pit varies per seed (present on some, absent on others)",
    pitSeeds > 0 && pitSeeds < seeds.length,
  );
}

// ─── 51. Dawn/dusk lighting beat (pure ambient transform) ────────────────────
// `beatAmbient` warms+brightens ("dawn") or dims+cools ("dusk") the ambient as
// the beat intensity `g` rises 0→1; `g=0` is a no-op. Render-side but pure.
console.log("\n[51] Dawn/dusk lighting beat: warms vs. dims by intensity");
{
  const throne = ambientForBiome("throne");
  const castle = ambientForBiome("castle");

  const same = (a: [number, number, number], b: [number, number, number]) =>
    a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  check(
    "g=0 leaves the ambient unchanged (dawn)",
    same(beatAmbient("dawn", 0, throne).center, throne.center),
  );

  const dawn = beatAmbient("dawn", 1, throne).center;
  check(
    "dawn brightens every channel toward daylight",
    dawn[0] > throne.center[0] &&
      dawn[1] > throne.center[1] &&
      dawn[2] > throne.center[2],
  );

  const dusk = beatAmbient("dusk", 1, castle).center;
  check(
    "dusk dims the overall ambient",
    dusk[0] < castle.center[0] && dusk[1] < castle.center[1],
  );
  // "holds the blue" → blue is dimmed LESS than red (reads colder as it darkens)
  const rRatio = dusk[0] / castle.center[0];
  const bRatio = dusk[2] / castle.center[2];
  check("dusk holds the blue (cools as it darkens)", bRatio > rRatio);

  // the two boss levels are actually wired to the beats
  const t = LEVELS.find((l) => l.id === "throne_of_dusk");
  const a = LEVELS.find((l) => l.id === "antechamber");
  check("the Throne is wired to the dawn beat", t?.lightingBeat === "dawn");
  check(
    "the Antechamber is wired to the dusk beat",
    a?.lightingBeat === "dusk",
  );
}

// ─── 52. Mutators still honour every generator guarantee ────────────────────
// `applyLevelMutators` reshapes the config BEFORE generation (traps, spawns,
// light, drops), so a trial could in principle break a guarantee that's only
// ever tested on UNMODIFIED configs. Run each trial (plus the all-on stack)
// across levels and re-assert the load-bearing invariants.
//
// This proves a mutated level GENERATES legally; `[P5]` in verify-playthrough
// covers the other half — that it's still actually survivable under real play.
console.log("\n[52] Mutators preserve the generator guarantees");
{
  const OPEN = new Set<string>([
    "floor",
    "doorOpen",
    "door",
    "exit",
    "trap",
    "trapSprung",
    "oil",
    "forage",
    "ice",
    "glowcap",
    "bramble",
    "sporeVent",
    "crackedWall",
  ]);
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const ids = MUTATORS.map((m) => m.id);
  const combos: string[][] = [...ids.map((i) => [i]), ids]; // each alone + all on
  const seeds = ["m1", "m2"];
  // (level, seed, combo) triples — checkOver proves we actually ran some
  const cases = combos.flatMap((combo) =>
    seeds.flatMap((seed) => LEVELS.map((_, li) => ({ combo, seed, li }))),
  );

  checkOver(
    `objectives stay reachable under every trial (${combos.length} combos)`,
    cases,
    ({ combo, seed, li }) => {
      const g = beginLevel(seed, li, createPlayer(), combo);
      const from = { x: g.player.x, y: g.player.y };
      if (g.map.exit && bfsPath(g.map, from, g.map.exit) === null) return false;
      for (const m of g.monsters)
        if (m.isGoalTarget && bfsPath(g.map, from, { x: m.x, y: m.y }) === null)
          return false;
      for (const it of g.items)
        if (it.questTag && bfsPath(g.map, from, { x: it.x, y: it.y }) === null)
          return false;
      return true;
    },
  );

  checkOver(
    "no unreachable open pockets under every trial",
    cases,
    ({ combo, seed, li }) => {
      const g = beginLevel(seed, li, createPlayer(), combo);
      const w = g.map.width;
      const h = g.map.height;
      const seen = new Uint8Array(w * h);
      const start = idx(g.player.x, g.player.y, w);
      seen[start] = 1;
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop()!;
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        for (const [dx, dy] of dirs) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (seen[ni] || !OPEN.has(g.map.tiles[ni])) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      for (let i = 0; i < g.map.tiles.length; i++)
        if (OPEN.has(g.map.tiles[i]) && !seen[i]) return false;
      return true;
    },
  );

  // Treacherous multiplies traps — the "always a trap-free route" guarantee is
  // the one most at risk, so assert it explicitly under the trap-heavy trials.
  const trapCases = cases.filter(
    (c) => c.combo.includes("treacherous") && LEVELS[c.li].trapCount,
  );
  // flood of tiles reachable WITHOUT stepping on an armed trap (as in [18])
  const trapFree = (map: GameMap, from: Pos): Set<number> => {
    const w = map.width;
    const h = map.height;
    const seen = new Set<number>([idx(from.x, from.y, w)]);
    const q = [idx(from.x, from.y, w)];
    while (q.length) {
      const cur = q.shift()!;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen.has(ni) || map.tiles[ni] === "trap") continue;
        if (!isWalkable(map, nx, ny)) continue;
        seen.add(ni);
        q.push(ni);
      }
    }
    return seen;
  };
  checkOver(
    "a trap-free route to every objective survives Treacherous",
    trapCases,
    ({ combo, seed, li }) => {
      const g = beginLevel(seed, li, createPlayer(), combo);
      const free = trapFree(g.map, { x: g.player.x, y: g.player.y });
      const w = g.map.width;
      const targets: Pos[] = [];
      if (g.map.exit) targets.push(g.map.exit);
      for (const m of g.monsters)
        if (m.isGoalTarget) targets.push({ x: m.x, y: m.y });
      for (const it of g.items)
        if (it.questTag) targets.push({ x: it.x, y: it.y });
      return targets.every((t) => free.has(idx(t.x, t.y, w)));
    },
  );
}

// ─── 53. Load-bearing invariants (found missing by a mutation audit) ────────
// These three all SURVIVED deliberate sabotage — the suite stayed green with
// the damage floor removed, poison dealing 0, and the sneak bonus deleted. Each
// is a rule the design leans on, so each now has a test that fails if it goes.
console.log("\n[53] Load-bearing invariants: damage floor, DoT, sneak bonus");
{
  // (a) The min-1 damage floor. Without it a monster whose armor meets your
  // weapon power becomes literally unkillable — the fight can never resolve.
  {
    const p = createPlayer("wanderer");
    const tank = { ...MONSTERS.skeleton, armor: 999 };
    check(
      "a player always deals ≥1 damage, however armored the target",
      playerAttackDamage(p, tank) >= 1,
      `(got ${playerAttackDamage(p, tank)})`,
    );
    const armored = createPlayer("warrior");
    armored.armorReduction = 999;
    check(
      "a monster always deals ≥1 damage, however armored the player",
      monsterAttackDamage(MONSTERS.rat, armored) >= 1,
      `(got ${monsterAttackDamage(MONSTERS.rat, armored)})`,
    );
    // and the floor really is a FLOOR — a real weapon still scales above it
    const strong = createPlayer("wanderer");
    strong.weaponPower = 20;
    check(
      "damage still scales with weapon power (the floor isn't a cap)",
      playerAttackDamage(strong, MONSTERS.skeleton) > 1,
    );
  }

  // (b) Damage-over-time actually damages. `poison`/`bleed`/`burn` are the
  // engine's armor-ignoring pressure; a 0-damage tick guts hazards silently.
  for (const kind of ["poison", "bleed", "burn"] as const) {
    const g = beginLevel("dot-seed", 0, createPlayer());
    g.monsters = [];
    const p = g.player;
    p.maxHp = 60;
    p.hp = 60;
    p.effects[kind] = 4;
    const before = p.hp;
    resolveTurn(g, { type: "wait" }, new Rng(1));
    check(
      `${kind} actually deals damage on its tick`,
      p.hp < before,
      `(hp ${before}→${p.hp})`,
    );
  }

  // (c) The sneak bonus. Striking a chaser that hasn't noticed you must hurt
  // MORE than the same blow once it's alerted — that's the whole payoff of the
  // light/stealth system.
  {
    const arena = (state: "idle" | "chase") => {
      const g = beginLevel("sneak-inv", 0, createPlayer("wanderer"));
      const p = g.player;
      p.maxHp = p.hp = 99;
      const spot = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]
        .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
        .find((c) => isWalkable(g.map, c.x, c.y))!;
      g.monsters = [
        {
          id: "t",
          defId: "skeleton",
          x: spot.x,
          y: spot.y,
          hp: 500, // survives the blow so we can read the damage dealt
          state,
        },
      ];
      resolveTurn(
        g,
        { type: "move", dx: spot.x - p.x, dy: spot.y - p.y },
        new Rng(4),
      );
      return 500 - (g.monsters[0]?.hp ?? 0);
    };
    const sneak = arena("idle");
    const alert = arena("chase");
    check(
      "striking an unaware chaser hits harder than an alerted one (sneak bonus)",
      sneak > alert,
      `(sneak ${sneak} vs alert ${alert})`,
    );
  }
}

// ─── 54. Color legibility — the rendering contract of an ASCII game ────────
// Everything is a colored glyph on a dark field, so "can you tell these apart
// at a glance" is a correctness property, not taste. Two bugs shipped from
// getting it wrong (a spore haze that vanished into the foliage; a chasm that
// read as off-map black).
//
// SCOPE, honestly: color distance alone can NOT decide every case — a trap
// sits at ~221 from some walls and is perfectly readable because its `^` glyph
// carries the signal, while the old spore haze at ~200–227 was invisible
// because a drifting mote has no shape to read. So these are REGRESSION FLOORS
// (nothing may get worse than today's worst) plus the specific relationships
// that are genuinely all-color. Eyeballing is still required — see /style.
console.log("\n[54] Color legibility: contrast floors for glyphs on terrain");
{
  const INK = "#0d0d0d"; // the page/background black

  // A cracked wall is a SHORTCUT you have to spot, so the fissure has to cut visibly
  // through the wall glyph on every palette. It's drawn as the wall's own colour,
  // darkened — and the strokes are deliberately hairline, because more fine
  // splinters read as fractured stone better than fewer heavy ones. That means the
  // visibility has to come from DEPTH rather than width, so pin the depth: at the old
  // 0.25 factor this sat ~260 on the dimmest walls and players reported the crack as
  // too subtle to notice.
  checkOver(
    "a crack fissure reads against every level's cracked-wall colour",
    LEVELS.map((l) => ({ l })),
    ({ l }) => {
      const wall = terrainColor("crackedWall", l.palette, l.biome);
      return colorDistance(dim(wall, CRACKED_WALL_CRACK_DIM), wall) > 280;
    },
  );

  // (a) Background TINTS are pure color — no glyph to help. The chasm's void
  // tint must not read as the off-map black (it did: distance 39, now 73).
  check(
    "the chasm's void tint is distinguishable from off-map black",
    colorDistance(CHASM_BG, INK) >= 60,
    `(distance ${colorDistance(CHASM_BG, INK).toFixed(0)}, need ≥60)`,
  );

  // (b) Status tints recolor the SAME glyph, so color is the only signal —
  // you must be able to tell poisoned from burning at a glance.
  const kinds = Object.keys(STATUS) as StatusKind[];
  const tintPairs = kinds.flatMap((a, i) =>
    kinds.slice(i + 1).map((b) => ({ a, b })),
  );
  checkOver(
    "every pair of status tints is tellable apart",
    tintPairs,
    ({ a, b }) => colorDistance(STATUS[a].tint, STATUS[b].tint) >= 120,
  );

  // (c) The player and the exit must pop against ANY terrain — they're what you
  // scan the screen for.
  const terrain = LEVELS.flatMap((l) =>
    [l.palette.floor, l.palette.wall].map((c) => ({ lvl: l.id, c })),
  );
  for (const [what, hex, min] of [
    ["the player @", PLAYER_COLOR, 300],
    ["the exit >", EXIT_COLOR, 300],
  ] as const)
    checkOver(
      `${what} stands out against every level's terrain`,
      terrain,
      (t) => colorDistance(hex, t.c) >= min,
    );

  // (d) Within a level, floor and wall must differ enough to read structure.
  checkOver(
    "every level's floor and wall are distinguishable from each other",
    LEVELS.map((l) => ({ id: l.id, f: l.palette.floor, w: l.palette.wall })),
    (l) => colorDistance(l.f, l.w) >= 60,
  );

  // (e) REGRESSION FLOOR for hazard signals against terrain they can really
  // appear on. The bar is set from MEASUREMENT, not taste: across the 34 real
  // pairs the weakest today is water on the Frostspine's grey-blue crags (121),
  // and water owns the whole bottom of the list (121/161/165/183) — everything
  // else is ≥221. Water survives on glyph + shimmer, but it IS the game's
  // thinnest read and is worth an art pass (logged in IDEAS). The floor sits
  // just under today's worst so it catches a NEW invisible hazard without
  // re-litigating accepted art; tighten it if water ever gets retinted.
  // Only compare a hazard against terrain it can ACTUALLY appear on — generate
  // each level and read which tiles are really there. (Comparing every hazard
  // against every level flagged water on the waterless Pit: a false alarm.)
  const SIGNAL_OF: Partial<Record<TileType, { what: string; hex: string }>> = {
    sporeVent: { what: "spore vent", hex: SPORE_VENT_COLOR },
    trap: { what: "trap", hex: TRAP_COLOR },
    water: { what: "water", hex: WATER_COLOR },
    glowcap: { what: "glowcap", hex: GLOWCAP_COLOR },
  };
  const signalPairs: { what: string; hex: string; on: string; tc: string }[] =
    [];
  LEVELS.forEach((l, li) => {
    const g = beginLevel("legibility", li, createPlayer());
    const present = new Set(g.map.tiles);
    // a spore vent seeps the gas haze, so the haze shares its levels
    if (present.has("sporeVent")) present.add("gas" as TileType);
    for (const [tile, sig] of Object.entries(SIGNAL_OF)) {
      if (!present.has(tile as TileType)) continue;
      for (const c of [l.palette.floor, l.palette.wall])
        signalPairs.push({ what: sig.what, hex: sig.hex, on: l.id, tc: c });
    }
    if (present.has("sporeVent"))
      for (const c of [l.palette.floor, l.palette.wall])
        signalPairs.push({ what: "gas haze", hex: GAS_COLOR, on: l.id, tc: c });
  });
  checkOver(
    `no hazard signal is invisible against terrain (${signalPairs.length} pairs)`,
    signalPairs,
    (p) => colorDistance(p.hex, p.tc) >= 110,
  );
}

// ─── 55. The flood can never seal the player in (softlock guard) ────────────
// The flood plan keeps OBJECTIVES reachable, but that only protects a player
// standing on the dry spine. Step into a side pocket and the rising ring used
// to flood every neighbor, marooning you on one tile — and since the turn
// limit is only a score target, nothing ends the run: a permanent softlock.
// `tickFlood` now reserves a walkable escape route back to dry ground.
console.log("\n[55] Flood never seals the player in (softlock guard)");
{
  const fi = levelIndexBy("with a flood set-piece", (l) => !!l.flood);
  const cfg = LEVELS[fi].flood!;
  // can the player still WALK to permanently-dry ground (a non-floodable tile)?
  const canEscape = (g: GameState) => {
    const w = g.map.width;
    const floodable = new Set(g.floodable ?? []);
    const start = idx(g.player.x, g.player.y, w);
    const seen = new Set<number>([start]);
    const q = [start];
    while (q.length) {
      const cur = q.shift()!;
      if (!floodable.has(cur) && g.map.tiles[cur] !== "water") return true;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const nx = cx + dx;
        const ny = cy + dy;
        const ni = idx(nx, ny, w);
        if (seen.has(ni) || !isWalkable(g.map, nx, ny)) continue;
        seen.add(ni);
        q.push(ni);
      }
    }
    return false;
  };

  const openOrthoCountAt = (g: GameState, i: number) => {
    const w = g.map.width;
    return [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ].filter(([dx, dy]) =>
      isWalkable(g.map, (i % w) + dx, Math.floor(i / w) + dy),
    ).length;
  };

  const seeds = ["fl1", "fl2", "fl3", "fl4", "fl5", "fl6"];
  // Park the player OFF the protected spine (a floodable tile far from start) —
  // exactly the situation that stranded a real run — then flood to the maximum.
  const cases = seeds.map((seed) => {
    const g = beginLevel(seed, fi, createPlayer());
    g.monsters = [];
    g.player.hp = g.player.maxHp = 1e9;
    const w = g.map.width;
    const pocket = (g.floodable ?? [])
      .filter((i) => openOrthoCountAt(g, i) <= 2) // a nook/corridor, worst case
      .sort(
        (a, b) =>
          manhattan(b % w, Math.floor(b / w), g.player.x, g.player.y) -
          manhattan(a % w, Math.floor(a / w), g.player.x, g.player.y),
      )[0];
    if (pocket != null) {
      g.player.x = pocket % w;
      g.player.y = Math.floor(pocket / w);
    }
    // run well past the last flood step
    const turns = cfg.startTurn + cfg.interval * (cfg.maxSteps + 2);
    let everStuck = false;
    for (let t = 0; t < turns; t++) {
      resolveTurn(g, { type: "wait" }, new Rng(t + 1));
      if (!canEscape(g)) everStuck = true;
    }
    return { seed, everStuck, step: g.floodStep ?? 0 };
  });

  checkOver(
    "the player is never sealed in by the rising water",
    cases,
    (c) => !c.everStuck,
  );
  // and the water must still actually rise — a guard that just stops the flood
  // would pass the check above while gutting the set-piece
  checkOver(
    "...and the flood still rises to its full extent",
    cases,
    (c) => c.step >= cfg.maxSteps,
  );
}

// ─── 56. A secret vault is SECRET — you can't see in before breaking in ─────
// The enclosure check originally tested only the 4 orthogonal neighbors, but
// FOV runs at `topology: 8`: one transparent diagonal corner let you see the
// whole vault — hoard, guardian and all — straight through the "sealed" wall
// (15+ outside tiles had a view). Spoiling the surprise is the whole point of
// the feature, so this asserts the seal optically, not just structurally.
console.log("\n[56] Secret vaults can't be seen into before you break in");
{
  const vaultLevels = LEVELS.map((l, i) => ({ l, i })).filter(
    ({ l }) => !!l.secretVault,
  );
  const seeds = ["v1", "v2", "v3", "v4"];
  const cases = vaultLevels.flatMap(({ l, i }) =>
    seeds.map((seed) => ({ id: l.id, i, seed })),
  );

  checkOver(
    `no tile outside a vault can see into it (${cases.length} level×seed)`,
    cases,
    ({ i, seed }) => {
      const g = beginLevel(seed, i, createPlayer());
      const vaultItem = g.items.find((it) => it.id.includes("_v"));
      if (!vaultItem) return true; // vault didn't place on this seed — nothing to leak
      const w = g.map.width;
      const vi = idx(vaultItem.x, vaultItem.y, w);
      // the sealed interior = floor reachable from the loot without crossing the gate
      const room = new Set<number>([vi]);
      const q = [vi];
      while (q.length) {
        const c = q.shift()!;
        for (const [dx, dy] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ]) {
          const ni = (Math.floor(c / w) + dy) * w + ((c % w) + dx);
          if (!room.has(ni) && g.map.tiles[ni] === "floor") {
            room.add(ni);
            q.push(ni);
          }
        }
      }
      // stand everywhere nearby OUTSIDE it and confirm the interior stays dark
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const x = vaultItem.x + dx;
          const y = vaultItem.y + dy;
          const i2 = idx(x, y, w);
          if (room.has(i2) || !isWalkable(g.map, x, y)) continue;
          g.player.x = x;
          g.player.y = y;
          g.player.lightRadius = 8;
          recomputeFOV(g);
          if (g.visible.includes(vi)) return false;
        }
      }
      return true;
    },
  );
}

// ─── 57. Tuning dials are load-bearing (anti-neutralization) ────────────────
// Every check here exists because a MUTATION AUDIT neutralized a real dial or
// formula term and all three suites stayed green. The failure mode they share:
// a mechanic can be silently switched off while the tests that "cover" it keep
// passing, because those tests only asserted a DIRECTION (hp went down) or were
// written relative to the very constant they meant to pin.
console.log("\n[57] Tuning dials are load-bearing (anti-neutralization)");
{
  // (a) The Might potion. Nothing asserted that the buff raises damage, so
  // dropping `might` from the formula (or zeroing the dial) was invisible.
  {
    const p = createPlayer("wanderer");
    const base = playerAttackDamage(p, MONSTERS.skeleton);
    p.effects.might = 5;
    const buffed = playerAttackDamage(p, MONSTERS.skeleton);
    check(
      "the Might buff actually raises weapon damage",
      buffed === base + CONFIG.mightBonus && buffed > base,
      `(${base} → ${buffed}, dial ${CONFIG.mightBonus})`,
    );
  }

  // (b) `collectX` must need EVERY pickup. Completing on the first one shortens
  // the Blackwood from a 3-shard hunt to a 1-shard errand, and the existing goal
  // test only walks the full collection, so it never noticed.
  {
    const li = levelIndexBy(
      "with a collectX goal",
      (l) => l.goal.type === "collectX",
    );
    const goal = LEVELS[li].goal as {
      type: "collectX";
      questTag: string;
      count: number;
    };
    const g = beginLevel("collect-early", li, createPlayer());
    check("the collectX level asks for more than one", goal.count > 1);
    g.questProgress[goal.questTag] = goal.count - 1;
    check(
      "collectX is NOT complete one short of the count",
      !isGoalComplete(g),
    );
    g.questProgress[goal.questTag] = goal.count;
    check("collectX completes on the last pickup", isGoalComplete(g));
  }

  // (c) `applyStatus` takes the LONGER of the two timers — a fresh weak tick must
  // never cut a long affliction short.
  {
    const fx: Record<string, number> = {};
    applyStatus(fx, "poison", 5);
    applyStatus(fx, "poison", 2);
    check(
      "re-applying a shorter status keeps the longer timer",
      fx.poison === 5,
    );
    applyStatus(fx, "poison", 9);
    check("a longer status refresh extends the timer", fx.poison === 9);
  }

  // (d) The GLOBAL economy dials. CLAUDE.md says to tune `lootScale`/`forageScale`
  // rather than per-level counts, which makes them the most load-bearing numbers
  // in the game — yet disabling either changed nothing any suite could see (the
  // playthrough economy band is far too wide to notice a 1.5× loot swing).
  // Asserting a fixed expected count is impossible (placement is lossy: the Mire
  // wants 5 forage nooks and fits 1), so flip the dial and require generation to
  // RESPOND — which pins the wiring without hard-coding a layout.
  {
    const li = levelIndexBy(
      "with enough forage and drops to scale",
      (l) => (l.forageCount ?? 0) >= 6 && l.itemDropCount >= 6,
    );
    void li;
    check(
      "both economy dials are set to THIN, not pass through",
      CONFIG.lootScale < 1 && CONFIG.forageScale < 1,
      `(loot ${CONFIG.lootScale}, forage ${CONFIG.forageScale})`,
    );

    // Assert the SCALED BUDGET as an upper bound on what generation places.
    // (Flipping `CONFIG` at runtime and re-generating would be the direct test,
    // but the dial doesn't reach `generate.ts` from inside this suite — the same
    // separate-module-instance quirk that once made a `LEVELS` mutation here
    // verify nothing. Static bounds work regardless.)
    //
    // Forage is the cleanest signal: `placeForage` is its only source, so placed
    // tiles can never exceed the scaled count — and on half the levels the bound
    // is TIGHT (the Pit 3/3, Iron Gate 2/2, Great Hall 3/3), which is what makes
    // this discriminating rather than slack.
    checkOver(
      "forage placement never exceeds the forageScale budget",
      LEVELS.map((l, i) => ({ l, i })),
      ({ l, i }) => {
        const g = beginLevel("econ-bound", i, createPlayer());
        const placed = g.map.tiles.filter((t) => t === "forage").length;
        return placed <= Math.round((l.forageCount ?? 0) * CONFIG.forageScale);
      },
    );

    // Ground loot: placed items must fit the scaled drop budget plus the loot the
    // config explicitly stamps (hut/vault caches) and the quest items. The
    // `gallery` generator is excluded — it stamps its own niche offering caches,
    // which aren't derivable from the config.
    const declaredLoot = (l: (typeof LEVELS)[number]) =>
      (l.structures ?? []).reduce((s, st) => s + (st.loot?.length ?? 0), 0) +
      (l.secretVault?.loot?.length ?? 0);
    checkOver(
      "ground loot never exceeds the lootScale budget + declared caches",
      LEVELS.map((l, i) => ({ l, i })).filter(
        ({ l }) => l.generator !== "gallery",
      ),
      ({ l, i }) => {
        const g = beginLevel("econ-bound", i, createPlayer());
        const quest = g.items.filter((it) => it.questTag).length;
        const budget =
          Math.round(l.itemDropCount * CONFIG.lootScale) +
          declaredLoot(l) +
          quest;
        return g.items.length <= budget;
      },
    );
  }

  // (e) Coin piles must be worth more than the min-1 floor. `coinPile: {0, 0}`
  // survived every suite because `generate.ts` clamps the value to ≥1, so the
  // economy quietly became 1-gold scraps while nothing failed.
  {
    const rich = LEVELS.map((l, i) => ({ l, i })).filter(
      ({ l }) => (l.coinRichness ?? 1) >= 1,
    );
    const values: number[] = [];
    for (const { i } of rich)
      for (const seed of ["coin1", "coin2"]) {
        const g = beginLevel(seed, i, createPlayer());
        for (const it of g.items)
          if (ITEMS[it.defId]?.category === "coin" && it.value !== undefined)
            values.push(it.value);
      }
    checkOver(
      "coin piles are worth more than the 1-gold floor",
      values,
      (v) => v > 1,
    );
    check(
      "the coin-pile dial spans a real range",
      CONFIG.coinPile.min >= 1 && CONFIG.coinPile.max > CONFIG.coinPile.min,
    );
  }

  // (e2) Monsters never spawn in your lap. This lived only as an emergent effect
  // in the playthrough sweep — a level got hard enough that some assertion there
  // failed — so it silently STOPPED being covered the moment the bot got better
  // at fighting (equipping upgrades and using its class ability was enough). A
  // spawn-placement guarantee belongs in core, where bot skill can't mask it.
  //
  // Note the metric: `farFromPlayer` in generate.ts uses MANHATTAN, so chebyshev
  // spawns as close as 3 are legitimate (dx 3, dy 3 = manhattan 6). Ambient
  // wildlife is excluded by design — it's placed on ordinary floor with no
  // far-from-player rule, being harmless atmosphere.
  {
    // The absolute anchor first — the sweep below is expressed relative to the
    // dial, so at 0 it would pass while monsters spawned in melee range. (This is
    // the single most common flaw the audit found in this suite: an assertion
    // parameterized by the constant it is supposed to pin.)
    check(
      "the spawn-distance dial keeps monsters out of melee range at level start",
      CONFIG.minSpawnDistanceFromPlayer >= 4,
      `(${CONFIG.minSpawnDistanceFromPlayer})`,
    );
    const cases = LEVELS.flatMap((_, i) =>
      ["s1", "s2", "s3", "s4", "s5", "s6"].map((seed) => ({ i, seed })),
    );
    checkOver(
      "no monster spawns within the min distance of the player (manhattan)",
      cases,
      ({ i, seed }) => {
        const g = beginLevel(seed, i, createPlayer());
        return g.monsters.every(
          (m) =>
            MONSTERS[m.defId].behavior === "ambient" ||
            manhattan(m.x, m.y, g.player.x, g.player.y) >=
              CONFIG.minSpawnDistanceFromPlayer,
        );
      },
    );
  }

  // (f) A torch's fuel comes from the ITEM (both real torches define their own),
  // so `CONFIG.torchFuel` is only a fallback — pin that the item value is what
  // reaches the player, and that it's short enough for managed light to matter.
  {
    // Use the LANTERN: its 280 differs from the `CONFIG.torchFuel` fallback (150),
    // whereas the torch's own fuel happens to equal it — so only the lantern can
    // actually prove the item value is what reaches the player.
    const p = createPlayer("wanderer");
    p.torchFuel = 0;
    giveItem(p, "i_lantern");
    check(
      "picking up a lantern grants the ITEM's fuel, not the config fallback",
      ITEMS.i_lantern.fuel !== undefined &&
        p.torchFuel === ITEMS.i_lantern.fuel &&
        ITEMS.i_lantern.fuel !== CONFIG.torchFuel,
      `(fuel ${p.torchFuel}, item ${ITEMS.i_lantern.fuel}, fallback ${CONFIG.torchFuel})`,
    );
    const longestPar = Math.max(...LEVELS.map((l) => l.turnLimit));
    check(
      "a torch can actually run out within a long level (light stays managed)",
      (ITEMS.i_torch.fuel ?? Infinity) < longestPar,
      `(fuel ${ITEMS.i_torch.fuel} vs longest par ${longestPar})`,
    );
  }
}

// ─── 58. Turn-resolution behavior (second mutation-audit pass) ──────────────
// A 32-mutation pass over `actions/index.ts` — the 2,365-line file holding monster
// AI, the tick pipeline, kill rewards and hazard resolution — found 12 behaviors
// with NO coverage anywhere. The first audit had reached that file only indirectly,
// through config dials.
//
// The worst of them: deleting `state.player.hp -= dmg` from `resolveMonsterAttack`
// (monsters deal no damage AT ALL) passed all three suites. It hides because every
// gate is one-directional — harmless monsters only make the bot win MORE, "levels
// are beatable" still passes, "boss levels last ≥6 turns" passes more easily — and
// the core tests exercise the damage FORMULA (`monsterAttackDamage`) rather than
// the resolution path that applies it. Formula coverage is not effect coverage.
console.log("\n[58] Turn-resolution behavior (mutation-audit closures)");
{
  const ORTHO = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;

  /** One monster placed orthogonally adjacent to a beefy player, nothing else. */
  const arena = (
    defId: string,
    mstate: "idle" | "chase" = "chase",
    classId = "wanderer",
    seed = "arena",
  ) => {
    const g = beginLevel(seed, 0, createPlayer(classId));
    g.monsters = [];
    const p = g.player;
    p.maxHp = p.hp = 500;
    const spot = ORTHO.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).find(
      (c) => isWalkable(g.map, c.x, c.y),
    )!;
    const def = MONSTERS[defId];
    g.monsters = [
      {
        id: "t",
        defId,
        x: spot.x,
        y: spot.y,
        hp: def.maxHp * 40, // survives many blows so we can read damage
        state: mstate,
      },
    ];
    recomputeFOV(g);
    return { g, mon: g.monsters[0], spot };
  };

  /** Attack whatever is adjacent, re-aiming each turn (it may shuffle). */
  const strikeAdjacent = (g: GameState, rng: Rng) => {
    const m = g.monsters[0];
    if (!m) return false;
    const dx = m.x - g.player.x;
    const dy = m.y - g.player.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) {
      resolveTurn(g, { type: "wait" }, rng);
      return true;
    }
    resolveTurn(g, { type: "move", dx, dy }, rng);
    return true;
  };

  // (a) THE headline hole: a monster's melee must actually cost you HP.
  {
    const { g } = arena("skeleton");
    const hp0 = g.player.hp;
    resolveTurn(g, { type: "wait" }, new Rng(3));
    check(
      "a monster's melee actually reduces player HP",
      g.player.hp < hp0,
      `(hp ${hp0} → ${g.player.hp})`,
    );
  }

  // (b) `MonsterDef.inflicts` must actually afflict you (wraith → bleed @ 0.5).
  {
    const { g } = arena("wraith");
    let afflicted = false;
    for (let t = 0; t < 40 && !afflicted; t++) {
      resolveTurn(g, { type: "wait" }, new Rng(7 + t));
      afflicted = (g.player.effects.bleed ?? 0) > 0;
    }
    check("a monster's `inflicts` really afflicts the player", afflicted);
  }

  // (c) Striking an unaware monster must WAKE it — otherwise it stays `idle` and
  // every subsequent blow re-earns the sneak multiplier, forever.
  //
  // The confound to kill first: the monster phase runs in the SAME turn, so an
  // adjacent, visible monster wakes itself by DETECTION and the assertion passes
  // whether or not the strike alerted it (this check initially let the mutation
  // survive for exactly that reason). Dousing the light to 0 makes detection
  // impossible — `visible` holds only the player's own tile — so `chase` can only
  // have come from the blow.
  {
    const { g, mon, spot } = arena("skeleton", "idle");
    g.player.hasTorch = false;
    g.player.lightRadius = 0;
    recomputeFOV(g);
    check(
      "(setup) the target is unseen, so only the blow can wake it",
      !g.visible.includes(idx(mon.x, mon.y, g.map.width)),
    );
    resolveTurn(
      g,
      { type: "move", dx: spot.x - g.player.x, dy: spot.y - g.player.y },
      new Rng(4),
    );
    check(
      "striking an unaware monster wakes it (sneak isn't repeatable)",
      mon.state === "chase",
      `(state ${mon.state})`,
    );
  }

  // (d) The Rogue's crit must fire and must double the blow.
  //
  // Draw from ONE long-lived Rng rather than a fresh `new Rng(smallInt)` per
  // attack. rot.js's first `getUniform()` after `setSeed(n)` is ≈ n/2048, so for
  // small integer seeds the first roll is a near-deterministic ramp (0.0000,
  // 0.0005, 0.0010, …) — 80 fresh small seeds gave 80 IDENTICAL crit outcomes.
  // Sequential draws from one instance are properly distributed. (Real gameplay
  // is unaffected: `gameplaySeed()` yields large hashes, which spread fine — see
  // the seed-spread check in [2].)
  {
    const cls = CLASS_LIST.find((c) => (c.critChance ?? 0) > 0)!;
    const { g, spot } = arena("skeleton", "chase", cls.id, "crit");
    const dx = spot.x - g.player.x;
    const dy = spot.y - g.player.y;
    const rng = new Rng(gameplaySeed("crit-spread"));
    const seen = new Set<number>();
    for (let n = 0; n < 120; n++) {
      const m = g.monsters[0];
      if (!m) break;
      const before = m.hp;
      resolveTurn(g, { type: "move", dx, dy }, rng);
      const dealt = before - (g.monsters[0]?.hp ?? 0);
      if (dealt > 0) seen.add(dealt);
      g.player.hp = g.player.maxHp; // keep the sparring going
    }
    const lo = Math.min(...seen);
    const hi = Math.max(...seen);
    check(
      `the ${cls.id}'s crit lands and doubles the blow`,
      seen.size > 1 && hi >= lo * 2,
      `(damages seen: ${[...seen].sort((a, b) => a - b).join("/")})`,
    );
  }

  // (e) A weapon's `onHit` must afflict what it strikes (Frostbrand → chill).
  {
    const { g } = arena("skeleton");
    g.player.weaponId = "w_frost";
    let chilled = false;
    for (let t = 0; t < 40 && !chilled; t++) {
      if (!strikeAdjacent(g, new Rng(11 + t))) break;
      chilled = (g.monsters[0]?.effects?.chill ?? 0) > 0;
    }
    check(
      "a weapon's on-hit effect afflicts its target (Frostbrand chills)",
      chilled,
    );
  }

  // (f) Knockback must stop at a solid wall rather than shove a body into it.
  {
    const { g, spot } = arena("skeleton");
    g.player.weaponId = "w_mace"; // knockback 1
    const dx = spot.x - g.player.x;
    const dy = spot.y - g.player.y;
    g.map.tiles[idx(spot.x + dx, spot.y + dy, g.map.width)] = "wall";
    resolveTurn(g, { type: "move", dx, dy }, new Rng(2));
    const m = g.monsters[0];
    check(
      "knockback stops at a solid wall (never shoves a body inside one)",
      !!m && m.x === spot.x && m.y === spot.y,
      m ? `(at ${m.x},${m.y}; target tile was ${spot.x},${spot.y})` : "(gone)",
    );
  }

  // (g) A boss never loses interest — the finale is relentless. Assert on
  // `lostTurns`, which only accumulates via the `!def.isBoss` branch.
  {
    const bossId = Object.values(MONSTERS).find(
      (m) => m.isBoss && m.behavior !== "bossLich",
    )!.id;
    const { g, mon } = arena(bossId, "chase");
    g.player.lightRadius = 1; // break contact: it can only be seen point-blank
    // park it far away so it cannot re-acquire us within the window
    const far = g.map.tiles.findIndex(
      (t, i) =>
        t === "floor" &&
        chebyshev(
          i % g.map.width,
          Math.floor(i / g.map.width),
          g.player.x,
          g.player.y,
        ) >
          CONFIG.loseInterestTurns * 3,
    );
    check("(setup) found a distant tile to park the boss", far >= 0);
    if (far >= 0) {
      mon.x = far % g.map.width;
      mon.y = Math.floor(far / g.map.width);
      for (let t = 0; t < CONFIG.loseInterestTurns + 2; t++)
        resolveTurn(g, { type: "wait" }, new Rng(20 + t));
      check(
        "a boss never gives up the chase",
        mon.state === "chase" && (mon.lostTurns ?? 0) === 0,
        `(state ${mon.state}, lostTurns ${mon.lostTurns ?? 0})`,
      );
    }
  }

  // (h) Having lost you, a monster hunts your LAST-SEEN tile — it must not home
  // on your true position (that's the "monsters aren't omniscient" promise).
  // Set the remembered tile on the far side of the monster from the player, so
  // "toward memory" and "toward player" are opposite directions.
  {
    let ran = false;
    for (const seed of ["ls1", "ls2", "ls3", "ls4", "ls5", "ls6"]) {
      const g = beginLevel(seed, 0, createPlayer("wanderer"));
      g.monsters = [];
      const p = g.player;
      p.maxHp = p.hp = 500;
      p.lightRadius = 1; // contact is broken
      const w = g.map.width;
      // A monster tile ≥6 away and CARDINALLY aligned with the player, with two
      // walkable tiles further along that same ray to serve as the remembered
      // spot. Cardinal alignment matters: `stepToward` runs A* at topology 4, so
      // a diagonal ray's "one step outward" isn't a legal single move and the
      // monster can stand still for reasons that have nothing to do with memory.
      let placed: { mx: number; my: number; lx: number; ly: number } | null =
        null;
      for (let i = 0; i < g.map.tiles.length && !placed; i++) {
        if (g.map.tiles[i] !== "floor") continue;
        const mx = i % w;
        const my = Math.floor(i / w);
        if (mx !== p.x && my !== p.y) continue; // cardinal ray only
        if (chebyshev(mx, my, p.x, p.y) < 6) continue;
        const ux = Math.sign(mx - p.x);
        const uy = Math.sign(my - p.y);
        const lx = mx + ux * 2;
        const ly = my + uy * 2;
        if (!isWalkable(g.map, mx + ux, my + uy)) continue; // step outward is legal
        if (!isWalkable(g.map, lx, ly)) continue;
        placed = { mx, my, lx, ly };
      }
      if (!placed) continue;
      g.monsters = [
        {
          id: "t",
          defId: "skeleton",
          x: placed.mx,
          y: placed.my,
          hp: 9999,
          state: "chase",
          lastSeen: { x: placed.lx, y: placed.ly },
          lostTurns: 0,
        },
      ];
      recomputeFOV(g);
      const distToPlayerBefore = chebyshev(placed.mx, placed.my, p.x, p.y);
      const distToMemoryBefore = chebyshev(
        placed.mx,
        placed.my,
        placed.lx,
        placed.ly,
      );
      resolveTurn(g, { type: "wait" }, new Rng(31));
      const m = g.monsters[0];
      ran = true;
      check(
        "a monster that lost you hunts your last-seen tile, not your true spot",
        chebyshev(m.x, m.y, placed.lx, placed.ly) < distToMemoryBefore &&
          chebyshev(m.x, m.y, p.x, p.y) >= distToPlayerBefore,
        `(→memory ${distToMemoryBefore}→${chebyshev(m.x, m.y, placed.lx, placed.ly)}, ` +
          `→player ${distToPlayerBefore}→${chebyshev(m.x, m.y, p.x, p.y)})`,
      );
      break;
    }
    check("(setup) found a geometry to test last-seen pursuit", ran);
  }

  // (i) `slowChase` shamblers act only every other turn.
  {
    const { g, mon } = arena("zombie", "chase");
    // park it away from the player so it MOVES rather than attacking in place
    const w = g.map.width;
    const spot = g.map.tiles.findIndex(
      (t, i) =>
        t === "floor" &&
        chebyshev(i % w, Math.floor(i / w), g.player.x, g.player.y) === 6,
    );
    check("(setup) found a tile to park the shambler", spot >= 0);
    if (spot >= 0) {
      mon.x = spot % w;
      mon.y = Math.floor(spot / w);
      g.player.lightRadius = 12;
      recomputeFOV(g);
      let moved = 0;
      const TURNS = 12;
      for (let t = 0; t < TURNS; t++) {
        const px = mon.x;
        const py = mon.y;
        resolveTurn(g, { type: "wait" }, new Rng(40 + t));
        if (mon.x !== px || mon.y !== py) moved++;
      }
      check(
        "a slowChase shambler acts only every other turn",
        moved > 0 && moved <= TURNS / 2 + 1,
        `(moved on ${moved} of ${TURNS} turns)`,
      );
    }
  }

  // (j) Emberstep must actually suppress burn damage.
  {
    const burnTick = (ember: boolean) => {
      const g = beginLevel("ember", 0, createPlayer("wanderer"));
      g.monsters = [];
      const p = g.player;
      p.maxHp = p.hp = 200;
      p.effects.burn = 5;
      if (ember) p.effects.emberstep = 5;
      const hp0 = p.hp;
      resolveTurn(g, { type: "wait" }, new Rng(1));
      return hp0 - p.hp;
    };
    const warded = burnTick(true);
    const bare = burnTick(false);
    check(
      "Emberstep wards off burn damage",
      warded === 0 && bare > 0,
      `(with ${warded}, without ${bare})`,
    );
  }

  // (k) The lich's telegraphed barrage must detonate ON the player for damage —
  // and do nothing to a player who stepped clear.
  {
    const barrageOn = (underPlayer: boolean) => {
      const g = beginLevel("barrage", 0, createPlayer("wanderer"));
      g.monsters = [];
      const p = g.player;
      p.maxHp = p.hp = 300;
      p.armorReduction = 0;
      const w = g.map.width;
      const elsewhere = g.map.tiles.findIndex(
        (t, i) =>
          t === "floor" && chebyshev(i % w, Math.floor(i / w), p.x, p.y) > 3,
      );
      g.barrage = [underPlayer ? idx(p.x, p.y, w) : elsewhere];
      const hp0 = p.hp;
      resolveTurn(g, { type: "wait" }, new Rng(1));
      return { lost: hp0 - p.hp, cleared: g.barrage.length === 0 };
    };
    const hit = barrageOn(true);
    const miss = barrageOn(false);
    check(
      "a barrage tile under the player detonates for damage",
      hit.lost > 0 && hit.cleared,
      `(lost ${hit.lost})`,
    );
    check(
      "a barrage you stepped clear of costs nothing",
      miss.lost === 0 && miss.cleared,
      `(lost ${miss.lost})`,
    );
  }

  // (l) `levelKills` must count kills. NOTE this is currently an INERT path —
  // `killCount` is the only reader and no level uses that goal — but it's
  // documented as supported for reuse, so keep it honest rather than let it rot.
  {
    const { g, spot } = arena("rat");
    g.player.weaponPower = 999;
    g.monsters[0].hp = 1;
    resolveTurn(
      g,
      { type: "move", dx: spot.x - g.player.x, dy: spot.y - g.player.y },
      new Rng(1),
    );
    check(
      "a kill increments levelKills (the killCount goal's only input)",
      g.levelKills === 1,
      `(levelKills ${g.levelKills})`,
    );
  }
}

// ─── 59. Generation placement RULES (third mutation-audit pass) ─────────────
// `generate.ts` is 1,992 lines and had only 4 mutations against it; the soak checks
// its OUTPUT guarantees (reachability, connectivity) but nothing probed the
// placement rules themselves. A 23-mutation pass found **14 uncovered**, i.e. a 61%
// escape rate — the worst-covered file in the project.
//
// Every threshold below is CALIBRATED against a measured baseline-vs-mutant pair,
// not guessed, and the seeds are fixed — so these shares are deterministic values,
// not samples, and a threshold between the two is a reliable discriminator.
console.log("\n[59] Generation placement rules (mutation-audit closures)");
{
  // Mirrors TRAP_OPEN in generate.ts EXACTLY. Using a looser set silently changes
  // every number here (my first draft did, and its thresholds didn't transfer).
  const TRAP_OPEN = ["floor", "doorOpen", "exit", "oil", "forage", "ice"];
  // each placement pass defines its own neighbor set — mirror them exactly
  const CRACK_NBR = ["floor", "oil", "doorOpen", "trap", "trapSprung", "exit"];
  const DOOR_NBR = ["floor", "oil", "exit", "trap", "trapSprung", "doorOpen"];
  const openOrtho = (t: string[], w: number, i: number) => {
    const h = t.length / w;
    const x = i % w;
    const y = Math.floor(i / w);
    let n = 0;
    if (y > 0 && TRAP_OPEN.includes(t[i - w])) n++;
    if (y < h - 1 && TRAP_OPEN.includes(t[i + w])) n++;
    if (x > 0 && TRAP_OPEN.includes(t[i - 1])) n++;
    if (x < w - 1 && TRAP_OPEN.includes(t[i + 1])) n++;
    return n;
  };
  const SEEDS = Array.from({ length: 25 }, (_, i) => `gp${i}`);
  const SPORE_GAP = 5; // mirrors the private SPORE_VENT_GAP

  let questOpen = 0;
  let questTotal = 0;
  let trapMinDist = 99;
  let trapBypass = 0;
  let trapTotal = 0;
  let ventMinGap = 99;
  let forageNooks = 0;
  let forageTotal = 0;
  let forageMinDist = 99;
  let loreNooks = 0;
  let loreTotal = 0;
  let crackedOK = 0;
  let crackedTotal = 0;
  let doorsChokepoint = 0;
  let doorTotal = 0;

  for (let li = 0; li < LEVELS.length; li++) {
    for (const seed of SEEDS) {
      const g = beginLevel(seed, li, createPlayer());
      const w = g.map.width;
      const t = g.map.tiles as string[];
      const solid = (k: number) => t[k] === "wall" || t[k] === "crackedWall";

      for (const it of g.items)
        if (it.questTag) {
          questTotal++;
          if (openOrtho(t, w, idx(it.x, it.y, w)) >= 3) questOpen++;
        }
      for (const l of g.lore) {
        loreTotal++;
        if (openOrtho(t, w, idx(l.x, l.y, w)) <= 2) loreNooks++;
      }

      const vents: number[] = [];
      for (let i = 0; i < t.length; i++) {
        const x = i % w;
        const y = Math.floor(i / w);
        if (t[i] === "trap") {
          trapMinDist = Math.min(
            trapMinDist,
            manhattan(x, y, g.player.x, g.player.y),
          );
          trapTotal++;
          if (openOrtho(t, w, i) >= 3) trapBypass++;
        }
        if (t[i] === "sporeVent") vents.push(i);
        if (t[i] === "forage") {
          forageTotal++;
          if (openOrtho(t, w, i) <= 2) forageNooks++;
          forageMinDist = Math.min(
            forageMinDist,
            manhattan(x, y, g.player.x, g.player.y),
          );
        }
        if (x < 1 || y < 1 || x >= w - 1) continue;
        // A cracked wall must bridge two open spaces or it isn't a shortcut. Uses
        // placeCrackedWalls' OWN predicate — each placement pass defines its own
        // "open" set, and measuring with TRAP_OPEN instead reports false failures.
        if (t[i] === "crackedWall") {
          crackedTotal++;
          const o = (k: number) => CRACK_NBR.includes(t[k]);
          if ((o(i - 1) && o(i + 1)) || (o(i - w) && o(i + w))) crackedOK++;
        }
        // An interactive door must sit on a 1-wide chokepoint. Only `doorOpen` is
        // checked: a shut `door` tile is a secret-VAULT GATE, deliberately not a
        // chokepoint (measured — "all doors are open" would be a false assertion).
        if (t[i] === "doorOpen") {
          doorTotal++;
          const o = (k: number) => DOOR_NBR.includes(t[k]);
          const horiz = o(i - 1) && o(i + 1) && solid(i - w) && solid(i + w);
          const vert = o(i - w) && o(i + w) && solid(i - 1) && solid(i + 1);
          if (horiz || vert) doorsChokepoint++;
        }
      }
      for (let a = 0; a < vents.length; a++)
        for (let b = a + 1; b < vents.length; b++)
          ventMinGap = Math.min(
            ventMinGap,
            manhattan(
              vents[a] % w,
              Math.floor(vents[a] / w),
              vents[b] % w,
              Math.floor(vents[b] / w),
            ),
          );
    }
  }

  const share = (n: number, d: number) => (d === 0 ? 0 : (100 * n) / d);
  // 86% baseline vs 74% with the open-ground preference (or FAR_SLACK) disabled.
  // Not 100% by design: `farthestCell` falls back to the strict farthest cell when
  // the far end has no open ground at all.
  check(
    "quest items land on OPEN ground, not corridor stubs",
    share(questOpen, questTotal) >= 80,
    `(${share(questOpen, questTotal).toFixed(0)}% of ${questTotal} on ≥3 open neighbors)`,
  );
  // A trap must sit where a BYPASS exists (≥3 open orthogonal neighbors) — never in
  // a 1-wide corridor you're forced through, which turns an avoidable risk into a
  // toll. 100% baseline vs 82% with the rule removed.
  //
  // This lived only as INCIDENTAL coverage in `test:play` (a trap-toll level killed
  // the bot often enough to trip the beatable gate) and vanished the moment that
  // sweep went from 6 seeds to 12 — the bot then won somewhere and the gate passed.
  // Note `ensureTrapsAvoidable` repairs *route* violations after the fact, so the
  // trap-free-route checks in `[18]`/`[32]` and the soak can't see this either: the
  // placement rule has to be asserted on its own.
  check(
    "traps are placed only where a bypass exists",
    share(trapBypass, trapTotal) >= 95,
    `(${share(trapBypass, trapTotal).toFixed(0)}% of ${trapTotal} traps have ≥3 open neighbors)`,
  );
  check(
    "no trap is placed adjacent to the player's start",
    trapMinDist >= 2,
    `(closest trap at manhattan ${trapMinDist})`,
  );
  check(
    "spore vents stay isolated so their clouds can't merge",
    ventMinGap >= SPORE_GAP,
    `(closest pair ${ventMinGap}, gap ${SPORE_GAP})`,
  );
  check(
    "forage never spawns on the player's doorstep",
    forageMinDist >= 3,
    `(closest at manhattan ${forageMinDist})`,
  );
  // 100% baseline vs 0% with the nook preference inverted — the sharpest signal here.
  check(
    "forage hides in nooks off the beeline",
    share(forageNooks, forageTotal) >= 80,
    `(${share(forageNooks, forageTotal).toFixed(0)}% of ${forageTotal})`,
  );
  check(
    "lore props hide in nooks off the beeline",
    share(loreNooks, loreTotal) >= 80,
    `(${share(loreNooks, loreTotal).toFixed(0)}% of ${loreTotal})`,
  );
  // 99% baseline vs 65% with the rule removed. Not 100%: later passes convert a
  // neighboring floor tile (to forage/altar/lore), which can retire the bridge.
  check(
    "cracked walls bridge two open spaces (a real shortcut)",
    share(crackedOK, crackedTotal) >= 90,
    `(${share(crackedOK, crackedTotal).toFixed(0)}% of ${crackedTotal})`,
  );
  // 99% baseline vs 13% without the chokepoint requirement.
  check(
    "interactive doors sit on 1-wide chokepoints",
    share(doorsChokepoint, doorTotal) >= 90,
    `(${share(doorsChokepoint, doorTotal).toFixed(0)}% of ${doorTotal})`,
  );

  // ── pre-seeded scorch in the ashen wastes ──
  // The burned region used to differ from ordinary stone only in HUE, which the eye
  // stops registering within seconds. Actual stains on the floor say "something
  // burned here". Scattered from the map-gen stream, so it's a pure function of
  // (seed, level) like every other placement.
  {
    const STAINABLE = ["floor", "oil", "trap", "trapSprung"];
    const ashenLevels: number[] = [];
    for (let li = 0; li < LEVELS.length; li++)
      if ((LEVELS[li].subBiomes ?? []).some((sb) => sb.biome === "ashen"))
        ashenLevels.push(li);
    check("(setup) some level has an ashen region", ashenLevels.length > 0);

    checkOver(
      "an ashen region opens already scorched",
      ashenLevels.flatMap((li) =>
        ["ash1", "ash2", "ash3", "ash4"].map((seed) => ({ li, seed })),
      ),
      ({ li, seed }) =>
        Object.keys(beginLevel(seed, li, createPlayer()).decals).length > 0,
    );

    // every stain must be scorch, inside the ashen region, on stainable ground — a
    // stain on water or inside a wall reads as a rendering bug
    checkOver(
      "pre-seeded stains are ash, in-region, and on stainable ground",
      ashenLevels.flatMap((li) =>
        ["ash1", "ash2", "ash3", "ash4"].map((seed) => ({ li, seed })),
      ),
      ({ li, seed }) => {
        const g = beginLevel(seed, li, createPlayer());
        const m = g.map;
        return Object.entries(g.decals).every(([k, kind]) => {
          const i = Number(k);
          if (kind !== "ash") return false;
          if (!m.region || !m.regionBiome) return false;
          if (m.regionBiome[m.region[i]] !== "ashen") return false;
          return STAINABLE.includes(m.tiles[i]);
        });
      },
    );

    // deterministic, and it must leave room for the runtime decals stamped by kills
    // and burnouts rather than starting at the cap
    {
      const li = ashenLevels[0];
      const keys = (seed: string) =>
        Object.keys(beginLevel(seed, li, createPlayer()).decals)
          .sort()
          .join(",");
      check(
        "the scorch scatter is deterministic per seed",
        keys("ash1") === keys("ash1"),
      );
      check(
        "a different seed scorches different tiles",
        keys("ash1") !== keys("ash2"),
      );
      const n = Object.keys(
        beginLevel("ash1", li, createPlayer()).decals,
      ).length;
      check(
        "pre-seeded stains leave headroom under the decal cap",
        n > 0 && n < CONFIG.maxDecals / 2,
        `(${n} of a ${CONFIG.maxDecals} cap)`,
      );
    }

    // The stain has to be VISIBLE on the ground it lands on. This is the entire
    // reason `ash` exists as a kind: `scorch` (#120d08) sits at distance 56 from the
    // ashen floor (#241f1c) — under the 110 bar `[54]` treats as unreadable — so the
    // pre-seed was there but invisible in play. Guard the replacement so nobody
    // "simplifies" it back to scorch.
    {
      const li = ashenLevels[0];
      const g = beginLevel("ash1", li, createPlayer());
      const rid = (g.map.regionBiome ?? []).findIndex((b) => b === "ashen");
      const floor =
        (g.map.regionPalette ?? [])[rid]?.floor ?? LEVELS[li].palette.floor;
      check(
        "the ash stain is legible against the burned floor it lands on",
        colorDistance(DECAL_STYLE.ash.color, floor) > 110,
        `(ash ${DECAL_STYLE.ash.color} vs floor ${floor}: ${colorDistance(DECAL_STYLE.ash.color, floor).toFixed(0)})`,
      );
      check(
        "…and plain scorch would NOT have been (why `ash` exists)",
        colorDistance(DECAL_STYLE.scorch.color, floor) < 110,
        `(scorch vs floor: ${colorDistance(DECAL_STYLE.scorch.color, floor).toFixed(0)})`,
      );
    }

    // a level with no burned ground must not be pre-stained
    checkOver(
      "levels without an ashen region open clean",
      LEVELS.map((_, li) => li)
        .filter((li) => !ashenLevels.includes(li))
        .map((li) => ({ li })),
      ({ li }) =>
        Object.keys(beginLevel("ash1", li, createPlayer()).decals).length === 0,
    );
  }

  // ── flood plan shape ──
  {
    const floodLevels = LEVELS.map((l, i) => ({ l, i })).filter(
      ({ l }) => l.flood,
    );
    let protectedMin = Infinity;
    let openDoorsFloodable = 0;
    let spreadMin = Infinity;
    for (const { i } of floodLevels) {
      for (const seed of [
        "fs1",
        "fs2",
        "fs3",
        "fs4",
        "fs5",
        "fs6",
        "fs7",
        "fs8",
      ]) {
        const g = beginLevel(seed, i, createPlayer());
        const w = g.map.width;
        const fl = new Set(g.floodable ?? []);
        let prot = 0;
        for (let k = 0; k < g.map.tiles.length; k++) {
          const x = k % w;
          const y = Math.floor(k / w);
          if (!isWalkable(g.map, x, y)) continue;
          if (!fl.has(k)) prot++;
          if (g.map.tiles[k] === "doorOpen" && fl.has(k)) openDoorsFloodable++;
        }
        protectedMin = Math.min(protectedMin, prot);
        const ds = (g.floodSeeds ?? []).map((k) =>
          manhattan(k % w, Math.floor(k / w), g.player.x, g.player.y),
        );
        if (ds.length > 1)
          spreadMin = Math.min(spreadMin, Math.max(...ds) - Math.min(...ds));
      }
    }
    // The dry spine is dilated one tile, so it's a WALKABLE CORRIDOR rather than a
    // 1-tile tightrope. Calibrated: 93 protected tiles at baseline, 78 without the
    // dilation — re-measure this floor if the Sunken Crypt is resized.
    check(
      "the flood's dry spine is dilated, not a single-tile line",
      protectedMin >= 85,
      `(min protected walkable ${protectedMin})`,
    );
    check(
      "water flows THROUGH open doors (they're conduits, not dams)",
      openDoorsFloodable > 0,
      `(${openDoorsFloodable} floodable open doors)`,
    );
    // 11 baseline vs 0 when every seed is taken from the near end.
    check(
      "flood seeds span near→far, so water wells up all over",
      spreadMin >= 5,
      `(min near/far spread ${spreadMin})`,
    );
  }

  // ── a secret vault must be a ROOM, not a slot ──
  {
    let smallest = Infinity;
    for (const { i } of LEVELS.map((l, i) => ({ l, i })).filter(
      ({ l }) => l.secretVault,
    )) {
      for (const seed of ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"]) {
        const g = beginLevel(seed, i, createPlayer());
        const w = g.map.width;
        const reach = new Set<number>();
        const start = idx(g.player.x, g.player.y, w);
        reach.add(start);
        const stack = [start];
        while (stack.length) {
          const cur = stack.pop()!;
          const cx = cur % w;
          const cy = Math.floor(cur / w);
          for (const [dx, dy] of [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0],
          ]) {
            const nx = cx + dx;
            const ny = cy + dy;
            const ni = ny * w + nx;
            if (reach.has(ni) || !isWalkable(g.map, nx, ny)) continue;
            reach.add(ni);
            stack.push(ni);
          }
        }
        let sealed = 0;
        for (let k = 0; k < g.map.tiles.length; k++) {
          const x = k % w;
          const y = Math.floor(k / w);
          if (isWalkable(g.map, x, y) && !reach.has(k)) sealed++;
        }
        if (sealed > 0) smallest = Math.min(smallest, sealed);
      }
    }
    // 9 tiles at baseline (a 3×3 room) vs 3 when carved only 1 tile deep — a vault
    // needs room for a hoard AND a guardian placed away from the gate.
    check(
      "a secret vault is a room with space for loot and a guardian",
      smallest >= 6,
      `(smallest sealed area ${smallest} tiles)`,
    );
  }
}

// ─── 60. Inventory, snapshots & altar costs (fourth audit pass) ─────────────
// 29 mutations across the last unaudited pure files (`inventory`, `state`, `altar`,
// `lighting`) plus `gameStore`. These are the survivors that were real holes.
console.log("\n[60] Inventory, snapshots & altar costs");
{
  // (a) Equipping SWAPS — the replaced piece is stowed, never discarded, so
  // anything you find stays re-equippable and sellable. `[27]` covered the weapon
  // path; the ARMOR path had no test, and discarding it silently ate your gear.
  {
    const p = createPlayer("warrior");
    const old = p.armorId!;
    check("(setup) the warrior starts in armor", !!old);
    equipArmor(p, "a_plate");
    check(
      "equipping armor stows the old set instead of discarding it",
      p.armorId === "a_plate" && p.bag.some((b) => b.defId === old),
      `(bag: ${p.bag.map((b) => b.defId).join(",")})`,
    );
    check(
      "the newly worn armor left the bag",
      !p.bag.some((b) => b.defId === "a_plate"),
    );
  }

  // (b) `giveItem` auto-equips only an UPGRADE. Auto-equipping anything would
  // downgrade you off a picked-up rusty dagger late in the run.
  {
    const p = createPlayer("warrior");
    equipWeapon(p, "w_sun"); // best weapon in the game
    const power = p.weaponPower;
    giveItem(p, "w_dagger"); // strictly worse
    check(
      "picking up a WORSE weapon stows it rather than equipping it",
      p.weaponId === "w_sun" && p.weaponPower === power,
      `(wielding ${p.weaponId})`,
    );
    check(
      "the worse weapon is still kept (sellable)",
      p.bag.some((b) => b.defId === "w_dagger"),
    );
  }

  // (c) An ammo bundle yields `value` arrows, not one.
  {
    const p = createPlayer("wanderer");
    const before = p.bag.find((b) => b.defId === "am_arrow")?.count ?? 0;
    giveItem(p, "am_arrow");
    const gained =
      (p.bag.find((b) => b.defId === "am_arrow")?.count ?? 0) - before;
    check(
      "an ammo bundle grants its full arrow count",
      gained === (ITEMS.am_arrow.value ?? 1) && gained > 1,
      `(gained ${gained}, bundle ${ITEMS.am_arrow.value})`,
    );
  }

  // (d) `clonePlayer` must DEEP-copy the bag and effects. Sharing them by reference
  // means the shop, the save, and the death-restart snapshot all mutate each other.
  {
    const p = createPlayer("warrior");
    giveItem(p, "p_heal");
    p.effects.ward = 3;
    const c = clonePlayer(p);
    c.bag.push({ defId: "p_bomb", count: 1 });
    c.effects.might = 5;
    if (c.bag[0]) c.bag[0].count += 99;
    check(
      "clonePlayer deep-copies the bag (no aliasing)",
      p.bag.length !== c.bag.length && p.bag[0].count !== c.bag[0].count,
    );
    check(
      "clonePlayer deep-copies the effects bag",
      p.effects.might === undefined,
    );
  }

  // (e) `beginLevel`'s `entryPlayer` is the DEATH-RESTART snapshot: the store replays
  // a level from it after you die. If it aliases the live player, your restart
  // inherits the damage and spent consumables that killed you — the snapshot would
  // be worthless in exactly the moment it matters.
  {
    const g = beginLevel("snap", 0, createPlayer("warrior"));
    const hp0 = g.entryPlayer.hp;
    const bag0 = g.entryPlayer.bag.length;
    g.player.hp = 1;
    g.player.bag.push({ defId: "p_bomb", count: 1 });
    g.player.effects.poison = 4;
    check(
      "the entry snapshot doesn't alias the live player",
      g.entryPlayer.hp === hp0 &&
        g.entryPlayer.bag.length === bag0 &&
        g.entryPlayer.effects.poison === undefined,
      `(snapshot hp ${g.entryPlayer.hp} vs live ${g.player.hp})`,
    );
  }

  // (f) An altar is a BARGAIN: spent once, and each boon has a real price.
  {
    const mk = (kind: "vigor" | "warblood" | "hoard") => {
      const g = beginLevel("altar-cost", 0, createPlayer("warrior"));
      g.player.coins = 500;
      g.player.maxHp = 60;
      g.player.hp = 60;
      const a = { id: "a", x: g.player.x, y: g.player.y, kind, used: false };
      g.altars = [a];
      return { g, a };
    };
    // spent-once
    {
      const { g, a } = mk("vigor");
      applyAltar(g, a);
      const coinsAfter = g.player.coins;
      const hpAfter = g.player.maxHp;
      const second = applyAltar(g, a);
      check(
        "a spent altar refuses to pay out again",
        second === null &&
          g.player.coins === coinsAfter &&
          g.player.maxHp === hpAfter,
      );
    }
    // each bargain costs what it says
    {
      const { g, a } = mk("vigor");
      const c0 = g.player.coins;
      applyAltar(g, a);
      check(
        "the vigor altar charges gold",
        g.player.coins < c0,
        `(${c0} → ${g.player.coins})`,
      );
    }
    {
      const { g, a } = mk("warblood");
      const m0 = g.player.maxHp;
      applyAltar(g, a);
      check(
        "the warblood altar charges maxHP",
        g.player.maxHp < m0,
        `(${m0} → ${g.player.maxHp})`,
      );
      check(
        "…and grants the weapon bonus it promises",
        g.player.weaponBonus > 0,
      );
    }
    {
      const { g, a } = mk("hoard");
      const h0 = g.player.hp;
      applyAltar(g, a);
      check(
        "the hoard altar charges blood",
        g.player.hp < h0,
        `(${h0} → ${g.player.hp})`,
      );
      check(
        "…and pays out gold + potions",
        g.player.coins > 500 && g.player.bag.length > 0,
      );
    }
  }
}

// ─── 61. Camera / viewport math ─────────────────────────────────────────────
// The renderer had ZERO automated coverage — 1,288 lines reachable only by eye. Most
// of it genuinely needs a canvas, but the camera is pure arithmetic and an off-by-one
// in either clamp is a VISIBLE bug: a strip of dead space along a map edge, or the
// player sliding off-centre. `cameraOrigin` was extracted from `renderBase` so this
// could be asserted; the renderer now calls it, so these aren't testing a copy.
console.log("\n[61] Camera / viewport math");
{
  const COLS = 40;
  const ROWS = 20;
  const W = 100;
  const H = 60;
  const at = (x: number, y: number) => cameraOrigin(x, y, COLS, ROWS, W, H);

  // centred in open country
  {
    const c = at(50, 30);
    check(
      "the camera centres on the player mid-map",
      c.camX === 50 - COLS / 2 && c.camY === 30 - ROWS / 2,
      `(${c.camX},${c.camY})`,
    );
  }
  // clamped at the top-left: never negative, or you'd scroll off-map
  {
    const c = at(0, 0);
    check(
      "the camera clamps at the top-left origin",
      c.camX === 0 && c.camY === 0,
    );
  }
  // clamped at the bottom-right: the last column/row of the map must be the last
  // column/row of the view — one too far leaves a dead strip on screen
  {
    const c = at(W - 1, H - 1);
    check(
      "the camera clamps flush to the bottom-right edge",
      c.camX === W - COLS && c.camY === H - ROWS,
      `(${c.camX},${c.camY}; expected ${W - COLS},${H - ROWS})`,
    );
  }
  // the player must always be INSIDE the viewport, everywhere on the map
  checkOver(
    "the player is always within the viewport",
    Array.from({ length: 300 }, (_, n) => ({
      x: (n * 7) % W,
      y: (n * 11) % H,
    })),
    ({ x, y }) => {
      const c = at(x, y);
      return (
        x >= c.camX && x < c.camX + COLS && y >= c.camY && y < c.camY + ROWS
      );
    },
  );
  // a viewport bigger than the map pins to the origin rather than going negative
  {
    const c = cameraOrigin(2, 2, 80, 40, 30, 20);
    check(
      "a viewport larger than the map pins to the origin",
      c.camX === 0 && c.camY === 0,
      `(${c.camX},${c.camY})`,
    );
  }
  // and it holds for every real level's dimensions, at all four corners + centre
  checkOver(
    "every level's dimensions keep the player on screen at the corners",
    LEVELS.flatMap((l) =>
      [
        [0, 0],
        [l.mapWidth - 1, 0],
        [0, l.mapHeight - 1],
        [l.mapWidth - 1, l.mapHeight - 1],
        [l.mapWidth >> 1, l.mapHeight >> 1],
      ].map(([x, y]) => ({ l, x, y })),
    ),
    ({ l, x, y }) => {
      const c = cameraOrigin(x, y, COLS, ROWS, l.mapWidth, l.mapHeight);
      const inX = c.camX >= 0 && (x >= c.camX || l.mapWidth <= COLS);
      const inY = c.camY >= 0 && (y >= c.camY || l.mapHeight <= ROWS);
      return inX && inY;
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [62] Hotbar slots are STABLE
//
// The premise of the always-up bag panel: a number key must mean the same item
// for the whole run. Bag order is append-and-compact (`removeOneFromBag`
// splices), so anything derived from the array INDEX silently repoints the
// moment a stack empties — which is precisely when you're staring at your HP
// bar and not at the panel. These pin the property, not the plumbing.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[62] Hotbar slots are stable");
{
  // Absolute anchor for every slot-number assertion below: the dial is sane and
  // the keys it promises actually exist on a keyboard. Without this, zeroing
  // HOTBAR_SLOTS would make "no slot was assigned" trivially true everywhere.
  check(
    "HOTBAR_SLOTS covers the 1-9 keys keymap.ts binds",
    HOTBAR_SLOTS === 9,
    `(got ${HOTBAR_SLOTS})`,
  );

  // ── one entry per item id, gear included ──
  // A BagEntry is {defId, count} with no per-instance state, so a second entry
  // for the same id carries no information and only shows up as bugs: duplicate
  // sheet rows all printing the SAME slot number (one claim, keyed by def id).
  // Gear is the case that regressed — it used to be excluded from stacking.
  {
    const p = createPlayer("wanderer");
    p.bag = [];
    p.slotMap = {};
    giveItem(p, "a_plate"); // better than the starting armor → worn, not bagged
    giveItem(p, "a_leather");
    giveItem(p, "a_leather");
    giveItem(p, "a_leather");
    const rows = p.bag.filter((b) => b.defId === "a_leather");
    check(
      "picking up the same armor three times makes ONE stack of 3",
      rows.length === 1 && rows[0]?.count === 3,
      `(${rows.length} row(s): ${JSON.stringify(rows)})`,
    );
    check(
      "…holding exactly one slot, so no two rows can print the same number",
      new Set(p.bag.map((b) => p.slotMap[b.defId])).size === p.bag.length,
      `(bag ${p.bag.map((b) => b.defId).join(",")}, ${JSON.stringify(p.slotMap)})`,
    );
    // equipping pulls a single copy off the stack rather than the whole pile
    equipArmor(p, "a_leather");
    check(
      "equipping from a stack takes one copy and stows the old armor",
      (p.bag.find((b) => b.defId === "a_leather")?.count ?? 0) === 2 &&
        p.armorId === "a_leather" &&
        p.bag.some((b) => b.defId === "a_plate"),
      `(${JSON.stringify(p.bag)})`,
    );
  }

  // ── allocation is lowest-free, in acquisition order ──
  {
    const p = createPlayer("wanderer");
    p.bag = [];
    p.slotMap = {};
    addToBag(p, "p_heal");
    addToBag(p, "p_bomb");
    addToBag(p, "p_ward");
    check(
      "slots are handed out lowest-free in acquisition order",
      p.slotMap["p_heal"] === 1 &&
        p.slotMap["p_bomb"] === 2 &&
        p.slotMap["p_ward"] === 3,
      `(${JSON.stringify(p.slotMap)})`,
    );
  }

  // ── THE property: a claim outlives its stack ──
  {
    const p = createPlayer("wanderer");
    p.bag = [];
    p.slotMap = {};
    addToBag(p, "p_heal");
    addToBag(p, "p_bomb", 2);
    addToBag(p, "p_ward");
    const bombSlot = p.slotMap["p_bomb"];
    // burn the whole firebomb stack — the entry leaves the bag entirely
    removeOneFromBag(p, "p_bomb");
    removeOneFromBag(p, "p_bomb");
    check(
      "exhausting a stack removes its bag entry",
      !p.bag.some((b) => b.defId === "p_bomb"),
      `(bag: ${p.bag.map((b) => b.defId).join(",")})`,
    );
    check(
      "…but the other items keep the numbers they had",
      p.slotMap["p_heal"] === 1 && p.slotMap["p_ward"] === 3,
      `(${JSON.stringify(p.slotMap)})`,
    );
    // the regression this whole feature exists to prevent: pressing the spent
    // key must hit NOTHING, never the item that slid up into its place
    check(
      "the spent slot resolves to nothing, not to a neighbour",
      bagEntryForSlot(p, bombSlot) === undefined,
      `(slot ${bombSlot} -> ${bagEntryForSlot(p, bombSlot)?.defId})`,
    );
    // Rebuy at the shop — it must come back to the SAME key. Slot 1 is emptied
    // first on purpose: an implementation that released claims on exhaustion
    // would hand the rebought bombs slot 1 (lowest free), so this distinguishes
    // stickiness from mere coincidence. Without it the check passes either way.
    removeOneFromBag(p, "p_heal");
    addToBag(p, "p_bomb", 3);
    check(
      "re-acquiring an item returns it to its original slot, not the lowest free",
      p.slotMap["p_bomb"] === bombSlot && bombSlot === 2,
      `(slot ${p.slotMap["p_bomb"]}, was ${bombSlot})`,
    );
  }

  // ── a freed number is not poached while its owner is still carried ──
  {
    const p = createPlayer("wanderer");
    p.bag = [];
    p.slotMap = {};
    addToBag(p, "p_heal");
    addToBag(p, "p_bomb");
    removeOneFromBag(p, "p_heal"); // slot 1 now spent but still claimed
    addToBag(p, "p_antidote");
    check(
      "a new item takes a fresh number rather than a spent-but-claimed one",
      p.slotMap["p_antidote"] === 3 && p.slotMap["p_heal"] === 1,
      `(${JSON.stringify(p.slotMap)})`,
    );
  }

  // ── eviction: only under pressure, and only from an item you no longer hold ──
  {
    const p = createPlayer("wanderer");
    p.bag = [];
    p.slotMap = {};
    // claim every slot, all still carried
    const ids = [
      "p_heal",
      "p_gheal",
      "p_bomb",
      "p_ward",
      "p_might",
      "p_detect",
      "p_antidote",
      "p_blink",
      "p_ruin",
    ];
    for (const id of ids) addToBag(p, id);
    check(
      "a full hotbar claims exactly the 9 keyed slots",
      new Set(Object.values(p.slotMap)).size === 9 &&
        Math.min(...Object.values(p.slotMap)) === 1 &&
        Math.max(...Object.values(p.slotMap)) === 9,
      `(${JSON.stringify(p.slotMap)})`,
    );
    // a 10th item, with every slot claimed BY A CARRIED ITEM, gets none
    addToBag(p, "w_short");
    check(
      "overflow past the keys gets no slot (sheet-only) rather than stealing one",
      p.slotMap["w_short"] === undefined &&
        ids.every((id) => p.slotMap[id] !== undefined),
      `(${JSON.stringify(p.slotMap)})`,
    );
    // …and it doesn't stay sheet-only forever: the moment a key frees up, the
    // carried-but-unslotted item claims it rather than waiting for a new pickup.
    removeOneFromBag(p, "p_might");
    const freed = p.slotMap["p_might"];
    syncBagSlots(p);
    check(
      "a carried but unslotted item claims the first key that frees up",
      p.slotMap["w_short"] === freed && p.slotMap["p_might"] === undefined,
      `(freed ${freed}, ${JSON.stringify(p.slotMap)})`,
    );
  }

  // ── eviction: only under pressure, and only from an item you no longer hold ──
  {
    const p = createPlayer("wanderer");
    p.bag = [];
    p.slotMap = {};
    const ids = [
      "p_heal",
      "p_gheal",
      "p_bomb",
      "p_ward",
      "p_might",
      "p_detect",
      "p_antidote",
      "p_blink",
      "p_ruin",
    ];
    for (const id of ids) addToBag(p, id);
    removeOneFromBag(p, "p_might"); // its claim is now stale, nothing else wants one
    const freed = p.slotMap["p_might"];
    check(
      "a stale claim survives while nothing needs the key",
      freed === 5 && p.slotMap["p_might"] === freed,
      `(${JSON.stringify(p.slotMap)})`,
    );
    addToBag(p, "w_axe"); // needs a slot; the only reclaimable one is `freed`
    check(
      "under pressure, eviction takes the slot of an item no longer carried",
      p.slotMap["w_axe"] === freed && p.slotMap["p_might"] === undefined,
      `(freed ${freed}, ${JSON.stringify(p.slotMap)})`,
    );
    check(
      "…and never one belonging to an item still in the bag",
      ids
        .filter((id) => id !== "p_might")
        .every((id) => p.slotMap[id] !== undefined),
      `(${JSON.stringify(p.slotMap)})`,
    );
  }

  // ── the panel's view: holes are rendered, not compacted away ──
  {
    const p = createPlayer("wanderer");
    p.bag = [];
    p.slotMap = {};
    addToBag(p, "p_heal");
    addToBag(p, "p_bomb");
    addToBag(p, "p_ward");
    removeOneFromBag(p, "p_bomb");
    const rows = hotbar(p);
    check(
      "hotbar() keeps a spent slot as a hole so the numbering stays readable",
      rows.length === 3 &&
        rows[0]?.defId === "p_heal" &&
        rows[1] === null &&
        rows[2]?.defId === "p_ward",
      `(${JSON.stringify(rows.map((r) => r?.defId ?? null))})`,
    );
  }

  // ── the snapshot lesson from [60]: entryPlayer must not alias the hotbar ──
  {
    const p = createPlayer("wanderer");
    const c = clonePlayer(p);
    c.slotMap["p_bomb"] = 7;
    check(
      "clonePlayer copies slotMap rather than aliasing it",
      p.slotMap["p_bomb"] === undefined,
      `(${JSON.stringify(p.slotMap)})`,
    );
  }

  // ── every class starts with a usable hotbar (the kit is a literal) ──
  checkOver(
    "every class's starting kit comes with its slots assigned",
    CLASS_LIST.map((c) => createPlayer(c.id)),
    (p) =>
      p.bag.every((b) => {
        const n = p.slotMap[b.defId];
        return n !== undefined && n >= 1 && n <= HOTBAR_SLOTS;
      }),
  );

  // ── JSON-safety: slotMap has to survive the save like everything else ──
  {
    const p = createPlayer("pyromancer");
    const round = JSON.parse(JSON.stringify(p.slotMap));
    check(
      "slotMap roundtrips through JSON intact",
      Object.keys(p.slotMap).length > 0 &&
        JSON.stringify(round) === JSON.stringify(p.slotMap),
      `(${JSON.stringify(p.slotMap)})`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [63] The shop can't be farmed
//
// Every sellable thing must be worth LESS at the counter than it cost, or the
// shop becomes a money printer and the deliberately lean economy — the thing
// that makes "what can I afford?" a real question — stops meaning anything.
// This escaped for a long time on arrows: `ItemDef.value` means "arrows per
// BUNDLE" for ammo, so a purchase was 8g for twelve, while `sellBagItem` paid
// per single arrow (2g) — buy one bundle, sell it back for 24g, repeat forever
// (arrows carry no `maxQty`). Nothing caught it because the balance harness
// never sells, and the per-item prices all look sane in isolation. The bug only
// exists in the RATIO, so that's what this checks.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[63] The shop can't be farmed");
{
  // cheapest listing per item across all tiers = the best rate a player can get
  const cheapest = new Map<string, ShopEntry>();
  for (const tier of Object.values(SHOP_TIERS))
    for (const e of tier)
      if (!cheapest.has(e.itemId) || e.price < cheapest.get(e.itemId)!.price)
        cheapest.set(e.itemId, e);

  checkOver(
    "no shop item can be bought and sold back at a profit",
    [...cheapest.entries()],
    ([id, entry]) => {
      const def = ITEMS[id];
      // ammo arrives as a bundle of `value`; everything else is one per purchase
      const qty = def.category === "ammo" ? (def.value ?? 1) : 1;
      return sellPrice(def) * qty < entry.price;
    },
    5,
  );

  // The absolute anchor the ratio check needs: with nothing sellable at all the
  // rule above is vacuously true, so pin that selling is still a real feature.
  checkOver(
    "…while ordinary gear and potions remain sellable for something",
    Object.values(ITEMS).filter(
      (d) => d.category === "weapon" || d.category === "potion",
    ),
    (d) => sellPrice(d) > 0,
  );

  // Ammo specifically: bundle-priced, so it must not be sellable per unit.
  check(
    "bundle-priced ammo is not sellable one arrow at a time",
    sellPrice(ITEMS["am_arrow"]) === 0,
    `(pays ${sellPrice(ITEMS["am_arrow"])}/arrow for a ${ITEMS["am_arrow"].value}-arrow bundle)`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [64] Log colour-coding
//
// The message log is prose, so its colour comes from a keyword heuristic — and a
// heuristic over prose silently rots the moment someone rewords a message. These
// lines are taken from the REAL templates in `actions/index.ts` / `status.ts`
// with the interpolations filled in; if you change the wording there and the
// colour moves, this is what says so.
//
// It exists because the first version keyed on `/for \d+/`, which cannot tell
// "You strike the Skeleton for 8" from "The Skeleton hits you for 2" — so your
// own hits were painted as injuries. The rule now is grammatical: harm names YOU
// as the object.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[64] Log colour-coding");
{
  const CASES: [string, string][] = [
    // your own blows — numbers, but you are the subject
    ["You strike the Skeleton for 8 (4 left).", "attack"],
    ["Critical! You strike the Goblin for 14 (2 left).", "attack"],
    ["Sneak attack! You hit the Skeleton for 12 (0 left).", "attack"],
    ["Out of arrows — you jab the Goblin for 1.", "attack"],
    ["You batter down the Skeleton with your bow.", "attack"],
    ["You smash the Goblin clean through a cracked wall!", "attack"],
    ["You hack at the cracked wall. (2 more)", "attack"],
    // deaths
    ["You slay the Skeleton.", "kill"],
    ["The Goblin succumbs.", "kill"],
    // harm — you are the object
    ["The Skeleton hits you for 2.", "harm"],
    ["The Bog Imp hurls a bolt for 3.", "harm"],
    ["Dark fire crashes down on you for 12!", "harm"],
    ["A hidden spike trap! You take 4 damage.", "harm"],
    ["The volatile creature bursts apart — the blast catches you!", "harm"],
    ["You choke on a lungful of spores!", "harm"],
    ["Thorns rake you — you're bleeding.", "harm"],
    ["The Gargoyle Sentinel hurls you off the edge into the void!", "harm"],
    ["The Gargoyle Sentinel throws you back.", "harm"],
    ["The Gargoyle Sentinel looms — the void yawns at your back!", "harm"],
    ["You are poisoned!", "harm"],
    ["You catch fire!", "harm"],
    // …but the SAME status template aimed at a monster is not harm to you
    ["The Skeleton is poisoned!", "neutral"],
    // healed / warded
    ["You drink the Healing Potion. (+10 hp)", "good"],
    ["You gather wild growth — +1 HP.", "good"],
    ["A shimmer of warding wraps you. (6 turns)", "good"],
    // loot
    ["You pick up 6 gold.", "gain"],
    ["You pick up a Healing Potion.", "gain"],
    ["You recover a Sunblade.", "gain"],
    ["You gather 12 Arrows.", "gain"],
    // ordinary chatter
    ["You stow the Chainmail.", "neutral"],
    ["You shove the door open.", "neutral"],
    ["The Skeleton drops a Healing Potion.", "neutral"],
    ["Your torch gutters out. The dark closes back in.", "neutral"],
    ["The water rises higher.", "neutral"],
  ];

  checkOver(
    "every real message line lands in its intended category",
    CASES,
    ([line, want]) => classifyLog(line).kind === want,
    20,
  );

  // The inversion this section exists to prevent, called out on its own so a
  // regression names itself rather than hiding in the sweep above.
  check(
    "your own hit is NOT coloured as harm",
    classifyLog("You strike the Skeleton for 8 (4 left).").kind !== "harm",
    `(got ${classifyLog("You strike the Skeleton for 8 (4 left).").kind})`,
  );
  check(
    "…and is visibly distinct from being hit",
    classifyLog("You strike the Skeleton for 8 (4 left).").color !==
      classifyLog("The Skeleton hits you for 2.").color &&
      classifyLog("You strike the Skeleton for 8 (4 left).").glyph !==
        classifyLog("The Skeleton hits you for 2.").glyph,
  );

  // ── cause of death: the last harm line, for the game-over screen ──
  {
    const run = [
      "You pick up 6 gold.",
      "The Wraith hits you for 5.",
      "You strike the Wraith for 8 (6 left).",
      "You are bleeding!",
      "You stow the Chainmail.",
    ];
    check(
      "cause of death is the LAST harm line, not the first or the newest",
      causeOfDeath(run) === "You are bleeding!",
      `(got ${causeOfDeath(run)})`,
    );
    const bled = ["You slay the Goblin.", "The bleed claims you."];
    check(
      "…a bleed-out is attributed, not just a melee blow",
      causeOfDeath(bled) === "The bleed claims you.",
      `(got ${causeOfDeath(bled)})`,
    );
    check(
      "…and your own attacks are never mistaken for what killed you",
      causeOfDeath(["You strike the Skeleton for 8 (4 left)."]) === null,
      `(got ${causeOfDeath(["You strike the Skeleton for 8 (4 left)."])})`,
    );
    check(
      "a log with no harm at all yields null rather than a wrong line",
      causeOfDeath(["You pick up 6 gold.", "You shove the door open."]) ===
        null,
    );
  }

  // Absolute anchors: without these the rules above could all collapse to one
  // category and the mapping assertions would still be satisfiable.
  checkOver(
    "every category is actually reachable from a real message",
    ["kill", "harm", "good", "gain", "attack", "neutral"],
    (kind) => CASES.some(([line]) => classifyLog(line).kind === kind),
    6,
  );
  checkOver(
    "no two categories share BOTH a colour and a glyph",
    ["kill", "harm", "good", "gain", "attack", "neutral"].flatMap((a, i, all) =>
      all.slice(i + 1).map((b) => [a, b] as const),
    ),
    ([a, b]) => {
      const x = CASES.find(([l]) => classifyLog(l).kind === a)![0];
      const y = CASES.find(([l]) => classifyLog(l).kind === b)![0];
      const sx = classifyLog(x);
      const sy = classifyLog(y);
      return sx.color !== sy.color || sx.glyph !== sy.glyph;
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [65] Objective text says each number ONCE
//
// The HUD row renders progress as pips plus an "N of M" count, so a count baked
// into the label too is the same figure said three times (that shipped: "Collect
// Moonstone Shards (*) — 0/3  ◇◇◇  0 of 3"). `goalTitle` is the countless form
// the HUD uses; `goalLabel` adds the count back for the intro card, which has no
// pips of its own. The split only helps if it stays split.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[65] Objective text says each number once");
{
  // Flattened to the STRINGS under test, not the states that produced them —
  // `checkOver` names the offending item, and a raw GameState in that slot is a
  // wall of JSON that tells you nothing about which text was wrong.
  const rows = LEVELS.map((l, i) => {
    const g = beginLevel("goal-text", i, createPlayer("warrior"));
    const p = goalProgress(g);
    return {
      id: l.id,
      type: l.goal.type,
      title: goalTitle(g),
      label: goalLabel(g),
      progress: p ? `${p.current}/${p.total}` : null,
    };
  });

  checkOver(
    "the HUD's goal title never carries a progress count",
    rows,
    (r) => !/\d+\s*\/\s*\d+/.test(r.title),
  );

  // …the pips supply it instead, on the goals that have one.
  const countable = rows.filter((r) => r.progress !== null);
  check(
    "at least one real level actually has a countable goal",
    countable.length > 0,
    `(${countable.length} of ${rows.length})`,
  );
  // The intro card has no pips, so it MUST still state the numbers inline.
  checkOver(
    "the intro-card label still spells out countable progress",
    countable,
    (r) => r.label.includes(r.progress!),
  );

  // Survive is the same trap wearing a different hat: row 1's HOLD gauge already
  // counts the turns down, so the title must not repeat them.
  const survive = rows.find((r) => r.type === "survive");
  if (survive) {
    check(
      "a survive title defers its countdown to the HOLD gauge",
      !/\d/.test(survive.title),
      `(${survive.title})`,
    );
    check(
      "…while the intro card still names the turn count",
      /\d+ turns/.test(survive.label),
      `(${survive.label})`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [66] HUD chrome legibility
//
// [54] does this job for the ASCII grid; the HUD had none, and the slate
// redesign introduced a dozen new greys sitting on near-black panels. The
// components and this test read the SAME `hud/palette.ts`, so a tweak there is
// measured rather than merely re-typed.
//
// Two tiers on purpose. TEXT has to be readable. STRUCTURE — borders, dotted
// rules, empty-slot dashes — only has to register as present, so it sits far
// below the text bar by design and holding it to one would be a false failure.
//
// Floors are regression floors calibrated just under the measured value, not
// absolute standards. Where a real standard exists (WCAG AA at 4.5) it's used as
// an absolute anchor so a "passing" number can't drift into genuinely unreadable.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[66] HUD chrome legibility");
{
  // ── text you actually read ──
  checkOver(
    "primary + secondary HUD text clears WCAG AA on its own panel",
    [
      { what: "fg on panel", fg: TEXT.primary, bg: BG.panel },
      { what: "fg on header", fg: TEXT.primary, bg: BG.header },
      { what: "section header", fg: TEXT.secondary, bg: BG.panel },
      { what: "row-2 labels", fg: TEXT.secondary, bg: BG.header },
      { what: "footer text", fg: TEXT.footer, bg: BG.footer },
      { what: "footer key letter", fg: TEXT.key, bg: BG.footer },
    ],
    (r) => contrastRatio(r.fg, r.bg) >= 4.5,
  );

  // The one deliberately-faint caption. It sits BELOW AA (measured 2.72) because
  // "PRESS 1-9" is a hint, not content — pinned so it can't quietly get fainter.
  {
    const r = contrastRatio(TEXT.tertiary, BG.panel);
    check(
      "the faintest HUD caption is quiet but not invisible",
      r >= 2.4 && r < 4.5,
      `(ratio ${r.toFixed(2)} — under AA by design; if this rises above 4.5 the tier collapsed)`,
    );
  }

  // ── the log rail: every category readable, and mutually tellable apart ──
  const LOG_SAMPLES = [
    "You slay the Skeleton.",
    "The Skeleton hits you for 2.",
    "You drink the Healing Potion. (+10 hp)",
    "You pick up 6 gold.",
    "You strike the Skeleton for 8 (4 left).",
    "You stow the Chainmail.",
  ];
  const cats = LOG_SAMPLES.map(classifyLog);
  checkOver(
    "every log category clears WCAG AA against the rail",
    cats,
    (c) => contrastRatio(c.color, BG.panel) >= 4.5,
    6,
  );
  // Separation rule: a pair is distinguishable if the GLYPHS differ (the glyph
  // is the signal — the same reasoning [54] uses for traps), or, when they share
  // one, if the glyph colours are far apart. Only good/gain share a glyph today,
  // at a measured 329.
  checkOver(
    "no two log categories are confusable",
    cats.flatMap((a, i) => cats.slice(i + 1).map((b) => ({ a, b }))),
    ({ a, b }) =>
      a.glyph !== b.glyph || colorDistance(a.glyphColor, b.glyphColor) >= 200,
    10,
  );

  // ── gauges: the read is FILLED vs EMPTY, not either against the panel ──
  check(
    "a filled vitality block is tellable from an empty one",
    colorDistance("#3fbf3f", MARK.gaugeEmpty) >= 150 &&
      colorDistance("#ff5555", MARK.gaugeEmpty) >= 150,
    `(healthy ${Math.round(colorDistance("#3fbf3f", MARK.gaugeEmpty))}, low ${Math.round(colorDistance("#ff5555", MARK.gaugeEmpty))})`,
  );
  checkOver(
    "a filled objective pip is tellable from an empty one, on every level",
    LEVELS,
    (l) => colorDistance(l.palette.accent, MARK.pipEmpty) >= 120,
  );

  // ── structure: present, not readable ──
  checkOver(
    "structural marks register against their panel without competing with text",
    [
      { what: "frame border", c: MARK.frame, bg: BG.panel },
      { what: "corner glyph", c: MARK.corner, bg: BG.panel },
      { what: "empty item slot", c: MARK.emptySlot, bg: BG.panel },
      { what: "row separator", c: MARK.separator, bg: BG.panel },
    ],
    (r) => {
      const d = colorDistance(r.c, r.bg);
      // visible at all, and quieter than the secondary text above it
      return d >= 45 && d < colorDistance(TEXT.secondary, BG.panel);
    },
  );

  // ── region edges ──
  // The gutter separates the PANELS by fill (measured 30). It does NOT separate
  // the map that way — gutter vs map plate is ~8, i.e. nothing — so the map's
  // edge is carried entirely by its border, and that's what's worth pinning.
  // Asserting the fills instead would have been a threshold tuned to pass.
  check(
    "panel plates read as distinct from the gutter behind them",
    colorDistance(BG.shell, BG.panel) >= 25,
    `(${Math.round(colorDistance(BG.shell, BG.panel))})`,
  );
  check(
    "the map region's edge is carried by its border, on both sides",
    colorDistance(MARK.mapBorder, BG.map) >= 60 &&
      colorDistance(MARK.mapBorder, BG.shell) >= 60,
    `(vs map ${Math.round(colorDistance(MARK.mapBorder, BG.map))}, vs gutter ${Math.round(colorDistance(MARK.mapBorder, BG.shell))})`,
  );
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`,
);
process.exit(failures === 0 ? 0 : 1);
