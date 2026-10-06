// ─────────────────────────────────────────────────────────────────────────
// Core type definitions. This module is PURE data — no React, Zustand, DOM,
// or rot.js imports. Everything downstream depends on these shapes.
// ─────────────────────────────────────────────────────────────────────────
import type { GameEvent } from "./events";

// ── Map / tiles ────────────────────────────────────────────────────────────
export type TileType =
  | "wall"
  | "crackedWall" // a wall, but an explosion blows it open into floor
  | "floor"
  | "door" // a closed door: blocks movement + sight until opened (bump to open)
  | "doorOpen" // an open door: walkable + see-through (press [c] to close it)
  | "exit"
  | "trap" // armed, hidden (renders as floor) until stepped on
  | "trapSprung" // triggered, visible, harmless
  | "oil" // walkable slick; fire ignites it and races across it
  | "ice" // frozen water (Frostwalk) — permanent walkable bridge
  | "forage" // walkable; step on it to heal a little, then it's spent (→ floor)
  | "glowcap" // walkable glowing fungus: emits colored light (bioluminescent grotto)
  | "bramble" // walkable thorn thicket: snags/bleeds whoever pushes through; fire clears it
  | "sporeVent" // walkable fumarole: seeps a lingering poison haze (gasTiles) around itself
  | "water" // impassable but transparent; Rimewalk freezes it, floods can fill it
  | "chasm"; // impassable void: like water but NO ice bridge (Rimewalk can't cross)

export interface GameMap {
  width: number;
  height: number;
  /** Flat array, length = width*height, index = y*width + x. */
  tiles: TileType[];
  /** The single "exit" tile, present on reachLocation levels. */
  exit?: Pos;
  // ── sub-biome regions (cosmetic) ──
  // Per-tile region id (0 = base level biome). Plain number[] (not a typed
  // array) so it JSON-roundtrips through the save like `tiles`. Present only on
  // levels with `subBiomes`. The renderer/lighting resolve each tile's look via
  // `regionBiome[id]` / `regionPalette[id]` (index 0 = the level's own).
  region?: number[];
  regionBiome?: Biome[];
  regionPalette?: Palette[];
  /** Region ids belonging to FREESTANDING structures (`LevelConfig.structures`)
   * rather than to a sub-biome. Plain number[] so it JSON-roundtrips like the
   * rest. A hut tags its region `dungeon` purely to borrow that biome's plain
   * `#` wall and lack of weather — but `dungeon` is also a SCONCE biome, so the
   * renderer read those walls as a lit interior and hung burning brackets on
   * every hut in the woods and every wayshrine in the bog. On an outdoor level
   * they were the ONLY eligible walls, so the entire sconce budget landed on
   * them. This is what lets the renderer tell "tagged dungeon for its glyph"
   * apart from "actually a dungeon". */
  structureRegions?: number[];
  /** Wall tiles carrying a lit sconce (`LevelConfig.sconces`). Placed at
   * GENERATION rather than in the renderer, because light is no longer a render
   * concern: a sconce is what makes a room down a dark hall visible at all, so
   * `recomputeFOV` needs it. Plain number[] so it JSON-roundtrips like `tiles`. */
  sconces?: number[];
}

/** A secondary biome region carved into a level: a distinct palette + biome tag
 * (glyphs / atmosphere / lighting ambient) over either an organic noise blob
 * (cosmetic) or a structural `layout` wing, optionally seeded with a hazard kit
 * (water/oil/ice/…) that DOES affect play. */
