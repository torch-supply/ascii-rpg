// Store-level orchestration harness.
//
// verify-core.mts tests pure-core mechanics; verify-playthrough.mts tests
// balance/beatability. Neither touches the LoopDriver in `gameStore.ts` — the
// layer that sequences SCREENS and RUN FLOW: splash → class → narration → play
// → level-clear → shop → next level → … → victory, plus death/restart, the
// anti-skip input-settle guard, and save/resume. This drives the vanilla store
// headlessly and asserts those transitions fire in the right order.
//
// Run with: npx --yes tsx scripts/verify-store.mts
//
// Browser seams: `sound`/`effectBus` self-guard to no-ops under Node; `storage`
// needs a localStorage shim (below) so the save/resume roundtrip is real.

// ── in-memory localStorage shim (must exist before the store is imported) ──
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
(globalThis as unknown as { localStorage: MemStorage }).localStorage =
  new MemStorage();

// pure helpers / content have no browser deps — safe to import statically
import { LEVELS } from "@/content/levels";
import { CONFIG } from "@/content/config";
import { MUTATORS } from "@/content/mutators";
import { SHOP_TIERS, ITEMS, sellPrice } from "@/content/items";
import { idx } from "@/game/core/grid";
import { giveItem } from "@/game/core/inventory";
import type { GameState, Pos } from "@/game/core/types";

