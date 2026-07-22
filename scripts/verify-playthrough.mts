// Headless autonomous-playthrough / balance harness.
// Complements verify-core.mts (which tests mechanics in ISOLATION). This drives
// a fairly-statted player through every level with a simple greedy bot across
// many seeds, then asserts the levels are actually *beatable while under attack*
// — plus reports a difficulty table (win-rate / turns / end-HP) for balancing.
//
// Run with: npx --yes tsx scripts/verify-playthrough.mts
//
// The bot is deliberately a FLOOR: greedy, non-optimal, 4-directional. If a dumb
// bot can clear a level, a human can. A win-rate here is a conservative lower
// bound on how hard a level really is.
import { LEVELS } from "@/content/levels";
import { createPlayer, beginLevel } from "@/game/core/state";
import { resolveTurn } from "@/game/core/actions";
import { Rng } from "@/game/core/rng";
import { idx, isWalkable, tileAt } from "@/game/core/grid";
import { giveItem } from "@/game/core/inventory";
import { CONFIG } from "@/content/config";
import type { GameState, Pos, PlayerAction } from "@/game/core/types";

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
      return items.length ? items.map((it) => ({ x: it.x, y: it.y })) : g.map.exit ? [g.map.exit] : [];
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

// Decide the bot's action for this turn.
function decide(g: GameState): PlayerAction {
  const p = g.player;
  const w = g.map.width;

  // 1. survival: heal when low if we're carrying a potion
  if (p.hp / p.maxHp < 0.35 && p.bag.some((b) => b.defId === "p_heal")) {
    return { type: "useItem", defId: "p_heal" };
  }

  // 2. step off a telegraphed barrage tile if we're standing on one
  if (g.barrage.includes(idx(p.x, p.y, w))) {
    for (const [dx, dy] of DIRS) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (isWalkable(g.map, nx, ny) && !g.barrage.includes(idx(nx, ny, w)) && !g.monsters.some((m) => m.x === nx && m.y === ny)) {
        return { type: "move", dx, dy };
      }
    }
  }

  // 3. attack an orthogonally-adjacent monster (finish the weakest first)
  const adj = g.monsters
    .filter((m) => chebyshev(m.x, m.y, p.x, p.y) === 1 && (m.x === p.x || m.y === p.y))
    .sort((a, b) => a.hp - b.hp)[0];
  if (adj) return { type: "move", dx: Math.sign(adj.x - p.x), dy: Math.sign(adj.y - p.y) };

  // 4. otherwise path toward the objective (avoid traps, then allow if trapped)
  const goals = objectiveTiles(g);
  const step = bfsStep(g, goals, true) ?? bfsStep(g, goals, false);
  if (step) return { type: "move", dx: step.x - p.x, dy: step.y - p.y };

  return { type: "wait" };
}

interface RunResult {
  outcome: "win" | "death" | "stuck";
  turns: number;
  endHp: number;
  invariant: string | null; // first invariant violation seen, if any
}

// Play one level to a conclusion with a fresh bot-statted player.
function playLevel(levelIndex: number, seed: string, botSeed: number): RunResult {
  const player = createPlayer("warrior"); // a fair, survivable baseline kit
  // stock a few heals so the bot has the same lifeline a real player buys
  for (let i = 0; i < 3; i++) giveItem(player, "p_heal");
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
    note(g.player.x < 0 || g.player.y < 0 || g.player.x >= g.map.width || g.player.y >= g.map.height, "player left the map");
    note(g.monsters.length > CONFIG.siege.cap + CONFIG.overtime.cap + 40, "monster count blew past caps");
    prevTurn = g.turnCount;

    if (res.goalComplete) return { outcome: "win", turns: g.turnCount, endHp: g.player.hp, invariant };
    if (res.playerDied) return { outcome: "death", turns: g.turnCount, endHp: 0, invariant };
  }
  return { outcome: "stuck", turns: g.turnCount, endHp: g.player.hp, invariant };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ─── Run the fleet ──────────────────────────────────────────────────────────
