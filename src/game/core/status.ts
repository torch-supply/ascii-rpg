// ─────────────────────────────────────────────────────────────────────────
// Status-effect behavior table. PURE — no React/DOM/rot.js. Timed conditions
// live in an `effects` bag (key -> turns remaining) on the player AND on
// monsters, so the same machinery afflicts either side.
//
//   • poison / bleed / burn — damage-over-time that ignores armor
//   • chill                 — a brief freeze; the afflicted skips its turns
//                             (only ever applied to monsters, so only the
//                              monster phase reads it)
// ─────────────────────────────────────────────────────────────────────────
import type { StatusKind } from "./types";

export interface StatusDef {
  key: StatusKind;
  /** damage inflicted each turn while active (0 = non-damaging) */
  dmgPerTurn: number;
  /** whether the tick damage bypasses armor (all DoTs do) */
  piercesArmor: boolean;
  /** message when first afflicted; `who` is "You"/the monster name */
  onApply: (who: string) => string;
  /** message when the effect wears off (player-facing only) */
  onFade: string;
  /** HUD chip glyph + color (player debuffs) */
  hudGlyph: string;
  hudColor: string;
  /** glyph tint for an afflicted entity on the map */
  tint: string;
}

export const STATUS: Record<StatusKind, StatusDef> = {
  poison: {
    key: "poison",
    dmgPerTurn: 2,
    piercesArmor: true,
    onApply: (w) => `${w} ${w === "You" ? "are" : "is"} poisoned!`,
    onFade: "The poison works out of your blood.",
    hudGlyph: "☠",
    hudColor: "#7fdf6a",
    tint: "#7fdf6a",
  },
  bleed: {
    key: "bleed",
    dmgPerTurn: 3,
    piercesArmor: true,
    onApply: (w) => `${w} ${w === "You" ? "are" : "is"} bleeding!`,
    onFade: "Your wounds finally clot.",
    hudGlyph: "≈",
    hudColor: "#e0555f",
    tint: "#e0555f",
  },
  burn: {
    key: "burn",
    dmgPerTurn: 4,
    piercesArmor: true,
    onApply: (w) => `${w} ${w === "You" ? "catch" : "catches"} fire!`,
    onFade: "The flames on you die down.",
    hudGlyph: "♨",
    hudColor: "#ff8c3a",
    tint: "#ff8c3a",
  },
  chill: {
    key: "chill",
    dmgPerTurn: 0,
    piercesArmor: false,
    onApply: (w) => `${w} ${w === "You" ? "are" : "is"} frozen stiff!`,
    onFade: "The frost releases its grip.",
    hudGlyph: "❄",
    hudColor: "#a9e0ff",
    tint: "#a9e0ff",
  },
};

export const STATUS_KEYS = Object.keys(STATUS) as StatusKind[];

/** The damaging debuffs a Cleanse potion clears (chill is a control effect). */
export const DAMAGING_STATUS: StatusKind[] = ["poison", "bleed", "burn"];

/** Apply/refresh a timed effect on a bag, taking the longer of the two timers. */
export function applyStatus(
  effects: Record<string, number>,
  kind: StatusKind,
  duration: number
) {
  effects[kind] = Math.max(effects[kind] ?? 0, duration);
}

/** Is `key` one of the damage-over-time debuffs (not a buff like ward/might)? */
export function isStatusKind(key: string): key is StatusKind {
  return key in STATUS;
}
