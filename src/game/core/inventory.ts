import type { PlayerState } from "./types";
import { ITEMS } from "@/content/items";
import { recomputeLight } from "./state";

// Shared inventory/equipment helpers used by both map pickups (actions) and
// shop purchases (store). One place for "what happens when the player acquires
// an item".

export function equipWeapon(p: PlayerState, defId: string) {
  const def = ITEMS[defId];
  p.weaponId = defId;
  p.weaponPower = def.power ?? 0;
}

export function equipArmor(p: PlayerState, defId: string) {
  const def = ITEMS[defId];
  p.armorId = defId;
  p.armorReduction = def.reduction ?? 0;
}

export function addToBag(p: PlayerState, defId: string) {
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

/**
 * Give a weapon/armor/potion/torch to the player: auto-equip gear if it's an
 * upgrade, otherwise stow it; potions stack in the bag; a torch widens light.
 * (Coins and quest items are handled separately at pickup.)
 */
export function giveItem(p: PlayerState, defId: string) {
  const def = ITEMS[defId];
  switch (def.category) {
    case "weapon":
      if ((def.power ?? 0) > p.weaponPower) equipWeapon(p, defId);
      else addToBag(p, defId);
      break;
    case "armor":
      if ((def.reduction ?? 0) > p.armorReduction) equipArmor(p, defId);
      else addToBag(p, defId);
      break;
    case "torch":
      p.hasTorch = true;
      recomputeLight(p);
      break;
    default:
      addToBag(p, defId);
  }
}