export interface SubBiomeSpec {
  biome: Biome;
  palette: Palette;
  /** noise frequency — smaller = larger, smoother blobs (default 0.13) */
  scale?: number;
  /** noise cutoff — higher = smaller region (default 0.2) */
  threshold?: number;
  /** hazard terrain scattered as blobs inside the region — a kit, e.g. a bog's
   * water pools or a scorched hollow's oil. Carved pre-connectivity, so
   * reachability guarantees hold. Omit to use the biome's default kit
   * (`BIOME_HAZARDS` in generate.ts); pass `[]` for none. */
  hazards?: {
    type: TileType;
    density?: number;
    /** if set, place the hazard as this many CONTIGUOUS patches (a glowing
     * hollow, an oil pool) grown by flood-fill, instead of many scattered
     * specks — total tiles still = density × region floor. */
    clumps?: number;
  }[];
  /** if set, carve the region's STRUCTURE with this generator in a rectangular
   * wing (e.g. a `maze` catacomb), bridged to the main map. Overrides the
   * default organic noise-blob shaping. */
  layout?: GeneratorKind;
  /** wing size as a fraction of the map (w & h), for `layout` carves (default 0.42) */
  size?: number;
  /**
   * The player may never START in this region.
   *
   * Not a difficulty knob — a narrative one. Several levels are a journey INTO
   * somewhere, and spawning past the threshold destroys the arc before it
   * begins: the Iron Gate started you already inside the gatehouse on 12% of
   * seeds, the Great Hall down in its undercroft — the level's first sight of
   * what the castle keeps underground — on 11%.
   *
   * Matched by REGION ID, which is why it lives on the spec and not as a
   * level-wide list of biomes. A biome blocklist cannot express the cases that
   * matter most, because a sub-region often shares its level's base biome: the
   * Mire's reed maze is `marsh`, the Sunken Crypt's catacomb is `crypt`, and the
   * Blackwood's glade and briar are BOTH `forest`. Blocking by biome there would
   * block the base region too, or fail to tell the two sub-regions apart — the
   * same biome-vs-region-id trap that hid the severed-wing bug.
   *
   * Falls back to the unconstrained pick if the exclusions leave nothing, so a
   * seed can never be stranded.
   */
  /**
   * The level's OBJECTIVE belongs in this region — the `reachLocation` exit,
   * the `killTarget` boss, or the `findItem` quest item, whichever the level
   * has. Falls back to the normal farthest-cell pick if the region has no
   * eligible floor, so a seed is never left without its goal.
   *
   * The mirror of `noStart`: that says where the journey can't begin, this says
   * where it has to end. Without it the objective lands wherever the map
   * happens to trail off, and a region built to BE the destination is just a
   * side room you may never enter — the Gate Warden, who exists to hold the
   * gatehouse, stood out on the open graves on 60% of seeds.
   *
   * Region-id keyed for the same reason as `noStart`: a biome-keyed version
   * (`exitInBiome`, which this replaces) cannot name one of two regions that
   * share a biome, and silently means "any of them".
   */
  goalHere?: boolean;
  noStart?: boolean;
  /** for `layout` carves: make the wing look GROWN rather than BUILT — the
   * lattice is cut at half resolution and doubled, then its walls eroded, so
   * banks vary in thickness and the straight runs and right angles go. Opt-in,
   * because rectilinear is CORRECT for a built wing (the crypt's bone catacombs,
   * the Mire's drowned temple) and wrong only for a natural one (a reed
   * thicket). See `organicGrid` in generate.ts. */
  organic?: boolean;
}

export interface Pos {
  x: number;
  y: number;
}

// ── Content definitions (immutable registries) ──────────────────────────────
export type Biome =
  | "dungeon"
  | "forest"
  | "marsh"
  | "mountain"
  | "castle"
  | "crypt"
  | "throne"
  | "cavern" // dark bioluminescent grotto — glowing fungi light it, not a torch
  | "ashen" // scorched dead-ground: falling ash, ember glow, oil/scorch (sub-region only)
  | "grove" // fungal grove: luminous caps over rot — beautiful and poisonous (sub-region)
  | "undercity" // flooded sewers of green-stained stone beneath Blackhall (sub-region)
  | "graveyard" // Blackhall's burial ground — the approach, under an open sky
  | "sanctum"; // a drowned pilgrim temple, nave half-flooded (sub-region only)
export type GeneratorKind =
  | "digger"
  | "uniform"
  | "cellular"
  | "rogue" // classic rooms + connecting corridors
  | "maze" // dense perfect maze (DividedMaze) — for labyrinth wings
  | "hall" // a grand cathedral nave: colonnaded central hall + flanking chambers
  | "rampart" // a linear wall-walk battlement: void beside the path + tower rooms
  | "gallery"; // a processional statue gallery: promenade + double colonnade + niches

