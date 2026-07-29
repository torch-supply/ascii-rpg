import type {
  GameState,
  ItemInstance,
  MonsterInstance,
  MonsterDef,
  PlayerAction,
  PlayerState,
  Pos,
  TurnResult,
} from "@/game/core/types";
import type { GameEvent } from "@/game/core/events";
import { Rng } from "@/game/core/rng";
import {
  idx,
  isWalkable,
  chebyshev,
  manhattan,
  inBounds,
  tileAt,
} from "@/game/core/grid";
import { recomputeFOV, recomputeLight } from "@/game/core/state";
import { equipWeapon, equipArmor, addToBag } from "@/game/core/inventory";
import { isGoalComplete } from "@/game/core/goals";
import {
  playerAttackDamage,
  monsterAttackDamage,
  wardMitigate,
  mitigate,
} from "@/game/core/combat";
import {
  STATUS,
  DAMAGING_STATUS,
  applyStatus,
  isStatusKind,
} from "@/game/core/status";
import type { StatusApplication } from "@/game/core/types";
import { stepToward } from "@/game/core/map/pathfinding";
import {
  monsterDef,
  ELITE,
  ELITE_KINDS,
  type EliteMod,
} from "@/content/monsters";
import { applyLevelMutators } from "@/content/mutators";
import { ventState } from "@/game/core/gas";
import { classDef } from "@/content/classes";
import { ITEMS } from "@/content/items";
import { LEVELS } from "@/content/levels";
import { CONFIG, forageStyle } from "@/content/config";

const DIRS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// 8-way (orthogonal + diagonal) — used where a hazard fills a full ring.
const DIRS8 = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

// ── helpers ──────────────────────────────────────────────────────────────
function msg(events: GameEvent[], text: string) {
  events.push({ kind: "message", text });
}

function addCoins(state: GameState, n: number) {
  state.player.coins += n;
  state.player.goldEarned += n; // run stat (never decremented by shopping)
}

function monsterAt(
  state: GameState,
  x: number,
  y: number,
  excludeId?: string,
): MonsterInstance | undefined {
  return state.monsters.find(
    (m) => m.x === x && m.y === y && m.id !== excludeId,
  );
}

function itemAt(
  state: GameState,
  x: number,
  y: number,
): ItemInstance | undefined {
  return state.items.find((i) => i.x === x && i.y === y);
}

// ── pickups ────────────────────────────────────────────────────────────────
function pickUp(state: GameState, events: GameEvent[]) {
  const p = state.player;
  const it = itemAt(state, p.x, p.y);
  if (!it) return;
  const def = ITEMS[it.defId];

  switch (def.category) {
    case "coin": {
      const v = it.value ?? def.value ?? 0;
      addCoins(state, v);
      msg(events, `You pick up ${v} gold.`);
      break;
    }
    case "weapon": {
      if ((def.power ?? 0) > p.weaponPower) {
        equipWeapon(p, def.id);
        msg(
          events,
          `You take up the ${def.name} and wield it (pow ${def.power}).`,
        );
      } else {
        addToBag(p, def.id);
        msg(events, `You stow the ${def.name}.`);
      }
      if (def.questTag) {
        state.questProgress[def.questTag] =
          (state.questProgress[def.questTag] ?? 0) + 1;
      }
      break;
    }
    case "armor": {
      if ((def.reduction ?? 0) > p.armorReduction) {
        equipArmor(p, def.id);
        msg(events, `You don the ${def.name} (armor ${def.reduction}).`);
      } else {
        addToBag(p, def.id);
        msg(events, `You stow the ${def.name}.`);
      }
      break;
    }
    case "potion": {
      addToBag(p, def.id);
      msg(events, `You pick up a ${def.name}.`);
      break;
    }
    case "ammo": {
      const n = def.value ?? 1;
      addToBag(p, def.id, n);
      msg(events, `You gather ${n} ${def.name}.`);
      break;
    }
    case "torch": {
      p.hasTorch = true;
      p.torchId = def.id;
      p.torchFuel = def.fuel ?? CONFIG.torchFuel;
      recomputeLight(p);
      msg(events, `You light a ${def.name}. The dark pulls back.`);
      break;
    }
    case "quest": {
      const tag = it.questTag ?? def.questTag ?? def.id;
      state.questProgress[tag] = (state.questProgress[tag] ?? 0) + 1;
      msg(events, `You recover a ${def.name}.`);
      break;
    }
  }

  events.push({ kind: def.category === "coin" ? "coin" : "pickup" }); // SFX cue
  state.items = state.items.filter((i) => i.id !== it.id);
}

// ── combat ─────────────────────────────────────────────────────────────────
/** The elite modifier for a monster instance, if any. */
function eliteMod(m: MonsterInstance): EliteMod | null {
  return m.elite ? ELITE[m.elite] : null;
}

/** Stamp a lasting floor decal (latest wins), bounded so a level can't grow an
 * unlimited number of stains. */
function addDecal(state: GameState, i: number, kind: "scorch" | "blood") {
  if (!(i in state.decals)) {
    const keys = Object.keys(state.decals);
    if (keys.length >= CONFIG.maxDecals) delete state.decals[Number(keys[0])];
  }
  state.decals[i] = kind;
}

/** Roll a monster's loot table and drop one item on its tile (if free).
 * `guaranteed` (elites) forces a drop, falling back to a potion with no table. */
function dropLoot(
  state: GameState,
  x: number,
  y: number,
  def: MonsterDef,
  rng: Rng,
  events: GameEvent[],
  guaranteed = false,
) {
  const loot = def.loot;
  const table = loot?.table ?? [{ itemId: "p_heal", weight: 1 }];
  const chance = guaranteed ? 1 : (loot?.chance ?? 0);
  if (!rng.chance(chance)) return;
  if (itemAt(state, x, y)) return; // don't stack drops on a tile
  const total = table.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return;
  let roll = rng.int(1, total);
  let itemId = table[0].itemId;
  for (const e of table) {
    roll -= e.weight;
    if (roll <= 0) {
      itemId = e.itemId;
      break;
    }
  }
  const idef = ITEMS[itemId];
  const inst: ItemInstance = {
    id: `drop_${x}_${y}_${state.turnCount}`,
    defId: itemId,
    x,
    y,
  };
  if (idef.category === "coin") {
    const rich = LEVELS[state.currentLevel].coinRichness;
    const base = rng.int(CONFIG.coinPile.min, CONFIG.coinPile.max);
    inst.value = Math.max(1, Math.round(base * rich));
  }
  state.items.push(inst);
  msg(events, `The ${def.name} drops a ${idef.name}.`);
}

/** A volatile elite bursts on death, searing anything on the adjacent tiles. */
function explodeOnDeath(
  state: GameState,
  m: MonsterInstance,
  events: GameEvent[],
) {
  const p = state.player;
  events.push({ kind: "blast", x: m.x, y: m.y, radius: 1 });
  if (chebyshev(p.x, p.y, m.x, m.y) <= 1) {
    const dmg = wardMitigate(p, CONFIG.eliteExplodeDamage);
    p.hp -= dmg;
    events.push({ kind: "hit", x: p.x, y: p.y });
    events.push({
      kind: "damage",
      x: p.x,
      y: p.y,
      amount: dmg,
      toPlayer: true,
    });
    msg(events, "The volatile creature bursts apart — the blast catches you!");
  } else {
    msg(events, "A volatile creature bursts apart in the dark.");
  }
}

/** Award a kill: coins, run/level counters, loot drop. Elites pay double and
 * always drop; volatile elites detonate. Does NOT remove `m` from the list. */
function awardKill(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  rng: Rng,
  events: GameEvent[],
) {
  const em = eliteMod(m);
  const coin = em ? def.coinReward * 2 : def.coinReward;
  if (coin > 0) addCoins(state, coin);
  state.player.kills += 1;
  state.levelKills += 1;
  addDecal(state, idx(m.x, m.y, state.map.width), "blood"); // a lasting stain
  dropLoot(state, m.x, m.y, def, rng, events, em != null);
  if (em?.explodes) explodeOnDeath(state, m, events);
}

/** Roll a chance-on-hit affliction and apply it to an effects bag. */
function tryAfflict(
  effects: Record<string, number>,
  spec: StatusApplication | undefined,
  rng: Rng,
  who: string,
  events: GameEvent[],
) {
  if (!spec || !rng.chance(spec.chance)) return;
  const had = (effects[spec.effect] ?? 0) > 0;
  applyStatus(effects, spec.effect, spec.duration);
  if (!had) msg(events, STATUS[spec.effect].onApply(who));
}

/** Shove a struck monster back along the blow. Into water/chasm = a kill;
 * a wall or another body stops it short. */
function knockBack(
  state: GameState,
  target: MonsterInstance,
  def: MonsterDef,
  rng: Rng,
  events: GameEvent[],
) {
  const dist = ITEMS[state.player.weaponId].knockback ?? 0;
  if (dist <= 0) return;
  const dx = Math.sign(target.x - state.player.x);
  const dy = Math.sign(target.y - state.player.y);
  if (dx === 0 && dy === 0) return;
  const w = state.map.width;
  for (let s = 0; s < dist; s++) {
    const nx = target.x + dx;
    const ny = target.y + dy;
    const shoveTile = tileAt(state.map, nx, ny);
    if (shoveTile === "water" || shoveTile === "chasm") {
      events.push({ kind: "hit", x: nx, y: ny });
      msg(events, `You hurl the ${def.name} into the depths!`);
      awardKill(state, target, def, rng, events);
      state.monsters = state.monsters.filter((m) => m.id !== target.id);
      return;
    }
    // A full-force slam shatters a cracked wall outright, and the body is
    // driven on into the opening.
    if (tileAt(state.map, nx, ny) === "crackedWall") {
      const i = idx(nx, ny, w);
      state.map.tiles[i] = "floor";
      delete state.crackedWallHits[i];
      events.push({ kind: "crumble" });
      events.push({ kind: "hit", x: nx, y: ny });
      msg(events, `You smash the ${def.name} clean through a cracked wall!`);
    }
    if (!isWalkable(state.map, nx, ny)) return; // slams into a solid wall
    if (monsterAt(state, nx, ny, target.id)) return; // blocked by another body
    target.x = nx;
    target.y = ny;
  }
}