// the store reads bare `localStorage` inside its functions, so import it only
// AFTER the shim is installed (dynamic import runs after top-level code above)
const { gameStore } = await import("@/store/gameStore");

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ FAIL: ${name} ${extra}`);
  }
}

const st = () => gameStore.getState();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The store arms a ~250ms "input settle" window after each screen appears so the
// keypress that opened it can't skip it. Wait it out before an advance action.
const settle = () => sleep(300);

// Boot a fresh run all the way into live play on a fixed seed.
async function bootToPlay(seed: string, classId = "warrior") {
  st().init();
  st().newGame(classId, seed);
  await settle();
  st().continueNarration(); // beginPlay → playing
}

const PASSABLE = new Set([
  "floor",
  "exit",
  "doorOpen",
  "door",
  "trapSprung",
  "oil",
  "forage",
  "ice",
  "glowcap",
]);
function stepToward(
  g: GameState,
  goal: Pos,
): { dx: number; dy: number } | null {
  const w = g.map.width;
  const h = g.map.height;
  const start = idx(g.player.x, g.player.y, w);
  const goalI = idx(goal.x, goal.y, w);
  const prev = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  seen[start] = 1;
  const q = [start];
  let found = -1;
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === goalI) {
      found = cur;
      break;
    }
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || !PASSABLE.has(g.map.tiles[ni])) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  if (found < 0) return null;
  let cur = found;
  while (prev[cur] !== start) cur = prev[cur];
  return { dx: (cur % w) - g.player.x, dy: Math.floor(cur / w) - g.player.y };
}

// Make the current player invincible, then walk the reachLocation exit. Stops
// as soon as the store leaves "playing" (i.e. the level-clear flow fired).
function clearReachLevelInvincible() {
  const g = st().game!;
  g.player.hp = 1e9;
  g.player.maxHp = 1e9;
  const exit = g.map.exit!;
  let guard = 0;
  while (guard++ < 5000) {
    const mode = st().mode;
    // A POI modal (lore / altar) can open mid-walk — a real player just dismisses
    // it and carries on, so don't mistake it for the level-clear transition.
    if (mode === "lore") {
      st().closeLore();
      continue;
    }
    if (mode === "altar") {
      st().declineAltar();
      continue;
    }
    if (mode !== "playing") break; // the level-clear flow (narration/shop) fired
    const cur = st().game!;
    const step = stepToward(cur, exit);
    if (!step || (step.dx === 0 && step.dy === 0)) {
      st().submitAction({ type: "wait" });
      continue;
    }
    st().submitAction({ type: "move", dx: step.dx, dy: step.dy });
  }
}

// ─── S1. Boot sequence: splash → new game → opening narration ───────────────
console.log("\n[S1] Boot: splash → new game → opening narration");
{
  st().init();
  check("a fresh install boots to the splash", st().mode === "splash");
  check("no save → Resume is unavailable", st().hasSave === false);

  st().newGame("warrior", "store-seed");
  check(
    "New Game opens the opening narration (not straight into play)",
    st().mode === "narration",
  );
  check(
    "the opening card continues into play",
    st().narration?.onContinue === "beginPlay",
  );
  check(
    "a game + rng now exist, parked on level 0",
    !!st().game && !!st().rng && st().game!.currentLevel === 0,
  );
}

// ─── S2. Input-settle guard: the class keypress can't skip the opening ──────
console.log("\n[S2] Anti-skip: input settle blocks an immediate advance");
{
  st().init();
  st().newGame("warrior", "store-seed");
  st().continueNarration(); // fired within the settle window → must be ignored
  check(
    "an advance inside the settle window is swallowed",
    st().mode === "narration",
  );
  await settle();
  st().continueNarration();
  check(
    "after the settle window the advance goes through",
    st().mode === "playing",
  );
}

// ─── S3. Level clear → narration → shop (ordering + no early advance) ───────
console.log("\n[S3] Level-clear flow: clear → narration → shop");
{
  await bootToPlay("store-seed");
  check(
    "(setup) in live play on level 0",
    st().mode === "playing" && st().game!.currentLevel === 0,
  );

  const parBefore = st().game!.player.parBonus ?? 0;
  clearReachLevelInvincible();
  check(
    "clearing the level opens the cleared-narration card",
    st().mode === "narration",
  );
  // The par bonus is accrued exactly here, at the moment of the clear — nothing
  // asserted it, so `handleLevelComplete` could stop paying it entirely and every
  // suite stayed green (mutation audit). The invincible walk takes well under par.
  check(
    "clearing under par accrues the efficiency bonus",
    (st().game!.player.parBonus ?? 0) > parBefore,
    `(parBonus ${parBefore} → ${st().game!.player.parBonus})`,
  );
  check(
    "the card is a next-level transition",
    st().narration?.onContinue === "nextLevel",
  );
  check(
    "the level does NOT advance until you continue",
    st().game!.currentLevel === 0,
  );

  await settle();
  st().continueNarration();
  check(
    "level 0 has a shop tier → continue lands in the shop",
    st().mode === "shop",
  );
  check(
    "the shop hasn't advanced the level yet",
    st().game!.currentLevel === 0,
  );
}

// ─── S4. Shop economy: buy (coins/qty caps) + sell ──────────────────────────
console.log("\n[S4] Shop economy: buy respects coins + maxQty, sell pays out");
{
  // continues from S3 — we're in the shop on level 0 (tier 1)
  const tier = LEVELS[0].shopTier!;
  const entry = SHOP_TIERS[tier].find(
    (e) => e.maxQty != null && e.maxQty >= 1,
  )!;
  const g = st().game!;
  // Fund FAR past the cap. With only a few coins left over, an over-cap purchase
  // gets refused by the PURSE check instead of the cap, and the cap assertion below
  // passes without the cap doing anything (a mutation audit removed the cap and this
  // section stayed green). Overfunding removes the confound.
  g.player.coins = entry.price * ((entry.maxQty ?? 1) + 5);
  const coins0 = g.player.coins;
  const held0 = g.player.bag.find((b) => b.defId === entry.itemId)?.count ?? 0;

  st().buyShopEntry(entry);
  check(
    "buying deducts the price",
    st().game!.player.coins === coins0 - entry.price,
  );
  check(
    "buying adds the item to the bag",
    (st().game!.player.bag.find((b) => b.defId === entry.itemId)?.count ??
      0) ===
      held0 + 1,
  );

  // buy up to the per-visit cap, then one more must be refused
  for (let i = 1; i < (entry.maxQty ?? 1); i++) st().buyShopEntry(entry);
  const cappedCoins = st().game!.player.coins;
  const cappedHeld =
    st().game!.player.bag.find((b) => b.defId === entry.itemId)?.count ?? 0;
  st().buyShopEntry(entry); // over the cap
  check(
    "buying past maxQty is refused (no coins spent, no item added)",
    st().game!.player.coins === cappedCoins &&
      (st().game!.player.bag.find((b) => b.defId === entry.itemId)?.count ??
        0) === cappedHeld,
  );

  // Broke: a purchase you can't afford must be a no-op.
  //
  // Two confounds had to be removed for this to mean anything, and I introduced the
  // second one myself while fixing the first:
  //   1. asserting `bag.length` — the capped entry above is a STACKABLE potion, so a
  //      successful buy bumps `count` and leaves the length untouched;
  //   2. reusing `entry` — by now it sits at its purchase CAP, so the cap refuses the
  //      buy and the purse check never runs at all.
  // So use an UNCAPPED entry that hasn't been bought, where the purse is the only
  // possible gate, and assert what a purchase would actually change.
  const uncapped = SHOP_TIERS[tier].find(
    (e) => e.maxQty == null && e.itemId === "am_arrow",
  )!;
  check("(setup) found an uncapped entry for the purse test", !!uncapped);
  st().game!.player.coins = 0;
  const arrows0 =
    st().game!.player.bag.find((b) => b.defId === uncapped.itemId)?.count ?? 0;
  st().buyShopEntry(uncapped);
  const arrows1 =
    st().game!.player.bag.find((b) => b.defId === uncapped.itemId)?.count ?? 0;
  check(
    "a purchase you can't afford changes nothing",
    arrows1 === arrows0 && st().game!.player.coins === 0,
    `(arrows ${arrows0} → ${arrows1}, coins ${st().game!.player.coins})`,
  );

  // sell: put a sellable item in the bag and sell it back
  const sellable = Object.values(ITEMS).find((it) => sellPrice(it) > 0)!;
  const gp = st().game!.player;
  gp.bag.push({ defId: sellable.id, count: 1 });
  const beforeSellCoins = gp.coins;
  st().sellBagItem(sellable.id);
  check(
    "selling pays out the sell price",
    st().game!.player.coins === beforeSellCoins + sellPrice(sellable),
  );
  check(
    "selling removes the item from the bag",
    !st().game!.player.bag.some((b) => b.defId === sellable.id),
  );
}

// ─── S5. Leaving the shop advances to the next level ────────────────────────
console.log("\n[S5] Leaving the shop advances the level");
{
  await settle();
  st().leaveShop();
  check("leaving the shop drops you into live play", st().mode === "playing");
  check("…on the NEXT level", st().game!.currentLevel === 1);
}

// ─── S6. Death with lives remaining → restart-level narration ───────────────
console.log("\n[S6] Death (lives left) → restart the level");
{
  await bootToPlay("death-seed");
  const g = st().game!;
  const levelAtDeath = g.currentLevel;
  g.player.lives = 2;
  g.player.hp = 1;
  g.player.maxHp = 30;
  g.player.effects.bleed = 5; // a lethal end-of-turn tick
  g.monsters = []; // isolate: die to our own DoT, not a lucky monster
  st().submitAction({ type: "wait" });
  check(
    "a lethal turn with lives left shows the You Fall card",
    st().mode === "narration",
  );
  check(
    "the card restarts the level",
    st().narration?.onContinue === "restartLevel",
  );

  await settle();
  st().continueNarration();
  check(
    "rising drops you back into play on the SAME level",
    st().mode === "playing" && st().game!.currentLevel === levelAtDeath,
  );
  check("a life was spent", st().game!.player.lives === 1);
  check(
    "HP is restored on restart",
    st().game!.player.hp === st().game!.player.maxHp,
  );
}

// ─── S7. Death on the last life → game over ─────────────────────────────────
console.log("\n[S7] Death (last life) → game over");
{
  await bootToPlay("gameover-seed");
  const g = st().game!;
  g.player.lives = 1;
  g.player.hp = 1;
  g.player.maxHp = 30;
  g.player.effects.bleed = 5;
  g.monsters = [];
  st().submitAction({ type: "wait" });
  check(
    "losing the last life ends the run at game over",
    st().mode === "gameover",
  );
  check(
    "the run result is recorded as a loss",
    st().runResult?.victory === false,
  );
  check(
    "game over clears the save (no resuming a dead run)",
    st().hasSave === false,
  );
}

// ─── S8. Completing the final level → victory ───────────────────────────────
console.log("\n[S8] Final level cleared → victory");
{
  await bootToPlay("victory-seed");
  st().debugJumpTo(LEVELS.length - 1); // jump straight to the throne
  check(
    "(setup) parked on the final level, in play",
    st().mode === "playing" && st().game!.currentLevel === LEVELS.length - 1,
  );
  // satisfy the kill-boss goal cheaply: remove the goal target, then take a turn
  st().game!.monsters = st().game!.monsters.filter((m) => !m.isGoalTarget);
  st().game!.player.hp = 1e9;
  st().game!.player.maxHp = 1e9;
  st().submitAction({ type: "wait" });
  check(
    "clearing the last level rolls straight to victory",
    st().mode === "victory",
  );
  check(
    "the run result is recorded as a win",
    st().runResult?.victory === true,
  );
  check("victory clears the save", st().hasSave === false);
}

// ─── S9. Save / resume roundtrip through the store ──────────────────────────
console.log("\n[S9] Save/resume roundtrip");
{
  await bootToPlay("resume-seed");
  const g = st().game!;
  g.player.hp = 1e9; // invincible so a wait can't end the run mid-test
  g.player.maxHp = 1e9;
  g.monsters = [];
  st().submitAction({ type: "wait" }); // a real turn → triggers persist()
  st().submitAction({ type: "wait" });
  const snap = {
    level: st().game!.currentLevel,
    turn: st().game!.turnCount,
    hp: st().game!.player.hp,
  };

  await settle();
  st().quitToTitle();
  check("quitting to title returns to the splash", st().mode === "splash");
  check("a persisted run is offered for Resume", st().hasSave === true);
  check("quitting drops the in-memory game", st().game === null);

  st().resumeGame();
  check("Resume drops back into live play", st().mode === "playing");
  check(
    "the resumed run matches what was saved (level/turn/hp)",
    st().game!.currentLevel === snap.level &&
      st().game!.turnCount === snap.turn &&
      st().game!.player.hp === snap.hp,
  );
}

// ─── S10. Lore prop interaction: step on → read → dismiss → stays read ──────
console.log("\n[S10] Lore prop: step onto → read modal → dismiss → stays read");
{
  await bootToPlay("store-seed");
  const g = st().game!;
  const w = g.map.width;
  const l = g.lore[0]; // level 0 (the Pit) carries lore props
  check("(setup) the level has a lore prop", !!l);
  if (l) {
    // stand on a floor neighbor of the prop and clear the way, then step onto it
    const nbrs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    let dir: { dx: number; dy: number } | null = null;
    for (const [dx, dy] of nbrs) {
      const nx = l.x + dx;
      const ny = l.y + dy;
      if (g.map.tiles[idx(nx, ny, w)] === "floor") {
        g.player.x = nx;
        g.player.y = ny;
        dir = { dx: -dx, dy: -dy }; // from the neighbor back onto the prop
        break;
      }
    }
    // clear any monsters off the prop + stand tiles so the step isn't a bump
    g.monsters = g.monsters.filter(
      (m) =>
        !(m.x === l.x && m.y === l.y) &&
        !(m.x === g.player.x && m.y === g.player.y),
    );
    check("(setup) found a floor approach to the prop", dir !== null);

    st().submitAction({ type: "move", dx: dir!.dx, dy: dir!.dy });
    check("stepping onto the prop opens the lore modal", st().mode === "lore");
    check("the prop is now marked read", g.lore[0].read === true);
    check(
      "the active lore is the prop stepped on",
      st().activeLore?.id === l.id,
    );

    st().closeLore();
    check("dismissing lore returns to play", st().mode === "playing");

    // stepping onto it again does NOT reopen (already read)
    g.player.x = l.x - dir!.dx;
    g.player.y = l.y - dir!.dy;
    st().submitAction({ type: "move", dx: dir!.dx, dy: dir!.dy });
    check("a read prop does not reopen", st().mode === "playing");
  }
}

// ─── S11. Save compatibility: stale/corrupt saves retire gracefully ─────────
// We bump `CONFIG.contentVersion` on every content change and RELY on old saves
// being rejected rather than loaded into a broken state. That path is what
// protects players across updates, so exercise it directly: a stale content
// version, a bumped schema version, and unparseable junk must each read as
// "no save" (Resume hidden) — never a crash or a half-loaded run.
console.log(
  "\n[S11] Save compatibility: stale/corrupt saves retire gracefully",
);
{
  const KEY = CONFIG.saveKey;
  // start from a real, valid save so we know the baseline works
  await bootToPlay("compat-seed");
  st().submitAction({ type: "wait" }); // a committed turn → persist()
  const valid = localStorage.getItem(KEY);
  check("(setup) a real run persisted a save", !!valid);
  st().init();
  check("a current-version save is offered for Resume", st().hasSave === true);

  const parsed = JSON.parse(valid!);
  const write = (o: unknown) => localStorage.setItem(KEY, JSON.stringify(o));

  // (a) a save written by an older content version must be retired
  write({ ...parsed, contentVersion: "0-ancient" });
  st().init();
  check(
    "a STALE contentVersion save is not offered for Resume",
    st().hasSave === false,
  );
  // the real protection: even if Resume is somehow invoked, it must refuse the
  // stale save and bounce to the splash rather than load a broken run
  st().resumeGame();
  check(
    "...and Resume refuses it, returning to the splash",
    st().mode === "splash" && st().hasSave === false,
  );

  // (b) a future/other schema version must be retired
  write({ ...parsed, version: 999 });
  st().init();
  check(
    "an unknown schema version is not offered for Resume",
    st().hasSave === false,
  );

  // (c) structurally broken payloads must not crash the boot
  for (const [label, blob] of [
    ["unparseable junk", "{not json"],
    ["a valid-JSON non-object", "42"],
    ["a save missing `game`", JSON.stringify({ ...parsed, game: undefined })],
  ] as const) {
    localStorage.setItem(KEY, blob);
    let threw = false;
    try {
      st().init();
    } catch {
      threw = true;
    }
    check(`${label} → boots without throwing`, !threw);
    check(`${label} → Resume stays hidden`, st().hasSave === false);
  }

  // (d) and the game is still fully playable after a rejected save
  localStorage.removeItem(KEY);
  await bootToPlay("compat-seed2");
  check(
    "a fresh run still starts cleanly after a rejected save",
    st().mode === "playing" && !!st().game,
  );
}

// ─── S12. Save FIDELITY: the whole run state survives, not just the scalars ──
// S9 proves a resume happens; this proves nothing is silently LOST in it. The
// save stores `game` wholesale as JSON, so the danger isn't a forgotten field —
// it's a value JSON can't carry (a Set/Map degrades to `{}`, `undefined` and
// NaN vanish). Nearly every feature adds a GameState field and the docs keep
// claiming "JSON-safe → roundtrips in the save"; this is what checks that.
console.log("\n[S12] Save fidelity: mid-run state survives a resume intact");
{
  await bootToPlay("fidelity-seed");
  const g = st().game!;
  g.player.hp = 1e9; // invincible so the persist turn can't end the run
  g.player.maxHp = 1e9;
  g.monsters = [];

  // (a) Structural guard: walk the LIVE state and reject anything JSON can't
  // carry. This is the future-proof half — it covers fields not yet written.
  const offenders: string[] = [];
  const scan = (v: unknown, path: string, depth = 0) => {
    if (depth > 6 || v === null) return;
    if (v instanceof Set || v instanceof Map) {
      offenders.push(`${path} is a ${v.constructor.name} (JSON → {})`);
      return;
    }
    if (typeof v === "number" && !Number.isFinite(v)) {
      offenders.push(`${path} is ${v} (JSON → null)`);
      return;
    }
    if (typeof v === "function") {
      offenders.push(`${path} is a function (JSON drops it)`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => scan(x, `${path}[${i}]`, depth + 1));
    } else if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>))
        scan(x, `${path}.${k}`, depth + 1);
    }
  };

  // populate the state that recent features added, so there's real data to lose
  const w = g.map.width;
  const here = idx(g.player.x, g.player.y, w);
  g.gasTiles = [{ i: here + 2, life: 3 }];
  g.fireTiles = [{ i: here + 3, life: 2 }];
  g.decals = { [here + 4]: "blood", [here + 5]: "scorch" };
  g.crackedWallHits = { [here + 6]: 2 };
  g.knownTraps = [here + 7];
  g.questProgress = { moonstone: 2 };
  g.levelKills = 4;
  g.mutators = ["dark", "champions"];
  g.floodStep = 3;
  g.barrage = [here + 8];
  if (g.lore[0]) g.lore[0].read = true;
  if (g.altars[0]) g.altars[0].used = true;

  scan(g, "game");
  check(
    "every live GameState value is JSON-safe (no Set/Map/NaN/function)",
    offenders.length === 0,
    offenders.slice(0, 3).join("; "),
  );

  // (b) Semantic roundtrip: persist → quit → resume, then confirm the actual
  // CONTENT came back (not just that the keys exist).
  st().submitAction({ type: "wait" }); // a committed turn → persist()
  const before = st().game!;
  const snap = {
    gas: before.gasTiles.length,
    fire: before.fireTiles.length,
    decals: Object.keys(before.decals).length,
    cracked: JSON.stringify(before.crackedWallHits),
    traps: JSON.stringify(before.knownTraps),
    quest: JSON.stringify(before.questProgress),
    kills: before.levelKills,
    mutators: JSON.stringify(before.mutators),
    flood: before.floodStep,
    loreRead: before.lore.filter((l) => l.read).length,
    altarUsed: before.altars.filter((a) => a.used).length,
    explored: before.explored.length,
    turn: before.turnCount,
    level: before.currentLevel,
    coins: before.player.coins,
    bag: JSON.stringify(before.player.bag),
  };

  await settle();
  st().quitToTitle();
  st().resumeGame();
  const after = st().game!;
  check("(setup) the run resumed", !!after);

  const fields: [string, unknown, unknown][] = [
    ["lingering gas clouds", snap.gas, after.gasTiles.length],
    ["lingering fire tiles", snap.fire, after.fireTiles.length],
    ["floor decals", snap.decals, Object.keys(after.decals).length],
    [
      "cracked-wall bash progress",
      snap.cracked,
      JSON.stringify(after.crackedWallHits),
    ],
    ["known traps", snap.traps, JSON.stringify(after.knownTraps)],
    ["quest progress", snap.quest, JSON.stringify(after.questProgress)],
    ["level kills", snap.kills, after.levelKills],
    ["active run modifiers", snap.mutators, JSON.stringify(after.mutators)],
    ["flood progress", snap.flood, after.floodStep],
    ["read-lore flags", snap.loreRead, after.lore.filter((l) => l.read).length],
    [
      "spent-altar flags",
      snap.altarUsed,
      after.altars.filter((a) => a.used).length,
    ],
    ["explored fog", snap.explored, after.explored.length],
    ["turn count", snap.turn, after.turnCount],
    ["current level", snap.level, after.currentLevel],
    ["coins", snap.coins, after.player.coins],
    ["inventory bag", snap.bag, JSON.stringify(after.player.bag)],
  ];
  for (const [label, was, now] of fields)
    check(
      `${label} survive the resume`,
      was === now,
      `(was ${was}, got ${now})`,
    );

  // and the populated state was genuinely non-empty, so the checks above meant something
  check(
    "(guard) the fidelity fixtures were actually populated",
    snap.gas > 0 &&
      snap.decals > 0 &&
      snap.explored > 0 &&
      snap.mutators !== "[]",
  );
}

// ─── S13. Trial picker: class select → toggle trials → run carries them ─────
// The mutator SYSTEM is well covered ([40]/[52] as config transforms, [P5] in
// real play, [S12] for the save roundtrip) but the UI PATH that turns a player's
// picks into a run was not tested at all: `chooseClass` → `mutators` mode →
// `toggleMutator` → `beginRun`. A picker that dropped the selection on the floor
// would have shipped with every one of those other tests green.
console.log("\n[S13] Trial picker: class select → toggle trials → run carries");
{
  st().init();
  st().chooseClass("rogue");
  check(
    "choosing a class advances to the trial picker (not straight into play)",
    st().mode === "mutators",
  );
  check(
    "the trial picker starts with nothing selected",
    st().selectedMutators.length === 0,
  );

  const trial = MUTATORS[0].id;
  st().toggleMutator(trial);
  check("toggling a trial selects it", st().selectedMutators.includes(trial));
  st().toggleMutator(trial);
  check(
    "toggling the same trial again clears it",
    !st().selectedMutators.includes(trial),
  );

  // pick two, including Glass, whose effect is observable on the player
  st().toggleMutator(trial);
  st().toggleMutator("glass");
  st().beginRun();
  await settle();
  st().continueNarration();

  const g = st().game!;
  check("the run starts in play", st().mode === "playing");
  check(
    "the chosen trials reach GameState.mutators",
    g.mutators.includes(trial) && g.mutators.includes("glass"),
    `(got ${JSON.stringify(g.mutators)})`,
  );
  check(
    "the chosen class survives the trial picker",
    g.player.classId === "rogue",
  );
  check(
    "Glass really applied — the run starts on a single life",
    g.player.lives === 1,
    `(lives ${g.player.lives})`,
  );
}

// ─── S14. Altar flow: step onto → offer → accept pays its cost ──────────────
// The parallel LORE modal flow has had [S10] for a while; the altar — which
// unlike lore mutates the player (gold/HP for maxHP/weaponBonus/potions) — had
// no store-level coverage, so `acceptAltar` was never once invoked by a test.
console.log(
  "\n[S14] Altar flow: step onto → offer → accept applies the bargain",
);
{
  await bootToPlay("altar-store-seed");
  const g = st().game!;
  const w = g.map.width;
  // Level 0 (the Pit) carries no altars, and `bootToPlay` always starts there, so
  // plant one on a floor tile beside the player — the flow under test is the
  // STORE's (step-on → offer mode → accept/decline), not altar placement, which
  // verify-core already covers.
  let dir: { dx: number; dy: number } | null = null;
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const nx = g.player.x + dx;
    const ny = g.player.y + dy;
    if (g.map.tiles[idx(nx, ny, w)] === "floor") {
      g.altars.push({
        id: "test-altar",
        x: nx,
        y: ny,
        kind: "vigor",
        used: false,
      });
      dir = { dx, dy };
      break;
    }
  }
  check("(setup) planted an altar beside the player", dir !== null);
  const a = g.altars.find((x) => x.id === "test-altar")!;
  if (dir) {
    g.monsters = g.monsters.filter(
      (m) =>
        !(m.x === a.x && m.y === a.y) &&
        !(m.x === g.player.x && m.y === g.player.y),
    );
    // pay-able: the bargains cost gold or HP, so make sure we can afford one
    g.player.coins = 500;
    g.player.maxHp = 60;
    g.player.hp = 60;

    st().submitAction({ type: "move", dx: dir.dx, dy: dir.dy });
    check("stepping onto an altar opens the offer", st().mode === "altar");
    check(
      "the active altar is the one stepped on",
      st().activeAltar?.id === a.id,
    );

    // Declining must cost nothing and leave the altar available.
    const coinsBefore = g.player.coins;
    const maxHpBefore = g.player.maxHp;
    st().declineAltar();
    check("declining returns to play", st().mode === "playing");
    check(
      "declining costs nothing and leaves the altar unspent",
      g.player.coins === coinsBefore &&
        g.player.maxHp === maxHpBefore &&
        a.used === false,
    );

    // Accept it: something about the player must change, and it must be spent.
    g.player.x = a.x - dir!.dx;
    g.player.y = a.y - dir!.dy;
    st().submitAction({ type: "move", dx: dir.dx, dy: dir.dy });
    check("the altar can be re-entered while unspent", st().mode === "altar");
    const before = JSON.stringify([
      g.player.coins,
      g.player.maxHp,
      g.player.hp,
      g.player.weaponBonus,
      g.player.bag.length,
    ]);
    st().acceptAltar();
    const after = JSON.stringify([
      g.player.coins,
      g.player.maxHp,
      g.player.hp,
      g.player.weaponBonus,
      g.player.bag.length,
    ]);
    check("accepting returns to play", st().mode === "playing");
    check(
      "accepting an altar changes the player",
      before !== after,
      `(${before} → ${after})`,
    );
    check("a taken altar is marked spent", a.used === true);

    // and a spent altar must not re-offer
    g.player.x = a.x - dir!.dx;
    g.player.y = a.y - dir!.dy;
    st().submitAction({ type: "move", dx: dir.dx, dy: dir.dy });
    check("a spent altar does not re-offer", st().mode === "playing");
  }
}

// ─── S15. Targeting cursor, ability routing, overlays, sound ────────────────
// The store's remaining untested surface. `[P6]` drives `throwAt`/`shootAt`/`blinkTo`
// as pure ACTIONS, but the UI path that aims them — `beginTargeting` → `moveCursor`
// → `confirmTarget`/`cancelTarget` — was never exercised, so a cursor that clamped
// wrongly or a confirm that fired the wrong action would ship green.
console.log("\n[S15] Targeting cursor, ability aim, overlays, sound");
{
  await bootToPlay("targeting-seed");
  const g = st().game!;
  g.monsters = []; // keep the cursor deterministic (it snaps to a visible monster)
  for (let i = 0; i < 3; i++) giveItem(g.player, "p_bomb");

  // ── firebomb cursor ──
  st().beginTargeting("p_bomb");
  check("beginTargeting opens the cursor", st().mode === "targeting");
  check(
    "the cursor starts on the player when nothing is in range",
    st().targeting?.x === g.player.x && st().targeting?.y === g.player.y,
  );
  check(
    "the cursor carries the throw range",
    st().targeting?.range === CONFIG.throwRange,
  );

  const cx0 = st().targeting!.x;
  st().moveCursor(1, 0);
  check("moveCursor moves the cursor", st().targeting!.x === cx0 + 1);

  // the cursor must not wander past the item's range
  for (let i = 0; i < CONFIG.throwRange + 6; i++) st().moveCursor(1, 0);
  const dist = Math.max(
    Math.abs(st().targeting!.x - g.player.x),
    Math.abs(st().targeting!.y - g.player.y),
  );
  check(
    "the cursor is clamped to the throw range",
    dist <= CONFIG.throwRange,
    `(cursor at chebyshev ${dist}, range ${CONFIG.throwRange})`,
  );

  st().cancelTarget();
  check("cancelling targeting returns to play", st().mode === "playing");
  check(
    "cancelling spends no turn and no bomb",
    (st().game!.player.bag.find((b) => b.defId === "p_bomb")?.count ?? 0) === 3,
  );

  // confirming actually throws: the bomb is spent and the turn is taken
  const turn0 = st().game!.turnCount;
  st().beginTargeting("p_bomb");
  st().moveCursor(2, 0);
  st().confirmTarget();
  check("confirming a throw returns to play", st().mode === "playing");
  check(
    "confirming spends the bomb and the turn",
    (st().game!.player.bag.find((b) => b.defId === "p_bomb")?.count ?? 0) ===
      2 && st().game!.turnCount > turn0,
    `(bombs ${st().game!.player.bag.find((b) => b.defId === "p_bomb")?.count}, turn ${turn0} → ${st().game!.turnCount})`,
  );

  // ── a directional ability opens an AIM, and a bare confirm just cancels it ──
  {
    st().game!.player.abilityCooldown = 0;
    st().game!.player.classId = "rogue"; // Dash is directional
    st().triggerAbility();
    check(
      "a directional ability opens an aim cursor",
      st().mode === "targeting",
    );
    check(
      "the aim is tagged as an ability",
      st().targeting?.kind === "ability",
    );
    const t1 = st().game!.turnCount;
    st().confirmTarget(); // a tile-confirm is meaningless for a direction
    check(
      "confirming a directional aim cancels rather than firing blind",
      st().mode === "playing" && st().game!.turnCount === t1,
    );
  }

  // ── overlays: pause / inventory / help all round-trip back to play ──
  for (const m of ["paused", "inventory", "help"] as const) {
    st().setMode(m);
    check(`the ${m} overlay opens`, st().mode === m);
    st().setMode("playing");
    check(`the ${m} overlay closes back to play`, st().mode === "playing");
  }

  // ── sound toggle persists (it's a localStorage-backed preference) ──
  {
    const before = st().soundOn;
    st().toggleSound();
    check("toggling sound flips the flag", st().soundOn === !before);
    st().init(); // a fresh boot must remember the choice
    check(
      "the sound preference survives a reboot",
      st().soundOn === !before,
      `(was ${before}, now ${st().soundOn})`,
    );
    st().toggleSound(); // leave it as we found it
  }
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`,
);
process.exit(failures === 0 ? 0 : 1);