export type MonsterBehavior =
  | "wander"
  | "erratic"
  | "chase"
  | "guardChase"
  | "slowChase"
  | "ranged"
  // non-hostile ambient wildlife (e.g. a will-o'-wisp): drifts, FLEES when you
  // draw near (luring you off-path), never attacks; bumping it disperses it
  // harmlessly (no combat, loot, or kill credit). See actMonster/movePlayer.
  | "ambient"
  // the final boss: HP-gated phases with bolts, telegraphed barrages,
  // summoned adds, and a blink-away when cornered (see actMonster).
  | "bossLich";

// ── Status effects ──────────────────────────────────────────────────────────
// Timed conditions stored in an `effects` bag (key -> turns remaining). `ward`
// and `might` are player buffs; the rest are debuffs that afflict whoever holds
// them (player OR monster). See `status.ts` for their behavior table.
export type StatusKind = "poison" | "bleed" | "burn" | "chill";

/** A chance-on-hit affliction carried by a monster attack or a weapon. */
export interface StatusApplication {
  effect: StatusKind;
  chance: number; // 0–1
  duration: number; // turns
}

// A champion/elite modifier rolled onto an ordinary monster at spawn:
//   brute    — tankier + hits harder (armor + damage bonus)
//   swift    — acts twice per turn
//   volatile — bursts on death, damaging anything adjacent
export type EliteKind = "brute" | "swift" | "volatile";

// A shrine's pre-rolled bargain (deterministic at generation, saved). Costs are
// paid in blood or gold; see `core/altar.ts` for the numbers + apply logic.
export type AltarKind = "vigor" | "warblood" | "hoard";

// Lasting cosmetic stains on the floor: scorch where fire burned out, blood
// where a monster fell. Rendered as a per-cell background tint.
/** A lasting floor stain. `scorch` is dark char left where a fire burned out;
 * `blood` marks a kill; `ash` is pale settled soot, used to pre-stain burned-ground
 * regions. Ash exists because `scorch` is near-black (#120d08) and simply cannot
 * read on the ashen palette's near-black floor (#241f1c — a perceptual distance of
 * 56, well under the 110 "unreadable" bar test [54] enforces). Charring
 * already-charred earth is the wrong image anyway; settled soot is the right one. */
export type DecalKind = "scorch" | "blood" | "ash";

export interface AltarInstance {
  id: string;
  x: number;
  y: number;
  kind: AltarKind;
  used: boolean;
}

/** An environmental-storytelling prop you bump/step onto to read a short lore
 * fragment (no cost, no boon — pure flavor/reward-for-curiosity). `inscription`
 * = a carved stone/scrawl, `remains` = a fallen adventurer's effects. */
export type LoreKind = "inscription" | "remains";
export interface LoreInstance {
  id: string;
  x: number;
  y: number;
  kind: LoreKind;
  title: string;
  text: string;
  read: boolean;
}

export interface MonsterDef {
  id: string;
  name: string;
  glyph: string;
  color: string;
  /** if set, this creature emits colored light (RGB) + a soft bloom halo — a
   * glowing wisp, say. Opt-in, so ordinary ambient critters don't glow. */
  glow?: [number, number, number];
  maxHp: number;
  dmg: number;
  armor: number;
  behavior: MonsterBehavior;
  sightRadius: number;
  /** 1 = normal, <1 acts less often (polish). */
  speed: number;
  coinReward: number;
  isBoss?: boolean;
  /** a tough non-boss enemy (mini-boss) — shows a small HP bar when in view */
  miniBoss?: boolean;
  /** can shove a closed door open (spends a turn); dumb monsters just reroute */
  opensDoors?: boolean;
  /** its melee hit KNOCKS the player back a tile — shoved into a chasm/water (and
   * not levitating) means a fall (lose a life). Positioning matters near the void. */
  knockback?: boolean;
  rangedDmg?: number;
  rangedRange?: number;
  /** turns a ranged attacker must reload between shots (default 1) */
  rangedCooldown?: number;
  /** ignores this much of the player's armor when attacking (wraith) */
  armorPierce?: number;
  /** chance-on-hit affliction inflicted on the player (spider poison, etc.) */
  inflicts?: StatusApplication;
  /** How strongly a status AFFECTS this monster, per kind. 1 (or omitted) is
   * normal; 0 is immune. Scales both the chance to land AND how long it lasts,
   * so it covers "resists it" and "shakes it off faster" with one number.
   *
   * Exists because the Frostbrand trivialised Gorm, the FROST TROLL: chill makes
   * a monster skip its turn, and at `chance: 0.5, duration: 3` you refresh it
   * while it is still frozen. Measured, he spent 55% of the fight unable to act,
   * and the weaker Frostbrand (power 7) left you on 22 HP where the stronger War
   * Axe (power 8) left you on 6. Freezing a creature made of ice should not be
   * the answer to it. */
  resist?: Partial<Record<StatusKind, number>>;
  /** loot dropped on death: `chance` (0–1) to drop one weighted item */
  loot?: { chance: number; table: { itemId: string; weight: number }[] };
}