/** Hack at an adjacent cracked wall; it crumbles after a few blows. Costs a
 * turn (monsters close in while you demolish). Weapon-agnostic. */
function bashCrackedWall(
  state: GameState,
  x: number,
  y: number,
  events: GameEvent[],
): boolean {
  const i = idx(x, y, state.map.width);
  const hits = (state.crackedWallHits[i] ?? 0) + 1;
  events.push({ kind: "hit", x, y });
  if (hits >= CONFIG.crackedWallToughness) {
    state.map.tiles[i] = "floor";
    delete state.crackedWallHits[i];
    events.push({ kind: "crumble" });
    msg(events, "The cracked wall crumbles to rubble!");
  } else {
    state.crackedWallHits[i] = hits;
    const left = CONFIG.crackedWallToughness - hits;
    msg(events, `You hack at the cracked wall. (${left} more)`);
  }
  return true; // bashing spends the turn
}

function resolvePlayerAttack(
  state: GameState,
  target: MonsterInstance,
  events: GameEvent[],
  rng: Rng,
  ranged = false,
) {
  const def = monsterDef(target.defId);
  const em = eliteMod(target);
  let dmg = playerAttackDamage(state.player, def);
  if (em) dmg = Math.max(1, dmg - em.armorBonus); // brutes shrug off blows
  // Ambush: a monster that could give chase but hasn't noticed you yet (you
  // approached unseen in the dark) takes bonus damage from the first strike.
  const canAlert = def.behavior !== "wander" && def.behavior !== "erratic";
  const sneak = canAlert && target.state === "idle";
  const cls = classDef(state.player.classId);
  if (sneak)
    dmg = Math.round(dmg * (cls.sneakMultiplier ?? CONFIG.sneakMultiplier));
  // class crit: a chance to double the blow (Rogue)
  const crit = (cls.critChance ?? 0) > 0 && rng.chance(cls.critChance!);
  if (crit) dmg *= 2;
  target.hp -= dmg;
  if (ranged)
    events.push({
      kind: "projectile",
      from: { x: state.player.x, y: state.player.y },
      to: { x: target.x, y: target.y },
      glyph: "»",
    });
  events.push({ kind: "hit", x: target.x, y: target.y });
  events.push({
    kind: "damage",
    x: target.x,
    y: target.y,
    amount: dmg,
    toPlayer: false,
  });
  if (target.hp <= 0) {
    msg(
      events,
      sneak
        ? `A silent kill — the ${def.name} never woke.`
        : crit
          ? `A critical blow fells the ${def.name}!`
          : `You slay the ${def.name}.`,
    );
    awardKill(state, target, def, rng, events);
    state.monsters = state.monsters.filter((m) => m.id !== target.id);
  } else {
    if (canAlert) target.state = "chase"; // the blow alerts it
    msg(
      events,
      sneak
        ? `Sneak attack! You hit the ${def.name} for ${dmg} (${target.hp} left).`
        : `${crit ? "Critical! " : ""}You strike the ${def.name} for ${dmg} (${target.hp} left).`,
    );
    // the wielded weapon may sear/chill/poison what it strikes (player → monster)
    if (!target.effects) target.effects = {};
    tryAfflict(
      target.effects,
      ITEMS[state.player.weaponId].onHit,
      rng,
      def.name,
      events,
    );
    if (!ranged) knockBack(state, target, def, rng, events); // arrows don't shove
  }
}

/** Spend one unit of ammo from the bag. Returns false if the quiver is empty. */
function consumeAmmo(p: PlayerState, ammoId: string): boolean {
  const entry = p.bag.find((b) => b.defId === ammoId);
  if (!entry || entry.count <= 0) return false;
  entry.count -= 1;
  if (entry.count <= 0) p.bag = p.bag.filter((b) => b !== entry);
  return true;
}

/** A feeble melee jab when a bow-wielder is out of arrows (1 damage). */
function improvisedJab(
  state: GameState,
  target: MonsterInstance,
  events: GameEvent[],
  rng: Rng,
) {
  const def = monsterDef(target.defId);
  target.hp -= 1;
  events.push({ kind: "hit", x: target.x, y: target.y });
  events.push({
    kind: "damage",
    x: target.x,
    y: target.y,
    amount: 1,
    toPlayer: false,
  });
  if (target.hp <= 0) {
    msg(events, `You batter down the ${def.name} with your bow.`);
    awardKill(state, target, def, rng, events);
    state.monsters = state.monsters.filter((m) => m.id !== target.id);
  } else {
    if (def.behavior !== "wander" && def.behavior !== "erratic")
      target.state = "chase";
    msg(events, `Out of arrows — you jab the ${def.name} for 1.`);
  }
}

/** Fire the equipped ranged weapon at a chosen tile (line of sight + in range).
 * Consumes one arrow; a shot into an empty tile is a wasted arrow + turn. */
function resolvePlayerShot(
  state: GameState,
  tx: number,
  ty: number,
  events: GameEvent[],
  rng: Rng,
): boolean {
  const p = state.player;
  const wpn = ITEMS[p.weaponId];
  if (!wpn.ranged) return false; // no ranged weapon equipped
  if (chebyshev(p.x, p.y, tx, ty) > wpn.ranged.range) return false;
  if (!state.visible.includes(idx(tx, ty, state.map.width))) return false; // need LOS
  if (!consumeAmmo(p, wpn.ranged.ammoId)) {
    msg(events, "You have no arrows.");
    return false;
  }
  events.push({ kind: "shoot" }); // bow twang
  const target = monsterAt(state, tx, ty);
  if (target) {
    resolvePlayerAttack(state, target, events, rng, true);
  } else {
    events.push({
      kind: "projectile",
      from: { x: p.x, y: p.y },
      to: { x: tx, y: ty },
      glyph: "»",
    });
    events.push({ kind: "thud" }); // struck stone
    msg(events, "Your arrow clatters off the stone.");
  }
  return true;
}

function resolveMonsterAttack(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  events: GameEvent[],
  rng: Rng,
) {
  const dmg = monsterAttackDamage(
    def,
    state.player,
    eliteMod(m)?.dmgBonus ?? 0,
  );
  state.player.hp -= dmg;
  events.push({ kind: "hit", x: state.player.x, y: state.player.y });
  events.push({
    kind: "damage",
    x: state.player.x,
    y: state.player.y,
    amount: dmg,
    toPlayer: true,
  });
  msg(events, `The ${def.name} hits you for ${dmg}.`);
  if (state.player.hp > 0)
    tryAfflict(state.player.effects, def.inflicts, rng, "You", events);

  // a shover knocks you back a tile — into a chasm/water (and not floating) that
  // means a fall to your death; onto open ground it just throws you off-balance.
  if (def.knockback && state.player.hp > 0) {
    const p = state.player;
    const tx = p.x + Math.sign(p.x - m.x);
    const ty = p.y + Math.sign(p.y - m.y);
    const tile = tileAt(state.map, tx, ty);
    if (tile === "chasm" || tile === "water") {
      if ((p.effects.levitate ?? 0) > 0) {
        p.x = tx;
        p.y = ty; // floating — the blow just drifts you out over the void
        msg(events, `The ${def.name} hurls you out over the void — you drift.`);
      } else {
        p.hp = 0; // shoved off the edge → a fall (handled as a death upstream)
        msg(events, `The ${def.name} hurls you off the edge into the void!`);
      }
    } else if (isWalkable(state.map, tx, ty) && !monsterAt(state, tx, ty)) {
      p.x = tx;
      p.y = ty;
      events.push({ kind: "thud" });
      msg(events, `The ${def.name} throws you back.`);
    }
  }
}

// ── player action ────────────────────────────────────────────────────────
function movePlayer(
  state: GameState,
  dx: number,
  dy: number,
  events: GameEvent[],
  rng: Rng,
): boolean {
  const p = state.player;
  const nx = p.x + dx;
  const ny = p.y + dy;

  const target = monsterAt(state, nx, ny);
  if (target) {
    // ambient wildlife (a wisp) isn't an enemy — touching it just scatters it,
    // no attack/damage/loot/kill-credit. It winks out with a small shimmer.
    if (monsterDef(target.defId).behavior === "ambient") {
      state.monsters = state.monsters.filter((x) => x.id !== target.id);
      events.push({ kind: "blast", x: nx, y: ny, radius: 0 });
      msg(
        events,
        `The ${monsterDef(target.defId).name} gutters out at your touch.`,
      );
      return true; // costs the turn
    }
    const wpn = ITEMS[p.weaponId];
    if (wpn.ranged) {
      // point-blank shot with the equipped bow (feeble jab if out of arrows)
      if (consumeAmmo(p, wpn.ranged.ammoId)) {
        events.push({ kind: "shoot" });
        resolvePlayerAttack(state, target, events, rng, true);
      } else improvisedJab(state, target, events, rng);
    } else {
      resolvePlayerAttack(state, target, events, rng);
    }
    return true; // attacking costs a turn
  }
  if (!isWalkable(state.map, nx, ny)) {
    // levitation lets you glide out over water / a chasm (nothing to trip or
    // grab out there — just drift across)
    const glide = tileAt(state.map, nx, ny);
    if (
      (glide === "water" || glide === "chasm") &&
      (p.effects.levitate ?? 0) > 0
    ) {
      p.x = nx;
      p.y = ny;
      events.push({ kind: "step" });
      return true;
    }
    // frostwalk freezes the water you step onto into a permanent ice bridge
    if (
      tileAt(state.map, nx, ny) === "water" &&
      (p.effects.frostwalk ?? 0) > 0
    ) {
      state.map.tiles[idx(nx, ny, state.map.width)] = "ice";
      p.x = nx;
      p.y = ny;
      events.push({ kind: "step" });
      return true;
    }
    // bumping a closed door swings it open (costs the turn; step through next);
    // a cracked wall hacks at it; any other wall/water is a dead bump (no turn)
    if (tileAt(state.map, nx, ny) === "door") {
      state.map.tiles[idx(nx, ny, state.map.width)] = "doorOpen";
      events.push({ kind: "door" });
      msg(events, "You shove the door open.");
      return true;
    }
    if (tileAt(state.map, nx, ny) === "crackedWall") {
      return bashCrackedWall(state, nx, ny, events);
    }
    return false;
  }
  p.x = nx;
  p.y = ny;
  events.push({ kind: "step" }); // footfall SFX cue
  springTrap(state, events);
  pickUp(state, events);
  forageOnTile(state, events);
  brambleSnag(state, events);
  return true;
}

