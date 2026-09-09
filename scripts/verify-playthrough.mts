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
// distance, fire an equipped bow, EQUIP upgrades it picks up, and fire its CLASS
// ABILITY ([q] — Cleave into a crowd, Scorch down the fullest cone, Dash out of
// one). So a boss-level win-rate here is a real (if conservative) signal of
// whether the intended toolkit can clear it, not just "can pure melee." If this
// bot can clear a level, a human can.
//
// COVERAGE OF THE ACTION SURFACE. The engine has 9 `PlayerAction` types. The bot
// EMITS 7 of them; the remaining two (`closeDoor`, `blinkTo`) are driven directly
// against a real mid-run state by `[P6]`, because a bot heuristic for either
// would cost more than it buys (see the note there). So all 9 are exercised in a
// live game — 7 by autonomous choice, 2 by injection.
//
// Still not simulated, deliberately: detouring for loot (see the note at the end
// of `decide` — tried twice, measured, and rejected for destabilizing the
// harness), altars, and lore props. The store suite covers the altar and lore
// flows end-to-end instead ([S14]/[S10]).
import { LEVELS } from "@/content/levels";
import { createPlayer, beginLevel, clonePlayer } from "@/game/core/state";
import { resolveTurn, takeGearAt } from "@/game/core/actions";
import { Rng } from "@/game/core/rng";
import { idx, isWalkable, isTransparent } from "@/game/core/grid";
import { giveItem, equipWeapon, equipArmor } from "@/game/core/inventory";
import { CONFIG } from "@/content/config";
import { MONSTERS } from "@/content/monsters";
import { ITEMS, SHOP_TIERS } from "@/content/items";
import { classDef } from "@/content/classes";
import { MUTATORS, applyPlayerMutators } from "@/content/mutators";
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

/**
 * Take the weapon/armour under our feet if it beats what we wear — the bot's
 * side of the step-onto gear prompt. Compares LIKE WITH LIKE (never trades a
 * bow for a melee stick) and skips quest gear, which the core already takes.
 */