export type ItemCategory =
  "weapon" | "armor" | "coin" | "potion" | "quest" | "torch" | "ammo";

export type PotionEffect =
  | "heal"
  | "greaterHeal"
  | "bomb" // thrown at a chosen tile (cursor targeting)
  | "blast" // one-time burst around the player
  | "ward" // temporary damage reduction
  | "might" // temporary weapon-power boost
  | "cleanse" // clear damaging debuffs (poison/bleed/burn)
  | "detect" // reveal every trap on the level
  | "levitate" // float over water/chasm + traps (no trap triggers) for a time
  | "emberstep" // immune to fire searing for a time
  | "frostwalk" // freeze water you step onto into permanent walkable ice
  | "shadow" // shrink monster detection range for a time (deep stealth)
  | "blink"; // short teleport to a chosen tile in range (opens cursor targeting)

export interface ItemDef {
  id: string;
  name: string;
  glyph: string;
  color: string;
  category: ItemCategory;
  power?: number; // weapon
  /** weapon: tiles a struck monster is shoved back (into hazards = a kill) */
  knockback?: number;
  reduction?: number; // armor
  value?: number; // coin base value
  effect?: PotionEffect; // potion
  magnitude?: number; // potion
  questTag?: string; // quest / findItem
  lightBonus?: number; // torch
  fuel?: number; // torch: turns of light before it burns out
  /** light source: how much this flame WAVERS, relative to an open one.
   * 1 = a bare torch; lower = enclosed and steadier. Scales the whole flicker
   * curve, guttering included, so a dying lantern falters less wildly than a
   * dying torch. Omit for 1. See `torchFlickerDepth` in `core/light.ts`. */
  flicker?: number;
  duration?: number; // potion: turns a timed effect (ward/might) lasts
  /** weapon: chance-on-hit affliction inflicted on the struck monster */
  onHit?: StatusApplication;
  /** weapon: makes it a ranged weapon (fired at range, consuming `ammoId`) */
  ranged?: { range: number; ammoId: string };
}

export interface Palette {
  wall: string;
  floor: string;
  accent: string;
}

// ── Goals ────────────────────────────────────────────────────────────────
export type GoalConfig =
  | { type: "reachLocation" }
  | { type: "collectX"; questTag: string; count: number }
  | { type: "findItem"; questTag: string }
  | { type: "killTarget"; monsterId: string }
  | { type: "killCount"; count: number } // cull: slay N monsters this level
  | { type: "survive"; turns: number }; // hold out for N turns

