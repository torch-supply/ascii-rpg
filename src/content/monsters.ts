import type { MonsterDef, EliteKind } from "@/game/core/types";

// Elite/champion modifiers applied to an ordinary monster at spawn. Each rolls
// onto a random regular monster (never a boss) at a level's `eliteChance`.
export interface EliteMod {
  label: string;
  hpMult: number;
  armorBonus: number; // extra armor vs. the player's blows
  dmgBonus: number; // extra damage on its attacks
  extraAction: boolean; // acts twice per turn
  explodes: boolean; // bursts on death (see CONFIG.eliteExplodeDamage)
  color: string; // glyph tint so the player can spot the threat
}

export const ELITE: Record<EliteKind, EliteMod> = {
  brute: {
    label: "Brute",
    hpMult: 1.8,
    armorBonus: 3,
    dmgBonus: 2,
    extraAction: false,
    explodes: false,
    color: "#f0b038",
  },
  swift: {
    label: "Swift",
    hpMult: 1.2,
    armorBonus: 0,
    dmgBonus: 0,
    extraAction: true,
    explodes: false,
    color: "#7fe0ff",
  },
  volatile: {
    label: "Volatile",
    hpMult: 1.3,
    armorBonus: 0,
    dmgBonus: 0,
    extraAction: false,
    explodes: true,
    color: "#ff6a3c",
  },
};