/** Step onto a forage tile: a small heal (biome-flavored), then it's spent to
 * floor. At full HP it's left untouched — save it for when you actually need it. */
function forageOnTile(state: GameState, events: GameEvent[]) {
  const p = state.player;
  const i = idx(p.x, p.y, state.map.width);
  if (state.map.tiles[i] !== "forage") return;
  if (p.hp >= p.maxHp) return; // already full — leave it for later
  const style = forageStyle(LEVELS[state.currentLevel].biome);
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + style.heal);
  const gained = p.hp - before;
  state.map.tiles[i] = "floor"; // consumed
  events.push({ kind: "heal", x: p.x, y: p.y, amount: gained });
  msg(events, `You gather ${style.name} — +${gained} HP.`);
}

/** Push through a bramble thicket: the thorns snag and bleed you (refreshing a
 * short bleed). Levitation floats you over the thorns untouched. The thicket
 * stays — burn it away to clear a safe path. */
function brambleSnag(state: GameState, events: GameEvent[]) {
  const p = state.player;
  if ((p.effects.levitate ?? 0) > 0) return; // drifting over the thorns
  const i = idx(p.x, p.y, state.map.width);
  if (state.map.tiles[i] !== "bramble") return;
  const had = (p.effects.bleed ?? 0) > 0;
  applyStatus(p.effects, "bleed", CONFIG.brambleBleedDuration);
  if (!had) msg(events, "Thorns rake you — you're bleeding.");
}

/** Trigger a hidden trap under the player, revealing and spending it. */
function springTrap(state: GameState, events: GameEvent[]) {
  const i = idx(state.player.x, state.player.y, state.map.width);
  if (state.map.tiles[i] !== "trap") return;
  if ((state.player.effects.levitate ?? 0) > 0) return; // floating over it — stays armed
  state.map.tiles[i] = "trapSprung";
  const dmg = wardMitigate(
    state.player,
    Math.max(1, CONFIG.trapDamage - state.player.armorReduction),
  );
  state.player.hp -= dmg;
  events.push({ kind: "trap" }); // SFX cue (a sharp snap, in place of the generic hurt)
  events.push({ kind: "hit", x: state.player.x, y: state.player.y });
  events.push({
    kind: "damage",
    x: state.player.x,
    y: state.player.y,
    amount: dmg,
    toPlayer: true,
  });
  msg(events, `A hidden spike trap! You take ${dmg} damage.`);
}

/** Burn torch fuel each turn; the light gutters out at zero. */
function tickTorch(state: GameState, events: GameEvent[]) {
  const p = state.player;
  if (!p.hasTorch || p.torchFuel <= 0) return;
  p.torchFuel -= 1;
  if (p.torchFuel <= 0) {
    p.hasTorch = false;
    recomputeLight(p);
    msg(events, "Your torch gutters out. The dark closes back in.");
  }
}

function useItem(
  state: GameState,
  defId: string,
  events: GameEvent[],
  rng: Rng,
): boolean {
  const p = state.player;
  const entry = p.bag.find((b) => b.defId === defId);
  if (!entry) return false;
  const def = ITEMS[defId];
  if (def.category !== "potion") return false;

  const consume = () => {
    entry.count -= 1;
    if (entry.count <= 0) p.bag = p.bag.filter((b) => b !== entry);
    events.push({ kind: "quaff" }); // only drink potions call consume(); SFX cue
  };

  switch (def.effect) {
    case "bomb":
      // auto-target fallback; the UI normally routes this to cursor targeting
      return throwFirebomb(state, entry, def, events, rng);
    case "blast":
      // one-time burst centered on the player (3x3); no lingering fire under you
      return detonateAt(state, entry, def, p.x, p.y, events, rng, false);
    case "heal":
    case "greaterHeal": {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + (def.magnitude ?? 0));
      msg(events, `You drink the ${def.name}. (+${p.hp - before} hp)`);
      consume();
      return true;
    }
    case "ward":
      p.effects.ward = def.duration ?? 10;
      msg(events, `A shimmer of warding wraps you. (${p.effects.ward} turns)`);
      consume();
      return true;
    case "might":
      p.effects.might = def.duration ?? 10;
      msg(
        events,
        `Strength surges through your arm. (${p.effects.might} turns)`,
      );
      consume();
      return true;
    case "cleanse": {
      const cleared = DAMAGING_STATUS.filter((k) => (p.effects[k] ?? 0) > 0);
      for (const k of cleared) delete p.effects[k];
      msg(
        events,
        cleared.length
          ? "The draught scours the venom and fire from your veins."
          : "The draught tastes of nothing in particular.",
      );
      consume();
      return true;
    }
    case "detect":
      revealTraps(state);
      msg(events, "The floor's hidden teeth glimmer into sight.");
      consume();
      return true;
    case "levitate":
      p.effects.levitate = def.duration ?? 12;
      msg(
        events,
        `You drift up off the ground — water and traps hold no threat. (${p.effects.levitate} turns)`,
      );
      consume();
      return true;
    case "emberstep":
      p.effects.emberstep = def.duration ?? 12;
      msg(
        events,
        `Your skin turns ember-proof; fire can't touch you. (${p.effects.emberstep} turns)`,
      );
      consume();
      return true;
    case "frostwalk":
      p.effects.frostwalk = def.duration ?? 12;
      msg(
        events,
        `Frost sheathes your steps — water freezes as you cross. (${p.effects.frostwalk} turns)`,
      );
      consume();
      return true;
    case "shadow":
      p.effects.shadow = def.duration ?? 12;
      msg(
        events,
        `You melt into shadow — nothing spots you unless it's close. (${p.effects.shadow} turns)`,
      );
      consume();
      return true;
    case "blink":
      // no target given (the UI normally routes this to cursor targeting) —
      // panic-blink to a random reachable tile in range
      return blinkFallback(state, entry, events, rng);
    default:
      return false;
  }
}

/** Reveal every armed trap on the level (Draught of Seeing). */
function revealTraps(state: GameState) {
  const known = new Set(state.knownTraps);
  const { tiles } = state.map;
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === "trap") known.add(i);
  state.knownTraps = Array.from(known);
}

/** Passive sense: armed traps within trapSenseRadius reveal as a faint ^. */
function senseTraps(state: GameState) {
  const { player, map } = state;
  const r = CONFIG.trapSenseRadius;
  const known = new Set(state.knownTraps);
  let changed = false;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > r) continue;
      const x = player.x + dx;
      const y = player.y + dy;
      if (!inBounds(map, x, y)) continue;
      const i = idx(x, y, map.width);
      if (map.tiles[i] === "trap" && !known.has(i)) {
        known.add(i);
        changed = true;
      }
    }
  }
  if (changed) state.knownTraps = Array.from(known);
}

/** Count down the player's timed effects each turn: damaging debuffs bite
 * (ignoring armor), then every timer decrements and expiries are announced. */
function tickEffects(state: GameState, events: GameEvent[]) {
  const p = state.player;
  const e = p.effects;

  // damage-over-time (poison/bleed/burn) — a floating number tinted by kind
  for (const k of Object.keys(e)) {
    if (!isStatusKind(k)) continue;
    if (k === "burn" && (e.emberstep ?? 0) > 0) continue; // ember-proof: fire doesn't bite
    const dmg = STATUS[k].dmgPerTurn;
    if (dmg <= 0) continue;
    p.hp -= dmg;
    events.push({
      kind: "damage",
      x: p.x,
      y: p.y,
      amount: dmg,
      toPlayer: true,
      color: STATUS[k].hudColor,
    });
    if (p.hp <= 0) msg(events, `The ${k} claims you.`);
  }

  for (const k of Object.keys(e)) {
    e[k] -= 1;
    if (e[k] <= 0) {
      delete e[k];
      if (k === "ward") msg(events, "Your warding fades.");
      else if (k === "might") msg(events, "Your strength fades.");
      else if (k === "emberstep")
        msg(events, "Your skin cools — the ember-ward is spent.");
      else if (k === "levitate") {
        msg(events, "Your levitation fades.");
        landFromLevitation(state, events); // don't leave you stranded over water
      } else if (isStatusKind(k)) msg(events, STATUS[k].onFade);
    }
  }
}

/** When levitation wears off over open water, scramble to the nearest solid
 * ground (flood out across the water to the closest walkable shore) — so a
 * lapsed potion never means a silent drop into the void. */
function landFromLevitation(state: GameState, events: GameEvent[]) {
  const p = state.player;
  const here = tileAt(state.map, p.x, p.y);
  if (here !== "water" && here !== "chasm") return;
  const w = state.map.width;
  const seen = new Set<number>([idx(p.x, p.y, w)]);
  const q: Pos[] = [{ x: p.x, y: p.y }];
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  while (q.length) {
    const c = q.shift()!;
    for (const [dx, dy] of dirs) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (!inBounds(state.map, nx, ny)) continue;
      const ni = idx(nx, ny, w);
      if (seen.has(ni)) continue;
      seen.add(ni);
      if (isWalkable(state.map, nx, ny) && !monsterAt(state, nx, ny)) {
        p.x = nx;
        p.y = ny;
        msg(events, "You scramble to solid ground.");
        return;
      }
      const t = tileAt(state.map, nx, ny);
      if (t === "water" || t === "chasm") q.push({ x: nx, y: ny });
    }
  }
}

