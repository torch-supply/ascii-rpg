import type { GameState, PlayerState } from "./types";
import { CONFIG } from "@/content/config";
import { ITEMS } from "@/content/items";
import { LEVELS } from "@/content/levels";
import { classDef, DEFAULT_CLASS_ID } from "@/content/classes";
import { generateLevel } from "./map/generate";
import { computeVisible } from "./map/fov";
import { applyLevelMutators } from "@/content/mutators";
import { syncBagSlots } from "./hotbar";
import { computeLightMap, lightGatedVisible } from "./light";

export function createPlayer(classId: string = DEFAULT_CLASS_ID): PlayerState {
  const cls = classDef(classId);
  const weapon = ITEMS[cls.weaponId];
  const armor = ITEMS[cls.armorId];
  const p: PlayerState = {
    x: 0,
    y: 0,
    maxHp: cls.maxHp,
    hp: cls.maxHp,
    lives: CONFIG.startingLives,
    classId: cls.id,
    weaponId: weapon.id,
    armorId: armor.id,
    weaponPower: weapon.power ?? 0,
    weaponBonus: 0,
    armorReduction: armor.reduction ?? 0,
    coins: 0,
    bag: cls.bag.map((b) => ({ ...b })),
    slotMap: {},
    loreSeen: [],
    kills: 0,
    totalTurns: 0,
    goldEarned: 0,
    parBonus: 0,
    baseLightRadius: 8,
    lightRadius: 8,
    hasTorch: false,
    torchId: null,
    torchFuel: 0,
    effects: {},
    abilityCooldown: 0,
  };
  syncBagSlots(p); // the class kit is a literal, so it needs its slots assigned
  return p;
}

export function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    bag: p.bag.map((b) => ({ ...b })),
    effects: { ...p.effects },
    slotMap: { ...p.slotMap },
    loreSeen: [...(p.loreSeen ?? [])],
  };
}

/** Light radius = base (from level) + torch bonus while a torch is lit. */
export function recomputeLight(p: PlayerState): void {
  const lit = p.hasTorch && p.torchFuel > 0;
  const src = p.torchId ? ITEMS[p.torchId] : null;
  const torchBonus = lit ? (src?.lightBonus ?? 0) : 0;
  p.lightRadius = p.baseLightRadius + torchBonus;
}

/**
 * Recompute FOV and merge into the explored (fog-memory) set.
 *
 * Under `CONFIG.sight === "lightGated"` this is line-of-sight out to
 * `CONFIG.sightRange` filtered by what is actually LIT (see `core/light.ts`),
 * rather than a disc of `player.lightRadius`. The light map is computed STEADY
 * — no flicker, no transient FX — because this runs once per turn and decides
 * what the game considers visible: a guttering torch must not make tiles wink
 * in and out of `state.visible`.
 *
 * `"torch"` is the older model, kept as a one-flag fallback: FOV radius IS your
 * light radius, so a lit brazier down a dark hall simply isn't in the set.
 */
export function recomputeFOV(state: GameState): void {
  const vis =
    CONFIG.sight === "lightGated"
      ? lightGatedVisible(state, computeLightMap(state, 0, true))
      : computeVisible(
          state.map,
          state.player.x,
          state.player.y,
          state.player.lightRadius,
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
  player: PlayerState,
  mutators: string[] = [],
): GameState {
  // Run modifiers reshape the level's config (light/spawns/traps/budget/…)
  // BEFORE generation, so the generator stays a pure function of the config and
  // all its connectivity/trap guarantees still hold.
  const config = applyLevelMutators(LEVELS[levelIndex], mutators);
  const data = generateLevel(config, levelIndex, masterSeed);

  const p = clonePlayer(player);
  p.x = data.playerStart.x;
  p.y = data.playerStart.y;
  p.hp = p.maxHp; // fresh HP at the start of each level
  p.effects = {}; // a fresh start sheds any lingering ward/poison/etc.
  p.baseLightRadius = config.baseLightRadius;
  recomputeLight(p);
  // Safety net: catches a bag built by any path that bypassed `addToBag` (a
  // hand-built test fixture, the dev jump, a save written before slots existed).
  syncBagSlots(p);

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
    gasTiles: [],
    crackedWallHits: {},
    decals: { ...(data.decals ?? {}) }, // pre-seeded stains (ashen scorch); runtime adds more
    floodable: data.floodable,
    floodSeeds: data.floodSeeds,
    floodStep: 0,
    altars: data.altars,
    lore: data.lore,
    barrage: [],
    visible: [],
    explored: [],
    status: "playing",
    messageLog: [`You enter ${config.title}.`],
    goalDone: false,
    mutators,
  };
  recomputeFOV(state);
  return state;
}
