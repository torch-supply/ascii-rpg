import type { BagEntry, PlayerState } from "./types";

/**
 * Stable hotbar slots. PURE, and deliberately its own module: `inventory.ts`
 * already imports `recomputeLight` from `state.ts`, so putting this in either
 * one would make the other import back into a cycle. Both need it — the bag can
 * be populated by acquisition (inventory) or built from a literal (the class
 * kit, the dev jump, a resumed save) — so it lives on its own, like `gas.ts`.
 */

/** How many bag items get a number key. Bounded by the keys that exist (1-9);
 * anything past this is reachable only from the inventory sheet. */
export const HOTBAR_SLOTS = 9;

/**
 * Give every bag item a stable hotbar slot, preserving claims already made.
 *
 * Called from `addToBag` and from the choke points that build a bag from a
 * literal (the class kit, the dev jump, a resumed save), so the invariant holds
 * however the bag was populated.
 *
 * A claim is deliberately NOT released when its stack empties — that's the
 * whole point (see `PlayerState.slotMap`). It's released only under pressure:
 * if all slots are claimed and a new item needs one, the lowest-numbered claim
 * whose item is no longer carried is evicted. So spare gear frees its key when
 * you sell it, while a consumable you keep rebuying holds its own.
 */
export function syncBagSlots(p: PlayerState) {
  if (!p.slotMap) p.slotMap = {};
  const held = new Set(p.bag.map((b) => b.defId));

  // Rebuild the slot -> owner index, dropping any duplicate claim on a slot
  // (defensive: a hand-built or legacy player could carry a collision).
  const owner = new Map<number, string>();
  for (const [defId, slot] of Object.entries(p.slotMap)) {
    if (slot >= 1 && slot <= HOTBAR_SLOTS && !owner.has(slot))
      owner.set(slot, defId);
    else delete p.slotMap[defId];
  }

  for (const b of p.bag) {
    if (p.slotMap[b.defId]) continue;
    let n = 0;
    for (let i = 1; i <= HOTBAR_SLOTS && !n; i++) if (!owner.has(i)) n = i;
    if (!n) {
      // every slot spoken for — reclaim one from an item that's no longer here
      for (let i = 1; i <= HOTBAR_SLOTS && !n; i++) {
        const claimant = owner.get(i)!;
        if (!held.has(claimant)) {
          delete p.slotMap[claimant];
          n = i;
        }
      }
    }
    if (!n) continue; // all slots held by carried items; this one is sheet-only
    p.slotMap[b.defId] = n;
    owner.set(n, b.defId);
  }
}

/** The bag entry bound to a hotbar slot, or undefined if the slot is empty. */
export function bagEntryForSlot(
  p: PlayerState,
  slot: number,
): BagEntry | undefined {
  const defId = Object.keys(p.slotMap ?? {}).find(
    (id) => p.slotMap[id] === slot,
  );
  return defId ? p.bag.find((b) => b.defId === defId) : undefined;
}

/**
 * The hotbar as the panel draws it: index 0 = slot 1, `null` = a spent slot
 * whose key is still reserved. Trimmed to the highest slot ever claimed, so an
 * early-game bag shows three rows rather than nine empty ones.
 */
export function hotbar(p: PlayerState): (BagEntry | null)[] {
  const highest = Math.max(
    0,
    ...Object.values(p.slotMap ?? {}).filter((n) => n <= HOTBAR_SLOTS),
  );
  return Array.from(
    { length: highest },
    (_, i) => bagEntryForSlot(p, i + 1) ?? null,
  );
}