// ── Level configuration (the data-driven spine) ─────────────────────────────
export interface LevelConfig {
  id: string;
  title: string;
  biome: Biome;
  palette: Palette;
  /** optional secondary biome regions carved into the level — each a distinct
   * palette/biome patch (cosmetic blob) or a structural wing (`layout`) with its
   * own hazard kit. Multiple entries get successive region ids (1, 2, …). */
  subBiomes?: SubBiomeSpec[];
  /** optional hidden vault: a sealed room holding the listed loot, reachable
   * ONLY through a single gate — a cracked wall to blast/bash (default) or a
   * shut door to simply open. Skipped on seeds with no valid spot. */
  secretVault?: {
    gate?: "door" | "crackedWall";
    loot: { itemId: string }[];
    /** a monster sealed in WITH the hoard — turns the vault from free loot into
     * a risk/reward lair. It can't path out (the gate isn't walkable until you
     * break/open it), so a `guardChase` beast simply waits, dormant. */
    guardian?: string;
  };
  /** optional FREESTANDING buildings stamped onto open ground: each a visible
   * wall box with a floor interior, one shut door, and loot — reads as an actual
   * structure (a hut in the woods, a shrine in a clearing), unlike `secretVault`
   * which digs a room into existing wall mass. Walls render as a built `#` in
   * `palette` (default warm timber). SEVERAL entries read as a hamlet. Each is
   * skipped if no clearing fits. */
  structures?: {
    size?: { w: number; h: number };
    palette?: Palette;
    loot: { itemId: string }[];
  }[];
  /** signature set-piece: the level slowly floods during play. Flooding begins
   * at `startTurn`, rises one ring every `interval` turns, up to `maxSteps`
   * rings. A protected dry spine (start→objectives) never floods, so the goal
   * stays reachable; side areas submerge — Levitation/Rimewalk are clutch. */
  flood?: { startTurn: number; interval: number; maxSteps: number };
  /** cosmetic level-wide weather that overrides the base biome's atmosphere:
   * `"rain"` = gentle falling rain; `"storm"` = heavier rain PLUS periodic
   * lightning flashes. Purely render-side; mapped to an atmosphere in `tiles.ts`
   * (and `"storm"` gates `paintLightning`). */
  weather?: "rain" | "storm";
  /** PROTOTYPE (light-gated sight) — lit wall sconces. Light tracks HABITATION:
   * a garrisoned gatehouse burns, a sealed tomb doesn't. Omit to fall back to
   * `CONFIG.sconces`; 0 means a level nobody has tended in a long time. */
  /**
   * The sky over THIS level, overriding what its base biome implies.
   *
   * `SKYLIGHT` is keyed by biome, which is right until a level's biome lies
   * about whether you are outdoors. The Ramparts is that level: an exposed
   * wall-walk under a thundering sky whose biome is `castle`, so it inherited
   * the sealed-interior value and you saw **3 tiles** standing on an open
   * battlement — while its own icy stretch, a `mountain` sub-region, gave 11.
   * Same wall, same storm, and a four-fold jump between two adjacent tiles.
   *
   * Replaces the value for the BASE biome and CAPS every sub-region, because a
   * level has one sky: snow can throw daylight back at you only if there is
   * daylight, and on a storm-lashed night there is not. Levels that want the
   * indoor/outdoor transition (the Iron Gate's graveyard → gatehouse) simply
   * omit it.
   */
  skylight?: number;
  sconces?: number;
  /** a boss-HP-keyed set-piece ambient beat (render-side only, in `renderBase`):
   * `"dawn"` warms + brightens the hall toward a rekindled sunrise as the boss
   * falls (the Throne); `"dusk"` dims + cools it as the boss falls (the
   * Antechamber — dread pressing in, darkest before the dawn beyond). Keyed to
   * the level's `isBoss` monster's remaining HP. */
  lightingBeat?: "dawn" | "dusk";
  mapWidth: number;
  mapHeight: number;
  generator: GeneratorKind;
  monsterBudget: number;
  spawnTable: { monsterId: string; weight: number }[];
  turnLimit: number;
  itemDropCount: number;
  dropTable: { itemId: string; weight: number }[];
  coinRichness: number;
  baseLightRadius: number;
  /** hidden spike traps scattered on the path (default 0) */
  trapCount?: number;
  /** impassable water tiles, placed as blobs (Rimewalk-freezable; default 0) */
  waterCount?: number;
  /** impassable chasm-void tiles, placed as blobs — a fall; only Levitation
   * crosses (Rimewalk can't bridge a void). Default 0. */
  chasmCount?: number;
  /** walkable oil slicks that fire ignites and spreads across (default 0) */
  oilCount?: number;
  /** isolated poison-spore vents (fumaroles) — each seeps a small toxic haze;
   * placed spaced apart so clouds don't merge (default 0) */
  sporeVentCount?: number;
  /** destructible cracked walls bordering rooms (default 0) */
  crackedWallCount?: number;
  /** interactive doors placed on 1-wide chokepoints, generated open (default 0) */
  doorCount?: number;
  /** forageable heal tiles tucked in nooks off the main path (default 0) */
  forageCount?: number;
  /** per-monster chance to spawn as an elite/champion (0–1, default 0) */
  eliteChance?: number;
  /** risk/reward shrines placed on open floor (default 0) */
  altarCount?: number;
  /** environmental-storytelling lore props tucked off the path (default 0);
   * text is drawn from the biome's `LORE_POOLS` pool in `content/lore.ts` */
  loreCount?: number;
  /** non-hostile ambient wildlife (behavior `"ambient"`), placed OUTSIDE the
   * combat `monsterBudget` — atmosphere, not threats (e.g. Blackwood wisps) */
  ambient?: { monsterId: string; count: number }[];
  goal: GoalConfig;
  /** Transition narration shown after completing this level. */
  narration: string;
  /** Shop tier shown before the next level (polish; null = none). */
  shopTier: number | null;
}