/** Set a tile alight: oil burns away to bare floor; floor/door/sprung-trap just
 * carry flame; walls/water won't take. Returns whether it ignited. */
function igniteTile(state: GameState, i: number, life: number): boolean {
  const t = state.map.tiles[i];
  if (t === "oil" || t === "bramble")
    state.map.tiles[i] = "floor"; // the slick / thicket is consumed
  else if (t !== "floor" && t !== "trapSprung" && t !== "doorOpen")
    return false;
  const ex = state.fireTiles.find((f) => f.i === i);
  if (ex) ex.life = Math.max(ex.life, life);
  else state.fireTiles.push({ i, life });
  return true;
}

/** Lingering fire tiles sear anything standing in them (refreshing burn), then
 * burn down — and spread one step across adjacent oil each turn. */
function tickFires(state: GameState, events: GameEvent[]) {
  if (state.fireTiles.length === 0) return;
  const w = state.map.width;
  const p = state.player;
  const survivors: { i: number; life: number }[] = [];
  for (const f of state.fireTiles) {
    const fx = f.i % w;
    const fy = Math.floor(f.i / w);
    if (p.x === fx && p.y === fy && (p.effects.emberstep ?? 0) <= 0) {
      const had = (p.effects.burn ?? 0) > 0;
      applyStatus(p.effects, "burn", CONFIG.fireBurnDuration);
      if (!had) msg(events, STATUS.burn.onApply("You"));
    }
    for (const m of state.monsters) {
      if (m.x === fx && m.y === fy) {
        if (!m.effects) m.effects = {};
        applyStatus(m.effects, "burn", CONFIG.fireBurnDuration);
      }
    }
    f.life -= 1;
    if (f.life > 0) survivors.push(f);
    else addDecal(state, f.i, "scorch"); // burnt-out fire leaves a scorch mark
  }
  state.fireTiles = survivors;

  // spread: any oil next to a still-burning tile catches this turn
  const spread: number[] = [];
  for (const f of state.fireTiles) {
    const fx = f.i % w;
    const fy = Math.floor(f.i / w);
    for (const [dx, dy] of DIRS) {
      const nx = fx + dx;
      const ny = fy + dy;
      if (!inBounds(state.map, nx, ny)) continue;
      const ni = idx(nx, ny, w);
      const nt = state.map.tiles[ni];
      if (nt === "oil" || nt === "bramble") spread.push(ni);
    }
  }
  let lit = false;
  let hitBramble = false;
  for (const ni of spread) {
    if (state.map.tiles[ni] === "bramble") hitBramble = true;
    if (igniteTile(state, ni, CONFIG.fire.duration)) lit = true;
  }
  if (lit)
    msg(
      events,
      hitBramble
        ? "Fire crackles through the thicket!"
        : "Fire races across the oil!",
    );
}

/**
 * Poison-spore vents: each `sporeVent` tile seeps a lingering toxic haze
 * (`gasTiles`). Every turn the existing haze poisons whoever stands in it and
 * decays, then each vent re-emits — refreshing the haze on itself + its
 * orthogonal neighbors, and on a "breath" turn (every `breathPeriod`) swelling
 * one diagonal ring further. So the cloud pulses around a bounded pocket rather
 * than filling the map — an avoidable poison zone, not a death trap. Levitation
 * gives NO protection (it's airborne); the counter is simply to hold your breath
 * and go around, or breathe an Antidote after. Deterministic (no RNG) so it
 * roundtrips through the save cleanly. */
function tickGas(state: GameState, events: GameEvent[]) {
  const w = state.map.width;
  const vents: number[] = [];
  for (let i = 0; i < state.map.tiles.length; i++)
    if (state.map.tiles[i] === "sporeVent") vents.push(i);
  if (vents.length === 0 && state.gasTiles.length === 0) return;

  // (1) existing haze poisons occupants, then decays
  const p = state.player;
  const survivors: { i: number; life: number }[] = [];
  for (const g of state.gasTiles) {
    const gx = g.i % w;
    const gy = Math.floor(g.i / w);
    if (p.x === gx && p.y === gy) {
      const had = (p.effects.poison ?? 0) > 0;
      applyStatus(p.effects, "poison", CONFIG.gas.poisonDuration);
      if (!had) msg(events, "You choke on a lungful of spores!");
    }
    for (const m of state.monsters) {
      if (m.x === gx && m.y === gy) {
        if (!m.effects) m.effects = {};
        applyStatus(m.effects, "poison", CONFIG.gas.poisonDuration);
      }
    }
    g.life -= 1;
    if (g.life > 0) survivors.push(g);
  }
  state.gasTiles = survivors;

  // (2) vents re-emit — refresh the haze on the vent + a ring (breath = wider)
  const breath = state.turnCount % CONFIG.gas.breathPeriod === 0;
  const emit = (i: number, life: number) => {
    if (!isWalkable(state.map, i % w, Math.floor(i / w))) return;
    const ex = state.gasTiles.find((g) => g.i === i);
    if (ex) ex.life = Math.max(ex.life, life);
    else state.gasTiles.push({ i, life });
  };
  // The CORE (vent + orthogonals) is refreshed every turn — that's the lingering
  // haze. The diagonal BREATH ring flares only on a breath turn and with a shorter
  // life, so the pocket visibly swells and settles instead of latching at full
  // extent. (It used to share `ventLife`, which refreshed the ring exactly as it
  // expired and froze the cloud permanently — see the note on `gas.breathLife`.)
  for (const v of vents) {
    // Duty cycle + per-vent phase live in `ventState` (core/gas.ts) because the
    // RENDERER needs the same arithmetic to telegraph the turn before a vent blows.
    if (ventState(state.turnCount, v) !== "seeping") continue;
    const vx = v % w;
    const vy = Math.floor(v / w);
    emit(v, CONFIG.gas.ventLife);
    for (const [dx, dy] of DIRS) {
      const nx = vx + dx;
      const ny = vy + dy;
      if (inBounds(state.map, nx, ny))
        emit(idx(nx, ny, w), CONFIG.gas.ventLife);
    }
    if (!breath) continue;
    for (const [dx, dy] of DIRS8) {
      if (dx === 0 || dy === 0) continue; // orthogonals are the core, done above
      const nx = vx + dx;
      const ny = vy + dy;
      if (inBounds(state.map, nx, ny))
        emit(idx(nx, ny, w), CONFIG.gas.breathLife);
    }
  }
}

/**
 * Flooding set-piece: on levels with `LevelConfig.flood`, water rises one ring
 * every `interval` turns (from `startTurn`, up to `maxSteps` rings). It spreads
 * only into `floodable` floor (never the protected dry spine) and never onto an
 * occupied tile, so no one is stranded on impassable footing and the objective
 * stays reachable. Levitation glides over it; Rimewalk freezes it to ice.
 */
/**
 * Tiles that must stay dry THIS step so the player is never sealed in: a
 * walkable route from wherever they're standing back to permanently-dry ground
 * (any tile outside `floodable` — i.e. the protected spine).
 *
 * The flood plan keeps the OBJECTIVES reachable, but that only helps a player
 * who is standing on the spine. Step off it into a side pocket and the ring
 * floods every neighbour, marooning you on a single tile — and since the turn
 * limit is only a score target, nothing ever ends the run. That's a softlock,
 * not a hazard. Returns `null` if no route exists (already stranded), which
 * tells the caller to hold the water rather than make it worse.
 */
function floodEscapeRoute(
  state: GameState,
  floodable: Set<number>,
): Set<number> | null {
  const map = state.map;
  const w = map.width;
  const start = idx(state.player.x, state.player.y, w);
  const prev = new Map<number, number>([[start, -1]]);
  const q = [start];
  let safe = -1;
  while (q.length) {
    const cur = q.shift()!;
    // dry ground the flood can never take — the player is safe once here
    if (!floodable.has(cur) && map.tiles[cur] !== "water") {
      safe = cur;
      break;
    }
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(map, nx, ny)) continue;
      const ni = idx(nx, ny, w);
      if (prev.has(ni) || !isWalkable(map, nx, ny)) continue;
      prev.set(ni, cur);
      q.push(ni);
    }
  }
  if (safe < 0) return null;
  const route = new Set<number>();
  for (let c = safe; c !== -1 && c !== undefined; c = prev.get(c)!)
    route.add(c);
  return route;
}

function tickFlood(state: GameState, events: GameEvent[]) {
  const cfg = LEVELS[state.currentLevel].flood;
  if (!cfg || !state.floodable || state.floodable.length === 0) return;
  const step = state.floodStep ?? 0;
  if (state.turnCount < cfg.startTurn) return;
  if ((state.turnCount - cfg.startTurn) % cfg.interval !== 0) return;
  if (step >= cfg.maxSteps) return;

  const map = state.map;
  const w = map.width;
  const floodable = new Set(state.floodable);
  const occupied = new Set<number>([idx(state.player.x, state.player.y, w)]);
  for (const m of state.monsters) occupied.add(idx(m.x, m.y, w));

  // Keep an escape route open. Levitation crosses water, so a floating player
  // can never be sealed in and needs no reservation.
  if ((state.player.effects.levitate ?? 0) <= 0) {
    const route = floodEscapeRoute(state, floodable);
    if (route === null) return; // already stranded — don't make it worse
    for (const i of route) occupied.add(i);
  }

  let rose = false;
  if (step === 0) {
    for (const s of state.floodSeeds ?? []) {
      if (!occupied.has(s) && map.tiles[s] === "floor") {
        map.tiles[s] = "water";
        rose = true;
      }
    }
    if (rose) msg(events, "Black water begins to seep up through the crypt.");
  } else {
    const front: number[] = [];
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.tiles[i] !== "water") continue;
      const cx = i % w;
      const cy = Math.floor(i / w);
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inBounds(map, nx, ny)) continue;
        const ni = idx(nx, ny, w);
        if (
          floodable.has(ni) &&
          // floor floods; water flows THROUGH an open door, but a door pulled
          // shut ([c]) holds it back (it's no longer "doorOpen" here)
          (map.tiles[ni] === "floor" || map.tiles[ni] === "doorOpen") &&
          !occupied.has(ni)
        ) {
          front.push(ni);
        }
      }
    }
    for (const ni of front) {
      map.tiles[ni] = "water";
      rose = true;
    }
    if (rose) msg(events, "The water rises higher.");
  }
  state.floodStep = step + 1;
}

