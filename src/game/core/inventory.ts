import type { PlayerState } from "./types";
import { ITEMS } from "@/content/items";
import { CONFIG } from "@/content/config";
import { recomputeLight } from "./state";
import { syncBagSlots } from "./hotbar";

// Shared inventory/equipment helpers used by both map pickups (actions) and
// shop purchases (store). One place for "what happens when the player acquires
// an item".

/** Remove a single copy of an item from the bag (a stack decrements). */
export function removeOneFromBag(p: PlayerState, defId: string) {
  const i = p.bag.findIndex((b) => b.defId === defId);
  if (i < 0) return;
  const entry = p.bag[i];
  if (entry.count > 1) entry.count -= 1;
  else p.bag.splice(i, 1);
}

/**
 * Wield a weapon / don armour, returning the defId this DISPLACED (or null).
 *
 * You carry ONE weapon and ONE suit of armour. The replaced piece used to be
 * stowed in the bag, which quietly made the bag a gear warehouse: a run can turn
 * up ~11 pieces, worth 178g of sell value against a ~190g purse, and most of an
 * "inventory" was spare kit you were never going to wear. The caller now decides
 * where the displaced piece goes — the floor at your feet during play, a
 * trade-in credit at a shop counter — so a swap is a real choice with a real
 * cost, and what you set down is still lying there if you want it back.
 */
export function equipWeapon(p: PlayerState, defId: string): string | null {
  if (p.weaponId === defId) return null;
  const def = ITEMS[defId];
  const displaced = p.weaponId || null;
  removeOneFromBag(p, defId); // the newly-wielded one leaves the bag
  p.weaponId = defId;
  p.weaponPower = def.power ?? 0;
  return displaced;
}

/** Don armor. Same swap semantics as `equipWeapon`. */
export function equipArmor(p: PlayerState, defId: string): string | null {
  if (p.armorId === defId) return null;
  const def = ITEMS[defId];
  const displaced = p.armorId || null;
  removeOneFromBag(p, defId);
  p.armorId = defId;
  p.armorReduction = def.reduction ?? 0;
  return displaced;
}

/**
 * Stow `count` copies, merging into the existing stack if there is one.
 *
 * EVERY item merges, gear included. A `BagEntry` is `{defId, count}` with no
 * per-instance state, so two entries of the same id are indistinguishable — the
 * split carries no information and only surfaces as bugs: three identical
 * "Leather Armor" rows in the sheet, all three printing the same `[7]` (one
 * slot claim, keyed by def id, rendered once per duplicate row). The shop's sell
 * list already summed by def id, so the bag was the odd surface out.
 */
export function addToBag(p: PlayerState, defId: string, count = 1) {
  const entry = p.bag.find((b) => b.defId === defId);
  if (entry) entry.count += count;
  else p.bag.push({ defId, count });
  syncBagSlots(p);
}

/**
 * Give a weapon/armor/potion/torch to the player: auto-equip gear if it's an
 * upgrade, otherwise stow it; potions stack in the bag; a torch widens light.
 * (Coins and quest items are handled separately at pickup.)
 */
/** Acquire an item. Returns any gear defId it DISPLACED, for the caller to
 * trade in or drop. */
export function giveItem(p: PlayerState, defId: string): string | null {
  const def = ITEMS[defId];
  switch (def.category) {
    // Bought at a counter: it goes straight on, and the piece it replaces is
    // traded in (the caller credits `sellPrice`). No "is it better?" test —
    // you chose to buy it, and POWER IS NOT THE ONLY AXIS: a Frostbrand chills
    // and a mace knocks back, so a bare `power >` comparison silently threw
    // away the property you were carrying the weapon for.
    case "weapon":
      return equipWeapon(p, defId);
    case "armor":
      return equipArmor(p, defId);
    case "torch": {
      // A torch is your light source, not a bag item — buying/finding another
      // ADDS its fuel (extra turns to burn). Adopt the brighter one; never
      // downgrade (a plain torch over a lantern just refuels, keeps the lantern).
      const curBonus =
        p.hasTorch && p.torchId ? (ITEMS[p.torchId].lightBonus ?? 0) : -1;
      if ((def.lightBonus ?? 0) > curBonus) p.torchId = defId;
      p.hasTorch = true;
      p.torchFuel = (p.torchFuel ?? 0) + (def.fuel ?? CONFIG.torchFuel);
      recomputeLight(p);
      break;
    }
    case "ammo":
      addToBag(p, defId, def.value ?? 1); // `value` = arrows per bundle
      break;
    default:
      addToBag(p, defId);
  }
  return null;
}
