// Generation SOAK — the generator guarantees over a large sweep of seeds.
//
// verify-core checks each guarantee on a handful of hand-picked seeds (5–8 per
// check). That is the right shape for a fast suite, but procedural generators fail
// on RARE seeds, and a rare seed is exactly what reaches a player: a 1-in-200
// orphaned pocket is invisible to an 8-seed sample and perfectly visible to
// whoever rolls it. This sweeps every level across hundreds of seeds and asserts
// the load-bearing structural properties only.
//
// Run with:  npm run test:soak            (default 200 seeds/level)
//            npm run test:soak -- 1000    (deeper, before a release)
//
// NOT part of `test:all` — it is a pre-release / post-generator-change gate, not a
// per-commit check. Seeds are FIXED strings (`soak-0`, `soak-1`, …), so a failure
// is reproducible: the report names the exact (level, seed) to re-run.
import { LEVELS } from "@/content/levels";
import { CONFIG } from "@/content/config";
import { MONSTERS } from "@/content/monsters";
import { createPlayer, beginLevel, recomputeFOV } from "@/game/core/state";
import { resolveTurn } from "@/game/core/actions";
import { Rng } from "@/game/core/rng";
import { gameplaySeed } from "@/lib/hash";
import { MUTATORS } from "@/content/mutators";
import { idx, isWalkable, manhattan } from "@/game/core/grid";
import type { GameState, Pos } from "@/game/core/types";

const SEED_COUNT = Number(process.argv[2]) || 200;

// Tiles that count as "open" for connectivity: a cracked wall or a shut door is
// passable-in-principle (you bash/open it), so a region behind one is NOT orphaned.
// Must mirror `isOpenTile` in generate.ts — when a new walkable tile type is added
// and this set isn't updated, the sweep reports phantom orphans.
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

const DIRS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const;

/** Flood from `from` over tiles passing `ok`. Returns the reached index set. */
function flood(
  g: GameState,
  from: Pos,
  ok: (i: number) => boolean,
): Set<number> {
  const w = g.map.width;
  const h = g.map.height;
  const start = idx(from.x, from.y, w);
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen.has(ni) || !ok(ni)) continue;
      seen.add(ni);
      stack.push(ni);
    }
  }
  return seen;
}

/** Every structural property we require of a freshly generated level. */
function violations(g: GameState): string[] {
  const bad: string[] = [];
  const w = g.map.width;
  const t = g.map.tiles;
  const from = { x: g.player.x, y: g.player.y };

  if (!isWalkable(g.map, g.player.x, g.player.y))
    bad.push("player not on walkable tile");

  // 1. connectivity: nothing open may be cut off from the player
  const open = flood(g, from, (i) => OPEN.has(t[i]));
  let orphans = 0;
  for (let i = 0; i < t.length; i++)
    if (OPEN.has(t[i]) && !open.has(i)) orphans++;
  if (orphans > 0) bad.push(`${orphans} orphaned open tiles`);

  // 2. objectives reachable
  const targets: Pos[] = [];
  if (g.map.exit) targets.push(g.map.exit);
  for (const m of g.monsters)
    if (m.isGoalTarget) targets.push({ x: m.x, y: m.y });
  for (const it of g.items) if (it.questTag) targets.push({ x: it.x, y: it.y });
  for (const p of targets)
    if (!open.has(idx(p.x, p.y, w)))
      bad.push(`objective unreachable at ${p.x},${p.y}`);

  // 3. every placed item reachable (loot you can see but never touch is a bug)
  for (const it of g.items)
    if (!open.has(idx(it.x, it.y, w)))
      bad.push(`item ${it.defId} unreachable at ${it.x},${it.y}`);

  // 4. a trap-free route to every objective must exist
  const safe = flood(g, from, (i) => OPEN.has(t[i]) && t[i] !== "trap");
  for (const p of targets)
    if (!safe.has(idx(p.x, p.y, w)))
      bad.push(`objective at ${p.x},${p.y} only reachable THROUGH a trap`);

  // 5. Nothing hostile that can actually REACH you spawns in your lap.
  //
  // Two intentional exemptions, both found by this sweep rather than assumed:
  //   • ambient wildlife — placed outside `monsterBudget` on ordinary floor with
  //     no far-from-player rule, being harmless atmosphere;
  //   • a sealed vault GUARDIAN — `placeSecretVault` puts it inside a walled room
  //     whose gate isn't walkable, so it's dormant and cannot come to you. At
  //     1000 seeds the Frostspine's beast-den bear lands at manhattan 5 on ~8 of
  //     them; harmless, because breaking in is the player's choice. Hence the test
  //     is "reachable by WALKING" (no bashing cracked walls or opening doors)
  //     rather than raw distance.
  const walkable = flood(g, from, (i) => {
    const x = i % w;
    const y = Math.floor(i / w);
    return isWalkable(g.map, x, y);
  });
  for (const m of g.monsters) {
    if (MONSTERS[m.defId].behavior === "ambient") continue;
    if (!walkable.has(idx(m.x, m.y, w))) continue; // sealed away — can't reach you
    const d = manhattan(m.x, m.y, g.player.x, g.player.y);
    if (d < CONFIG.minSpawnDistanceFromPlayer)
      bad.push(`${m.defId} spawned too close (manhattan ${d})`);
  }

  // 6. flood levels: an interactive altar or a readable inscription must never be
  // marked floodable, or it drowns into water while still rendering its glyph
  if (g.floodable?.length) {
    const floodable = new Set(g.floodable);
    for (const a of g.altars)
      if (floodable.has(idx(a.x, a.y, w)))
        bad.push(`altar at ${a.x},${a.y} can flood`);
    for (const l of g.lore)
      if (floodable.has(idx(l.x, l.y, w)))
        bad.push(`lore at ${l.x},${l.y} can flood`);
  }

  // 7. every structural WING must survive with walkable floor, and be reachable.
  //
  // A wing is carved as a rectangle and joined to the map by an artery. That
  // artery is drawn before the wing's own hazards scatter, so a water clump can
  // cut it; on an organic base it can dead-end in a one-tile pocket; and two
  // wings used to stamp the same rectangle and destroy each other. In every case
  // `sealUnreachable` then walls the wing away and the region stays TAGGED with
  // no walkable tile — the level quietly loses a third of its content and every
  // gate stays green.
  //
  // Count by REGION ID, never by biome: a wing whose biome matches its level's
  // base (the reed maze in a marsh, the crypt maze in a crypt) otherwise counts
  // base tiles and reads as a false 100%. Measuring it the wrong way is exactly
  // how this went unnoticed — the Mire's maze was severed on 40% of seeds.
  (LEVELS[g.currentLevel].subBiomes ?? []).forEach((spec, si) => {
    if (!spec.layout) return;
    const rid = si + 1;
    let floor = 0;
    let reachable = 0;
    for (let i = 0; i < t.length; i++) {
      if ((g.map.region?.[i] ?? 0) !== rid) continue;
      if (!OPEN.has(t[i])) continue;
      floor++;
      if (open.has(i)) reachable++;
    }
    if (floor === 0)
      bad.push(`${spec.biome}/${spec.layout} wing has NO walkable floor`);
    else if (reachable === 0)
      bad.push(
        `${spec.biome}/${spec.layout} wing is sealed off (${floor} tiles)`,
      );
  });

  return bad;
}