/** Tick every monster's debuffs: DoT bites, timers count down, and any monster
 * that dies to the damage is reaped (awarding coins/loot/kills). */
function tickMonsterStatus(state: GameState, rng: Rng, events: GameEvent[]) {
  const w = state.map.width;
  const visible = new Set(state.visible);
  let anyDead = false;
  for (const m of state.monsters) {
    const e = m.effects;
    if (!e) continue;
    let dot = 0;
    for (const k of Object.keys(e))
      if (isStatusKind(k)) dot += STATUS[k].dmgPerTurn;
    if (dot > 0) {
      m.hp -= dot;
      if (visible.has(idx(m.x, m.y, w))) {
        const tintKey = DAMAGING_STATUS.find((k) => (e[k] ?? 0) > 0);
        events.push({
          kind: "damage",
          x: m.x,
          y: m.y,
          amount: dot,
          toPlayer: false,
          color: tintKey ? STATUS[tintKey].hudColor : undefined,
        });
      }
      if (m.hp <= 0) anyDead = true;
    }
    for (const k of Object.keys(e)) {
      e[k] -= 1;
      if (e[k] <= 0) delete e[k];
    }
  }
  if (!anyDead) return;
  const survivors: MonsterInstance[] = [];
  for (const m of state.monsters) {
    if (m.hp <= 0) {
      const md = monsterDef(m.defId);
      awardKill(state, m, md, rng, events);
      msg(events, `The ${md.name} succumbs.`);
    } else survivors.push(m);
  }
  state.monsters = survivors;
}

/**
 * Detonate a firebomb at (tx,ty): full damage to that tile, splash (half,
 * rounded up) to the 3x3 around it. Consumes the item, awards coins for kills.
 */
/** Scatter lingering fire across the walkable ground within a blast footprint.
 * Oil always catches; bare ground catches on a chance. */
function spawnFires(state: GameState, tx: number, ty: number, rng: Rng) {
  const { map } = state;
  const life = CONFIG.fire.duration;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (!inBounds(map, x, y)) continue;
      const i = idx(x, y, map.width);
      const t = map.tiles[i];
      if (t === "oil") igniteTile(state, i, life);
      else if (
        (t === "floor" || t === "trapSprung" || t === "doorOpen") &&
        rng.chance(CONFIG.fire.spawnChance)
      )
        igniteTile(state, i, life);
    }
  }
}

function detonateAt(
  state: GameState,
  entry: { defId: string; count: number },
  def: (typeof ITEMS)[string],
  tx: number,
  ty: number,
  events: GameEvent[],
  rng: Rng,
  spawnFire: boolean,
): boolean {
  const p = state.player;
  events.push({
    kind: "projectile",
    from: { x: p.x, y: p.y },
    to: { x: tx, y: ty },
    glyph: "*",
  });
  events.push({ kind: "blast", x: tx, y: ty, radius: 1 });

  const dmg =
    (def.magnitude ?? 0) + (classDef(state.player.classId).bombPower ?? 0);
  for (const m of state.monsters) {
    const d = chebyshev(m.x, m.y, tx, ty);
    if (d > 1) continue;
    const dealt = d === 0 ? dmg : Math.ceil(dmg / 2);
    m.hp -= dealt;
    events.push({ kind: "hit", x: m.x, y: m.y });
    events.push({
      kind: "damage",
      x: m.x,
      y: m.y,
      amount: dealt,
      toPlayer: false,
    });
    // the flames cling to anything that survives the burst (player → monster)
    if (m.hp > 0) {
      if (!m.effects) m.effects = {};
      applyStatus(m.effects, "burn", CONFIG.fireBurnDuration);
    }
  }

  // the blast blows open any cracked walls it touches (new shortcuts)
  let opened = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (!inBounds(state.map, x, y)) continue;
      const i = idx(x, y, state.map.width);
      if (state.map.tiles[i] === "crackedWall") {
        state.map.tiles[i] = "floor";
        opened++;
      }
    }
  }
  if (opened > 0) {
    events.push({ kind: "crumble" });
    msg(
      events,
      `The blast blows open ${opened > 1 ? "cracked walls" : "a cracked wall"}!`,
    );
  }

  if (spawnFire) spawnFires(state, tx, ty, rng);

  let slain = 0;
  const survivors: MonsterInstance[] = [];
  for (const m of state.monsters) {
    if (m.hp <= 0) {
      awardKill(state, m, monsterDef(m.defId), rng, events);
      slain++;
    } else {
      survivors.push(m);
    }
  }
  state.monsters = survivors;

  msg(
    events,
    `The ${def.name} bursts into flame!${slain ? ` ${slain} slain.` : ""}`,
  );
  entry.count -= 1;
  if (entry.count <= 0) p.bag = p.bag.filter((b) => b !== entry);
  return true;
}

/** Auto-target the nearest visible monster (used as a fallback). */
function throwFirebomb(
  state: GameState,
  entry: { defId: string; count: number },
  def: (typeof ITEMS)[string],
  events: GameEvent[],
  rng: Rng,
): boolean {
  const p = state.player;
  const w = state.map.width;
  const visible = new Set(state.visible);
  let target: MonsterInstance | null = null;
  let best = Infinity;
  for (const m of state.monsters) {
    if (!visible.has(idx(m.x, m.y, w))) continue;
    const d = chebyshev(p.x, p.y, m.x, m.y);
    if (d <= CONFIG.throwRange && d < best) {
      best = d;
      target = m;
    }
  }
  if (!target) {
    msg(events, `No target in sight for the ${def.name}.`);
    return false;
  }
  return detonateAt(state, entry, def, target.x, target.y, events, rng, true);
}

/** Throw a firebomb at a chosen tile (cursor targeting). */
function throwFirebombAt(
  state: GameState,
  defId: string,
  tx: number,
  ty: number,
  events: GameEvent[],
  rng: Rng,
): boolean {
  const entry = state.player.bag.find((b) => b.defId === defId);
  if (!entry) return false;
  const def = ITEMS[defId];
  if (def.category !== "potion" || def.effect !== "bomb") return false;
  if (chebyshev(state.player.x, state.player.y, tx, ty) > CONFIG.throwRange)
    return false;
  return detonateAt(state, entry, def, tx, ty, events, rng, true);
}

function equipFromBag(
  state: GameState,
  defId: string,
  events: GameEvent[],
): boolean {
  const def = ITEMS[defId];
  if (def.category === "weapon") {
    equipWeapon(state.player, defId);
    msg(events, `You wield the ${def.name}.`);
  } else if (def.category === "armor") {
    equipArmor(state.player, defId);
    msg(events, `You don the ${def.name}.`);
  }
  return false; // equipping is a free action
}

/** Apply the player's action. Returns whether a turn was consumed. */
// ── class active abilities ([q]) ─────────────────────────────────────────────
/** Dispatch the player's class ability. Sets the cooldown on a successful use;
 * a no-op (e.g. a dash into a wall) costs neither the turn nor the cooldown. */
function useAbility(
  state: GameState,
  dx: number,
  dy: number,
  events: GameEvent[],
  rng: Rng,
): boolean {
  const p = state.player;
  const ab = classDef(p.classId).ability;
  if (!ab) {
    msg(events, "You have no special ability.");
    return false;
  }
  if (p.abilityCooldown > 0) {
    msg(events, `${ab.name} isn't ready yet (${p.abilityCooldown}).`);
    return false;
  }
  let used = false;
  switch (ab.id) {
    case "cleave":
      used = abilityCleave(state, events, rng);
      break;
    case "dash":
      used = abilityDash(state, dx, dy, events);
      break;
    case "scorch":
      used = abilityScorch(state, dx, dy, events);
      break;
  }
  if (used) p.abilityCooldown = ab.cooldown;
  return used;
}

/** Warrior — Cleave: one sweep hits every adjacent monster (a full weapon blow). */
function abilityCleave(
  state: GameState,
  events: GameEvent[],
  rng: Rng,
): boolean {
  const p = state.player;
  const around = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  const targets = around
    .map(([dx, dy]) => monsterAt(state, p.x + dx, p.y + dy))
    .filter((m): m is MonsterInstance => !!m);
  events.push({ kind: "blast", x: p.x, y: p.y, radius: 1 }); // a sweeping ring
  msg(
    events,
    targets.length
      ? "You sweep your blade in a wide arc!"
      : "You sweep your blade through empty air.",
  );
  for (const m of targets) {
    if (state.monsters.includes(m)) resolvePlayerAttack(state, m, events, rng);
  }
  return true; // a swing always spends the turn + cooldown
}

/** Rogue — Dash: leap up to `range` tiles in a direction, stopping before any
 * blocker. Reposition/escape only (no strike). */
function abilityDash(
  state: GameState,
  dx: number,
  dy: number,
  events: GameEvent[],
): boolean {
  if (dx === 0 && dy === 0) return false;
  const p = state.player;
  const range = classDef(p.classId).ability?.range ?? 3;
  let nx = p.x;
  let ny = p.y;
  let steps = 0;
  for (let s = 0; s < range; s++) {
    const tx = nx + dx;
    const ty = ny + dy;
    if (!isWalkable(state.map, tx, ty) || monsterAt(state, tx, ty)) break;
    nx = tx;
    ny = ty;
    steps++;
  }
  if (steps === 0) {
    msg(events, "The way is blocked — you can't dash there.");
    return false; // no movement → no turn spent
  }
  events.push({
    kind: "projectile",
    from: { x: p.x, y: p.y },
    to: { x: nx, y: ny },
    glyph: "·",
  });
  p.x = nx;
  p.y = ny;
  events.push({ kind: "step" });
  springTrap(state, events); // you land fully — a trap underfoot bites
  pickUp(state, events);
  forageOnTile(state, events);
  brambleSnag(state, events);
  msg(events, `You dash ${steps} tile${steps > 1 ? "s" : ""} in a blur.`);
  return true;
}

