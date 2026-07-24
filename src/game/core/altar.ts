// ─────────────────────────────────────────────────────────────────────────
// Altars / shrines — a single pre-rolled risk/reward bargain each, paid in
// blood or gold. PURE core: `applyAltar` mutates the GameState and returns a
// log line; the store just opens/closes the modal around it.
// ─────────────────────────────────────────────────────────────────────────
import type { AltarKind, AltarInstance, GameState } from "./types";
import { giveItem } from "./inventory";

export interface AltarOfferDef {
  kind: AltarKind;
  title: string;
  /** the full offer, shown in the modal */
  prompt: string;
  /** short label for the Accept button */
  acceptLabel: string;
}

export const ALTAR_OFFERS: Record<AltarKind, AltarOfferDef> = {
  vigor: {
    kind: "vigor",
    title: "Altar of Vigor",
    prompt:
      "Lay 40 gold upon the altar and vitality floods you — your frame toughens (+6 max HP) and every wound closes.",
    acceptLabel: "Offer 40 gold",
  },
  warblood: {
    kind: "warblood",
    title: "Altar of Warblood",
    prompt:
      "This altar hungers for vigor, not coin. Give up 6 of your max HP — forever — and your every blow lands harder (+3 power, permanent).",
    acceptLabel: "Offer your blood",
  },
  hoard: {
    kind: "hoard",
    title: "Altar of the Hoard",
    prompt:
      "Bleed onto the stone — 8 HP — and take the cache it guards: two Greater Healing draughts and 25 gold.",
    acceptLabel: "Bleed (8 HP)",
  },
};

export const ALTAR_KINDS = Object.keys(ALTAR_OFFERS) as AltarKind[];

/** Whether the player can pay an altar's price right now (+ a reason if not). */
export function canAffordAltar(
  state: GameState,
  kind: AltarKind,
): { ok: boolean; reason?: string } {
  const p = state.player;
  switch (kind) {
    case "vigor":
      return p.coins >= 40
        ? { ok: true }
        : { ok: false, reason: "You lack the 40 gold." };
    case "warblood":
      return p.maxHp > 6
        ? { ok: true }
        : { ok: false, reason: "You are too frail to give more blood." };
    case "hoard":
      return p.hp > 8
        ? { ok: true }
        : { ok: false, reason: "You haven't the blood to spare." };
  }
}

/** Pay the cost + grant the boon, marking the altar spent. Returns a log line,
 * or null if it couldn't be afforded (a no-op). */
export function applyAltar(
  state: GameState,
  altar: AltarInstance,
): string | null {
  if (altar.used) return null;
  if (!canAffordAltar(state, altar.kind).ok) return null;
  const p = state.player;
  altar.used = true;
  switch (altar.kind) {
    case "vigor":
      p.coins -= 40;
      p.maxHp += 6;
      p.hp = p.maxHp;
      return "Vitality floods you — the altar's gift takes hold.";
    case "warblood":
      p.maxHp -= 6;
      p.hp = Math.min(p.hp, p.maxHp);
      p.weaponBonus += 3;
      return "The altar drinks deep. Your blows fall heavier — but you are frailer, forever.";
    case "hoard":
      p.hp -= 8;
      giveItem(p, "p_gheal");
      giveItem(p, "p_gheal");
      p.coins += 25;
      p.goldEarned += 25;
      return "You bleed onto the stone and claim the hoard.";
  }
}
