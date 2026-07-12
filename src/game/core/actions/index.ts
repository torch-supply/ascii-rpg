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

function equipWeapon(p: PlayerState, defId: string) {
  const def = ITEMS[defId];
  p.weaponId = defId;
  p.weaponPower = def.power ?? 0;
}

function equipArmor(p: PlayerState, defId: string) {
  const def = ITEMS[defId];
  p.armorId = defId;
  p.armorReduction = def.reduction ?? 0;
}

function addToBag(p: PlayerState, defId: string) {
  const def = ITEMS[defId];
  if (def.stackable) {
    const entry = p.bag.find((b) => b.defId === defId);
    if (entry) {
      entry.count += 1;
      return;
    }
  }
  p.bag.push({ defId, count: 1 });
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
    return false; // bumped a wall — no turn spent
  }
  p.x = nx;
  p.y = ny;
  pickUp(state, events);
  return true;
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

  if (def.effect === "heal" || def.effect === "greaterHeal") {
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + (def.magnitude ?? 0));
    msg(events, `You drink the ${def.name}. (+${p.hp - before} hp)`);
  } else {
    // Firebomb targeting is polish; not usable in the core loop yet.
    msg(events, `You aren't sure how to use the ${def.name} yet.`);
    return false;
  }

  entry.count -= 1;
  if (entry.count <= 0) p.bag = p.bag.filter((b) => b !== entry);
  return true; // drinking costs a turn
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

  switch (def.behavior) {
    case "wander":
      moveRandom(state, m, def, rng, events);
      return;
    case "erratic":
      if (rng.chance(0.85)) moveRandom(state, m, def, rng, events);
      return;
    default: {
      // chase / guardChase / slowChase / ranged all treated as line-chasers
      // for the core loop: notice the player within sight + LOS, then pursue.
      if (seen && dist <= def.sightRadius) m.state = "chase";
      if (m.state === "chase") {
        const step = stepToward(
          state.map,
          { x: m.x, y: m.y },
          { x: p.x, y: p.y }
        );
        if (step) monsterMoveTo(state, m, def, step.x, step.y, events);
      } else {
        moveRandom(state, m, def, rng, events);
      }
      return;
    }
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
    return { tookTurn: false, goalComplete: false, playerDied: false };
  }

  state.turnCount += 1;
  state.turnsLeft -= 1;
  recomputeFOV(state);

  // Completing your objective happens on your turn, before monsters act.
  if (isGoalComplete(state)) {
    state.goalDone = true;
    pushLog(state, events);
    return { tookTurn: true, goalComplete: true, playerDied: false };
  }

  advanceMonsters(state, rng, events);

  if (state.player.hp <= 0) {
    pushLog(state, events);
    return {
      tookTurn: true,
      goalComplete: false,
      playerDied: true,
      deathReason: "combat",
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
    };
  }

  pushLog(state, events);
  return { tookTurn: true, goalComplete: false, playerDied: false };
}
