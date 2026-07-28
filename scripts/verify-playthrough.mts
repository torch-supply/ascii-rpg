// Headless autonomous-playthrough / balance harness.
// Complements verify-core.mts (which tests mechanics in ISOLATION). This drives
// a fairly-statted player through every level with a simple greedy bot across
// many seeds, then asserts the levels are actually *beatable while under attack*
// — plus reports a difficulty table (win-rate / turns / end-HP) for balancing.
//
// Run with: npx --yes tsx scripts/verify-playthrough.mts
//
// The bot is deliberately a FLOOR: greedy, non-optimal, 4-directional — but it
// is *tactically equipped* (heals + firebombs, the kit a player buys at the
// shop) and will hurl a bomb at a boss/cluster, kite a menace to reopen bombing
// distance, and fire an equipped bow. So a boss-level win-rate here is a real
// (if conservative) signal of whether the intended toolkit can clear it, not
// just "can pure melee." If this bot can clear a level, a human can.
import { LEVELS } from "@/content/levels";
import { createPlayer, beginLevel, clonePlayer } from "@/game/core/state";
import { resolveTurn } from "@/game/core/actions";
import { Rng } from "@/game/core/rng";
import { idx, isWalkable } from "@/game/core/grid";
import { giveItem } from "@/game/core/inventory";
import { CONFIG } from "@/content/config";
import { MONSTERS } from "@/content/monsters";
import { ITEMS, SHOP_TIERS } from "@/content/items";
import type {
  GameState,
  Pos,
  PlayerAction,
  PlayerState,
  MonsterInstance,
} from "@/game/core/types";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ FAIL: ${name} ${extra}`);
  }
}

const DIRS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const;

// Tiles the bot is willing to path across. Monster-occupied tiles are also
// treated as passable so the bot bump-attacks through blockers. Cracked walls
// and shut doors are passable (the bot will bash / shove them open over turns).
const PASSABLE = new Set([
  "floor",
  "exit",
  "trap",
  "trapSprung",
  "oil",
  "forage",
  "ice",
  "glowcap",
  "doorOpen",
  "door",
  "crackedWall",
]);

// BFS over PASSABLE tiles. `avoidTraps` routes around armed traps when it can;
// callers fall back to allowing them only if no safe path exists.
function bfsStep(g: GameState, goals: Pos[], avoidTraps: boolean): Pos | null {
  const w = g.map.width;
  const h = g.map.height;
  if (goals.length === 0) return null;
  const goalSet = new Set(goals.map((p) => idx(p.x, p.y, w)));
  const start = idx(g.player.x, g.player.y, w);
  const prev = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  seen[start] = 1;
  const q: number[] = [start];
  let found = -1;
  while (q.length) {
    const cur = q.shift()!;
    if (goalSet.has(cur) && cur !== start) {
      found = cur;
      break;
    }
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni]) continue;
      const t = g.map.tiles[ni];
      if (!PASSABLE.has(t)) continue;
      if (avoidTraps && t === "trap" && !goalSet.has(ni)) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  if (found < 0) return null;
  // walk the chain back to the first step out of `start`
  let cur = found;
  while (prev[cur] !== start) cur = prev[cur];
  return { x: cur % w, y: Math.floor(cur / w) };
}

function objectiveTiles(g: GameState): Pos[] {
  const goal = LEVELS[g.currentLevel].goal;
  switch (goal.type) {
    case "reachLocation":
      return g.map.exit ? [g.map.exit] : [];
    case "collectX":
    case "findItem": {
      const tag = goal.type === "collectX" ? goal.questTag : goal.questTag;
      const items = g.items.filter((it) => it.questTag === tag);
      return items.length
        ? items.map((it) => ({ x: it.x, y: it.y }))
        : g.map.exit
          ? [g.map.exit]
          : [];
    }
    case "killTarget": {
      const boss = g.monsters.find((m) => m.isGoalTarget);
      return boss ? [{ x: boss.x, y: boss.y }] : [];
    }
    case "killCount":
    case "survive":
      // hunt the nearest threat (survive: fighting the siege is the objective)
      return g.monsters.map((m) => ({ x: m.x, y: m.y }));
  }
}

const chebyshev = (ax: number, ay: number, bx: number, by: number) =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by));

const isThreat = (m: MonsterInstance) =>
  !!MONSTERS[m.defId]?.isBoss || !!m.elite;

// Pick an orthogonally-adjacent tile that's safe to stand on (walkable, no
// monster/fire/barrage/trap), maximizing distance from `from` (a menace to
// back away from). Returns a move, or null if boxed in.
function safeStepAwayFrom(g: GameState, from: Pos | null): PlayerAction | null {
  const p = g.player;
  const w = g.map.width;
  let best: PlayerAction | null = null;
  let bestD = -1;
  for (const [dx, dy] of DIRS) {
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!isWalkable(g.map, nx, ny)) continue;
    const ni = idx(nx, ny, w);
    if (g.monsters.some((m) => m.x === nx && m.y === ny)) continue;
    if (
      g.barrage.includes(ni) ||
      g.fireTiles.some((f) => f.i === ni) ||
      g.map.tiles[ni] === "trap"
    )
      continue;
    const d = from ? chebyshev(nx, ny, from.x, from.y) : 1;
    if (d > bestD) {
      bestD = d;
      best = { type: "move", dx, dy };
    }
  }
  return best;
}

const minMonDist = (g: GameState, x: number, y: number) =>
  g.monsters.length
    ? Math.min(...g.monsters.map((m) => chebyshev(m.x, m.y, x, y)))
    : 99;

// Kite: bounded flood (≤10 steps) over safe open tiles, then head one step
// toward the reachable tile that puts the MOST breathing room between us and the
// nearest monster — so a siege can't pin us in a corner. Returns null if we're
// already as safe as anywhere reachable (nothing to gain by moving).
function fleeStep(g: GameState): PlayerAction | null {
  const p = g.player;
  const w = g.map.width;
  const h = g.map.height;
  const start = idx(p.x, p.y, w);
  const prev = new Int32Array(w * h).fill(-1);
  const dist = new Int32Array(w * h);
  const seen = new Uint8Array(w * h);
  seen[start] = 1;
  const q = [start];
  const visited: number[] = [];
  const MAX_DEPTH = 10;
  while (q.length) {
    const cur = q.shift()!;
    if (dist[cur] >= MAX_DEPTH) continue;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || !isWalkable(g.map, nx, ny)) continue;
      if (g.monsters.some((m) => m.x === nx && m.y === ny)) continue;
      if (
        g.barrage.includes(ni) ||
        g.fireTiles.some((f) => f.i === ni) ||
        g.map.tiles[ni] === "trap"
      )
        continue;
      seen[ni] = 1;
      prev[ni] = cur;
      dist[ni] = dist[cur] + 1;
      q.push(ni);
      visited.push(ni);
    }
  }
  let best = -1;
  let bestScore = minMonDist(g, p.x, p.y); // must beat standing still
  for (const ti of visited) {
    const s = minMonDist(g, ti % w, Math.floor(ti / w));
    // prefer more breathing room; among equals, the closest (commit, don't dither)
    if (
      s > bestScore ||
      (s === bestScore && best >= 0 && dist[ti] < dist[best])
    ) {
      bestScore = s;
      best = ti;
    }
  }
  if (best < 0) return null;
  let cur = best;
  while (prev[cur] !== start) cur = prev[cur];
  return { type: "move", dx: (cur % w) - p.x, dy: Math.floor(cur / w) - p.y };
}

// Decide the bot's action for this turn.
function decide(g: GameState): PlayerAction {
  const p = g.player;
  const w = g.map.width;
  const hpFrac = p.hp / p.maxHp;

  // 1. heal when low if we're carrying a potion
  if (hpFrac < 0.4 && p.bag.some((b) => b.defId === "p_heal")) {
    return { type: "useItem", defId: "p_heal" };
  }

  // 2. step off a telegraphed barrage tile if we're standing on one
  if (g.barrage.includes(idx(p.x, p.y, w))) {
    const dodge = safeStepAwayFrom(g, null);
    if (dodge) return dodge;
  }

  // 3. firebomb: hurl at the boss / the densest cluster, from ≥2 away so the
  //    lingering fire doesn't catch us. Conserve bombs — only worth it if the
  //    blast tags a boss/elite or catches 2+ enemies.
  const bombs = p.bag.find((b) => b.defId === "p_bomb");
  if (bombs) {
    let best: MonsterInstance | null = null;
    let bestScore = 0;
    for (const c of g.monsters) {
      const d = chebyshev(c.x, c.y, p.x, p.y);
      if (d < 2 || d > CONFIG.throwRange) continue; // too close (self-fire) / out of range
      const caught = g.monsters.filter(
        (m) => chebyshev(m.x, m.y, c.x, c.y) <= 1,
      );
      const score = caught.length + (caught.some(isThreat) ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best && bestScore >= 2)
      return { type: "throwAt", defId: "p_bomb", x: best.x, y: best.y };
  }

  // 4. ranged: fire an equipped bow at the nearest visible target in range
  const wpn = p.weaponId ? ITEMS[p.weaponId] : undefined;
  if (wpn?.ranged && p.bag.some((b) => b.defId === wpn.ranged!.ammoId)) {
    const shot = g.monsters
      .filter(
        (m) =>
          chebyshev(m.x, m.y, p.x, p.y) <= wpn.ranged!.range &&
          g.visible.includes(idx(m.x, m.y, w)),
      )
      .sort(
        (a, b) => chebyshev(a.x, a.y, p.x, p.y) - chebyshev(b.x, b.y, p.x, p.y),
      )[0];
    if (shot) return { type: "shootAt", x: shot.x, y: shot.y };
  }

  const adjMonsters = g.monsters.filter(
    (m) => chebyshev(m.x, m.y, p.x, p.y) === 1,
  );

  // 5. survive levels: staying alive IS the objective — stay mobile so the siege
  //    can't pin you (bombs above already thin clusters). Flee to open ground;
  //    only trade blows if genuinely cornered, else just wait out the clock.
  if (LEVELS[g.currentLevel].goal.type === "survive") {
    const flee = fleeStep(g);
    if (flee) return flee;
    const weakest = [...adjMonsters].sort((a, b) => a.hp - b.hp)[0];
    if (weakest && (weakest.x === p.x || weakest.y === p.y)) {
      return {
        type: "move",
        dx: Math.sign(weakest.x - p.x),
        dy: Math.sign(weakest.y - p.y),
      };
    }
    return { type: "wait" };
  }

  // 6. surrounded and hurting on any level → break out to open ground
  if (hpFrac < 0.5 && adjMonsters.length >= 3) {
    const flee = fleeStep(g);
    if (flee) return flee;
  }

  // 7. kite: with bombs left, don't trade blows with a boss/elite on top of us
  //    while hurting — back off to reopen bombing distance
  if (bombs && hpFrac < 0.6) {
    const menace = g.monsters.find(
      (m) => chebyshev(m.x, m.y, p.x, p.y) === 1 && isThreat(m),
    );
    if (menace) {
      const away = safeStepAwayFrom(g, menace);
      if (away) return away;
    }
  }

  // 8. attack an orthogonally-adjacent monster (finish the weakest first)
  const adj = adjMonsters
    .filter((m) => m.x === p.x || m.y === p.y)
    .sort((a, b) => a.hp - b.hp)[0];
  if (adj)
    return {
      type: "move",
      dx: Math.sign(adj.x - p.x),
      dy: Math.sign(adj.y - p.y),
    };

  // 9. otherwise path toward the objective (avoid traps, then allow if trapped)
  const goals = objectiveTiles(g);
  const step = bfsStep(g, goals, true) ?? bfsStep(g, goals, false);
  if (step) return { type: "move", dx: step.x - p.x, dy: step.y - p.y };

  return { type: "wait" };
}

interface RunResult {
  outcome: "win" | "death" | "stuck";
  turns: number;
  endHp: number;
  coins: number; // gold earned this level (bot starts at 0, never spends)
  /** How much of the level a run actually explored — a DESIGN metric: content
   * (sub-biomes, lore, secrets) in tiles you never walk is content nobody sees.
   * CAVEAT: read the ABSOLUTE tile count across levels, not the share — the
   * share is skewed by how open a map is (the Great Hall is 77% floor, so it
   * scores a low % while being walked FARTHER than any other level). */
  exploredPct: number;
  exploredTiles: number;
  invariant: string | null; // first invariant violation seen, if any
  /** the player as they finished — so a caller can carry them to the next level
   * (a real run is ONE character across ten levels, not ten fresh ones) */
  endPlayer: PlayerState;
}

/** Walkable tiles the player revealed: absolute count + share of the level. */
function exploredStats(g: GameState): { pct: number; tiles: number } {
  let walkable = 0;
  for (let y = 0; y < g.map.height; y++)
    for (let x = 0; x < g.map.width; x++)
      if (isWalkable(g.map, x, y)) walkable++;
  let tiles = 0;
  for (const i of new Set(g.explored))
    if (isWalkable(g.map, i % g.map.width, Math.floor(i / g.map.width)))
      tiles++;
  return { pct: walkable ? Math.round((tiles / walkable) * 100) : 0, tiles };
}

// Play one level to a conclusion with a fresh bot-statted player. `classId`
// defaults to the Warrior baseline the difficulty table is calibrated on; [P3]
// re-runs the sweep as the other classes to prove they're viable too.
function playLevel(
  levelIndex: number,
  seed: string,
  botSeed: number,
  classId = "warrior",
  startPlayer?: PlayerState,
): RunResult {
  // A carried character (full-run mode) arrives with whatever they've earned;
  // otherwise mint the standard bot loadout for an isolated level measurement.
  const player = startPlayer ?? createPlayer(classId);
  if (!startPlayer) {
    // stock the consumables a real player buys at the shop: heals + firebombs, so
    // the bot can actually engage bosses with the intended toolkit (not just melee)
    for (let i = 0; i < 3; i++) giveItem(player, "p_heal");
    for (let i = 0; i < 3; i++) giveItem(player, "p_bomb");
  }
  const g = beginLevel(seed, levelIndex, player);
  const rng = new Rng(botSeed);
  const cap = Math.max(LEVELS[levelIndex].turnLimit * 4, 500);

  let prevTurn = g.turnCount;
  let invariant: string | null = null;
  const note = (bad: boolean, msg: string) => {
    if (bad && !invariant) invariant = msg;
  };

  for (let t = 0; t < cap; t++) {
    const res = resolveTurn(g, decide(g), rng);

    // ── invariants that must hold every single turn of real play ──
    note(g.player.hp > g.player.maxHp, "hp exceeded maxHp");
    note(Number.isNaN(g.player.hp), "hp went NaN");
    note(g.turnCount < prevTurn, "turnCount went backwards");
    note(
      g.player.x < 0 ||
        g.player.y < 0 ||
        g.player.x >= g.map.width ||
        g.player.y >= g.map.height,
      "player left the map",
    );
    note(
      g.monsters.length > CONFIG.siege.cap + 40,
      "monster count blew past caps",
    );
    prevTurn = g.turnCount;

    if (res.goalComplete)
      return {
        outcome: "win",
        turns: g.turnCount,
        endHp: g.player.hp,
        coins: g.player.coins,
        exploredPct: exploredStats(g).pct,
        exploredTiles: exploredStats(g).tiles,
        invariant,
        endPlayer: g.player,
      };
    if (res.playerDied)
      return {
        outcome: "death",
        turns: g.turnCount,
        endHp: 0,
        coins: g.player.coins,
        exploredPct: exploredStats(g).pct,
        exploredTiles: exploredStats(g).tiles,
        invariant,
        endPlayer: g.player,
      };
  }
  return {
    outcome: "stuck",
    turns: g.turnCount,
    endHp: g.player.hp,
    coins: g.player.coins,
    exploredPct: exploredStats(g).pct,
    exploredTiles: exploredStats(g).tiles,
    invariant,
    endPlayer: g.player,
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ─── Run the fleet ──────────────────────────────────────────────────────────
console.log(
  "\n[P1] Autonomous playthroughs — every level, greedy bot, many seeds",
);
const SEEDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
// Goal types the greedy bot is expected to actually clear (navigation +
// attrition). Boss fights (killTarget) and the siege (survive) need tactical
// play beyond a greedy melee floor, so those are held only to an "enterable,
// not an instant wipe" bar — real beatability is a human/table judgement.
const BOT_MUST_WIN = new Set([
  "reachLocation",
  "collectX",
  "findItem",
  "killCount",
]);
const ENTERABLE_FLOOR = 6; // a boss/siege level must let you last ≥ this many turns

let anyInvariant: string | null = null;
let totalWins = 0;
let totalRuns = 0;
let runGold = 0; // summed median per-level gold ≈ a whole run's purse
const rows: string[] = [];
const unbeatable: string[] = []; // BOT_MUST_WIN levels the bot never won
const instantWipe: string[] = []; // boss/siege levels that wipe you near-instantly

for (let li = 0; li < LEVELS.length; li++) {
  const cfg = LEVELS[li];
  const results: RunResult[] = [];
  for (let s = 0; s < SEEDS.length; s++) {
    const r = playLevel(li, SEEDS[s], 1000 + s);
    results.push(r);
    if (r.invariant && !anyInvariant)
      anyInvariant = `${cfg.id}/${SEEDS[s]}: ${r.invariant}`;
  }
  const wins = results.filter((r) => r.outcome === "win");
  totalWins += wins.length;
  totalRuns += results.length;

  if (BOT_MUST_WIN.has(cfg.goal.type)) {
    if (wins.length === 0) unbeatable.push(cfg.id);
  } else {
    // longest a run lasted before winning or dying — did the encounter even open?
    const survived = median(
      results.map((r) => (r.outcome === "win" ? r.turns : r.turns)),
    );
    if (survived < ENTERABLE_FLOOR)
      instantWipe.push(`${cfg.id} (median ${survived}t)`);
  }

  const rate = ((wins.length / results.length) * 100).toFixed(0);
  const medTurns = median(wins.map((r) => r.turns));
  const medHp = median(wins.map((r) => r.endHp));
  const deaths = results.filter((r) => r.outcome === "death").length;
  const stuck = results.filter((r) => r.outcome === "stuck").length;
  const medDeathTurn = median(
    results.filter((r) => r.outcome === "death").map((r) => r.turns),
  );
  const medGold = median(results.map((r) => r.coins)); // gold earned this level
  runGold += medGold; // accumulate a whole-run purse (see the economy summary)
  // How much of the map a WINNING run saw — reported as BOTH a share and an
  // absolute tile count, because the share alone misleads: a very open map (the
  // Great Hall is 77% floor) scores a low % while actually being walked farther
  // than anywhere else. Compare `seenT` across levels; use % only within a level.
  const seenRuns = wins.length ? wins : results;
  const medSeen = median(seenRuns.map((r) => r.exploredPct));
  const medSeenTiles = median(seenRuns.map((r) => r.exploredTiles));
  rows.push(
    `  · ${cfg.id.padEnd(16)} ${cfg.goal.type.padEnd(13)} win ${rate.padStart(3)}%  ` +
      `(${wins.length}W/${deaths}D/${stuck}S)  medTurns ${String(medTurns).padStart(4)}  ` +
      `medEndHP ${String(medHp).padStart(2)}  medGold ${String(medGold).padStart(3)}  ` +
      `medSeen ${String(medSeen).padStart(3)}%/${String(medSeenTiles).padStart(4)}t  medDeath@ ${medDeathTurn}t`,
  );
}

console.log(rows.join("\n"));

// ─── Run-level economy ─────────────────────────────────────────────────────
// Per-level medGold hides the real question: across a WHOLE run, can you afford
// to just buy everything? Compare the accumulated purse against the cost of
// clearing out every shop you visit. Ratio ≫ 1 = the "banked $200, bought it
// all" problem; ≪ 1 = you can never afford anything.
{
  const shopCost = LEVELS.reduce((sum, l) => {
    const tier = l.shopTier;
    if (tier == null || !SHOP_TIERS[tier]) return sum;
    // one of each entry (maxQty-capped stacks counted once) = a "buy it all" trip
    return sum + SHOP_TIERS[tier].reduce((s, e) => s + e.price, 0);
  }, 0);
  const ratio = shopCost ? runGold / shopCost : 0;
  console.log(
    `\n  Economy — clearing all ${LEVELS.length} levels earns ~${runGold}g; buying one of ` +
      `everything at every shop costs ~${shopCost}g (${(ratio * 100).toFixed(0)}% affordable).` +
      `\n  (An UPPER bound: it sums per-level medians as if every level is cleared. ` +
      `See [P4] for what a real carried run actually banks.)`,
  );
  check(
    "a run cannot simply buy out every shop (economy stays a choice)",
    ratio < 0.9,
    `(earns ${runGold}g vs ${shopCost}g of stock — ${(ratio * 100).toFixed(0)}%)`,
  );
  check(
    "...but a run can still afford meaningful purchases",
    ratio > 0.15,
    `(only ${(ratio * 100).toFixed(0)}% of stock affordable — too poor?)`,
  );
  // A tighter band on the absolute purse. The ratio check above is a wide
  // sanity rail — a mutation audit showed it happily absorbed a 4× coin-reward
  // inflation. Income is a deliberately tuned dial (CONFIG.lootScale /
  // coinPile / coinReward), so guard the tuned VALUE, not just the extremes.
  // Update this range intentionally whenever the economy is re-tuned.
  check(
    "run income stays near its tuned level (120–320g)",
    runGold >= 120 && runGold <= 320,
    `(earned ${runGold}g — economy dials moved? re-tune or update this band)`,
  );
}

// ─── Assertions ───────────────────────────────────────────────────────────
check(
  "no invariant was violated during real play",
  anyInvariant === null,
  anyInvariant ? `(${anyInvariant})` : "",
);
check(
  `navigation/attrition levels are beatable by the greedy bot (won ≥1 of ${SEEDS.length} seeds)`,
  unbeatable.length === 0,
  unbeatable.length ? `(never won: ${unbeatable.join(", ")})` : "",
);
check(
  `boss/siege levels are enterable, not an instant wipe (survive ≥${ENTERABLE_FLOOR} turns)`,
  instantWipe.length === 0,
  instantWipe.length ? `(${instantWipe.join(", ")})` : "",
);
check(
  `overall greedy-bot win-rate is a sane floor across ${totalRuns} runs`,
  totalWins / totalRuns >= 0.3,
  `(${((totalWins / totalRuns) * 100).toFixed(0)}% — a floor; the bot is greedy/non-optimal)`,
);

// ─── P3. Every class is viable, not just the Warrior ───────────────────────
// The table above is a WARRIOR sweep. Rogue (16 HP, stealth/crit) and Pyromancer
// (bow + bombs) carry very different kits and survivability, and their abilities
// are otherwise only unit-tested in isolation — so a class could be quietly
// unplayable. Re-run a reduced sweep per class and hold each to the same
// "clears the navigation/attrition levels" bar the Warrior meets.
console.log("\n[P3] Class viability — every class can play the game");
{
  const CLASS_SEEDS = ["alpha", "charlie", "echo"]; // reduced: keeps runtime sane
  const navLevels = LEVELS.map((l, i) => ({ l, i })).filter(({ l }) =>
    BOT_MUST_WIN.has(l.goal.type),
  );
  for (const classId of ["warrior", "rogue", "pyromancer"]) {
    let wins = 0;
    let runs = 0;
    const endHps: number[] = [];
    const neverWon: string[] = [];
    for (const { l, i } of navLevels) {
      let levelWins = 0;
      for (const seed of CLASS_SEEDS) {
        const r = playLevel(i, seed, 11, classId);
        runs++;
        if (r.outcome === "win") {
          wins++;
          levelWins++;
          endHps.push(r.endHp);
        }
      }
      if (levelWins === 0) neverWon.push(l.id);
    }
    const pct = ((wins / runs) * 100).toFixed(0);
    console.log(
      `  · ${classId.padEnd(11)} win ${pct.padStart(3)}% of ${runs} navigation runs  ` +
        `medEndHP ${median(endHps)}${neverWon.length ? `  (never cleared: ${neverWon.join(", ")})` : ""}`,
    );
    check(
      `${classId} can clear every navigation/attrition level`,
      neverWon.length === 0,
      neverWon.length ? `(never cleared: ${neverWon.join(", ")})` : "",
    );
  }
}

// ─── P4. Full-run continuity: ONE character across the whole quest ─────────
// Every measurement above plays levels in ISOLATION with a fresh, fully-stocked
// player. A real run is one character carrying gear, damage and coins through
// all ten levels, spending at shops, and burning lives on the way. That's the
// only way to see whether the difficulty CURVE and the economy actually sustain
// a persistent character — and it's the closest thing to "is the game
// completable." Faithful to the store: death restarts the level from the
// entry-snapshot and costs a life; a clear carries the live player forward.
// NOTE `beginLevel` refills HP at every level start, so HP does NOT compound —
// what a carried run actually runs short of is CONSUMABLES and gear money. The
// isolated table hides that by gifting every level a fresh 3 heals + 3 bombs.
console.log("\n[P4] Full-run continuity — one character, carried, with shops");
{
  // Spend like a real player: GEAR upgrades first (the power curve that carries
  // a run), then top up consumables. `giveItem` auto-equips a strict upgrade.
  const shopAt = (p: PlayerState, tier: number) => {
    const stock = SHOP_TIERS[tier];
    if (!stock) return 0;
    let spent = 0;
    const buy = (id: string, price: number) => {
      p.coins -= price;
      spent += price;
      giveItem(p, id);
    };
    // strict weapon/armor upgrades, best affordable first
    for (const kind of ["weapon", "armor"] as const) {
      const better = stock
        .filter((e) => {
          const d = ITEMS[e.itemId];
          if (d?.category !== kind) return false;
          return kind === "weapon"
            ? (d.power ?? 0) > p.weaponPower
            : (d.reduction ?? 0) > p.armorReduction;
        })
        .sort((a, b) => b.price - a.price); // best (priciest) affordable one
      const pick = better.find((e) => p.coins >= e.price);
      if (pick) buy(pick.itemId, pick.price);
    }
    // then keep the consumable belt stocked with whatever's left
    const held = (id: string) => p.bag.find((b) => b.defId === id)?.count ?? 0;
    for (const want of ["p_heal", "p_gheal", "p_bomb"]) {
      const entry = stock.find((e) => e.itemId === want);
      if (!entry) continue;
      const cap = entry.maxQty ?? 2;
      while (held(want) < cap && p.coins >= entry.price) buy(want, entry.price);
    }
    return spent;
  };

  const runOnce = (seed: string, botSeed: number) => {
    let player = createPlayer("warrior");
    let lives = CONFIG.startingLives;
    let earned = 0;
    let spent = 0;
    let deaths = 0;
    let depth = 0; // deepest level index CLEARED (+1 = levels beaten)
    for (let li = 0; li < LEVELS.length && lives > 0;) {
      const entry = clonePlayer(player); // the store restarts a level from this
      const before = player.coins;
      const r = playLevel(li, `${seed}-${li}`, botSeed + li, "warrior", player);
      earned += Math.max(0, r.endPlayer.coins - before);
      if (r.outcome === "win") {
        depth = li + 1;
        player = clonePlayer(r.endPlayer);
        const tier = LEVELS[li].shopTier;
        if (tier != null) spent += shopAt(player, tier);
        li++;
      } else {
        deaths++;
        lives--;
        player = clonePlayer(entry); // retry the same level, as the store does
      }
    }
    return { depth, earned, spent, deaths, coins: player.coins };
  };

  const runs = [
    runOnce("run-a", 5),
    runOnce("run-b", 17),
    runOnce("run-c", 29),
  ];
  const depths = runs.map((r) => r.depth);
  const best = Math.max(...depths);
  console.log(
    `  · reached levels ${depths.join(" / ")} of ${LEVELS.length} ` +
      `(best ${best})  earned ${runs.map((r) => r.earned).join("/")}g  ` +
      `spent ${runs.map((r) => r.spent).join("/")}g  deaths ${runs.map((r) => r.deaths).join("/")}`,
  );

  // A REGRESSION FLOOR, not an ambition. The greedy bot spends all 3 lives on
  // the first boss it can't out-trade, so depth ~3 is its natural ceiling — the
  // value here is catching a COLLAPSE (a gear/economy change that stops a
  // carried character clearing even the opening arc). Raise this bar only
  // alongside a smarter bot, never by wishing.
  check(
    "a carried character still clears the opening arc (3+ levels)",
    best >= 3,
    `(best depth ${best}/${LEVELS.length})`,
  );
  check(
    "every full run clears at least the opening stretch",
    depths.every((d) => d >= 2),
    `(depths ${depths.join("/")})`,
  );
  // The bot spends only on consumables, so this is a floor — but a run that
  // never affords ANYTHING means the economy starves a real player too.
  check(
    "a carried run can actually afford to shop",
    runs.some((r) => r.spent > 0),
    `(spent ${runs.map((r) => r.spent).join("/")}g)`,
  );
}

// ─── Determinism: same seed + same bot RNG → identical outcome ──────────────
console.log("\n[P2] Playthrough determinism");
{
  const a = playLevel(0, "repeat-me", 42);
  const b = playLevel(0, "repeat-me", 42);
  check(
    "same (level, seed, bot RNG) → identical outcome",
    a.outcome === b.outcome && a.turns === b.turns && a.endHp === b.endHp,
  );
}

console.log(
  "\n  (win-rate is a conservative lower bound — a greedy bot floor, not a human ceiling.\n" +
    "   Use the table above to spot meat-grinders (low win% / low medEndHP) or cakewalks.)",
);

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`,
);
process.exit(failures === 0 ? 0 : 1);
