import type { ItemDef, ItemCategory } from "@/game/core/types";
import { CONFIG } from "@/content/config";

// Registry of item definitions, keyed by id.
export const ITEMS: Record<string, ItemDef> = {
  // ── weapons ──
  w_dagger: { id: "w_dagger", name: "Rusty Dagger", glyph: "/", color: "#b0b0b0", category: "weapon", stackable: false, power: 3 },
  w_short: { id: "w_short", name: "Short Sword", glyph: "/", color: "#e0e0e0", category: "weapon", stackable: false, power: 5 },
  w_mace: { id: "w_mace", name: "Flanged Mace", glyph: "/", color: "#c9c9d2", category: "weapon", stackable: false, power: 6, knockback: 1 },
  w_axe: { id: "w_axe", name: "War Axe", glyph: "/", color: "#f0d0a0", category: "weapon", stackable: false, power: 8 },
  w_frost: { id: "w_frost", name: "Frostbrand", glyph: "/", color: "#a9e0ff", category: "weapon", stackable: false, power: 7, onHit: { effect: "chill", chance: 0.5, duration: 3 } },
  w_bow: { id: "w_bow", name: "Hunter's Bow", glyph: ")", color: "#c9a06a", category: "weapon", stackable: false, power: 6, ranged: { range: 6, ammoId: "am_arrow" } },
  w_ench: { id: "w_ench", name: "Enchanted Blade", glyph: "/", color: "#9fdfff", category: "weapon", stackable: false, power: 12 },
  w_sun: { id: "w_sun", name: "The Sunblade", glyph: "/", color: "#ffe14d", category: "weapon", stackable: false, power: 18, questTag: "sunblade" },

  // ── armor ──
  a_rags: { id: "a_rags", name: "Tattered Rags", glyph: "[", color: "#8a7a5a", category: "armor", stackable: false, reduction: 0 },
  a_leather: { id: "a_leather", name: "Leather Armor", glyph: "[", color: "#cd7f32", category: "armor", stackable: false, reduction: 1 },
  a_chain: { id: "a_chain", name: "Chainmail", glyph: "[", color: "#c0c0c8", category: "armor", stackable: false, reduction: 2 },
  a_scale: { id: "a_scale", name: "Scale Mail", glyph: "[", color: "#b8c0b0", category: "armor", stackable: false, reduction: 3 },
  a_plate: { id: "a_plate", name: "Plate Armor", glyph: "[", color: "#e8e8f0", category: "armor", stackable: false, reduction: 4 },

  // ── potions (polish; usable but not required for the core loop) ──
  p_heal: { id: "p_heal", name: "Healing Potion", glyph: "!", color: "#ff5fa2", category: "potion", stackable: true, effect: "heal", magnitude: 10 },
  p_gheal: { id: "p_gheal", name: "Greater Healing", glyph: "!", color: "#ff8fd0", category: "potion", stackable: true, effect: "greaterHeal", magnitude: 20 },
  p_bomb: { id: "p_bomb", name: "Firebomb", glyph: "¤", color: "#ff8c00", category: "potion", stackable: true, effect: "bomb", magnitude: 15 },
  p_ruin: { id: "p_ruin", name: "Vial of Ruin", glyph: "!", color: "#ff5a3c", category: "potion", stackable: true, effect: "blast", magnitude: 14 },
  p_ward: { id: "p_ward", name: "Potion of Warding", glyph: "!", color: "#7fb0ff", category: "potion", stackable: true, effect: "ward", duration: 12 },
  p_might: { id: "p_might", name: "Elixir of Might", glyph: "!", color: "#ff9d3c", category: "potion", stackable: true, effect: "might", duration: 12 },
  p_antidote: { id: "p_antidote", name: "Antidote", glyph: "!", color: "#7fdf6a", category: "potion", stackable: true, effect: "cleanse" },
  p_detect: { id: "p_detect", name: "Draught of Seeing", glyph: "!", color: "#c86bff", category: "potion", stackable: true, effect: "detect" },
  p_levit: { id: "p_levit", name: "Draught of Levitation", glyph: "!", color: "#a9d8ff", category: "potion", stackable: true, effect: "levitate", duration: 16 },
  p_ember: { id: "p_ember", name: "Emberstep Draught", glyph: "!", color: "#ff7a3c", category: "potion", stackable: true, effect: "emberstep", duration: 12 },
  p_rime: { id: "p_rime", name: "Rimewalk Draught", glyph: "!", color: "#bfe8ff", category: "potion", stackable: true, effect: "frostwalk", duration: 14 },
  p_shadow: { id: "p_shadow", name: "Shadowcloak Draught", glyph: "!", color: "#7a6cff", category: "potion", stackable: true, effect: "shadow", duration: 14 },
  p_blink: { id: "p_blink", name: "Phial of Blinking", glyph: "!", color: "#c86bff", category: "potion", stackable: true, effect: "blink" },

  // ── ammunition (bundles; `value` = arrows per pickup/purchase) ──
  am_arrow: { id: "am_arrow", name: "Arrows", glyph: "»", color: "#d0c0a0", category: "ammo", stackable: true, value: 12 },

  // ── coins ──
  c_gold: { id: "c_gold", name: "Gold", glyph: "$", color: "#ffd700", category: "coin", stackable: true, value: 10 },

  // ── torches (light + fuel) ──
  i_torch: { id: "i_torch", name: "Torch", glyph: "(", color: "#ff8c00", category: "torch", stackable: false, lightBonus: 3, fuel: 150 },
  i_lantern: { id: "i_lantern", name: "Lantern", glyph: "(", color: "#ffd24d", category: "torch", stackable: false, lightBonus: 4, fuel: 280 },

  // ── quest items ──
  q_shard: { id: "q_shard", name: "Moonstone Shard", glyph: "*", color: "#7fdfff", category: "quest", stackable: true, questTag: "moonstone" },
  q_sigil: { id: "q_sigil", name: "Dusk Sigil", glyph: "*", color: "#c86bff", category: "quest", stackable: true, questTag: "sigil" },
};

