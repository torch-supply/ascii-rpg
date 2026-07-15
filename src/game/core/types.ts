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
  | "door"
  | "exit"
  | "trap" // armed, hidden (renders as floor) until stepped on
  | "trapSprung" // triggered, visible, harmless
  | "oil" // walkable slick; fire ignites it and races across it
  | "water"; // impassable but transparent (chasm / water)

export interface GameMap {
  width: number;
  height: number;
  /** Flat array, length = width*height, index = y*width + x. */
  tiles: TileType[];
  /** The single "exit" tile, present on reachLocation levels. */
  exit?: Pos;
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
  | "throne";
export type GeneratorKind = "digger" | "uniform" | "cellular";

export type MonsterBehavior =
  | "wander"
  | "erratic"
  | "chase"
  | "guardChase"
  | "slowChase"
  | "ranged";

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

export interface AltarInstance {
  id: string;
  x: number;
  y: number;
  kind: AltarKind;
  used: boolean;
}

export interface MonsterDef {
  id: string;
  name: string;
  glyph: string;
  color: string;
  maxHp: number;
  dmg: number;
  armor: number;
  behavior: MonsterBehavior;
  sightRadius: number;
  /** 1 = normal, <1 acts less often (polish). */
  speed: number;
  coinReward: number;
  isBoss?: boolean;
  rangedDmg?: number;
  rangedRange?: number;
  /** turns a ranged attacker must reload between shots (default 1) */
  rangedCooldown?: number;
  /** ignores this much of the player's armor when attacking (wraith) */
  armorPierce?: number;
  /** chance-on-hit affliction inflicted on the player (spider poison, etc.) */
  inflicts?: StatusApplication;
  /** loot dropped on death: `chance` (0–1) to drop one weighted item */
  loot?: { chance: number; table: { itemId: string; weight: number }[] };
}

export type ItemCategory =
  | "weapon"
  | "armor"
  | "coin"
  | "potion"
  | "quest"
  | "torch"
  | "ammo";

export type PotionEffect =
  | "heal"
  | "greaterHeal"
  | "bomb" // thrown at a chosen tile (cursor targeting)
  | "blast" // one-time burst around the player
  | "ward" // temporary damage reduction
  | "might" // temporary weapon-power boost
  | "cleanse" // clear damaging debuffs (poison/bleed/burn)
  | "detect"; // reveal every trap on the level

export interface ItemDef {
  id: string;
  name: string;
  glyph: string;
  color: string;
  category: ItemCategory;
  stackable: boolean;
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
  /** impassable water/chasm tiles, placed as blobs (default 0) */
  waterCount?: number;
  /** walkable oil slicks that fire ignites and spreads across (default 0) */
  oilCount?: number;
  /** destructible cracked walls bordering rooms (default 0) */
  crackedWallCount?: number;
  /** per-monster chance to spawn as an elite/champion (0–1, default 0) */
  eliteChance?: number;
  /** risk/reward shrines placed on open floor (default 0) */
  altarCount?: number;
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
  weaponId: string;
  armorId: string;
  weaponPower: number;
  /** permanent bonus damage from altar boons (survives re-equipping) */
  weaponBonus: number;
  armorReduction: number;
  coins: number;
  bag: BagEntry[];
  // ── run-cumulative stats (carry across levels via clonePlayer) ──
  kills: number;
  totalTurns: number;
  goldEarned: number;
  baseLightRadius: number;
  lightRadius: number;
  hasTorch: boolean;
  /** turns of torch light remaining; 0 = unlit */
  torchFuel: number;
  /** active timed effects: id -> turns remaining (e.g. ward, might) */
  effects: Record<string, number>;
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
  /** melee-bash progress on cracked walls: tile index -> hits taken so far */
  crackedWallHits: Record<number, number>;
  /** risk/reward shrines on the level */
  altars: AltarInstance[];
  /** currently in FOV (recomputed every player turn) — set of tile indices */
  visible: number[];
  /** seen before (fog memory) — set of tile indices */
  explored: number[];
  status: GameStatus;
  messageLog: string[];
  goalDone: boolean;
}

// ── Player actions (input intents) ──────────────────────────────────────────
export type PlayerAction =
  | { type: "move"; dx: number; dy: number }
  | { type: "wait" }
  | { type: "equip"; defId: string }
  | { type: "useItem"; defId: string }
  | { type: "throwAt"; defId: string; x: number; y: number }
  | { type: "shootAt"; x: number; y: number };

// ── Turn resolution result ─────────────────────────────────────────────────
export interface TurnResult {
  tookTurn: boolean;
  goalComplete: boolean;
  playerDied: boolean;
  deathReason?: "combat" | "timeout";
  /** cosmetic cues (hits, projectiles) for the animation layer */
  events: GameEvent[];
}