export const ELITE_KINDS = Object.keys(ELITE) as EliteKind[];

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
  spider: {
    id: "spider",
    name: "Giant Spider",
    glyph: "x",
    color: "#a06a4f",
    maxHp: 6,
    dmg: 2,
    armor: 0,
    behavior: "chase",
    sightRadius: 6,
    speed: 1,
    coinReward: 1,
    inflicts: { effect: "poison", chance: 0.4, duration: 6 },
  },
  imp: {
    id: "imp",
    name: "Bog Imp",
    glyph: "i",
    color: "#ff8c3a",
    maxHp: 5,
    dmg: 2,
    armor: 0,
    behavior: "ranged",
    sightRadius: 6,
    speed: 1,
    coinReward: 2,
    rangedDmg: 3,
    rangedRange: 4,
    rangedCooldown: 2, // reload two turns between bolts — fire every 3rd turn (eases crossfire)
    inflicts: { effect: "poison", chance: 0.3, duration: 5 },
  },
  wisp: {
    id: "wisp",
    name: "Will-o'-Wisp",
    glyph: "✦",
    color: "#9fe8d0", // pale, cold witch-light
    glow: [96, 196, 176], // a small drifting light source (+ bloom)
    maxHp: 1,
    dmg: 0, // harmless — never attacks
    armor: 0,
    behavior: "ambient", // drifts, flees when you near it, guttering out if caught
    sightRadius: 5, // doubles as its "shy radius": flees within this
    speed: 1,
    coinReward: 0,
  },
  // ── ambient wildlife (non-hostile: drift, flee, disperse harmlessly) ──
  raven: {
    id: "raven",
    name: "Carrion Raven",
    glyph: "v",
    color: "#5a5a64", // sooty black — carrion birds wheeling over the dead
    maxHp: 1,
    dmg: 0,
    armor: 0,
    behavior: "ambient",
    sightRadius: 5,
    speed: 1,
    coinReward: 0,
  },
  marsh_frog: {
    id: "marsh_frog",
    name: "Mire Frog",
    glyph: "f",
    color: "#6a9a4a", // mossy green — plops away into the bog
    maxHp: 1,
    dmg: 0,
    armor: 0,
    behavior: "ambient",
    sightRadius: 4, // less shy — lets you get closer before it bolts
    speed: 1,
    coinReward: 0,
  },
  snow_hare: {
    id: "snow_hare",
    name: "Snow Hare",
    glyph: "h",
    color: "#c9bda2", // pale tan — a flash of life bolting across the dead pass
    maxHp: 1,
    dmg: 0,
    armor: 0,
    behavior: "ambient",
    sightRadius: 6, // very skittish — bolts from far off
    speed: 1,
    coinReward: 0,
  },
  // GARRISONS CAME DOWN ~20% GAME-WIDE, so each remaining monster had to carry
  // more — kill rewards are 22–80% of a run's income, and cutting bodies without
  // compensating would quietly gut the economy.
  //
  // `coinReward` was the obvious lever and turned out to be the WRONG one. Raised
  // alongside everything else it put run income at 240g against a 193g baseline —
  // the opposite of lean — and backing it out entirely landed at 188g with the
  // carried-run gate IMPROVED (2/2/3 → 3/2/3). The compensation was already being
  // done by the two dials below: elites pay double and drop guaranteed loot, so
  // raising `eliteChance` is itself an income raise, and richer drop tables carry
  // `c_gold`. Three dials pushing one number is how you overshoot without seeing
  // it; measure each before stacking the next.
  //
  // What DID move: drop chances across the mid tier (goblin .10→.15, skeleton /
  // zombie / ghoul .12→.16, wraith .16→.22, gargoyle .20→.28), as part of moving
  // loot off the open floor. A monster is an out-of-the-way place too — you have
  // to beat it — and it pairs with the smaller garrisons: fewer bodies, each one
  // worth killing, rather than a crowd you walk past. Trash (rat/bat/spider)
  // keeps `coinReward: 1` and no drop at all: it should still read as not worth
  // the turn.
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
    coinReward: 2,
    opensDoors: true, // goblins are clever enough to work a latch
    loot: { chance: 0.15, table: [{ itemId: "p_heal", weight: 1 }] },
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
    coinReward: 3,
    loot: {
      chance: 0.16,
      table: [
        { itemId: "p_heal", weight: 3 },
        { itemId: "a_leather", weight: 1 },
      ],
    },
  },
  zombie: {
    id: "zombie",
    name: "Rotting Zombie",
    glyph: "z",
    color: "#6f8f4f",
    maxHp: 16,
    dmg: 5,
    armor: 0,
    behavior: "slowChase", // shambles — acts every other turn
    sightRadius: 6,
    speed: 1,
    coinReward: 3,
    loot: { chance: 0.16, table: [{ itemId: "p_heal", weight: 1 }] },
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
    coinReward: 4,
    armorPierce: 2, // its touch slips past armor
    /**
     * Bleed at 0.25, down from 0.5.
     *
     * The wraith stacks three multipliers — high base damage, armour pierce, and
     * the heaviest DoT in the game (3/turn × 4 = 12, vs poison's and burn's 8) —
     * and against a chainmail Warrior it was landing 5 + 12 while its own spawn
     * table (ghoul, skeleton, goblin) landed 1. A 40-seed sweep found the bleed
     * was doing essentially ALL of that work: deleting it took the Great Hall
     * from 53% to 93% and the Crypt from 40% to 70%, while shaving base damage
     * 6→5 bought only +4. At 0.5 the refresh rate meant a wraith fight was simply
     * a bleeding fight; at 0.25 it's a real risk you can sometimes dodge.
     *
     * Left alone deliberately: `dmgPerTurn` (shared with brambles and the bear)
     * and `armorPierce` — the latter is the wraith's whole identity as the answer
     * to over-armouring, and note the balance harness CANNOT measure it, since
     * the bot wears leather (1) and `max(0, 1−2) === max(0, 1−1)`.
     */
    inflicts: { effect: "bleed", chance: 0.25, duration: 4 },
    loot: {
      chance: 0.22,
      table: [
        { itemId: "p_gheal", weight: 2 },
        { itemId: "p_ward", weight: 1 },
      ],
    },
  },
  ghoul: {
    id: "ghoul",
    name: "Ghoul",
    glyph: "u",
    color: "#b9c2a0",
    maxHp: 10,
    dmg: 4,
    armor: 0,
    behavior: "chase",
    sightRadius: 6,
    speed: 1,
    coinReward: 3,
    loot: { chance: 0.16, table: [{ itemId: "p_heal", weight: 2 }] },
  },
  gargoyle: {
    id: "gargoyle",
    name: "Gargoyle Sentinel",
    glyph: "y",
    color: "#8a8f99",
    maxHp: 22,
    dmg: 6,
    armor: 2,
    behavior: "guardChase", // still as stone until you draw near
    knockback: true, // a stone brute — its blow hurls you back (off a ledge = a fall)
    sightRadius: 8,
    speed: 1,
    coinReward: 5,
    loot: {
      chance: 0.28,
      table: [
        { itemId: "p_gheal", weight: 2 },
        { itemId: "a_scale", weight: 1 },
      ],
    },
  },
  cave_bear: {
    id: "cave_bear",
    name: "Hoarfrost Bear",
    glyph: "B",
    color: "#cdbba4", // shaggy pale pelt, frost-matted
    maxHp: 28,
    dmg: 7,
    armor: 1,
    // dormant in its den until you break in and draw near — a hibernating
    // beast, not a patrol. Pairs with `secretVault.guardian`.
    behavior: "guardChase",
    sightRadius: 7,
    speed: 1,
    coinReward: 8,
    miniBoss: true, // a real fight — earns an HP bar when it wakes
    inflicts: { effect: "bleed", chance: 0.4, duration: 5 }, // raking claws
    loot: {
      chance: 1,
      table: [
        { itemId: "p_gheal", weight: 2 },
        { itemId: "a_chain", weight: 1 },
      ],
    },
  },
  // The Gate Warden holds the far end of the gatehouse. dmg was 7 and made the Iron
  // Gate the outlier of the whole run — 13% bot win-rate at 52 seeds against 44-52%
  // for its peers. dmg 6 lands it at 42%, in line with the Great Hall / Crypt /
  // Antechamber. Measured alternatives, all rejected: dmg 5 → 71% (easier than the
  // Frostspine, too far); thinning the gargoyle escort → no win-rate effect at all
  // (it only softened punishment: median end-HP 5 → 12); and pairing dmg 6 with more
  // HP to keep it a "step up" from the Frost Troll → 42 HP crashed it back to 15%,
  // 48 HP to 12%, because a greedy melee bot cannot out-trade a tankier boss.
  //
  // So it now reads a shade under the Frost Troll on paper (hp 34/dmg 6 vs 36/dmg 6).
  // That's deliberate: the escalation here is the LEVEL — a gatehouse you cross under
  // fire with a gargoyle escort — not a bigger statline.
  gate_captain: {
    id: "gate_captain",
    name: "Gate Warden",
    glyph: "C",
    color: "#d24a4a",
    maxHp: 34,
    dmg: 6,
    armor: 1,
    behavior: "guardChase",
    sightRadius: 9,
    speed: 1,
    coinReward: 12,
    isBoss: false, // an elite gate guard, not a unique boss — several can hold the gate
    miniBoss: true, // still tough — gets a small HP bar in view
    opensDoors: true, // a warden won't be stopped by a shut door
    loot: {
      chance: 1,
      table: [
        { itemId: "p_gheal", weight: 2 },
        { itemId: "a_scale", weight: 1 },
        { itemId: "w_mace", weight: 1 },
      ],
    },
  },
  herald: {
    id: "herald",
    name: "Malachar's Herald",
    glyph: "H",
    color: "#c86bff",
    maxHp: 30,
    dmg: 6,
    armor: 1,
    behavior: "ranged",
    sightRadius: 10,
    speed: 1,
    coinReward: 12,
    isBoss: true,
    opensDoors: true,
    rangedDmg: 7,
    rangedRange: 5,
    loot: {
      chance: 1,
      table: [
        { itemId: "p_gheal", weight: 2 },
        { itemId: "p_ruin", weight: 1 },
        { itemId: "i_lantern", weight: 1 },
      ],
    },
  },
  frost_troll: {
    id: "frost_troll",
    name: "Gorm, the Frost Troll",
    glyph: "T",
    color: "#a9e0ff",
    maxHp: 36,
    dmg: 6,
    armor: 1,
    behavior: "guardChase", // guards the bridge until it spots you
    // You cannot freeze a thing made of frost. Chill makes a monster skip its
    // turn, and the Frostbrand refreshes it (chance 0.5, duration 3) while it is
    // still frozen — measured, Gorm spent 55% of the fight unable to act, and
    // the WEAKER Frostbrand (power 7) left you on 22 HP where the stronger War
    // Axe (power 8) left you on 6. Halving it takes that to 16% and 10 HP: the
    // blade still bites a little, so you learn it is RESISTED rather than
    // broken, but it stops being the answer to the one enemy it should not be.
    resist: { chill: 0.5 },
    sightRadius: 9,
    speed: 1,
    coinReward: 16,
    isBoss: true,
    loot: {
      chance: 1,
      table: [
        { itemId: "p_gheal", weight: 2 },
        { itemId: "w_axe", weight: 1 },
        { itemId: "a_chain", weight: 1 },
      ],
    },
  },
  lich: {
    id: "lich",
    name: "Malachar the Lich-King",
    glyph: "M",
    color: "#c04cff",
    maxHp: 80,
    dmg: 12,
    armor: 2,
    behavior: "bossLich", // phased finale: bolts, barrages, summons, blink
    sightRadius: 10,
    speed: 1,
    coinReward: 0,
    isBoss: true,
    opensDoors: true,
    rangedDmg: 9,
    rangedRange: 5,
  },
};

export function monsterDef(id: string): MonsterDef {
  const def = MONSTERS[id];
  if (!def) throw new Error(`Unknown monster id: ${id}`);
  return def;
}