function takeGroundUpgrade(g: GameState) {
  const p = g.player;
  const it = g.items.find((i) => i.x === p.x && i.y === p.y);
  if (!it || it.questTag) return;
  const def = ITEMS[it.defId];
  if (!def) return;
  if (def.category === "weapon") {
    const cur = p.weaponId ? ITEMS[p.weaponId] : undefined;
    if ((def.power ?? 0) > (cur?.power ?? 0) && !!def.ranged === !!cur?.ranged)
      takeGearAt(g, it.id);
    return;
  }
  if (def.category === "armor" && (def.reduction ?? 0) > p.armorReduction)
    takeGearAt(g, it.id);
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

  const adjNow = g.monsters.filter((m) => chebyshev(m.x, m.y, p.x, p.y) === 1);

  // 2a. Equip an upgrade we're carrying. The bot used to fight the entire game in
  //     its starting kit, so ground gear was picked up and never worn — which made
  //     the drop economy look worthless and understated what a real player gets
  //     out of loot. Equipping costs a turn, so never do it toe-to-toe.
  if (adjNow.length === 0) {
    for (const b of p.bag) {
      const def = ITEMS[b.defId];
      if (!def) continue;
      if (def.category === "weapon") {
        const cur = p.weaponId ? ITEMS[p.weaponId] : undefined;
        // compare like with like — never trade a bow for a melee stick
        if (
          (def.power ?? 0) > (cur?.power ?? 0) &&
          !!def.ranged === !!cur?.ranged
        )
          return { type: "equip", defId: b.defId };
      }
      if (def.category === "armor" && (def.reduction ?? 0) > p.armorReduction)
        return { type: "equip", defId: b.defId };
    }
  }

  // 2b. Class active ability ([q]) — the headline per-class mechanic. Without it
  //     `[P3]` certified Rogue and Pyromancer as "viable" while never once firing
  //     Dash or Scorch, i.e. it graded two thirds of the classes on their basic
  //     kit alone.
  const ab = classDef(p.classId).ability;
  if (ab && p.abilityCooldown <= 0) {
    if (ab.id === "cleave" && adjNow.length >= 2) return { type: "ability" };
    if (ab.id === "scorch") {
      // aim the cone down whichever orthogonal covers the most foes at range 1–4
      let bestDir: readonly number[] | null = null;
      let bestN = 0;
      for (const [dx, dy] of DIRS) {
        const n = g.monsters.filter((m) => {
          const rx = m.x - p.x;
          const ry = m.y - p.y;
          const along = rx * dx + ry * dy;
          const spread = Math.abs(dx !== 0 ? ry : rx);
          return along >= 1 && along <= 4 && spread <= along;
        }).length;
        if (n > bestN) {
          bestN = n;
          bestDir = [dx, dy];
        }
      }
      if (bestDir && bestN >= 2)
        return { type: "ability", dx: bestDir[0], dy: bestDir[1] };
    }
    if (ab.id === "dash" && adjNow.length >= 2) {
      // a Rogue caught in a crowd leaps clear rather than trading blows
      const away = safeStepAwayFrom(g, adjNow[0]);
      if (away && away.type === "move")
        return { type: "ability", dx: away.dx, dy: away.dy };
    }
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
  //
  // DELIBERATELY NOT a looter. Making the bot detour for nearby gold/gear was
  // tried and measured, twice: as a separate pre-move step, and folded into this
  // goal set. Both improved the metrics you'd want improved (whole-run purse
  // 207g → 281g, `[P4]` best depth 4 → 9 with real shop spending) — and both
  // destabilized the harness: a run that never terminated (`stuck`), a 1914-turn
  // death on the Frostspine, the Antechamber falling 17% → 0%, and `[P5]`'s
  // all-trials gate failing because the Crypt stopped being clearable. The goal
  // set is position-dependent (items enter/leave the radius as you move), so the
  // nearest-goal target can flip turn to turn and livelock.
  //
  // Consequence to keep in mind when reading the table: `medGold` measures what
  // the bot trips over EN ROUTE, so the economy figures are a LOWER bound on what
  // an attentive player banks. Making this faithful needs a committed loot target
  // with an explicit detour budget, not a radius filter.
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
  mutators: string[] = [],
): RunResult {
  // A carried character (full-run mode) arrives with whatever they've earned;
  // otherwise mint the standard bot loadout for an isolated level measurement.
  const player = startPlayer ?? createPlayer(classId);
  if (!startPlayer) {
    // stock the consumables a real player buys at the shop: heals + firebombs, so
    // the bot can actually engage bosses with the intended toolkit (not just melee)
    for (let i = 0; i < 3; i++) giveItem(player, "p_heal");
    for (let i = 0; i < 3; i++) giveItem(player, "p_bomb");
    applyPlayerMutators(player, mutators);
  }
  const g = beginLevel(seed, levelIndex, player, mutators);
  const rng = new Rng(botSeed);
  const cap = Math.max(LEVELS[levelIndex].turnLimit * 4, 500);

  let prevTurn = g.turnCount;
  let invariant: string | null = null;
  const note = (bad: boolean, msg: string) => {
    if (bad && !invariant) invariant = msg;
  };

  for (let t = 0; t < cap; t++) {
    const res = resolveTurn(g, decide(g), rng);

    // Accept the gear prompt when we're standing on an upgrade. Gear is no
    // longer auto-taken into the bag (one weapon, one suit — stepping on a
    // piece raises `mode: "gear"` and the STORE calls `takeGearAt`), so the
    // bag-equip branch in `decide` can no longer see ground loot at all: this
    // bot silently went back to fighting the whole game in its starting kit,
    // which is the exact regression that branch was added to fix. Free action,
    // like the real prompt, so it costs no turn.
    //
    // Restoring it moved NOTHING: byte-identical win-rates and income at 40
    // seeds, because it fires 11 times in the whole suite. The bot is
    // deliberately not a looter, and treasure now sits on open floor only 1% of
    // the time, so it crosses a gear tile ~75 times per suite and upgrades on
    // 11 of those. That is the ground-loot blindness documented in CLAUDE.md,
    // stronger than before: this harness cannot grade ground gear at all. The
    // path is here so it is CORRECT, not because it is a signal.
    takeGroundUpgrade(g);

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
// 12 seeds, not 6. Doubling costs +0.6s and halves the per-seed noise (one seed is
// 8 points instead of 17) — which matters because the floors below are only as sharp
// as the resolution. It also corrected a systematically optimistic reading: the Iron
// Gate showed 50% on 6 seeds and 25% on 12, i.e. the extra seeds were all deaths.
const SEEDS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "g1",
  "g2",
  "g3",
  "g4",
  "g5",
  "g6",
];
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
const levelWinPct: Record<string, number> = {}; // per-level rate, for the floors below
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
  levelWinPct[cfg.id] = (wins.length / results.length) * 100;
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
  // The lower rail is 0.10, NOT the 0.15 it started at, and the reason is that
  // 0.15 contradicted the income band asserted just below. `runGold` sums TWELVE-
  // seed per-level medians, and that input is far noisier than a 1-point rail:
  // measured across a single afternoon of level-geometry work it swung 175–209g
  // (15–18% of stock) while the same content at FORTY seeds held flat at 192–194g
  // (16–17%). So the rail was tripping on the sample, not on the economy.
  //
  // 0.10 is the band's own floor expressed as a ratio (120g / ~1174g of stock),
  // which is the consistency this pair was missing: at 0.15 an income of 120g
  // would satisfy "stays near its tuned level" and simultaneously fail "can still
  // afford meaningful purchases". A genuine collapse now reddens BOTH.
  check(
    "...but a run can still afford meaningful purchases",
    ratio > 0.1,
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
// ─── Per-level regression floors ───────────────────────────────────────────
// The gates above are aggregate: "won ≥1 seed" and a 30% overall rate. A single
// level could therefore collapse from 100% to 8% and nothing would fail. That is
// not hypothetical — twice this project had a level quietly fall (the Iron Gate to
// 17%, the Ramparts 50%→33%) and both were noticed only because a human happened
// to read the table.
//
// VALIDATED AT 52 SEEDS, not at the 12 this file runs. That distinction cost me a
// bad recommendation: the Iron Gate reads 25% on the default 12 seeds and 13% on 52,
// and the same config measured 8% / 25% / 33% / 43% across different 12–30 seed sets.
// A level near the low end is noise-dominated, so calibrate a floor against a big
// sample even though the committed sweep is small.
//
// These floors sit ~2-3 seeds BELOW the measured rate, so they catch a COLLAPSE
// rather than a wobble (one seed is 8 points at this sample size). Update them
// deliberately when you re-tune a level — a floor you lower without thinking is
// how the regression this exists to catch gets waved through.
const WIN_FLOOR: Record<string, number> = {
  dungeon_depths: 75, // 100 @52 seeds
  blackwood: 75, // 100 @52
  the_mire: 50, // 90 @52
  frostspine_pass: 50, // 71 @52
  // PROVISIONAL, pending the balance pass that follows the level rework. The
  // Iron Gate grew 2772 -> 4200 tiles and flipped its base generator (graveyard
  // exterior + a `rogue` gatehouse wing). It measures **48% @40 seeds** — in line
  // with the Great Hall (50%) and Antechamber (42%) — but only ~17% on the
  // committed 12, which the new layout happens to be unlucky on. Lowered
  // deliberately so the gate still catches a COLLAPSE while the level is in
  // flight; re-seat it against a fresh @52 reading once the rework is finished.
  iron_gate: 8, // 48 @40 · 17 @12 (see above)
  // The four wraith levels were re-measured after the wraith's bleed chance went
  // 0.5 → 0.25. The floors themselves are UNCHANGED — a floor only ever needs
  // moving when the measured rate falls toward it, and these all rose. Left
  // conservative on purpose rather than re-seated tight to the new numbers:
  // re-tightening after every buff is how a floor ends up tracking the bot's
  // skill instead of guarding the level.
  great_hall: 17, // 58 @52 (was 52 before the wraith bleed nerf)
  sunken_crypt: 25, // 56 @52 (was 44)
  ramparts: 8, // 38 @52 (was 31) (survive/siege)
  antechamber: 17, // 50 @52
  // throne_of_dusk is deliberately absent: every row plays a level in ISOLATION
  // with a fresh STARTING loadout, so the finale is fought with a rusty dagger and
  // reads 0% by construction. `[P7]` is its real gate (63% with the intended kit).
};
{
  const below: string[] = [];
  for (const [id, pct] of Object.entries(levelWinPct)) {
    const floor = WIN_FLOOR[id];
    if (floor === undefined) continue;
    if (pct < floor) below.push(`${id} ${pct.toFixed(0)}% < ${floor}%`);
  }
  check(
    "no level has regressed below its committed win-rate floor",
    below.length === 0,
    below.length ? `(${below.join("; ")})` : "",
  );
  check(
    "(setup) every non-finale level has a floor to check",
    Object.keys(WIN_FLOOR).length === LEVELS.length - 1,
    `(${Object.keys(WIN_FLOOR).length} floors for ${LEVELS.length} levels)`,
  );
}

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
  // 6 seeds, not 3. The class sweep is the only evidence Rogue and Pyromancer are
  // playable at all, and at 3 seeds a single unlucky roll is 33 points — enough to
  // hide a real regression or invent one. Still reduced vs the 12-seed main table.
  const CLASS_SEEDS = ["alpha", "charlie", "echo", "g1", "g3", "g5"];
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

// ─── P5. Trials (run modifiers) stay playable ──────────────────────────────
// Every measurement above runs with NO trials on — the bot never opts into them,
// so the whole mutator system had zero playtest signal. Core test [52] proves a
// mutated level still GENERATES legally (objectives reachable, no orphaned
// pockets, a trap-free route survives Treacherous), but "generates" is not
// "survivable": a trial that made a level unwinnable would ship green.
//
// The bar is deliberately a FLOOR, not a balance target. Trials are SUPPOSED to
// hurt and the greedy bot is a conservative measure, so the only hard gate is the
// WORST case — every trial at once — leaving each navigation/attrition level
// clearable on at least one seed, with no invariant violated during real play.
// Since every trial is strictly a difficulty increase, all-on subsumes the singles.
//
// Do NOT read the single-trial rows as a difficulty RANKING. At 5 levels × 4 seeds
// one run is 5 percentage points, and the bot is largely insensitive to what most
// trials change: it beelines, paths around traps, and carries 3 heals, so denser
// monsters and thinner loot barely move its win-rate (forsaken and champions have
// both scored ABOVE baseline here — that is noise, not a finding). The rows exist
// to make an unplayable trial obvious, not to tune one.
//
// NOTE `glass` is unmeasurable here: it only sets starting lives, and playLevel
// resolves ONE level that ends on the first death regardless — so its row should
// mirror the baseline. It's listed for completeness, not coverage.
console.log("\n[P5] Trials stay playable — run modifiers under the greedy bot");
{
  const TRIAL_SEEDS = ["alpha", "charlie", "echo", "foxtrot"];
  const navLevels = LEVELS.map((l, i) => ({ l, i })).filter(({ l }) =>
    BOT_MUST_WIN.has(l.goal.type),
  );
  const configs: { label: string; ids: string[] }[] = [
    { label: "(none — baseline)", ids: [] },
    ...MUTATORS.map((m) => ({ label: m.id, ids: [m.id] })),
    { label: "ALL ON", ids: MUTATORS.map((m) => m.id) },
  ];

  let trialInvariant: string | null = null;
  const unclearable: string[] = [];

  for (const cfg of configs) {
    let wins = 0;
    let runs = 0;
    const endHps: number[] = [];
    const neverWon: string[] = [];
    for (const { l, i } of navLevels) {
      let levelWins = 0;
      for (const seed of TRIAL_SEEDS) {
        const r = playLevel(i, seed, 11, "warrior", undefined, cfg.ids);
        runs++;
        if (r.invariant && !trialInvariant)
          trialInvariant = `${cfg.label} @ ${l.id}/${seed}: ${r.invariant}`;
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
      `  · ${cfg.label.padEnd(18)} win ${pct.padStart(3)}% of ${runs}  ` +
        `medEndHP ${String(median(endHps)).padStart(2)}` +
        `${neverWon.length ? `  (never cleared: ${neverWon.join(", ")})` : ""}`,
    );
    if (cfg.label === "ALL ON") unclearable.push(...neverWon);
  }

  // Anti-vacuity: the rows above are only meaningful if the trials actually reach
  // generation. Drop the `mutators` argument in playLevel and every row silently
  // collapses to the baseline while BOTH gates below stay green — so assert the
  // mutated world is observably different, per trial, at its own mechanism.
  const world = (ids: string[]) => {
    const g = beginLevel("alpha", navLevels[1].i, createPlayer("warrior"), ids);
    return {
      monsters: g.monsters.length,
      elites: g.monsters.filter((m) => m.elite).length,
      traps: g.map.tiles.filter((t) => t === "trap").length,
      forage: g.map.tiles.filter((t) => t === "forage").length,
      light: g.player.lightRadius,
    };
  };
  const b = world([]);
  check(
    "swarm actually spawns more monsters",
    world(["swarm"]).monsters > b.monsters,
  );
  check(
    "treacherous actually places more traps",
    world(["treacherous"]).traps > b.traps,
  );
  check(
    "champions actually rolls more elites",
    world(["champions"]).elites > b.elites,
  );
  check(
    "dark actually shrinks the light radius",
    world(["dark"]).light < b.light,
  );
  check(
    "forsaken actually strips the forage",
    world(["forsaken"]).forage === 0 && b.forage > 0,
  );

  check(
    "every navigation/attrition level stays clearable with ALL trials on",
    unclearable.length === 0,
    unclearable.length ? `(never cleared: ${unclearable.join(", ")})` : "",
  );
  check(
    "no invariant violated during real play under trials",
    trialInvariant === null,
    trialInvariant ?? "",
  );
}

// ─── P6. Integration: the actions the greedy bot never emits ────────────────
// `closeDoor` and `blinkTo` are covered as MECHANICS in verify-core ([33], [37]),
// but only in hand-built scenarios. Neither is ever emitted by the bot, so until
// now neither had run inside a real, mid-flight game — a live generated map with
// alerted monsters, fog of war, and a populated turn loop.
//
// Deliberately NOT done by teaching the greedy bot to use them tactically:
//   • a `closeDoor` heuristic livelocks — `PASSABLE` treats a shut door as
//     passable and the bot bumps to reopen it, so closing one on its own route
//     makes it undo itself, the same failure that killed the loot detour;
//   • `blinkTo` would mean adding a Phial to the loadout the difficulty table
//     above is calibrated on, perturbing every row for a niche consumable.
// Driving them at a real mid-run state gets the integration coverage without
// touching the balance numbers.
console.log("\n[P6] Integration: closeDoor + blinkTo inside a live run");
{
  // Play a real run for a while so the state is genuinely mid-flight.
  const midRun = (levelIndex: number, seed: string, turns: number) => {
    const player = createPlayer("warrior");
    for (let i = 0; i < 3; i++) giveItem(player, "p_heal");
    for (let i = 0; i < 3; i++) giveItem(player, "p_bomb");
    const g = beginLevel(seed, levelIndex, player);
    const rng = new Rng(11);
    for (let t = 0; t < turns; t++) {
      const r = resolveTurn(g, decide(g), rng);
      if (r.goalComplete || r.playerDied) break;
    }
    return g;
  };
  const sane = (g: GameState) =>
    g.player.hp <= g.player.maxHp &&
    !Number.isNaN(g.player.hp) &&
    isWalkable(g.map, g.player.x, g.player.y);

  // ── closeDoor: shut a door in a live level and prove it seals ──
  {
    const li = LEVELS.findIndex((l) => (l.doorCount ?? 0) > 0);
    const g = midRun(li, "door-live", 25);
    const w = g.map.width;
    let door: number | null = null;
    for (let i = 0; i < g.map.tiles.length && door === null; i++) {
      if (g.map.tiles[i] !== "doorOpen") continue;
      const dx = i % w;
      const dy = Math.floor(i / w);
      if (g.monsters.some((m) => m.x === dx && m.y === dy)) continue;
      const spot = DIRS.map(([ax, ay]) => ({ x: dx + ax, y: dy + ay })).find(
        (c) =>
          isWalkable(g.map, c.x, c.y) &&
          !g.monsters.some((m) => m.x === c.x && m.y === c.y),
      );
      if (spot) {
        g.player.x = spot.x;
        g.player.y = spot.y;
        door = i;
      }
    }
    check("(setup) found an open door to shut mid-run", door !== null);
    if (door !== null) {
      const dx = door % w;
      const dy = Math.floor(door / w);
      const before = g.turnCount;
      const res = resolveTurn(g, { type: "closeDoor" }, new Rng(5));
      check(
        "closing a door mid-run spends the turn",
        res.tookTurn && g.turnCount > before,
      );
      check("the door is now shut", g.map.tiles[door] === "door");
      check(
        "a shut door blocks both movement and sight",
        !isWalkable(g.map, dx, dy) && !isTransparent(g.map, dx, dy),
      );
      check("the run is still sane after closing a door", sane(g));
      // and with no door beside you it must refuse WITHOUT eating a turn
      const far = g.map.tiles.findIndex(
        (t, i) =>
          t === "floor" &&
          !DIRS.some(
            ([ax, ay]) => g.map.tiles[i + ax + ay * w] === "doorOpen",
          ) &&
          !g.monsters.some((m) => idx(m.x, m.y, w) === i),
      );
      if (far >= 0) {
        g.player.x = far % w;
        g.player.y = Math.floor(far / w);
        const t0 = g.turnCount;
        const none = resolveTurn(g, { type: "closeDoor" }, new Rng(5));
        check(
          "closing with no door beside you costs no turn",
          !none.tookTurn && g.turnCount === t0,
        );
      }
    }
  }

  // ── blinkTo: teleport out of a live position, spending the phial ──
  {
    const g = midRun(0, "blink-live", 20);
    const w = g.map.width;
    giveItem(g.player, "p_blink");
    const had = g.player.bag.find((b) => b.defId === "p_blink")?.count ?? 0;
    check("(setup) carrying a Phial of Blinking", had >= 1);
    // a legal destination: in range, walkable, unoccupied, not where we stand
    let dest: Pos | null = null;
    for (let i = 0; i < g.map.tiles.length && !dest; i++) {
      const x = i % w;
      const y = Math.floor(i / w);
      if (x === g.player.x && y === g.player.y) continue;
      if (chebyshev(x, y, g.player.x, g.player.y) > CONFIG.blinkRange) continue;
      if (!isWalkable(g.map, x, y)) continue;
      if (g.monsters.some((m) => m.x === x && m.y === y)) continue;
      dest = { x, y };
    }
    check("(setup) found a legal blink destination", dest !== null);
    if (dest) {
      const res = resolveTurn(
        g,
        { type: "blinkTo", defId: "p_blink", x: dest.x, y: dest.y },
        new Rng(9),
      );
      check("blinking mid-run spends the turn", res.tookTurn);
      check(
        "the player actually arrives at the target",
        g.player.x === dest.x && g.player.y === dest.y,
      );
      check(
        "the phial is consumed",
        (g.player.bag.find((b) => b.defId === "p_blink")?.count ?? 0) ===
          had - 1,
      );
      check("the run is still sane after blinking", sane(g));
      // an out-of-range blink must fizzle without spending a turn OR a phial
      const kept = g.player.bag.find((b) => b.defId === "p_blink")?.count ?? 0;
      const t0 = g.turnCount;
      const far = resolveTurn(
        g,
        {
          type: "blinkTo",
          defId: "p_blink",
          x: g.player.x + CONFIG.blinkRange + 3,
          y: g.player.y,
        },
        new Rng(9),
      );
      check(
        "an out-of-range blink fizzles — no turn, no phial spent",
        !far.tookTurn &&
          g.turnCount === t0 &&
          (g.player.bag.find((b) => b.defId === "p_blink")?.count ?? 0) ===
            kept,
      );
    }
  }
}

// ─── P7. The finale: is Malachar actually beatable? ─────────────────────────
// The difficulty table shows `throne_of_dusk` at 0% and calls it "not measurable
// here." That was accurate but it left the game's CLIMAX with no automated
// beatability evidence at all — every other level has a floor; the fight the whole
// quest builds toward had none.
//
// The 0% turns out not to be a tactics problem. Every row of that table plays a
// level in ISOLATION with a FRESH starting loadout, so the bot faces the lich
// holding the rusty dagger it starts the game with: 80 HP ÷ (3 power − 2 armor) =
// **80 melee hits**, versus 5 with the Sunblade it was supposed to recover from the
// Crypt one level earlier. The row measured a loadout no real player would arrive
// with, which is why it read as unwinnable.
//
// So: play the finale with the INTENDED endgame kit (Sunblade + heavy armor + the
// consumables the tier-9 shop sells) and hold it to a real bar.
console.log("\n[P7] The finale: Malachar with the intended endgame kit");
{
  const li = LEVELS.length - 1;
  check(
    "(setup) the last level is the boss fight",
    LEVELS[li].goal.type === "killTarget",
  );

  // The kit a player plausibly ARRIVES with. 6 firebombs is deliberately
  // conservative: the shops sell 16 across the run at 20g each, so 6 costs 120g of
  // a ~215g whole-run purse — affordable, but a real tradeoff against gear.
  const kit = (weapon: string | null, bombs: number) => {
    const p = createPlayer("warrior");
    if (weapon) {
      giveItem(p, weapon);
      equipWeapon(p, weapon);
    }
    giveItem(p, "a_plate");
    equipArmor(p, "a_plate");
    for (let i = 0; i < 4; i++) giveItem(p, "p_heal");
    for (let i = 0; i < bombs; i++) giveItem(p, "p_bomb");
    return p;
  };

  const SEEDS = [
    "alpha",
    "bravo",
    "charlie",
    "delta",
    "echo",
    "foxtrot",
    "g1",
    "g2",
  ];
  const run = (weapon: string | null, bombs: number) => {
    let wins = 0;
    const turns: number[] = [];
    const endHps: number[] = [];
    const outcomes: string[] = [];
    let invariant: string | null = null;
    for (const seed of SEEDS) {
      const r = playLevel(li, seed, 11, "warrior", kit(weapon, bombs));
      if (r.invariant && !invariant) invariant = `${seed}: ${r.invariant}`;
      outcomes.push(`${r.outcome[0]}@${r.turns}`);
      if (r.outcome === "win") {
        wins++;
        turns.push(r.turns);
        endHps.push(r.endHp);
      }
    }
    return { wins, turns, endHps, outcomes, invariant };
  };

  // The 2x2 that isolates what the finale actually demands of the player.
  const intended = run("w_sun", 6);
  const noBlade = run(null, 6);
  const noBombs = run("w_sun", 0);
  const neither = run(null, 0);
  const pct = (n: number) =>
    `${((n / SEEDS.length) * 100).toFixed(0).padStart(3)}%`;
  console.log(
    `  · Sunblade + 6 bombs (intended) win ${pct(intended.wins)}  ` +
      `medTurns ${median(intended.turns)}  medEndHP ${median(intended.endHps)}  ${intended.outcomes.join(" ")}`,
  );
  console.log(`  · dagger   + 6 bombs           win ${pct(noBlade.wins)}`);
  console.log(`  · Sunblade + 0 bombs           win ${pct(noBombs.wins)}`);
  console.log(
    `  · dagger   + 0 bombs           win ${pct(neither.wins)}   ` +
      `<- the loadout the isolated table measures, i.e. why that row reads 0%`,
  );

  check(
    "the finale IS winnable with the intended endgame kit",
    intended.wins > 0,
    `(${intended.wins}/${SEEDS.length} seeds)`,
  );
  check(
    "no invariant violated during the boss fight",
    intended.invariant === null,
    intended.invariant ?? "",
  );
  // Both halves of the intended toolkit must be load-bearing — that IS the design
  // claim ("beatable without the Sunblade only in theory"), now measured.
  check(
    "the Sunblade is load-bearing (80 HP / a 3-power dagger = 80 melee hits)",
    intended.wins > noBlade.wins,
    `(with ${intended.wins} vs without ${noBlade.wins})`,
  );
  check(
    "firebombs are load-bearing (the lich is dormant — you soften it at range)",
    intended.wins > noBombs.wins && noBombs.wins === 0,
    `(with ${intended.wins} vs without ${noBombs.wins})`,
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
