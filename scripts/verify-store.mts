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
import { SHOP_TIERS, ITEMS, sellPrice } from "@/content/items";
import { idx } from "@/game/core/grid";
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
  while (st().mode === "playing" && guard++ < 5000) {
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

  clearReachLevelInvincible();
  check(
    "clearing the level opens the cleared-narration card",
    st().mode === "narration",
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
  g.player.coins = entry.price * (entry.maxQty ?? 1) + 5; // afford the full stack
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

  // broke: a purchase you can't afford is a no-op
  st().game!.player.coins = 0;
  const brokeHeld = st().game!.player.bag.length;
  st().buyShopEntry(entry);
  check(
    "a purchase you can't afford changes nothing",
    st().game!.player.bag.length === brokeHeld,
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

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`}`,
);
process.exit(failures === 0 ? 0 : 1);
