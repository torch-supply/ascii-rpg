import type {
  GameState,
  ItemInstance,
  MonsterInstance,
  MonsterDef,
  PlayerAction,
  PlayerState,
  TurnResult,
} from "@/game/core/types";
import type { GameEvent } from "@/game/core/events";
import { Rng } from "@/game/core/rng";
import { idx, isWalkable, chebyshev } from "@/game/core/grid";
import { recomputeFOV, recomputeLight } from "@/game/core/state";
import { equipWeapon, equipArmor, addToBag } from "@/game/core/inventory";
import { isGoalComplete } from "@/game/core/goals";
import { playerAttackDamage, monsterAttackDamage } from "@/game/core/combat";
import { stepToward } from "@/game/core/map/pathfinding";
import { monsterDef } from "@/content/monsters";
import { ITEMS } from "@/content/items";
import { CONFIG } from "@/content/config";

const DIRS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// ── helpers ──────────────────────────────────────────────────────────────
function msg(events: GameEvent[], text: string) {
  events.push({ kind: "message", text });
}

function monsterAt(
  state: GameState,
  x: number,
  y: number,
  excludeId?: string
): MonsterInstance | undefined {
  return state.monsters.find(
    (m) => m.x === x && m.y === y && m.id !== excludeId
  );
}

