// ─────────────────────────────────────────────────────────────────────────
// Core type definitions. This module is PURE data — no React, Zustand, DOM,
// or rot.js imports. Everything downstream depends on these shapes.
// ─────────────────────────────────────────────────────────────────────────
import type { GameEvent } from "./events";

// ── Map / tiles ────────────────────────────────────────────────────────────
export type TileType =
  | "wall"
  | "floor"
  | "door"
  | "exit"
  | "trap" // armed, hidden (renders as floor) until stepped on
  | "trapSprung" // triggered, visible, harmless
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
  /** ignores this much of the player's armor when attacking (wraith) */
  armorPierce?: number;
}

export type ItemCategory =
  | "weapon"
  | "armor"
  | "coin"
  | "potion"
  | "quest"
  | "torch";

export type PotionEffect = "heal" | "greaterHeal" | "bomb";

export interface ItemDef {
  id: string;
  name: string;
  glyph: string;
  color: string;
  category: ItemCategory;
  stackable: boolean;
  power?: number; // weapon
  reduction?: number; // armor
  value?: number; // coin base value
  effect?: PotionEffect; // potion
  magnitude?: number; // potion
  questTag?: string; // quest / findItem
  lightBonus?: number; // torch
  fuel?: number; // torch: turns of light before it burns out
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
  | { type: "killTarget"; monsterId: string };

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
  /** flagged as the killTarget for the current level's goal */
  isGoalTarget?: boolean;
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
  armorReduction: number;
  coins: number;
  bag: BagEntry[];
  baseLightRadius: number;
  lightRadius: number;
  hasTorch: boolean;
  /** turns of torch light remaining; 0 = unlit */
  torchFuel: number;
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
  questProgress: Record<string, number>;
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
  | { type: "throwAt"; defId: string; x: number; y: number };

// ── Turn resolution result ─────────────────────────────────────────────────
export interface TurnResult {
  tookTurn: boolean;
  goalComplete: boolean;
  playerDied: boolean;
  deathReason?: "combat" | "timeout";
  /** cosmetic cues (hits, projectiles) for the animation layer */
  events: GameEvent[];
}
