import type { MonsterDef } from "@/game/core/types";

// Registry of monster definitions, keyed by id. Runtime instances are
// lightweight ({defId, hp, x, y, state}) and look up their def here.
export const MONSTERS: Record<string, MonsterDef> = {
  rat: {
    id: "rat",
    name: "Cave Rat",
    glyph: "r",
    color: "#9a7b4f",
    maxHp: 4,
    dmg: 1,
    armor: 0,
    behavior: "wander",
    sightRadius: 4,
    speed: 1,
    coinReward: 1,
  },
  bat: {
    id: "bat",
    name: "Shrieking Bat",
    glyph: "b",
    color: "#7a5cff",
    maxHp: 3,
    dmg: 1,
    armor: 0,
    behavior: "erratic",
    sightRadius: 4,
    speed: 1,
    coinReward: 1,
  },
  goblin: {
    id: "goblin",
    name: "Goblin",
    glyph: "g",
    color: "#3fbf3f",
    maxHp: 8,
    dmg: 3,
    armor: 0,
    behavior: "chase",
    sightRadius: 6,
    speed: 1,
    coinReward: 3,
  },
  skeleton: {
    id: "skeleton",
    name: "Skeleton",
    glyph: "s",
    color: "#d9d9d9",
    maxHp: 12,
    dmg: 4,
    armor: 0,
    behavior: "chase",
    sightRadius: 7,
    speed: 1,
    coinReward: 5,
  },
  zombie: {
    id: "zombie",
    name: "Rotting Zombie",
    glyph: "z",
    color: "#6f8f4f",
    maxHp: 16,
    dmg: 5,
    armor: 0,
    behavior: "chase", // slowChase is polish; treated as chase in core
    sightRadius: 6,
    speed: 1,
    coinReward: 6,
  },
  wraith: {
    id: "wraith",
    name: "Wraith",
    glyph: "w",
    color: "#59c2c2",
    maxHp: 14,
    dmg: 6,
    armor: 2,
    behavior: "chase",
    sightRadius: 8,
    speed: 1,
    coinReward: 8,
  },
  frost_troll: {
    id: "frost_troll",
    name: "Gorm, the Frost Troll",
    glyph: "T",
    color: "#a9e0ff",
    maxHp: 40,
    dmg: 8,
    armor: 1,
    behavior: "chase", // guardChase is polish
    sightRadius: 9,
    speed: 1,
    coinReward: 30,
    isBoss: true,
  },
  lich: {
    id: "lich",
    name: "Malachar the Lich-King",
    glyph: "M",
    color: "#c04cff",
    maxHp: 80,
    dmg: 12,
    armor: 2,
    behavior: "chase", // ranged bolt is polish
    sightRadius: 10,
    speed: 1,
    coinReward: 0,
    isBoss: true,
  },
};

export function monsterDef(id: string): MonsterDef {
  const def = MONSTERS[id];
  if (!def) throw new Error(`Unknown monster id: ${id}`);
  return def;
}