export function itemDef(id: string): ItemDef {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item id: ${id}`);
  return def;
}

// ── Selling ─────────────────────────────────────────────────────────────────
/** Categories the shop will buy back (equipped gear isn't in the bag, so it's
 * never sellable; quest items and loose coins can't be sold). */
export const SELLABLE: ReadonlySet<ItemCategory> = new Set<ItemCategory>([
  "weapon",
  "armor",
  "potion",
  "torch",
  "ammo",
]);

/** A rough gold worth for an item, derived from its category + stats. */
export function baseValue(def: ItemDef): number {
  switch (def.category) {
    case "weapon":
      return 6 + (def.power ?? 0) * 4;
    case "armor":
      return 8 + (def.reduction ?? 0) * 10;
    case "potion":
      return 12;
    case "torch":
      return 12;
    case "ammo":
      return 4;
    default: // coin / quest — not sellable
      return 0;
  }
}

/** What the shop pays for one of `def` (0 if it won't buy the item). */
export function sellPrice(def: ItemDef): number {
  if (!SELLABLE.has(def.category)) return 0;
  return Math.max(1, Math.round(baseValue(def) * CONFIG.sellRate));
}

// ── Shop tiers (polish — designed in now, wired up in Phase 2) ──────────────
export interface ShopEntry {
  itemId: string;
  price: number;
  maxQty?: number;
}
// One shop per between-level transition (9 for a 10-level run). Gear unlocks
// climb (short→mace→axe→enchanted; leather→chain→scale→plate); potions and
// firebombs restock; torch/lantern for the dark stretches.
export const SHOP_TIERS: Record<number, ShopEntry[]> = {
  1: [
    { itemId: "w_short", price: 15 },
    { itemId: "w_bow", price: 26 },
    { itemId: "am_arrow", price: 8 },
    { itemId: "a_leather", price: 12 },
    { itemId: "p_heal", price: 8, maxQty: 3 },
    { itemId: "i_torch", price: 10 },
  ],
  2: [
    { itemId: "w_mace", price: 24 },
    { itemId: "p_rime", price: 26, maxQty: 1 },
    { itemId: "a_leather", price: 12 },
    { itemId: "p_heal", price: 8, maxQty: 3 },
    { itemId: "p_antidote", price: 10, maxQty: 2 },
    { itemId: "p_bomb", price: 20, maxQty: 2 },
  ],
  3: [
    { itemId: "w_axe", price: 34 },
    { itemId: "w_frost", price: 28 },
    { itemId: "a_chain", price: 25 },
    { itemId: "am_arrow", price: 8 },
    { itemId: "i_lantern", price: 30 },
    { itemId: "p_gheal", price: 18, maxQty: 2 },
    { itemId: "p_bomb", price: 20, maxQty: 2 },
    { itemId: "p_levit", price: 30, maxQty: 1 },
  ],
  4: [
    { itemId: "a_chain", price: 25 },
    { itemId: "p_gheal", price: 18, maxQty: 2 },
    { itemId: "p_ward", price: 16, maxQty: 2 },
    { itemId: "p_bomb", price: 20, maxQty: 3 },
    { itemId: "p_ember", price: 26, maxQty: 1 },
    { itemId: "i_torch", price: 10 },
  ],
  5: [
    { itemId: "a_scale", price: 38 },
    { itemId: "p_shadow", price: 24, maxQty: 1 },
    { itemId: "p_might", price: 16, maxQty: 2 },
    { itemId: "p_antidote", price: 10, maxQty: 2 },
    { itemId: "p_gheal", price: 18, maxQty: 3 },
    { itemId: "p_bomb", price: 20, maxQty: 3 },
  ],
  6: [
    { itemId: "w_ench", price: 55 },
    { itemId: "p_detect", price: 12, maxQty: 2 },
    { itemId: "p_ruin", price: 22, maxQty: 2 },
    { itemId: "p_gheal", price: 18, maxQty: 3 },
    { itemId: "p_levit", price: 30, maxQty: 1 },
    { itemId: "p_ember", price: 26, maxQty: 1 },
    { itemId: "i_lantern", price: 30 },
  ],
  7: [
    { itemId: "a_plate", price: 48 },
    { itemId: "am_arrow", price: 8 },
    { itemId: "p_ward", price: 16, maxQty: 3 },
    { itemId: "p_gheal", price: 18, maxQty: 3 },
    { itemId: "p_bomb", price: 20, maxQty: 3 },
  ],
  8: [
    { itemId: "p_might", price: 16, maxQty: 3 },
    { itemId: "p_ruin", price: 22, maxQty: 2 },
    { itemId: "p_rime", price: 26, maxQty: 1 },
    { itemId: "p_blink", price: 30, maxQty: 1 },
    { itemId: "p_gheal", price: 18, maxQty: 3 },
    { itemId: "p_bomb", price: 20, maxQty: 3 },
  ],
  9: [
    { itemId: "p_shadow", price: 24, maxQty: 1 },
    { itemId: "p_blink", price: 30, maxQty: 1 },
    { itemId: "p_ward", price: 16, maxQty: 3 },
    { itemId: "p_might", price: 16, maxQty: 3 },
    { itemId: "p_gheal", price: 18, maxQty: 3 },
    { itemId: "p_ruin", price: 22, maxQty: 2 },
  ],
};