function itemAt(state: GameState, x: number, y: number): ItemInstance | undefined {
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
      p.coins += v;
      msg(events, `You pick up ${v} gold.`);
      break;
    }
    case "weapon": {
      if ((def.power ?? 0) > p.weaponPower) {
        equipWeapon(p, def.id);
        msg(events, `You take up the ${def.name} and wield it (pow ${def.power}).`);
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
    case "torch": {
      p.hasTorch = true;
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

  state.items = state.items.filter((i) => i.id !== it.id);
}

// ── combat ─────────────────────────────────────────────────────────────────
function resolvePlayerAttack(
  state: GameState,
  target: MonsterInstance,
  events: GameEvent[]
) {
  const def = monsterDef(target.defId);
  const dmg = playerAttackDamage(state.player, def);
  target.hp -= dmg;
  events.push({ kind: "hit", x: target.x, y: target.y });
  if (target.hp <= 0) {
    msg(events, `You slay the ${def.name}.`);
    if (def.coinReward > 0) {
      state.player.coins += def.coinReward;
    }
    state.monsters = state.monsters.filter((m) => m.id !== target.id);
  } else {
    msg(events, `You strike the ${def.name} for ${dmg} (${target.hp} left).`);
  }
}

function resolveMonsterAttack(
  state: GameState,
  def: MonsterDef,
  events: GameEvent[]
) {
  const dmg = monsterAttackDamage(def, state.player);
  state.player.hp -= dmg;
  events.push({ kind: "hit", x: state.player.x, y: state.player.y });
  msg(events, `The ${def.name} hits you for ${dmg}.`);
}

// ── player action ────────────────────────────────────────────────────────
function movePlayer(
  state: GameState,
  dx: number,
  dy: number,
  events: GameEvent[]
): boolean {
  const p = state.player;
  const nx = p.x + dx;
  const ny = p.y + dy;

  const target = monsterAt(state, nx, ny);
  if (target) {
    resolvePlayerAttack(state, target, events);
    return true; // attacking costs a turn
  }
  if (!isWalkable(state.map, nx, ny)) {
    return false; // bumped a wall / water — no turn spent
  }
  p.x = nx;
  p.y = ny;
  springTrap(state, events);
  pickUp(state, events);
  return true;
}

/** Trigger a hidden trap under the player, revealing and spending it. */
function springTrap(state: GameState, events: GameEvent[]) {
  const i = idx(state.player.x, state.player.y, state.map.width);
  if (state.map.tiles[i] !== "trap") return;
  state.map.tiles[i] = "trapSprung";
  const dmg = Math.max(1, CONFIG.trapDamage - state.player.armorReduction);
  state.player.hp -= dmg;
  events.push({ kind: "hit", x: state.player.x, y: state.player.y });
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
  events: GameEvent[]
): boolean {
  const p = state.player;
  const entry = p.bag.find((b) => b.defId === defId);
  if (!entry) return false;
  const def = ITEMS[defId];
  if (def.category !== "potion") return false;

  if (def.effect === "bomb") {
    return throwFirebomb(state, entry, def, events);
  }
  if (def.effect === "heal" || def.effect === "greaterHeal") {
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + (def.magnitude ?? 0));
    msg(events, `You drink the ${def.name}. (+${p.hp - before} hp)`);
    entry.count -= 1;
    if (entry.count <= 0) p.bag = p.bag.filter((b) => b !== entry);
    return true; // drinking costs a turn
  }
  return false;
}

/**
 * Detonate a firebomb at (tx,ty): full damage to that tile, splash (half,
 * rounded up) to the 3x3 around it. Consumes the item, awards coins for kills.
 */
function detonateAt(
  state: GameState,
  entry: { defId: string; count: number },
  def: (typeof ITEMS)[string],
  tx: number,
  ty: number,
  events: GameEvent[]
): boolean {
  const p = state.player;
  events.push({
    kind: "projectile",
    from: { x: p.x, y: p.y },
    to: { x: tx, y: ty },
    glyph: "*",
  });

  const dmg = def.magnitude ?? 0;
  for (const m of state.monsters) {
    const d = chebyshev(m.x, m.y, tx, ty);
    if (d > 1) continue;
    m.hp -= d === 0 ? dmg : Math.ceil(dmg / 2);
    events.push({ kind: "hit", x: m.x, y: m.y });
  }

  let slain = 0;
  const survivors: MonsterInstance[] = [];
  for (const m of state.monsters) {
    if (m.hp <= 0) {
      const md = monsterDef(m.defId);
      if (md.coinReward > 0) p.coins += md.coinReward;
      slain++;
    } else {
      survivors.push(m);
    }
  }
  state.monsters = survivors;

  msg(events, `The ${def.name} bursts into flame!${slain ? ` ${slain} slain.` : ""}`);
  entry.count -= 1;
  if (entry.count <= 0) p.bag = p.bag.filter((b) => b !== entry);
  return true;
}

/** Auto-target the nearest visible monster (used as a fallback). */
function throwFirebomb(
  state: GameState,
  entry: { defId: string; count: number },
  def: (typeof ITEMS)[string],
  events: GameEvent[]
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
  return detonateAt(state, entry, def, target.x, target.y, events);
}

/** Throw a firebomb at a chosen tile (cursor targeting). */
function throwFirebombAt(
  state: GameState,
  defId: string,
  tx: number,
  ty: number,
  events: GameEvent[]
): boolean {
  const entry = state.player.bag.find((b) => b.defId === defId);
  if (!entry) return false;
  const def = ITEMS[defId];
  if (def.category !== "potion" || def.effect !== "bomb") return false;
  if (chebyshev(state.player.x, state.player.y, tx, ty) > CONFIG.throwRange)
    return false;
  return detonateAt(state, entry, def, tx, ty, events);
}

function equipFromBag(
  state: GameState,
  defId: string,
  events: GameEvent[]
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
function applyPlayerAction(
  state: GameState,
  action: PlayerAction,
  events: GameEvent[]
): boolean {
  switch (action.type) {
    case "wait":
      return true;
    case "move":
      return movePlayer(state, action.dx, action.dy, events);
    case "equip":
      return equipFromBag(state, action.defId, events);
    case "useItem":
      return useItem(state, action.defId, events);
    case "throwAt":
      return throwFirebombAt(state, action.defId, action.x, action.y, events);
  }
}

// ── monster phase ────────────────────────────────────────────────────────
function monsterMoveTo(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  nx: number,
  ny: number,
  events: GameEvent[]
) {
  if (nx === state.player.x && ny === state.player.y) {
    resolveMonsterAttack(state, def, events);
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
  events: GameEvent[]
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
      resolveMonsterAttack(state, def, events);
      return;
    }
    if (isWalkable(state.map, nx, ny) && !monsterAt(state, nx, ny, m.id)) {
      m.x = nx;
      m.y = ny;
      return;
    }
  }
}

function chaseStep(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  events: GameEvent[]
) {
  const step = stepToward(
    state.map,
    { x: m.x, y: m.y },
    { x: state.player.x, y: state.player.y }
  );
  if (step) monsterMoveTo(state, m, def, step.x, step.y, events);
}

function rangedAttack(
  state: GameState,
  m: MonsterInstance,
  def: MonsterDef,
  events: GameEvent[]
) {
  const dmg = Math.max(1, (def.rangedDmg ?? def.dmg) - state.player.armorReduction);
  state.player.hp -= dmg;
  events.push({
    kind: "projectile",
    from: { x: m.x, y: m.y },
    to: { x: state.player.x, y: state.player.y },
    glyph: "•",
  });
  events.push({ kind: "hit", x: state.player.x, y: state.player.y });
  msg(events, `The ${def.name} hurls a bolt for ${dmg}.`);
}

function actMonster(
  state: GameState,
  m: MonsterInstance,
  visible: Set<number>,
  rng: Rng,
  events: GameEvent[]
) {
  const def = monsterDef(m.defId);
  const p = state.player;
  const dist = chebyshev(m.x, m.y, p.x, p.y);
  const seen = visible.has(idx(m.x, m.y, state.map.width));

  // Chasers wake (and stay awake) once they spot the player in line of sight.
  const isChaser = def.behavior !== "wander" && def.behavior !== "erratic";
  if (isChaser && seen && dist <= def.sightRadius) m.state = "chase";

  switch (def.behavior) {
    case "wander":
      moveRandom(state, m, def, rng, events);
      return;
    case "erratic":
      if (rng.chance(0.85)) moveRandom(state, m, def, rng, events);
      return;
    case "slowChase":
      // shambles: acts only every other turn
      if (state.turnCount % 2 === 1) return;
      if (m.state === "chase") chaseStep(state, m, def, events);
      else moveRandom(state, m, def, rng, events);
      return;
    case "guardChase":
      // holds its ground until it spots you, then pursues relentlessly
      if (m.state === "chase") chaseStep(state, m, def, events);
      return;
    case "ranged":
      if (m.state === "chase") {
        if (seen && dist <= (def.rangedRange ?? 4)) rangedAttack(state, m, def, events);
        else chaseStep(state, m, def, events);
      }
      return;
    case "chase":
    default:
      if (m.state === "chase") chaseStep(state, m, def, events);
      else moveRandom(state, m, def, rng, events);
      return;
  }
}

function advanceMonsters(state: GameState, rng: Rng, events: GameEvent[]) {
  const visible = new Set(state.visible);
  // snapshot the list: monsters don't die during their own phase
  for (const m of state.monsters.slice()) {
    if (state.player.hp <= 0) break;
    actMonster(state, m, visible, rng, events);
  }
}

// ── log ──────────────────────────────────────────────────────────────────
function pushLog(state: GameState, events: GameEvent[]) {
  for (const e of events) if (e.kind === "message") state.messageLog.push(e.text);
  if (state.messageLog.length > CONFIG.messageLogMax) {
    state.messageLog = state.messageLog.slice(-CONFIG.messageLogMax);
  }
}

// ── the top-level turn resolution (mutates state in place) ──────────────────
export function resolveTurn(
  state: GameState,
  action: PlayerAction,
  rng: Rng
): TurnResult {
  const events: GameEvent[] = [];
  const tookTurn = applyPlayerAction(state, action, events);

  if (!tookTurn) {
    pushLog(state, events);
    return { tookTurn: false, goalComplete: false, playerDied: false, events };
  }

  state.turnCount += 1;
  state.turnsLeft -= 1;
  tickTorch(state, events);
  recomputeFOV(state);

  // Completing your objective happens on your turn, before monsters act.
  if (isGoalComplete(state)) {
    state.goalDone = true;
    pushLog(state, events);
    return { tookTurn: true, goalComplete: true, playerDied: false, events };
  }

  // A trap (or a firebomb misfire) can be lethal before monsters even move.
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

  if (state.turnsLeft <= 0) {
    msg(events, "Time runs out — the dark closes in.");
    pushLog(state, events);
    return {
      tookTurn: true,
      goalComplete: false,
      playerDied: true,
      deathReason: "timeout",
      events,
    };
  }

  pushLog(state, events);
  return { tookTurn: true, goalComplete: false, playerDied: false, events };
}