// ── Runtime entity instances ─────────────────────────────────────────────
export interface MonsterInstance {
  id: string;
  defId: string;
  x: number;
  y: number;
  hp: number;
  state: "idle" | "chase";
  /** turns until a ranged attacker can fire again (reload) */
  cooldown?: number;
  /** flagged as the killTarget for the current level's goal */
  isGoalTarget?: boolean;
  /** active timed debuffs afflicting this monster (poison/bleed/burn/chill) */
  effects?: Record<string, number>;
  /** champion modifier (buffed stats + better loot); bosses are never elite */
  elite?: EliteKind;
  /** last tile it detected the player at — where it hunts after losing sight */
  lastSeen?: { x: number; y: number };
  /** turns since it could last detect the player (alerted monsters give up) */
  lostTurns?: number;
  /** boss (bossLich): turns until the next special ability can fire */
  abilityCd?: number;
  /** boss (bossLich): highest phase index entered so far (announce once) */
  phase?: number;
}

export interface ItemInstance {
  id: string;
  defId: string;
  x: number;
  y: number;
  /** for coins: the actual rolled value; for quest items: the tag */
  value?: number;
  questTag?: string;
}

export interface BagEntry {
  defId: string;
  count: number;
}

export interface PlayerState {
  x: number;
  y: number;
  maxHp: number;
  hp: number;
  lives: number;
  /** chosen character class (drives the starting kit + passive traits) */
  classId: string;
  weaponId: string;
  armorId: string;
  weaponPower: number;
  /** permanent bonus damage from altar boons (survives re-equipping) */
  weaponBonus: number;
  armorReduction: number;
  coins: number;
  bag: BagEntry[];
  /**
   * Stable hotbar assignment: item id -> slot number (1..HOTBAR_SLOTS). Keyed by
   * DEF ID rather than stored on the `BagEntry` so a claim outlives the stack —
   * run out of firebombs, rebuy them at the shop, and they return to the same
   * key. Bag order is append-and-compact (`removeOneFromBag` splices), so an
   * index-derived number silently renumbers the moment a stack empties, which
   * is exactly when you're least likely to be reading the panel. JSON-safe.
   */
  slotMap: Record<string, number>;
  /** Titles of every lore fragment read this RUN, in the order found — the
   * journal behind the log rail's Lore tab. Kept on the player because
   * `GameState.lore` is per-level and a fresh `beginLevel` discards it, so
   * anything you read two levels ago would otherwise be unrecoverable. Titles
   * only (resolved via `loreByTitle`); copying prose into the save would bloat
   * it for no gain, and all 44 titles are distinct. */
  loreSeen: string[];
  // ── run-cumulative stats (carry across levels via clonePlayer) ──
  kills: number;
  totalTurns: number;
  goldEarned: number;
  /** accumulated par-time score bonus (levels cleared under their turn "par") */
  parBonus: number;
  baseLightRadius: number;
  lightRadius: number;
  hasTorch: boolean;
  /** which light source is held (its `lightBonus`/`fuel` apply); null = none */
  torchId: string | null;
  /** turns of torch light remaining; 0 = unlit */
  torchFuel: number;
  /** active timed effects: id -> turns remaining (e.g. ward, might) */
  effects: Record<string, number>;
  /** turns until the class active ability is ready again (0 = ready) */
  abilityCooldown: number;
}

