import type { ItemDef } from "@/game/core/types";

// Registry of item definitions, keyed by id.
export const ITEMS: Record<string, ItemDef> = {
  // ── weapons ──
  w_dagger: { id: "w_dagger", name: "Rusty Dagger", glyph: "/", color: "#b0b0b0", category: "weapon", stackable: false, power: 3 },
  w_short: { id: "w_short", name: "Short Sword", glyph: "/", color: "#e0e0e0", category: "weapon", stackable: false, power: 5 },
  w_axe: { id: "w_axe", name: "War Axe", glyph: "/", color: "#f0d0a0", category: "weapon", stackable: false, power: 8 },
  w_ench: { id: "w_ench", name: "Enchanted Blade", glyph: "/", color: "#9fdfff", category: "weapon", stackable: false, power: 12 },
  w_sun: { id: "w_sun", name: "The Sunblade", glyph: "/", color: "#ffe14d", category: "weapon", stackable: false, power: 18, questTag: "sunblade" },

  // ── armor ──
  a_rags: { id: "a_rags", name: "Tattered Rags", glyph: "[", color: "#8a7a5a", category: "armor", stackable: false, reduction: 0 },
  a_leather: { id: "a_leather", name: "Leather Armor", glyph: "[", color: "#cd7f32", category: "armor", stackable: false, reduction: 1 },
  a_chain: { id: "a_chain", name: "Chainmail", glyph: "[", color: "#c0c0c8", category: "armor", stackable: false, reduction: 2 },
  a_plate: { id: "a_plate", name: "Plate Armor", glyph: "[", color: "#e8e8f0", category: "armor", stackable: false, reduction: 4 },

  // ── potions (polish; usable but not required for the core loop) ──
  p_heal: { id: "p_heal", name: "Healing Potion", glyph: "!", color: "#ff5fa2", category: "potion", stackable: true, effect: "heal", magnitude: 10 },
  p_gheal: { id: "p_gheal", name: "Greater Healing", glyph: "!", color: "#ff8fd0", category: "potion", stackable: true, effect: "greaterHeal", magnitude: 20 },
  p_bomb: { id: "p_bomb", name: "Firebomb", glyph: "!", color: "#ff8c00", category: "potion", stackable: true, effect: "bomb", magnitude: 15 },

  // ── coins ──
  c_gold: { id: "c_gold", name: "Gold", glyph: "$", color: "#ffd700", category: "coin", stackable: true, value: 10 },

  // ── torch (polish) ──
  i_torch: { id: "i_torch", name: "Torch", glyph: "(", color: "#ff8c00", category: "torch", stackable: false, lightBonus: 3 },

  // ── quest items ──
  q_shard: { id: "q_shard", name: "Moonstone Shard", glyph: "*", color: "#7fdfff", category: "quest", stackable: true, questTag: "moonstone" },
};

export function itemDef(id: string): ItemDef {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item id: ${id}`);
  return def;
}

// ── Shop tiers (polish — designed in now, wired up in Phase 2) ──────────────
export interface ShopEntry {
  itemId: string;
  price: number;
  maxQty?: number;
}
export const SHOP_TIERS: Record<number, ShopEntry[]> = {
  1: [
    { itemId: "w_short", price: 15 },
    { itemId: "a_leather", price: 12 },
    { itemId: "p_heal", price: 8, maxQty: 3 },
    { itemId: "i_torch", price: 10 },
  ],
  2: [
    { itemId: "w_axe", price: 30 },
    { itemId: "a_chain", price: 25 },
    { itemId: "p_heal", price: 8, maxQty: 3 },
    { itemId: "p_gheal", price: 18, maxQty: 2 },
  ],
  3: [
    { itemId: "w_ench", price: 55 },
    { itemId: "a_plate", price: 45 },
    { itemId: "p_gheal", price: 18, maxQty: 3 },
    { itemId: "p_bomb", price: 20, maxQty: 3 },
  ],
  4: [
    { itemId: "p_gheal", price: 18, maxQty: 3 },
    { itemId: "p_bomb", price: 20, maxQty: 3 },
  ],
};