/** Pyromancer — Scorch: a widening cone of fire that sets the ground ablaze —
 * the lingering fire then sears whatever stands in it (via `tickFires`). */
function abilityScorch(
  state: GameState,
  dx: number,
  dy: number,
  events: GameEvent[],
): boolean {
  if (dx === 0 && dy === 0) return false;
  const p = state.player;
  const w = state.map.width;
  const px = -dy; // perpendicular (90° rotation of the aim)
  const py = dx;
  let lit = 0;
  for (let s = 1; s <= 3; s++) {
    const half = s - 1; // depth 1 → 1 wide, 2 → 3 wide, 3 → 5 wide
    for (let lat = -half; lat <= half; lat++) {
      const tx = p.x + dx * s + px * lat;
      const ty = p.y + dy * s + py * lat;
      if (!inBounds(state.map, tx, ty)) continue;
      if (igniteTile(state, idx(tx, ty, w), CONFIG.fire.duration)) lit++;
    }
  }
  events.push({ kind: "blast", x: p.x + dx * 2, y: p.y + dy * 2, radius: 2 });
  msg(
    events,
    lit
      ? "You breathe a roaring cone of fire!"
      : "Your flames gutter against cold stone.",
  );
  return true; // the burst always spends the turn + cooldown
}

function applyPlayerAction(
  state: GameState,
  action: PlayerAction,
  events: GameEvent[],
  rng: Rng,
): boolean {
  switch (action.type) {
    case "ability":
      return useAbility(state, action.dx ?? 0, action.dy ?? 0, events, rng);
    case "wait":
      return true;
    case "move":
      return movePlayer(state, action.dx, action.dy, events, rng);
    case "equip":
      return equipFromBag(state, action.defId, events);
    case "useItem":
      return useItem(state, action.defId, events, rng);
    case "throwAt":
      return throwFirebombAt(
        state,
        action.defId,
        action.x,
        action.y,
        events,
        rng,
      );
    case "shootAt":
      return resolvePlayerShot(state, action.x, action.y, events, rng);
    case "closeDoor":
      return closePlayerDoor(state, events);
    case "blinkTo":
      return resolvePlayerBlink(
        state,
        action.defId,
        action.x,
        action.y,
        events,
      );
  }
}

/** Teleport to a chosen tile (Phial of Blinking): must be within `blinkRange`,
 * walkable, and empty. Consumes the phial + the turn; you arrive fully (a trap
 * underfoot springs, items/forage are gathered). No-op (no turn) if invalid. */
function resolvePlayerBlink(
  state: GameState,
  defId: string,
  x: number,
  y: number,
  events: GameEvent[],
): boolean {
  const p = state.player;
  const entry = p.bag.find((b) => b.defId === defId);
  if (!entry) return false;
  if (
    chebyshev(p.x, p.y, x, y) > CONFIG.blinkRange ||
    !isWalkable(state.map, x, y) ||
    monsterAt(state, x, y)
  ) {
    msg(events, "The blink fizzles — you can't reach there.");
    return false; // no turn spent
  }
  entry.count -= 1;
  if (entry.count <= 0) p.bag = p.bag.filter((b) => b !== entry);
  events.push({ kind: "blast", x: p.x, y: p.y, radius: 1 }); // depart poof
  p.x = x;
  p.y = y;
  events.push({ kind: "blast", x, y, radius: 1 }); // arrive poof
  events.push({ kind: "quaff" });
  msg(events, "You blink through the space between.");
  springTrap(state, events); // you land on the tile — a trap underfoot bites
  pickUp(state, events);
  forageOnTile(state, events);
  brambleSnag(state, events);
  return true;
}

/** No-target blink: hop to a random reachable tile in range (used only if a
 * Phial is somehow used without the cursor). */
function blinkFallback(
  state: GameState,
  entry: { defId: string },
  events: GameEvent[],
  rng: Rng,
): boolean {
  const p = state.player;
  const r = CONFIG.blinkRange;
  const cands: { x: number; y: number }[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = p.x + dx;
      const y = p.y + dy;
      if (isWalkable(state.map, x, y) && !monsterAt(state, x, y))
        cands.push({ x, y });
    }
  }
  if (cands.length === 0) {
    msg(events, "The blink fizzles.");
    return false;
  }
  const t = cands[rng.int(0, cands.length - 1)];
  return resolvePlayerBlink(state, entry.defId, t.x, t.y, events);
}

/** Shut an orthogonally-adjacent open door (break LOS / wall off a chaser).
 * Won't close onto a monster. Costs a turn only if a door actually closes. */
function closePlayerDoor(state: GameState, events: GameEvent[]): boolean {
  const p = state.player;
  const w = state.map.width;
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!inBounds(state.map, nx, ny)) continue;
    if (tileAt(state.map, nx, ny) !== "doorOpen") continue;
    if (monsterAt(state, nx, ny)) continue; // something's in the doorway
    state.map.tiles[idx(nx, ny, w)] = "door";
    events.push({ kind: "door" });
    msg(events, "You pull the door shut.");
    return true;
  }
  msg(events, "There's no open door beside you to close.");
  return false;
}

// ── monster phase ────────────────────────────────────────────────────────
function monsterMoveTo(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  nx: number,
  ny: number,
  events: GameEvent[],
  rng: Rng,
) {
  if (nx === state.player.x && ny === state.player.y) {
    resolveMonsterAttack(state, m, def, events, rng);
    return;
  }
  if (!isWalkable(state.map, nx, ny)) return;
  if (monsterAt(state, nx, ny, m.id)) return; // don't stack
  m.x = nx;
  m.y = ny;
}

function moveRandom(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  rng: Rng,
  events: GameEvent[],
) {
  const dirs = DIRS.slice();
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  for (const [dx, dy] of dirs) {
    const nx = m.x + dx;
    const ny = m.y + dy;
    if (nx === state.player.x && ny === state.player.y) {
      resolveMonsterAttack(state, m, def, events, rng);
      return;
    }
    if (isWalkable(state.map, nx, ny) && !monsterAt(state, nx, ny, m.id)) {
      m.x = nx;
      m.y = ny;
      return;
    }
  }
}

/** Non-hostile ambient drift (a will-o'-wisp): wanders idly, but FLEES when the
 * player comes within its shy radius — retreating to the neighbor that puts the
 * most distance between you (so it lures you deeper as you follow). Never steps
 * onto the player and never attacks; if cornered it just shimmers in place. */
function driftAmbient(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  rng: Rng,
) {
  const p = state.player;
  const flee = chebyshev(m.x, m.y, p.x, p.y) <= (def.sightRadius ?? 5);
  const dirs = DIRS.slice();
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  const curDist = manhattan(m.x, m.y, p.x, p.y);
  let best: [number, number] | null = null;
  let bestDist = -1;
  for (const [dx, dy] of dirs) {
    const nx = m.x + dx;
    const ny = m.y + dy;
    if (nx === p.x && ny === p.y) continue; // never drift into the player
    if (!isWalkable(state.map, nx, ny) || monsterAt(state, nx, ny, m.id))
      continue;
    if (!flee) {
      m.x = nx; // idle wander: first open neighbor
      m.y = ny;
      return;
    }
    const d = manhattan(nx, ny, p.x, p.y);
    if (d > bestDist) {
      bestDist = d;
      best = [nx, ny];
    }
  }
  // fleeing: only move if it actually gains distance; else hold (shimmer)
  if (flee && best && bestDist >= curDist) {
    m.x = best[0];
    m.y = best[1];
  }
}

function chaseStep(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  events: GameEvent[],
  rng: Rng,
  target: Pos,
) {
  const step = stepToward(
    state.map,
    { x: m.x, y: m.y },
    target,
    def.opensDoors,
  );
  if (!step) return;
  // a door-forcer (guard/boss) shoves a shut door open — spends the turn on it,
  // then walks through next turn; dumb monsters can't (their path routed around)
  if (def.opensDoors && tileAt(state.map, step.x, step.y) === "door") {
    state.map.tiles[idx(step.x, step.y, state.map.width)] = "doorOpen";
    events.push({ kind: "door" });
    if (state.visible.includes(idx(step.x, step.y, state.map.width)))
      msg(events, `The ${def.name} forces the door open.`);
    return;
  }
  monsterMoveTo(state, m, def, step.x, step.y, events, rng);
}

function rangedAttack(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  events: GameEvent[],
  rng: Rng,
) {
  const bonus = eliteMod(m)?.dmgBonus ?? 0;
  const dmg = mitigate(
    state.player,
    Math.max(
      1,
      (def.rangedDmg ?? def.dmg) + bonus - state.player.armorReduction,
    ),
  );
  state.player.hp -= dmg;
  events.push({
    kind: "projectile",
    from: { x: m.x, y: m.y },
    to: { x: state.player.x, y: state.player.y },
    glyph: "•",
  });
  events.push({ kind: "hit", x: state.player.x, y: state.player.y });
  events.push({
    kind: "damage",
    x: state.player.x,
    y: state.player.y,
    amount: dmg,
    toPlayer: true,
  });
  msg(events, `The ${def.name} hurls a bolt for ${dmg}.`);
  if (state.player.hp > 0)
    tryAfflict(state.player.effects, def.inflicts, rng, "You", events);
}

// ── boss: Malachar the Lich-King (behavior "bossLich") ─────────────────────
// Risen dead the lich tears from the stone when he summons.
const LICH_MINIONS = ["skeleton", "wraith"] as const;

/** HP-gated phase: 0 (>2/3), 1 (>1/3), 2 (≤1/3) — the fight escalates. */
function lichPhase(m: MonsterInstance, def: MonsterDef): number {
  const frac = m.hp / def.maxHp;
  if (frac > 2 / 3) return 0;
  if (frac > 1 / 3) return 1;
  return 2;
}

/** Empty, walkable tiles on expanding rings around (cx,cy), nearest first,
 * excluding the player and any occupied tile. */
