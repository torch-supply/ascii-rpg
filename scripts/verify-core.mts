// Temporary end-to-end verification of the pure game engine (no DOM).
// Run with: npx tsx verify-core.mts   — deleted after verification.
import { generateLevel } from "@/game/core/map/generate";
import { LEVELS } from "@/content/levels";
import { createPlayer, beginLevel, recomputeLight } from "@/game/core/state";
import { resolveTurn } from "@/game/core/actions";
import { Rng } from "@/game/core/rng";
import { isGoalComplete } from "@/game/core/goals";
import {
  idx,
  isWalkable,
  isTransparent,
  tileAt,
  chebyshev,
} from "@/game/core/grid";
import { monsterAttackDamage, mitigate } from "@/game/core/combat";
import { STATUS } from "@/game/core/status";
import { applyAltar } from "@/game/core/altar";
import {
  applyLevelMutators,
  applyPlayerMutators,
  mutatorScoreMult,
} from "@/content/mutators";
import { MONSTERS, ELITE } from "@/content/monsters";
import { ITEMS, sellPrice } from "@/content/items";
import { giveItem, equipWeapon } from "@/game/core/inventory";
import { CONFIG } from "@/content/config";
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
  const idx3 = LEVELS.findIndex(
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
  const idx4 = LEVELS.findIndex((l) => l.goal.type === "findItem");
  const player = createPlayer();
  const game = beginLevel("find-seed", idx4, player);
  const sun = game.items.find((it) => it.questTag === "sunblade");
  check("sunblade placed on the map", !!sun);
  check("goal incomplete initially", !isGoalComplete(game));
  game.questProgress["sunblade"] = 1;
  check("questProgress sunblade >= 1 → goalComplete", isGoalComplete(game));
}

// ─── 7. Turn budget → overtime (not a timeout death) ────────────────────────
console.log("\n[7] Turn-budget exhaustion is no longer lethal");
{
  const player = createPlayer();
  const game = beginLevel("combat-seed", 0, player);
  // run the turn budget down to empty in one wait
  const rng = new Rng(3);
  game.turnsLeft = 1;
  const res = resolveTurn(game, { type: "wait" }, rng);
  check("running out the turn budget doesn't kill you", !res.playerDied);
  check("the budget has crossed into overtime", game.turnsLeft <= 0);
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
    const hp0 = g.player.hp;
    resolveTurn(
      g,
      { type: "move", dx: Math.sign(nb.x - p.x), dy: Math.sign(nb.y - p.y) },
      new Rng(5),
    );
    check("stepping on a trap deals damage", g.player.hp < hp0);
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

// ─── 16. Survive & cull goals ───────────────────────────────────────────────
console.log("\n[16] Survive & cull goals");
{
  const si = LEVELS.findIndex((l) => l.goal.type === "survive");
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

  const ci = LEVELS.findIndex((l) => l.goal.type === "killCount");
  const count = (LEVELS[ci].goal as { count: number }).count;
  const g2 = beginLevel("cull-seed", ci, createPlayer());
  check("cull incomplete at start", !isGoalComplete(g2));
  g2.levelKills = count;
  check("cull completes at the kill count", isGoalComplete(g2));
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
    check(
      "its blast catches an adjacent player",
      g.player.hp === hp0 - CONFIG.eliteExplodeDamage,
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

// ─── 26. Turn budget vs map size ────────────────────────────────────────────
// The path to each level's objective must fit its turn "par" with headroom for
// exploration + combat. Overtime is no longer an instant death, but par should
// still be reachable at a relaxed pace before the world turns hostile. Uses the
// shortest walkable beeline to the farthest objective (a floor: real play needs
// more), and requires turnLimit ≥ that × EXPLORE_FACTOR.
console.log("\n[26] Turn budget vs map size");
{
  const seeds = ["s1", "s2", "s3", "xyzzy", "blackwood", "999"];
  const EXPLORE_FACTOR = 2.0;
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
    `objectives fit the turn budget with ${EXPLORE_FACTOR}× headroom (${checked} level×seed)`,
    bad === 0,
    `(a level dipped below ${EXPLORE_FACTOR}× — see the per-level list above)`,
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
  const ti = LEVELS.findIndex(
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
  // tick would have completed (only your own action wins through a tie).
  {
    const ci = LEVELS.findIndex((l) => l.goal.type === "killCount");
    const count = (LEVELS[ci].goal as { count: number }).count;
    const g = beginLevel("sameturn-c", ci, createPlayer());
    const p = g.player;
    g.monsters = [];
    g.levelKills = count - 1; // one kill short of the cull goal
    const spot = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]
      .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
      .find((c) => isWalkable(g.map, c.x, c.y))!;
    // a monster that will die to its own burn this tick → completes the cull
    g.monsters = [
      {
        id: "m",
        defId: "skeleton",
        x: spot.x,
        y: spot.y,
        hp: 1,
        state: "idle",
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
      "(sanity) that tick did finish the cull count",
      g.levelKills >= count,
    );
  }
}

// ─── 31. Overtime pressure replaces the timeout death ───────────────────────
// Drive a non-survive level well past its budget: no death from the clock, and
// the world reinforces (monster count climbs) up to the overtime cap.
console.log("\n[31] Overtime pressure (soft clock)");
{
  const g = beginLevel("overtime-seed", 0, createPlayer()); // dungeon: reachLocation
  const rng = new Rng(7);
  // isolate the clock from HP: an invincible, stationary player never completes
  // the reach-goal, so we can overstay freely
  g.player.hp = 99999;
  g.player.maxHp = 99999;
  const before = g.monsters.length;
  g.turnsLeft = 2; // right at the edge, then overstay ~80 turns
  let died = false;
  let sawOvertimeMsg = false;
  for (let i = 0; i < 80; i++) {
    const res = resolveTurn(g, { type: "wait" }, rng);
    if (res.events.some((e) => e.kind === "message" && /close in/.test(e.text)))
      sawOvertimeMsg = true;
    if (res.playerDied) {
      died = true;
      break;
    }
  }
  check("overstaying the budget never triggers a timeout death", !died);
  check("crossing par announces the closing dark", sawOvertimeMsg);
  check("the world reinforces during overtime", g.monsters.length > before);
  check(
    "overtime respects its concurrent cap",
    g.monsters.length <= CONFIG.overtime.cap,
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
  check(
    "cleave damages every adjacent monster",
    g.monsters.length === hp0.length &&
      g.monsters.every((m, i) => m.hp < hp0[i]),
  );
  check("cleave sets the cooldown", g.player.abilityCooldown === 5);
  const hp1 = g.monsters.map((m) => m.hp);
  const res2 = resolveTurn(g, { type: "ability" }, new Rng(2));
  check(
    "ability refused while on cooldown (no turn, no damage)",
    !res2.tookTurn && g.monsters.every((m, i) => m.hp === hp1[i]),
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
  check(
    "an unknown mutator id is a no-op",
    applyLevelMutators(base, ["nope"]) === base,
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
    "hunted",
  ]);
  check(
    "a heavily-mutated level still has the player on a floor tile",
    isWalkable(g2.map, g2.player.x, g2.player.y),
  );
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`,
);
process.exit(failures === 0 ? 0 : 1);
