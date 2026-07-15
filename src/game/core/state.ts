import type { GameState, PlayerState } from "./types";
import { CONFIG } from "@/content/config";
import { ITEMS } from "@/content/items";
import { LEVELS } from "@/content/levels";
import { generateLevel } from "./map/generate";
import { computeVisible } from "./map/fov";

export function createPlayer(): PlayerState {
  const weapon = ITEMS[CONFIG.startingWeaponId];
  const armor = ITEMS[CONFIG.startingArmorId];
  return {
    x: 0,
    y: 0,
    maxHp: CONFIG.startingMaxHp,
    hp: CONFIG.startingMaxHp,
    lives: CONFIG.startingLives,
    weaponId: weapon.id,
    armorId: armor.id,
    weaponPower: weapon.power ?? 0,
    weaponBonus: 0,
    armorReduction: armor.reduction ?? 0,
    coins: 0,
    bag: [],
    kills: 0,
    totalTurns: 0,
    goldEarned: 0,
    baseLightRadius: 8,
    lightRadius: 8,
    hasTorch: false,
    torchFuel: 0,
    effects: {},
  };
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p, bag: p.bag.map((b) => ({ ...b })), effects: { ...p.effects } };
}

/** Light radius = base (from level) + torch bonus while a torch is lit. */
export function recomputeLight(p: PlayerState): void {
  const lit = p.hasTorch && p.torchFuel > 0;
  const torchBonus = lit ? ITEMS["i_torch"].lightBonus ?? 0 : 0;
  p.lightRadius = p.baseLightRadius + torchBonus;
}

/** Recompute FOV and merge into the explored (fog-memory) set. */
export function recomputeFOV(state: GameState): void {
  const vis = computeVisible(
    state.map,
    state.player.x,
    state.player.y,
    state.player.lightRadius
  );
  state.visible = vis;
  const explored = new Set(state.explored);
  for (const i of vis) explored.add(i);
  state.explored = Array.from(explored);
}

/**
 * Build a fresh GameState for entering a level. `player` carries over gear,
 * coins, and lives from the previous level; HP is refilled (a rest between
 * levels). Death-restart uses `entryPlayer` instead (see actions).
 */
export function beginLevel(
  masterSeed: string,
  levelIndex: number,
  player: PlayerState
): GameState {
  const config = LEVELS[levelIndex];
  const data = generateLevel(config, levelIndex, masterSeed);

  const p = clonePlayer(player);
  p.x = data.playerStart.x;
  p.y = data.playerStart.y;
  p.hp = p.maxHp; // fresh HP at the start of each level
  p.effects = {}; // a fresh start sheds any lingering ward/poison/etc.
  p.baseLightRadius = config.baseLightRadius;
  recomputeLight(p);

  const state: GameState = {
    masterSeed,
    currentLevel: levelIndex,
    player: p,
    entryPlayer: clonePlayer(p),
    map: data.map,
    monsters: data.monsters,
    items: data.items,
    turnsLeft: config.turnLimit,
    turnCount: 0,
    levelKills: 0,
    questProgress: {},
    knownTraps: [],
    fireTiles: [],
    crackedWallHits: {},
    altars: data.altars,
    visible: [],
    explored: [],
    status: "playing",
    messageLog: [`You enter ${config.title}.`],
    goalDone: false,
  };
  recomputeFOV(state);
  return state;
}
