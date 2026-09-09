import type { Biome } from "@/game/core/types";

// Global, non-per-level tuning knobs.
export const CONFIG = {
  startingLives: 3,
  startingMaxHp: 20,
  startingWeaponId: "w_dagger",
  startingArmorId: "a_rags",
  /** how far a coin pile's value can swing, before coinRichness multiplier */
  coinPile: { min: 3, max: 9 },
  /** GLOBAL economy dials — scale a level's ground-loot and forage counts at
   * generation (applied on top of any run-modifier tweak). Lower = leaner: the
   * shop becomes a real "what can I afford?" choice and HP attrition bites, so a
   * careless run costs a life. Tune these (with `coinPile` + monster
   * `coinReward`) rather than editing every level. */
  // 0.6, down from 0.67 — and the real leanness is WHERE loot sits, not how much
  // of it there is. Treasure now prefers dead ends (see `placeItems`), which took
  // gold and gear lying on open floor from 49% of the game's loot to 4%.
  //
  // 0.6 is a MEASURED floor, not a preference: with the treasure/supply split in
  // place, 0.67 and 0.60 both keep the carried-run gate at depth 3 and 0.55 drops
  // it to 2. Note that gate has no headroom — its baseline is 2/2/3, so exactly
  // one of three runs reaches the bar — which is why every step down was swept
  // rather than guessed.
  lootScale: 0.6, // ground item drops (gold piles + potions/gear on the floor)
  forageScale: 0.5, // wild heal tiles — halved so healing isn't free-flowing
  /** keep monsters from spawning right on top of the player */
  minSpawnDistanceFromPlayer: 6,
  /** Floor on how close a `reachLocation` exit may be to the start (manhattan).
   * `exitInBiome` picks the farthest cell WITHIN a region, which is only far if
   * the region itself is — and a destination region can be carved right next to
   * the start. Measured on the Mire over 1000 seeds: ~2% put the exit within 20
   * steps and the worst put it at 3, so a pilgrimage level was occasionally over
   * before it began. Deliberately a modest ABSOLUTE floor rather than a fraction
   * of map size: it should catch the broken tail and nothing else, and a
   * size-scaled value (~34 on the Mire) would fire on a quarter of seeds and
   * flatten the variety in where you start. */
  minStartToExit: 20,
  /**
   * How far you must walk before you can first set foot in the region that
   * holds the objective (`SubBiomeSpec.goalHere`) — the APPROACH.
   *
   * Distinct from `minStartToExit`, which measures the distance to the goal
   * TILE and so can be satisfied entirely indoors: you may start 30 steps from
   * the Gate Warden but three steps from the gatehouse door, walk in, and cross
   * the interior. On levels built as an outside→inside journey that skips the
   * half the level exists for. Measured before this: **13% of Iron Gate seeds
   * put the building within 10 steps** (19% within 15), and 9%/19% on the Mire,
   * against a median approach of 35.
   *
   * Applied by FILTERING the start pool, not by moving the start afterwards —
   * the region is already carved when the start is picked, so a single
   * multi-source BFS out from it gives the true walking distance.
   */
  minStartToGoalRegion: 18,
  /** message log lines kept in memory */
  messageLogMax: 50,
  /** damage a hidden spike trap deals when triggered (reduced by armor) */
  trapDamage: 6,
  /** default torch fuel (turns of light) if an item doesn't specify its own */
  torchFuel: 150,
  /** how far the firebomb cursor may be placed from the player */
  throwRange: 7,
  /** weapon-power bonus while the Might effect is active */
  mightBonus: 4,
  /** armed traps within this many tiles are sensed (revealed as a faint ^) */
  trapSenseRadius: 1,
  /** damage multiplier for striking a monster that hasn't noticed you (sneak) */
  sneakMultiplier: 2,
  /** damage a volatile elite's death-burst deals to an adjacent player */
  eliteExplodeDamage: 6,
  /** melee bumps needed to smash open a cracked wall (knockback breaks instantly) */
  crackedWallToughness: 4,
  /** cap on persistent floor decals per level (drops oldest beyond this) */
  maxDecals: 220,
  /** fraction of an item's base value the shop pays when you sell it */
  sellRate: 0.4,
  /** "survive" levels: an escalating siege — waves close in from a ring around
   * the player, growing as the timer runs down, up to a concurrent cap */
  siege: {
    waveEvery: 3, // spawn a wave every N turns
    ringMin: 5, // waves appear this..
    ringMax: 10, // ..to this many tiles from the player (they arrive in a few turns)
    cap: 19, // max concurrent COMBATANTS during the hold (a FLOOR — see headroom)
    /** Minimum room to escalate INTO, above the level's own starting population:
     * the effective cap is `max(cap, monsterBudget + headroom)`.
     *
     * `cap` is 19 rather than 22 to PRESERVE the Ramparts' tuned difficulty across
     * the fix that stopped ambient wildlife counting against the cap: its 3 ravens
     * used to occupy 3 slots, so the real combat capacity the level was balanced
     * against was always 22 − 3 = 19. Correcting the accounting without this would
     * have handed the siege 3 extra live combatants (measured: 50% → 33% bot
     * win-rate). Headroom 5 keeps that at baseline (14 + 5 = 19) while a denser
     * level, or the Restless Dead trial (21 + 5 = 26), still gets real room to
     * escalate into instead of being pinned at the cap with nowhere to grow. */
    headroom: 5,
  },
  /** Par-for-score: `LevelConfig.turnLimit` is no longer a threat on non-survive
   * levels (there's no countdown or overtime) — it's a PAR TIME. Clearing a level
   * in fewer turns awards up to this many bonus score points, scaling linearly
   * from `parBonusMax` (instant clear) down to 0 (at/over par). Survive levels —
   * whose whole point is spending turns — earn no par bonus. */
  parBonusMax: 120,
  /** Malachar's boss fight (behavior "bossLich"). Values are indexed by phase
   * (0: HP>2/3, 1: HP>1/3, 2: HP≤1/3) so the fight escalates as he weakens. */
  lich: {
    /** dark-fire barrage: damage per detonating tile (reduced by armor/ward) */
    barrageDamage: 12,
    /** how many tiles the barrage telegraphs, by phase */
    barrageTiles: [3, 5, 7],
    /** turns between special abilities (barrage/summon), by phase */
    abilityCd: [5, 4, 3],
    /** adds summoned per summon, by phase */
    summonCount: [2, 2, 3],
    /** chance an ability is a summon (else a barrage), by phase */
    summonChance: [0.4, 0.45, 0.5],
    /** don't summon past this many living non-boss monsters */
    summonCap: 8,
    /** blink at least this far from the player when cornered */
    teleportMinDist: 4,
  },
  /** Forage heal tiles. Outdoors the land sustains you (small, plentiful heals);
   * the deeper arcane motes heal a touch more but are far rarer (per-level
   * `forageCount`, sparse-to-none in the castle/throne). */
  forage: {
    outdoorBiomes: ["forest", "marsh", "mountain"] as Biome[],
    outdoor: { heal: 1, glyph: "%", color: "#8fd45a", name: "wild growth" },
    // ❖, not ∴ — a three-dot cluster is what the POISON HAZE draws, so a
    // healing mote and a cloud of gas were the same character. A hazard and a
    // boon must never share a glyph; `/style`'s collision report is the check.
    arcane: { heal: 2, glyph: "❖", color: "#c86bff", name: "arcane mote" },
  },
  /** while the Shadow effect is active, monsters can't detect you beyond this
   * many tiles (on top of the usual light-limited sight) */
  shadowSightRadius: 2,
  /** an alerted (non-boss) monster gives up the chase after this many turns
   * without detecting you — break line-of-sight and wait it out */
  loseInterestTurns: 6,
  /** how far the Phial of Blinking can teleport you (cursor range) */
  blinkRange: 5,
  /** how long a status debuff lasts when applied by a fire tile (burn refresh) */
  fireBurnDuration: 2,
  /** lingering fire tiles left by a thrown firebomb */
  fire: {
    /** turns a fire tile keeps burning */
    duration: 4,
    /** per-tile chance to catch fire within the blast footprint */
    spawnChance: 0.6,
  },
  /** how long the bleed lasts when you push through a bramble thicket (Levitation
   * floats over the thorns untouched; fire clears the thicket to bare floor) */
  brambleBleedDuration: 3,
  /** poison-spore vents (`sporeVent` tiles) that seep a lingering toxic haze */
  gas: {
    /** turns of gas life set on a vent + its neighbors each turn it re-emits */
    ventLife: 3,
    /** every Nth turn the vent "breathes" — the haze swells one ring further */
    breathPeriod: 3,
    /** Life of the diagonal BREATH ring — deliberately shorter than `ventLife` so the
     * swell visibly lapses again. When the two were equal (both 3) the ring was
     * refreshed on precisely the turn it would have expired, so the haze swelled once
     * on turn 3 and then sat frozen at full extent forever: a "pulsing pocket" that
     * never pulsed. The glyph alternation is a renderer clock effect, so it still
     * LOOKED alive, which is what hid it. */
    breathLife: 1,
    /** A vent SEEPS for `ventActive` turns out of every `ventPeriod`, then falls
     * quiet — so the haze clears completely and later returns, rather than sitting
     * on the map as permanent poison terrain. A standing cloud is something you
     * route around once and forget; an intermittent one is a timing decision (wait
     * for it to clear, or push through and take the poison). It stays fair because
     * the `○` vent tile is always visible, so the threat is telegraphed even while
     * the air is clear. Each vent runs on its OWN phase (offset by its tile index)
     * so a level's vents don't pulse in unison, which reads as mechanical. */
    ventPeriod: 12,
    ventActive: 4,
    /** how long the poison lasts when you breathe the haze */
    poisonDuration: 4,
  },
  /**
   * Light-gated sight — the model the game runs on. Flip `sight` to compare.
   *
   *  "torch"     — shipped behaviour. FOV radius IS your light radius, so you
   *                see exactly as far as your own torch reaches and a lit
   *                brazier down a dark hall is invisible (it isn't in
   *                `state.visible` at all).
   *  "lightGated" — the classic roguelike model: line of sight out to
   *                `sightRange`, and a tile you can see is DRAWN when something
   *                lights it — your torch, a glowcap pool, a fire, an altar.
   *
   * PROMOTED from a render-side probe into the core (`game/core/light.ts`), so
   * `state.visible` IS this set. While it was render-only the two disagreed
   * everywhere it mattered — the sharpest case being that `shootAt` gates on
   * `state.visible`, so you could see a lit room and be refused the shot with no
   * message and no turn spent. Test `[70]` reproduces exactly that when flipped
   * back to `"torch"`.
   *
   * STEALTH IS UNAFFECTED: detection reads `player.lightRadius` directly
   * (`min(def.sightRadius, p.lightRadius, …)`), never `state.visible`, so
   * dousing your torch still hides you while you can now see the lit room ahead.
   */
  sight: "lightGated" as "torch" | "lightGated",
  /** how far line-of-sight reaches under "lightGated" (tiles) */
  sightRange: 14,
  /**
   * Pool radius of light sources in the WORLD — sconces, fires, glowcaps,
   * altars, the Sunblade, a boss aura.
   *
   * Separate from your own carried light on purpose, and this is the whole
   * point of "light at a distance". `ROT.Lighting` takes ONE range and its
   * falloff is `1 - r/range` measured FROM THE SOURCE, so a single shared range
   * meant your torch governed the size and brightness of every other light on
   * the level: douse it and a brazier forty tiles away dimmed and shrank with
   * it. Two light fields are computed instead — this range for the world, your
   * `lightRadius` for what you carry — and summed.
   *
   * 5 because it reproduces the old look in the case where the bug was DORMANT
   * (torch out, so the shared range was just the base radius): measured over 8
   * seeds the Antechamber reads 104 visible tiles either way, the Great Hall 95.
   * What it removes is the inflation a lit torch used to apply to everything
   * else — the Antechamber went 104 → 193 on striking a torch, and now goes
   * 104 → 144, which is your own pool growing rather than every brazier in the
   * castle brightening at once. Raise it if distant braziers read too weakly;
   * it is the dial for how far a light carries.
   */
  worldLightRange: 5,
  /** What your eyes give you in PITCH DARK, with nothing lit nearby.
   * Today there's no such concept: `baseLightRadius` (4-8) means you always see
   * a room's worth even carrying no light at all, which is why darkness has
   * never been dangerous and the torch reads as a convenience. Your torch is
   * already a light source in the light map, so its pool comes back through the
   * lit test — this is only the floor beneath it. */
  unlitSight: 3,
  /**
   * Minimum light (luma) for a tile in LOS to be drawn — the dial that decides
   * how far you read a light, far more than `sightRange` does (most lights are
   * near, so shortening the range barely bites).
   *
   * Started at 30, which let very weak bounce light through: the result was a
   * broad field of barely-lit tiles that read as "I can see everything faintly"
   * rather than as pools with dark between them. 100 is about half a torch's
   * brightness at its source, so only genuinely lit ground registers.
   */
  sightLightMin: 55,
  /** Lit wall sconces per level — often the only reason a room down a dark hall
   * is visible at all. Placed at GENERATION (`placeSconces` → `GameMap.sconces`)
   * on wall tiles that face open floor, deterministically from the level index,
   * so they consume none of the map-gen RNG stream. The wall stays a wall; it
   * just burns. 0 = off, and every level declares a value. */
  sconces: 14,
  /** localStorage key for the single autosave slot */
  saveKey: "emberofdawn:save:v1",
  /** bump content version to invalidate incompatible saves */
  contentVersion: "60",
};

/** Forage flavor + heal for a biome: outdoor growth vs. deeper arcane motes. */
export function forageStyle(biome: Biome) {
  return CONFIG.forage.outdoorBiomes.includes(biome)
    ? CONFIG.forage.outdoor
    : CONFIG.forage.arcane;
}