console.log("\n[P1] Autonomous playthroughs — every level, greedy bot, many seeds");
const SEEDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
// Goal types the greedy bot is expected to actually clear (navigation +
// attrition). Boss fights (killTarget) and the siege (survive) need tactical
// play beyond a greedy melee floor, so those are held only to an "enterable,
// not an instant wipe" bar — real beatability is a human/table judgement.
const BOT_MUST_WIN = new Set(["reachLocation", "collectX", "findItem", "killCount"]);
const ENTERABLE_FLOOR = 6; // a boss/siege level must let you last ≥ this many turns

let anyInvariant: string | null = null;
let totalWins = 0;
let totalRuns = 0;
const rows: string[] = [];
const unbeatable: string[] = []; // BOT_MUST_WIN levels the bot never won
const instantWipe: string[] = []; // boss/siege levels that wipe you near-instantly

for (let li = 0; li < LEVELS.length; li++) {
  const cfg = LEVELS[li];
  const results: RunResult[] = [];
  for (let s = 0; s < SEEDS.length; s++) {
    const r = playLevel(li, SEEDS[s], 1000 + s);
    results.push(r);
    if (r.invariant && !anyInvariant) anyInvariant = `${cfg.id}/${SEEDS[s]}: ${r.invariant}`;
  }
  const wins = results.filter((r) => r.outcome === "win");
  totalWins += wins.length;
  totalRuns += results.length;

  if (BOT_MUST_WIN.has(cfg.goal.type)) {
    if (wins.length === 0) unbeatable.push(cfg.id);
  } else {
    // longest a run lasted before winning or dying — did the encounter even open?
    const survived = median(results.map((r) => (r.outcome === "win" ? r.turns : r.turns)));
    if (survived < ENTERABLE_FLOOR) instantWipe.push(`${cfg.id} (median ${survived}t)`);
  }

  const rate = ((wins.length / results.length) * 100).toFixed(0);
  const medTurns = median(wins.map((r) => r.turns));
  const medHp = median(wins.map((r) => r.endHp));
  const deaths = results.filter((r) => r.outcome === "death").length;
  const stuck = results.filter((r) => r.outcome === "stuck").length;
  const medDeathTurn = median(results.filter((r) => r.outcome === "death").map((r) => r.turns));
  rows.push(
    `  · ${cfg.id.padEnd(16)} ${cfg.goal.type.padEnd(13)} win ${rate.padStart(3)}%  ` +
      `(${wins.length}W/${deaths}D/${stuck}S)  medTurns ${String(medTurns).padStart(4)}  ` +
      `medEndHP ${String(medHp).padStart(2)}  medDeath@ ${medDeathTurn}t`
  );
}

console.log(rows.join("\n"));

// ─── Assertions ───────────────────────────────────────────────────────────
check("no invariant was violated during real play", anyInvariant === null, anyInvariant ? `(${anyInvariant})` : "");
check(
  `navigation/attrition levels are beatable by the greedy bot (won ≥1 of ${SEEDS.length} seeds)`,
  unbeatable.length === 0,
  unbeatable.length ? `(never won: ${unbeatable.join(", ")})` : ""
);
check(
  `boss/siege levels are enterable, not an instant wipe (survive ≥${ENTERABLE_FLOOR} turns)`,
  instantWipe.length === 0,
  instantWipe.length ? `(${instantWipe.join(", ")})` : ""
);
check(
  `overall greedy-bot win-rate is a sane floor across ${totalRuns} runs`,
  totalWins / totalRuns >= 0.3,
  `(${((totalWins / totalRuns) * 100).toFixed(0)}% — a floor; the bot is greedy/non-optimal)`
);

// ─── Determinism: same seed + same bot RNG → identical outcome ──────────────
console.log("\n[P2] Playthrough determinism");
{
  const a = playLevel(0, "repeat-me", 42);
  const b = playLevel(0, "repeat-me", 42);
  check(
    "same (level, seed, bot RNG) → identical outcome",
    a.outcome === b.outcome && a.turns === b.turns && a.endHp === b.endHp
  );
}

console.log(
  "\n  (win-rate is a conservative lower bound — a greedy bot floor, not a human ceiling.\n" +
    "   Use the table above to spot meat-grinders (low win% / low medEndHP) or cakewalks.)"
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`);
process.exit(failures === 0 ? 0 : 1);
