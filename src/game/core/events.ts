// Events emitted by pure transitions. Log lines drive the message log; the
// animation cues are consumed by a cosmetic AnimationQueue later (polish).
// Transitions NEVER perform side effects — they only return these.
export type GameEvent =
  | { kind: "message"; text: string }
  | { kind: "hit"; x: number; y: number }
  // the player just picked something up (a cue for the SFX layer)
  | { kind: "pickup" }
  // picked up gold specifically (distinct ching)
  | { kind: "coin" }
  // the player drank a (non-thrown) potion — SFX cue
  | { kind: "quaff" }
  // the player loosed an arrow; `thud` = it struck stone (a miss)
  | { kind: "shoot" }
  | { kind: "thud" }
  // a cracked wall broke apart (bash / knockback / blast)
  | { kind: "crumble" }
  // a door was opened or shut (player bump/close, or a monster forcing through)
  | { kind: "door" }
  // a spike trap sprang
  | { kind: "trap" }
  // the player walked one tile
  | { kind: "step" }
  | { kind: "projectile"; from: { x: number; y: number }; to: { x: number; y: number }; glyph: string }
  // a damage number to float off a tile (toPlayer tints it red vs. gold;
  // an explicit `color` overrides that, e.g. green for poison ticks)
  | { kind: "damage"; x: number; y: number; amount: number; toPlayer: boolean; color?: string }
  // a small heal (foraged berries / mote) — floats a green +N and plays a soft cue
  | { kind: "heal"; x: number; y: number; amount: number }
  // an expanding blast ring centered on a tile (firebomb / Ruin)
  | { kind: "blast"; x: number; y: number; radius: number };