// ── run the sweep ───────────────────────────────────────────────────────────
console.log(
  `Generation soak — ${LEVELS.length} levels × ${SEED_COUNT} seeds = ` +
    `${LEVELS.length * SEED_COUNT} generations\n`,
);

const seeds = Array.from({ length: SEED_COUNT }, (_, i) => `soak-${i}`);
let failures = 0;
const t0 = Date.now();

for (let li = 0; li < LEVELS.length; li++) {
  let bad = 0;
  const firstFew: string[] = [];
  for (const seed of seeds) {
    const g = beginLevel(seed, li, createPlayer());
    const v = violations(g);
    if (v.length) {
      bad++;
      failures++;
      if (firstFew.length < 3) firstFew.push(`${seed}: ${v.join("; ")}`);
    }
  }
  const label = LEVELS[li].id.padEnd(16);
  if (bad === 0) console.log(`  ✓ ${label} ${SEED_COUNT} seeds clean`);
  else {
    console.log(`  ✗ ${label} ${bad}/${SEED_COUNT} seeds FAILED`);
    for (const f of firstFew) console.log(`      ${f}`);
  }
}

// Vault secrecy is O(tiles × FOV), far too slow for every seed — sample it. A
// transparent diagonal corner in a "sealed" vault wall reveals the whole hoard
// (test [56] covers the fixed seeds; this widens the net cheaply).
{
  const vaultLevels = LEVELS.map((l, i) => ({ l, i })).filter(
    ({ l }) => l.secretVault,
  );
  const sample = seeds.filter((_, n) => n % 10 === 0); // was every 25th — still bounded, 2.5× the net
  let bad = 0;
  for (const { i } of vaultLevels) {
    for (const seed of sample) {
      const g = beginLevel(seed, i, createPlayer());
      const w = g.map.width;
      // the vault is the floor component holding loot that the player can't reach
      const reach = flood(
        g,
        { x: g.player.x, y: g.player.y },
        (k) =>
          OPEN.has(g.map.tiles[k]) &&
          g.map.tiles[k] !== "crackedWall" &&
          g.map.tiles[k] !== "door",
      );
      const sealedLoot = g.items.filter((it) => !reach.has(idx(it.x, it.y, w)));
      if (!sealedLoot.length) continue;
      const target = idx(sealedLoot[0].x, sealedLoot[0].y, w);
      // stand on every reachable tile near the vault and confirm we can't see in
      for (const k of reach) {
        const kx = k % w;
        const ky = Math.floor(k / w);
        if (
          Math.abs(kx - sealedLoot[0].x) > 3 ||
          Math.abs(ky - sealedLoot[0].y) > 3
        )
          continue;
        g.player.x = kx;
        g.player.y = ky;
        g.player.lightRadius = 8;
        recomputeFOV(g);
        if (g.visible.includes(target)) {
          bad++;
          failures++;
          console.log(
            `  ✗ ${LEVELS[i].id} ${seed}: vault loot visible from ${kx},${ky} before breaking in`,
          );
          break;
        }
      }
    }
  }
  if (bad === 0)
    console.log(
      `  ✓ vault secrecy    ${vaultLevels.length} levels × ${sample.length} sampled seeds clean`,
    );
}