function emptyTilesNear(
  state: GameState,
  cx: number,
  cy: number,
  rMin: number,
  rMax: number,
): number[] {
  const w = state.map.width;
  const out: number[] = [];
  for (let r = rMin; r <= rMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const x = cx + dx;
        const y = cy + dy;
        if (!inBounds(state.map, x, y) || !isWalkable(state.map, x, y))
          continue;
        if (x === state.player.x && y === state.player.y) continue;
        if (monsterAt(state, x, y)) continue;
        out.push(idx(x, y, w));
      }
    }
  }
  return out;
}

/** Telegraph a dark-fire barrage centered on the player's current tile. The
 * tiles detonate at the start of the next monster phase (see resolveBarrage),
 * so the player gets one turn to step clear. */
function lichBarrage(
  state: GameState,
  phase: number,
  rng: Rng,
  events: GameEvent[],
) {
  const p = state.player;
  const w = state.map.width;
  const want = CONFIG.lich.barrageTiles[phase];
  const tiles = [idx(p.x, p.y, w)]; // always rains where you stand
  const cand = emptyTilesNear(state, p.x, p.y, 1, 2);
  while (tiles.length < want && cand.length) {
    tiles.push(cand.splice(rng.int(0, cand.length - 1), 1)[0]);
  }
  state.barrage = tiles;
  msg(
    events,
    "Malachar thrusts his staff skyward — dark fire gathers overhead!",
  );
}

/** Detonate any telegraphed barrage tiles: a spark on each, damage the player
 * if still standing on one. Runs at the top of the monster phase. */
function resolveBarrage(state: GameState, events: GameEvent[]) {
  if (state.barrage.length === 0) return;
  const p = state.player;
  const w = state.map.width;
  const pIdx = idx(p.x, p.y, w);
  let struck = false;
  for (const t of state.barrage) {
    events.push({ kind: "hit", x: t % w, y: Math.floor(t / w) });
    if (t === pIdx) struck = true;
  }
  state.barrage = [];
  if (struck) {
    const dmg = wardMitigate(
      p,
      Math.max(2, CONFIG.lich.barrageDamage - p.armorReduction),
    );
    p.hp -= dmg;
    events.push({
      kind: "damage",
      x: p.x,
      y: p.y,
      amount: dmg,
      toPlayer: true,
    });
    msg(events, `Dark fire crashes down on you for ${dmg}!`);
  } else {
    msg(events, "Dark fire crashes down where you stood.");
  }
}

/** Raise a cluster of adds around the lich (up to the phase count). */
function lichSummon(
  state: GameState,
  m: MonsterInstance,
  phase: number,
  rng: Rng,
  events: GameEvent[],
) {
  const w = state.map.width;
  const count = CONFIG.lich.summonCount[phase];
  const spots = emptyTilesNear(state, m.x, m.y, 1, 3);
  let n = 0;
  for (const s of spots) {
    if (n >= count) break;
    const chosen = LICH_MINIONS[rng.int(0, LICH_MINIONS.length - 1)];
    const mdef = monsterDef(chosen);
    state.monsters.push({
      id: `lm${state.turnCount}_${state.monsters.length}`,
      defId: chosen,
      x: s % w,
      y: Math.floor(s / w),
      hp: mdef.maxHp,
      state: "chase", // they rise already hunting
    });
    n++;
  }
  if (n > 0) {
    events.push({ kind: "blast", x: m.x, y: m.y, radius: 1 });
    msg(
      events,
      "Malachar rips the dead from the stone — they rise around him!",
    );
  }
}

/** Blink to a distant walkable tile (still within bolt range-ish) — used to
 * escape when the player closes to melee. Returns false if nowhere to go. */
function lichTeleport(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  rng: Rng,
  events: GameEvent[],
): boolean {
  const w = state.map.width;
  const p = state.player;
  const maxD = (def.rangedRange ?? 5) + 2;
  const cands: number[] = [];
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < w; x++) {
      if (!isWalkable(state.map, x, y) || monsterAt(state, x, y)) continue;
      if (x === p.x && y === p.y) continue;
      const d = chebyshev(x, y, p.x, p.y);
      if (d < CONFIG.lich.teleportMinDist || d > maxD) continue;
      cands.push(idx(x, y, w));
    }
  }
  if (cands.length === 0) return false;
  const dest = cands[rng.int(0, cands.length - 1)];
  events.push({ kind: "blast", x: m.x, y: m.y, radius: 1 }); // vanish
  m.x = dest % w;
  m.y = Math.floor(dest / w);
  events.push({ kind: "blast", x: m.x, y: m.y, radius: 1 }); // reform
  msg(events, "Malachar dissolves into shadow — and reforms across the hall.");
  return true;
}

function actMonster(
  state: GameState,
  m: MonsterInstance,
  visible: Set<number>,
  rng: Rng,
  events: GameEvent[],
) {
  const def = monsterDef(m.defId);
  const p = state.player;

  // Frozen solid: the monster forfeits its turn while chilled.
  if ((m.effects?.chill ?? 0) > 0) return;

  const dist = chebyshev(m.x, m.y, p.x, p.y);
  const seen = visible.has(idx(m.x, m.y, state.map.width));

  // Detection is light-limited: a chaser only notices you within the smaller of
  // its sight and your own light (Shadow shrinks it further). Dousing your
  // torch / low light lets you slip past unseen and set up a sneak attack.
  const isChaser =
    def.behavior !== "wander" &&
    def.behavior !== "erratic" &&
    def.behavior !== "ambient";
  const detectRange = Math.min(
    def.sightRadius,
    p.lightRadius,
    (p.effects.shadow ?? 0) > 0 ? CONFIG.shadowSightRadius : Infinity,
  );
  const canDetect = isChaser && seen && dist <= detectRange;
  if (canDetect) {
    m.state = "chase";
    m.lastSeen = { x: p.x, y: p.y }; // remember where you were
    m.lostTurns = 0;
  } else if (m.state === "chase" && !def.isBoss) {
    // lost sight — hunt your last-known spot, then give up after a while
    // (bosses never lose interest — the finale is relentless)
    m.lostTurns = (m.lostTurns ?? 0) + 1;
    if (m.lostTurns >= CONFIG.loseInterestTurns) {
      m.state = "idle";
      m.lastSeen = undefined;
      m.lostTurns = 0;
    }
  }
  // pursue your actual position while in contact (or if a boss / no memory);
  // otherwise head for the last tile you were seen on
  const target: Pos =
    canDetect || def.isBoss || !m.lastSeen ? { x: p.x, y: p.y } : m.lastSeen;

  switch (def.behavior) {
    case "wander":
      moveRandom(state, m, def, rng, events);
      return;
    case "erratic":
      if (rng.chance(0.85)) moveRandom(state, m, def, rng, events);
      return;
    case "ambient":
      driftAmbient(state, m, def, rng);
      return;
    case "slowChase":
      // shambles: acts only every other turn
      if (state.turnCount % 2 === 1) return;
      if (m.state === "chase") chaseStep(state, m, def, events, rng, target);
      else moveRandom(state, m, def, rng, events);
      return;
    case "guardChase":
      // holds its ground until it spots you, then pursues relentlessly
      if (m.state === "chase") chaseStep(state, m, def, events, rng, target);
      return;
    case "ranged": {
      if (m.state !== "chase") return;
      const inRange = seen && dist <= (def.rangedRange ?? 4);
      if (!inRange) {
        chaseStep(state, m, def, events, rng, target); // close until the player is in range
      } else if ((m.cooldown ?? 0) > 0) {
        m.cooldown = (m.cooldown ?? 0) - 1; // reload — hold position, don't fire
      } else {
        rangedAttack(state, m, def, events, rng);
        m.cooldown = def.rangedCooldown ?? 1;
      }
      return;
    }
    case "bossLich": {
      if (m.state !== "chase") return; // dormant until he spots you
      const phase = lichPhase(m, def);
      // announce each new phase once (HP only falls, so phase only rises)
      if ((m.phase ?? 0) < phase) {
        m.phase = phase;
        msg(
          events,
          phase === 1
            ? "Malachar's form splits into wreathing shadow — the hall turns against you!"
            : "Malachar screams, and the dark fire comes without pause!",
        );
      }
      if (m.abilityCd == null) m.abilityCd = CONFIG.lich.abilityCd[phase];

      // Cornered (phase 2+): blink away rather than trade melee blows.
      if (phase >= 1 && dist <= 1 && lichTeleport(state, m, def, rng, events))
        return;

      if (m.abilityCd > 0) {
        m.abilityCd -= 1; // basic turn: bolt in range/LOS, else close the gap
        if (seen && dist <= (def.rangedRange ?? 5))
          rangedAttack(state, m, def, events, rng);
        else chaseStep(state, m, def, events, rng, target);
        return;
      }

      // ability ready: summon (if adds are thin) or a telegraphed barrage
      const adds = state.monsters.filter(
        (x) => !monsterDef(x.defId).isBoss,
      ).length;
      if (
        adds < CONFIG.lich.summonCap &&
        rng.chance(CONFIG.lich.summonChance[phase])
      )
        lichSummon(state, m, phase, rng, events);
      else lichBarrage(state, phase, rng, events);
      m.abilityCd = CONFIG.lich.abilityCd[phase];
      return;
    }
    case "chase":
    default:
      if (m.state === "chase") chaseStep(state, m, def, events, rng, target);
      else moveRandom(state, m, def, rng, events);
      return;
  }
}

/**
 * On "survive" levels, trickle in reinforcements (every few turns, up to the
 * level's budget) so holding out is a real fight rather than a waiting game.
 */
/**
 * The current level's config with the run's active trials applied.
 *
 * Almost every runtime reader deliberately uses the RAW `LEVELS[...]` entry,
 * because trials only touch fields consumed during generation (see the invariant
 * on `Mutator.applyLevel`). The **siege is the exception**: it spawns monsters
 * mid-level, so it's the one runtime site that genuinely needs the mutated
 * `monsterBudget` and `eliteChance` — without this, Restless Dead couldn't size
 * the hold and Champions couldn't reach a single reinforcement.
 */
