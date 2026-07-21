import type { BagEntry } from "@/game/core/types";
import { CONFIG } from "@/content/config";

// Character classes — a starting kit + a couple of passive traits, picked on a
// New Game. Data-driven like levels/monsters/items; `createPlayer(classId)`
// applies the kit, and the traits are read at their combat sites (see below).
export interface ClassDef {
  id: string;
  name: string;
  glyph: string; // shown on the picker card
  color: string;
  blurb: string; // one-line playstyle for the picker
  weaponId: string; // starting (equipped) weapon
  armorId: string; // starting (equipped) armor
  bag: BagEntry[]; // starting consumables / ammo
  maxHp: number;
  // ── passives (all optional; a class with none is just a kit) ──
  /** flat damage shaved off enemy melee + ranged hits (min-1 floor kept) */
  damageReduction?: number;
  /** overrides CONFIG.sneakMultiplier for this player's sneak attacks */
  sneakMultiplier?: number;
  /** 0–1 chance a landed melee/ranged blow deals double */
  critChance?: number;
  /** extra damage added to this player's thrown firebombs */
  bombPower?: number;
}

export const CLASSES: Record<string, ClassDef> = {
  // Neutral baseline — the plain starting kit, no passives. Not shown in the
  // picker; it's the no-class default for tests, the dev jump, and legacy saves.
  wanderer: {
    id: "wanderer",
    name: "Wanderer",
    glyph: "@",
    color: "#d9d9d9",
    blurb: "A plain start.",
    weaponId: CONFIG.startingWeaponId,
    armorId: CONFIG.startingArmorId,
    bag: [],
    maxHp: CONFIG.startingMaxHp,
  },
  warrior: {
    id: "warrior",
    name: "Warrior",
    glyph: "⚔",
    color: "#e0c060",
    blurb: "Sword + armor, hardy. Shrugs off blows — a forgiving front-liner.",
    weaponId: "w_short",
    armorId: "a_leather",
    bag: [{ defId: "p_heal", count: 1 }],
    maxHp: 26,
    damageReduction: 1,
  },
  rogue: {
    id: "rogue",
    name: "Rogue",
    glyph: "†",
    color: "#7fe0ff",
    blurb: "Fragile, deadly from the dark. Triple sneak damage + crits.",
    weaponId: "w_dagger",
    armorId: "a_leather",
    bag: [{ defId: "p_detect", count: 1 }],
    maxHp: 16,
    sneakMultiplier: 3,
    critChance: 0.2,
  },
  pyromancer: {
    id: "pyromancer",
    name: "Pyromancer",
    glyph: "✷",
    color: "#ff8c3a",
    blurb: "Bombs + bolts. Fights at range and burns rooms down.",
    weaponId: "w_bow",
    armorId: "a_rags",
    bag: [
      { defId: "am_arrow", count: 12 },
      { defId: "p_bomb", count: 2 },
    ],
    maxHp: 18,
    bombPower: 6,
  },
};

/** The pickable classes, ordered for the picker (and 1/2/3 hotkeys). Excludes
 * the neutral "wanderer" baseline. */
export const CLASS_LIST = [CLASSES.warrior, CLASSES.rogue, CLASSES.pyromancer];
export const DEFAULT_CLASS_ID = "wanderer";

/** Look up a class def, falling back to the default for unknown/legacy ids. */
export function classDef(id: string | undefined): ClassDef {
  return (id && CLASSES[id]) || CLASSES[DEFAULT_CLASS_ID];
}