// Run modifiers reshape generation BEFORE the guarantees run, so a trial that broke
// a guarantee on a RARE seed would slip past both core `[52]` (a handful of fixed
// seeds) and this sweep (which ran unmodified configs only). Check the worst case —
// every trial at once — plus each trial alone, over a bounded slice of the seeds.
{
  const combos: { label: string; ids: string[] }[] = [
    ...MUTATORS.map((m) => ({ label: m.id, ids: [m.id] })),
    { label: "ALL ON", ids: MUTATORS.map((m) => m.id) },
  ];
  const slice = seeds.filter((_, n) => n % 5 === 0); // bounded: a fifth of the sweep
  let bad = 0;
  for (const { label, ids } of combos) {
    for (let li = 0; li < LEVELS.length; li++) {
      for (const seed of slice) {
        const g = beginLevel(seed, li, createPlayer(), ids);
        const v = violations(g);
        if (v.length) {
          bad++;
          failures++;
          if (bad <= 3)
            console.log(
              `  ✗ ${LEVELS[li].id} ${seed} [${label}]: ${v.join("; ")}`,
            );
        }
      }
    }
  }
  if (bad === 0)
    console.log(
      `  ✓ under trials     ${combos.length} combos × ${LEVELS.length} levels × ` +
        `${slice.length} seeds clean`,
    );
}

// The flood must never MAROON the player: before each rise `tickFlood` reserves a
// walkable escape route back to permanently-dry ground. A softlock is worse than a
// death — the turn limit is only a score target, so nothing would end the run.
//
// Two things this has to get right, both learned by getting them wrong:
//   • park the player OFF the protected dry spine (on a floodable tile). Standing on
//     the spine is safe by construction, so a player who never moves can't be
//     stranded and the check passes with the escape logic deleted;
//   • assert "can still WALK to permanently-dry ground", not "has a walkable
//     neighbor" — the weaker version passes while you tread water in a puddle.
{
  const floodLevels = LEVELS.map((l, i) => ({ l, i })).filter(
    ({ l }) => l.flood,
  );
  const slice = seeds.filter((_, n) => n % 4 === 0);
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
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        const ni = ny * w + nx;
        if (seen.has(ni) || !isWalkable(g.map, nx, ny)) continue;
        seen.add(ni);
        q.push(ni);
      }
    }
    return false;
  };
  let bad = 0;
  let checked = 0;
  for (const { i } of floodLevels) {
    for (const seed of slice) {
      const g = beginLevel(seed, i, createPlayer());
      g.player.maxHp = 1e9;
      g.player.hp = 1e9;
      g.monsters = [];
      // Park in the ADVERSARIAL spot, not merely an off-spine one: the floodable
      // tile with the FEWEST walkable neighbors (a dead end), tie-broken by
      // distance from the entry. Measured with the guard disabled, the farthest
      // tile strands on 16% of seeds while a dead end strands on 42% — so the
      // gentler choice needs ~3× the seeds to see the same bug. A soak should
      // probe the worst case it can construct.
      const w = g.map.width;
      let best = -1;
      let bestScore = -Infinity;
      for (const k of g.floodable ?? []) {
        const x = k % w;
        const y = Math.floor(k / w);
        if (!isWalkable(g.map, x, y)) continue;
        const openN = DIRS.filter(([dx, dy]) =>
          isWalkable(g.map, x + dx, y + dy),
        ).length;
        const score = -openN * 100 + manhattan(x, y, g.player.x, g.player.y);
        if (score > bestScore) {
          bestScore = score;
          best = k;
        }
      }
      if (best < 0) continue;
      g.player.x = best % w;
      g.player.y = Math.floor(best / w);
      checked++;
      const cfg = LEVELS[i].flood!;
      const turns = cfg.startTurn + cfg.interval * (cfg.maxSteps + 2);
      const rng = new Rng(gameplaySeed(seed));
      for (let t = 0; t < turns; t++) resolveTurn(g, { type: "wait" }, rng);
      if (!canEscape(g)) {
        bad++;
        failures++;
        if (bad <= 3)
          console.log(
            `  ✗ ${LEVELS[i].id} ${seed}: stranded at ${g.player.x},${g.player.y} ` +
              `after full submersion (no walk to dry ground)`,
          );
      }
    }
  }
  if (bad === 0)
    console.log(
      `  ✓ flood softlock   ${checked} off-spine starts flooded to maximum, ` +
        `all still able to reach dry ground`,
    );
}

console.log(
  `\n${failures === 0 ? "SOAK CLEAN ✓" : `${failures} SEED(S) FAILED ✗`}` +
    `  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
);
process.exit(failures === 0 ? 0 : 1);