function effectiveConfig(state: GameState) {
  return applyLevelMutators(LEVELS[state.currentLevel], state.mutators ?? []);
}

/**
 * How many actual COMBATANTS are on the map — the number the siege cap governs.
 *
 * Ambient wildlife (`LevelConfig.ambient`: ravens, wisps, frogs) is placed
 * OUTSIDE `monsterBudget` on purpose — it's harmless atmosphere that drifts and
 * flees. It must be excluded here too, or a few decorative birds permanently
 * occupy siege capacity and throttle the reinforcement waves. On the Ramparts
 * that was 3 of 22 slots at baseline, and under Restless Dead (21 combatants +
 * 3 ravens = 24 vs a flat cap of 22) it killed the siege outright: `spawnWave`
 * bailed on turn one and not a single wave ever arrived.
 */
function combatantCount(state: GameState): number {
  let n = 0;
  for (const m of state.monsters)
    if (monsterDef(m.defId).behavior !== "ambient") n++;
  return n;
}

/** Spawn up to `count` monsters (from the level's spawn table) on a ring around
 * the player — close enough to close in within a few turns, never on top of you
 * or another monster. Respects a concurrent `cap`. Returns how many spawned.
 * Drives the survive-level siege (`maybeReinforce`). */
function spawnWave(
  state: GameState,
  rng: Rng,
  count: number,
  cap: number,
): number {
  if (combatantCount(state) >= cap) return 0;
  const config = effectiveConfig(state);
  const siege = CONFIG.siege;
  const { map, player } = state;
  const ring: number[] = [];
  const fallback: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    const t = map.tiles[i];
    if (t !== "floor" && t !== "trapSprung" && t !== "oil") continue;
    const d = chebyshev(
      i % map.width,
      Math.floor(i / map.width),
      player.x,
      player.y,
    );
    if (d >= siege.ringMin && d <= siege.ringMax) ring.push(i);
    else if (d > siege.ringMax) fallback.push(i);
  }
  const pool = ring.length ? ring : fallback;
  if (pool.length === 0) return 0;

  const total = config.spawnTable.reduce((s, e) => s + e.weight, 0);
  let spawned = 0;
  for (
    let n = 0;
    n < count && combatantCount(state) < cap && pool.length;
    n++
  ) {
    const spot = pool.splice(rng.int(0, pool.length - 1), 1)[0]; // no two on a tile
    const x = spot % map.width;
    const y = Math.floor(spot / map.width);
    if (monsterAt(state, x, y)) continue;
    let roll = rng.int(1, total);
    let chosen = config.spawnTable[0].monsterId;
    for (const e of config.spawnTable) {
      roll -= e.weight;
      if (roll <= 0) {
        chosen = e.monsterId;
        break;
      }
    }
    const def = monsterDef(chosen);
    const inst: MonsterInstance = {
      id: `rf${state.turnCount}_${state.monsters.length}`,
      defId: chosen,
      x,
      y,
      hp: def.maxHp,
      state: "chase", // they already know where you are
    };
    // Reinforcements roll for champion status exactly like the initial garrison
    // (mirrors generate.ts, but off the GAMEPLAY rng — this is a live spawn, not
    // map geometry). Without this a breach wave could never contain a champion
    // while the garrison it reinforces could, and Champions had no effect at all
    // on the one level where most enemies arrive as reinforcements.
    const eliteChance = config.eliteChance ?? 0;
    if (
      !def.isBoss &&
      eliteChance > 0 &&
      rng.int(1, 100) <= eliteChance * 100
    ) {
      const kind = ELITE_KINDS[rng.int(0, ELITE_KINDS.length - 1)];
      inst.elite = kind;
      inst.hp = Math.round(def.maxHp * ELITE[kind].hpMult);
    }
    state.monsters.push(inst);
    spawned++;
  }
  return spawned;
}

function maybeReinforce(state: GameState, rng: Rng, events: GameEvent[]) {
  const config = effectiveConfig(state);
  if (config.goal.type !== "survive") return;
  const siege = CONFIG.siege;
  if (state.turnCount % siege.waveEvery !== 0) return;

  // the horde grows as the hold wears on: 1 → 3 per wave near the end
  const progress = Math.min(1, state.turnCount / config.goal.turns);
  const waveSize = 1 + Math.floor(progress * 2);

  // The cap must sit ABOVE the level's starting population or there's no room
  // left to escalate into — the whole point of a siege. `siege.cap` is a floor,
  // not a ceiling: a level (or a trial like Restless Dead, which is why this
  // reads the MUTATED budget) that starts denser gets proportional headroom.
  // Without it, Restless Dead put the Ramparts at 21 of 22 and the rising waves
  // could only trickle in as fast as you killed — a frontloaded brawl, not a siege.
  const cap = Math.max(siege.cap, config.monsterBudget + siege.headroom);
  const spawned = spawnWave(state, rng, waveSize, cap);
  if (spawned > 1) msg(events, "The dead swarm the wall!");
  else if (spawned === 1) msg(events, "More of the dead surge onto the wall.");
}

function advanceMonsters(state: GameState, rng: Rng, events: GameEvent[]) {
  // Last turn's telegraphed barrage lands now — the player has had one turn to
  // step off the marked tiles.
  resolveBarrage(state, events);
  if (state.player.hp <= 0) return; // the barrage itself can be lethal
  const visible = new Set(state.visible);
  // snapshot the list: monsters don't die during their own phase
  for (const m of state.monsters.slice()) {
    if (state.player.hp <= 0) break;
    actMonster(state, m, visible, rng, events);
    // swift elites act twice (only while alerted, so they aren't a menace at rest)
    if (
      eliteMod(m)?.extraAction &&
      m.state === "chase" &&
      state.player.hp > 0 &&
      state.monsters.includes(m)
    ) {
      actMonster(state, m, visible, rng, events);
    }
  }
}

// ── log ──────────────────────────────────────────────────────────────────
function pushLog(state: GameState, events: GameEvent[]) {
  for (const e of events)
    if (e.kind === "message") state.messageLog.push(e.text);
  if (state.messageLog.length > CONFIG.messageLogMax) {
    state.messageLog = state.messageLog.slice(-CONFIG.messageLogMax);
  }
}

// ── the top-level turn resolution (mutates state in place) ──────────────────
export function resolveTurn(
  state: GameState,
  action: PlayerAction,
  rng: Rng,
): TurnResult {
  const events: GameEvent[] = [];
  const tookTurn = applyPlayerAction(state, action, events, rng);

  if (!tookTurn) {
    pushLog(state, events);
    return { tookTurn: false, goalComplete: false, playerDied: false, events };
  }

  state.turnCount += 1;
  state.player.totalTurns += 1; // run stat (across all levels)
  state.turnsLeft -= 1;

  // (1) Your decisive action ends the level right here — checked BEFORE the
  // end-of-turn hazard ticks — so a goal-completing blow can't be undone by
  // your own lingering fire or a DoT ticking out on the same turn you win.
  if (isGoalComplete(state)) {
    state.goalDone = true;
    recomputeFOV(state);
    pushLog(state, events);
    return { tookTurn: true, goalComplete: true, playerDied: false, events };
  }

  tickTorch(state, events);
  tickFires(state, events); // fire sears whoever stands in it, refreshing burn
  tickGas(state, events); // spore vents seep a poison haze around themselves
  tickEffects(state, events); // then the player's DoTs/buffs tick
  tickMonsterStatus(state, rng, events); // and every monster's debuffs tick
  tickFlood(state, events); // the crypt fills — water creeps into the floodable set
  // count the ability cooldown down — but NOT on the turn it was just used (a
  // refused/on-cooldown ability returns early above, so reaching here on an
  // "ability" turn means it fired and just set the cooldown).
  if (action.type !== "ability" && state.player.abilityCooldown > 0) {
    state.player.abilityCooldown -= 1;
  }
  recomputeFOV(state);
  senseTraps(state);

  // A passive end-of-turn tick (trap aftermath, fire, DoT) that drops you is a
  // death — even if that same tick also finished the objective. Only your own
  // action wins through a simultaneous death (handled by (1) above).
  if (state.player.hp <= 0) {
    pushLog(state, events);
    return {
      tookTurn: true,
      goalComplete: false,
      playerDied: true,
      deathReason: "combat",
      events,
    };
  }

  // (2) A tick-driven completion (e.g. a burn finished off the last enemy) —
  // you survived the ticks, so claim the win before monsters move.
  if (isGoalComplete(state)) {
    state.goalDone = true;
    pushLog(state, events);
    return { tookTurn: true, goalComplete: true, playerDied: false, events };
  }

  maybeReinforce(state, rng, events); // survive siege
  advanceMonsters(state, rng, events);

  if (state.player.hp <= 0) {
    pushLog(state, events);
    return {
      tookTurn: true,
      goalComplete: false,
      playerDied: true,
      deathReason: "combat",
      events,
    };
  }

  senseBrink(state, events); // warn if a shover could knock you into the void
  pushLog(state, events);
  return { tookTurn: true, goalComplete: false, playerDied: false, events };
}

/** Telegraph: after monsters move, if a knockback ("shover") monster is now
 * adjacent with a chasm/water directly at your back (and you're not floating),
 * warn — so you can reposition before it hurls you over the edge next turn. */
function senseBrink(state: GameState, events: GameEvent[]) {
  const p = state.player;
  if ((p.effects.levitate ?? 0) > 0) return; // floating — no fall risk
  for (const m of state.monsters) {
    const def = monsterDef(m.defId);
    if (!def.knockback) continue;
    if (m.x === p.x && m.y === p.y) continue;
    if (Math.abs(m.x - p.x) > 1 || Math.abs(m.y - p.y) > 1) continue; // adjacent
    const t = tileAt(
      state.map,
      p.x + Math.sign(p.x - m.x),
      p.y + Math.sign(p.y - m.y),
    );
    if (t === "chasm" || t === "water") {
      msg(events, `The ${def.name} looms — the void yawns at your back!`);
      return;
    }
  }
}
