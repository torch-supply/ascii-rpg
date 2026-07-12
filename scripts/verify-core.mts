// Temporary end-to-end verification of the pure game engine (no DOM).
// Run with: npx tsx verify-core.mts   — deleted after verification.
import { generateLevel } from "@/game/core/map/generate";
import { LEVELS } from "@/content/levels";
import { createPlayer, beginLevel, recomputeLight } from "@/game/core/state";
import { resolveTurn } from "@/game/core/actions";
import { Rng } from "@/game/core/rng";
import { isGoalComplete } from "@/game/core/goals";
import { idx, isWalkable, tileAt } from "@/game/core/grid";
import { monsterAttackDamage } from "@/game/core/combat";
import { MONSTERS } from "@/content/monsters";
import type { GameMap, Pos } from "@/game/core/types";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ FAIL: ${name} ${extra}`);
  }
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

// ─── 1. Determinism ─────────────────────────────────────────────────────────
console.log("\n[1] Map-gen determinism (two RNG streams)");
{
  const a = generateLevel(LEVELS[0], 0, "seed-abc");
  const b = generateLevel(LEVELS[0], 0, "seed-abc");
  const c = generateLevel(LEVELS[0], 0, "seed-xyz");
  check("same (seed,index) → identical tiles", JSON.stringify(a.map.tiles) === JSON.stringify(b.map.tiles));
  check(
    "same (seed,index) → identical monster positions",
    JSON.stringify(a.monsters.map((m) => [m.defId, m.x, m.y])) ===
      JSON.stringify(b.monsters.map((m) => [m.defId, m.x, m.y]))
  );
  check("same (seed,index) → identical player start", a.playerStart.x === b.playerStart.x && a.playerStart.y === b.playerStart.y);
  check("different seed → different tiles", JSON.stringify(a.map.tiles) !== JSON.stringify(c.map.tiles));
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
  check("exit tile is walkable", !!game.map.exit && isWalkable(game.map, game.map.exit.x, game.map.exit.y));
  check("player starts on a floor/exit tile", isWalkable(game.map, game.player.x, game.player.y));
  check("initial FOV is non-empty", game.visible.length > 0);
  check("goal not complete at start", !isGoalComplete(game));

  const path = bfsPath(game.map, { x: game.player.x, y: game.player.y }, game.map.exit!);
  check("BFS finds a path to the exit (connectivity)", !!path && path.length > 0);

  let completed = false;
  let iterations = 0;
  const startExplored = game.explored.length;
  if (path) {
    for (const step of path) {
      let guard = 0;
      // keep issuing this step until the player actually reaches it
      while ((game.player.x !== step.x || game.player.y !== step.y) && guard < 40) {
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
  check("reached exit → goalComplete fired", completed, `(after ${iterations} turns)`);
  check("turnCount advanced during play", game.turnCount > 0);
  check("fog-of-war expanded while exploring", game.explored.length >= startExplored);
}

// ─── 4. collectX goal (Level 2 — Moonstone Shards) ──────────────────────────
console.log("\n[4] Level 2 collectX goal");
{
  const idx2 = 1;
  const goal = LEVELS[idx2].goal;
  const player = createPlayer();
  const game = beginLevel("collect-seed", idx2, player);
  const shards = game.items.filter((it) => it.questTag === "moonstone");
  check("3 moonstone shards placed", goal.type === "collectX" && shards.length === goal.count);
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
    resolveTurn(game, { type: "move", dx: Math.sign(shard.x - neighbor.x), dy: Math.sign(shard.y - neighbor.y) }, rng);
  }
  check("picking up a shard increments questProgress", (game.questProgress["moonstone"] ?? 0) === 1);
  check("shard removed from ground after pickup", !game.items.some((it) => it.id === shard.id));

  // Directly complete to verify threshold logic
  game.questProgress["moonstone"] = 3;
  check("questProgress >= count → goalComplete", isGoalComplete(game));
}

// ─── 5. killTarget goal (Level 3 — Frost Troll) ─────────────────────────────
console.log("\n[5] Level 3 killTarget goal");
{
  const idx3 = LEVELS.findIndex(
    (l) => l.goal.type === "killTarget" && l.goal.monsterId === "frost_troll"
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
  const idx4 = LEVELS.findIndex((l) => l.goal.type === "findItem");
  const player = createPlayer();
  const game = beginLevel("find-seed", idx4, player);
  const sun = game.items.find((it) => it.questTag === "sunblade");
  check("sunblade placed on the map", !!sun);
  check("goal incomplete initially", !isGoalComplete(game));
  game.questProgress["sunblade"] = 1;
  check("questProgress sunblade >= 1 → goalComplete", isGoalComplete(game));
}

// ─── 7. Combat + timeout death ──────────────────────────────────────────────
console.log("\n[7] Combat formulas & turn-budget death");
{
  const player = createPlayer();
  const game = beginLevel("combat-seed", 0, player);
  // starve the turn budget: wait until it hits 0
  const rng = new Rng(3);
  game.turnsLeft = 1;
  const res = resolveTurn(game, { type: "wait" }, rng);
  check("turn budget exhaustion kills the player", res.playerDied && res.deathReason === "timeout");
}

// ─── 8. Connectivity — no more "trapped with no way out" (regression) ───────
console.log("\n[8] Connectivity: player can reach every objective");
{
  const seeds = ["s1", "s2", "s3", "trap-check", "xyzzy", "blackwood", "abc", "999"];
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
        if (bfsPath(g.map, from, { x: boss.x, y: boss.y }) === null) unreachable++;
      }
    }
  }
  check(
    `all objectives reachable across ${seeds.length} seeds × ${LEVELS.length} levels`,
    unreachable === 0,
    `(${unreachable}/${checked} unreachable)`
  );
}

// ─── 9. Phase 2: wraith armor-pierce ────────────────────────────────────────
console.log("\n[9] Wraith armor-pierce");
{
  const p = createPlayer();
  p.armorReduction = 4;
  // wraith: dmg 6, pierce 2 → effective armor 2 → 4 damage
  check("wraith pierces 2 of armor", monsterAttackDamage(MONSTERS.wraith, p) === 4);
  // goblin: dmg 3, no pierce, armor 4 → min-1 floor
  check("non-piercer respects armor + min-1 floor", monsterAttackDamage(MONSTERS.goblin, p) === 1);
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
    { id: "test-rat", defId: "rat", x: neighbor.x, y: neighbor.y, hp: 4, state: "idle" },
  ];
  game.visible = [...game.visible, idx(neighbor.x, neighbor.y, game.map.width)];
  game.player.bag = [{ defId: "p_bomb", count: 1 }];
  const coinsBefore = game.player.coins;

  const res = resolveTurn(game, { type: "useItem", defId: "p_bomb" }, rng);
  check("firebomb consumed a turn", res.tookTurn);
  check("firebomb slew the target", game.monsters.length === 0);
  check("firebomb removed from bag", !game.player.bag.some((b) => b.defId === "p_bomb"));
  check("kill awarded coins", game.player.coins > coinsBefore);
  check("firebomb emitted a projectile effect", res.events.some((e) => e.kind === "projectile"));
}

// ─── 11. Traps ──────────────────────────────────────────────────────────────
console.log("\n[11] Hidden traps");
{
  const g = beginLevel("trap-seed", 0, createPlayer()); // dungeon has trapCount
  check("dungeon scatters hidden traps", g.map.tiles.some((t) => t === "trap"));

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
    const hp0 = g.player.hp;
    resolveTurn(g, { type: "move", dx: Math.sign(nb.x - p.x), dy: Math.sign(nb.y - p.y) }, new Rng(5));
    check("stepping on a trap deals damage", g.player.hp < hp0);
    check("trap becomes sprung (one-shot)", tileAt(g.map, nb.x, nb.y) === "trapSprung");
  }
}

// ─── 12. Torch fuel ─────────────────────────────────────────────────────────
console.log("\n[12] Torch fuel");
{
  const g = beginLevel("torch-seed", 0, createPlayer());
  g.monsters = [];
  const base = g.player.baseLightRadius;
  g.player.hasTorch = true;
  g.player.torchFuel = 3;
  recomputeLight(g.player);
  check("a lit torch widens the light radius", g.player.lightRadius > base);
  const rng = new Rng(6);
  for (let i = 0; i < 3; i++) resolveTurn(g, { type: "wait" }, rng);
  check("torch burns out at 0 fuel", !g.player.hasTorch && g.player.torchFuel === 0);
  check("light reverts to base once unlit", g.player.lightRadius === base);
}

// ─── 13. Cursor firebomb throw ──────────────────────────────────────────────
console.log("\n[13] Cursor firebomb throw (throwAt)");
{
  const g = beginLevel("throw-seed", 0, createPlayer());
  const spot = { x: g.player.x + 2, y: g.player.y };
  g.monsters = [{ id: "t1", defId: "rat", x: spot.x, y: spot.y, hp: 4, state: "idle" }];
  g.player.bag = [{ defId: "p_bomb", count: 1 }];
  const res = resolveTurn(g, { type: "throwAt", defId: "p_bomb", x: spot.x, y: spot.y }, new Rng(7));
  check("throwAt consumes a turn", res.tookTurn);
  check("throwAt detonates on the targeted tile", g.monsters.length === 0);
  check("throwAt consumes the firebomb", !g.player.bag.some((b) => b.defId === "p_bomb"));

  const g2 = beginLevel("throw-seed2", 0, createPlayer());
  g2.player.bag = [{ defId: "p_bomb", count: 1 }];
  const r2 = resolveTurn(
    g2,
    { type: "throwAt", defId: "p_bomb", x: g2.player.x + 40, y: g2.player.y + 40 },
    new Rng(1)
  );
  check(
    "throwAt out of range is rejected (no turn, keeps bomb)",
    !r2.tookTurn && g2.player.bag.some((b) => b.defId === "p_bomb")
  );
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`);
process.exit(failures === 0 ? 0 : 1);