export type GameStatus = "playing" | "levelComplete" | "gameOver" | "victory";

export interface GameState {
  masterSeed: string;
  /** index into the LEVELS array */
  currentLevel: number;
  player: PlayerState;
  /** snapshot of player as they ENTERED the current level (for death-restart) */
  entryPlayer: PlayerState;
  map: GameMap;
  monsters: MonsterInstance[];
  items: ItemInstance[];
  turnsLeft: number;
  turnCount: number;
  /** monsters the player has slain on THIS level (for the cull goal) */
  levelKills: number;
  questProgress: Record<string, number>;
  /** armed trap tiles the player is aware of (sensed or detected) */
  knownTraps: number[];
  /** lingering fire tiles (from firebombs): tile index -> turns remaining */
  fireTiles: { i: number; life: number }[];
  /** lingering poison-spore clouds (from `sporeVent` tiles): tile index -> turns
   * remaining. Re-emitted by vents each turn; poisons whoever stands in one. */
  gasTiles: { i: number; life: number }[];
  /** melee-bash progress on cracked walls: tile index -> hits taken so far */
  crackedWallHits: Record<number, number>;
  /** lasting floor stains: tile index -> decal kind (scorch / blood / ash) */
  decals: Record<number, DecalKind>;
  /** RUNTIME decals (blood, scorch) in the order they were made, oldest first —
   * what the `CONFIG.maxDecals` cap evicts from. The ash a region is generated
   * with is not in here, so it is never evicted. Optional for older saves. */
  decalOrder?: number[];
  /** flooding set-piece (levels with `LevelConfig.flood`): floor tiles that MAY
   * flood (off the protected dry spine), the initial water origins, and how many
   * rings have risen so far. Absent on non-flooding levels. */
  floodable?: number[];
  floodSeeds?: number[];
  floodStep?: number;
  /** risk/reward shrines on the level */
  altars: AltarInstance[];
  /** environmental-storytelling props (bump/step to read; `read` persists) */
  lore: LoreInstance[];
  /** tiles telegraphed by the lich's barrage — they detonate at the start of
   * the next monster phase, giving the player one turn to step clear */
  barrage: number[];
  /** currently in FOV (recomputed every player turn) — set of tile indices */
  visible: number[];
  /** seen before (fog memory) — set of tile indices */
  explored: number[];
  status: GameStatus;
  messageLog: string[];
  goalDone: boolean;
  /** active run modifiers (mutator ids) chosen at New Game — fixed for the run,
   * applied to each level's config in `beginLevel`. Empty on an unmodified run. */
  mutators: string[];
}

// ── Player actions (input intents) ──────────────────────────────────────────
export type PlayerAction =
  | { type: "move"; dx: number; dy: number }
  | { type: "wait" }
  | { type: "equip"; defId: string }
  | { type: "useItem"; defId: string }
  | { type: "throwAt"; defId: string; x: number; y: number }
  | { type: "shootAt"; x: number; y: number }
  | { type: "closeDoor" } // shut an adjacent open door (break LOS / block a chaser)
  | { type: "blinkTo"; defId: string; x: number; y: number } // teleport (Phial of Blinking)
  | { type: "ability"; dx?: number; dy?: number }; // class active ([q]); dx/dy for directional ones

// ── Turn resolution result ─────────────────────────────────────────────────
export interface TurnResult {
  tookTurn: boolean;
  goalComplete: boolean;
  playerDied: boolean;
  deathReason?: "combat" | "timeout";
  /** cosmetic cues (hits, projectiles) for the animation layer */
  events: GameEvent[];
}
