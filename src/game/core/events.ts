// Events emitted by pure transitions. Log lines drive the message log; the
// animation cues are consumed by a cosmetic AnimationQueue later (polish).
// Transitions NEVER perform side effects — they only return these.
export type GameEvent =
  | { kind: "message"; text: string }
  | { kind: "hit"; x: number; y: number }
  | { kind: "projectile"; from: { x: number; y: number }; to: { x: number; y: number }; glyph: string }
  // a damage number to float off a tile (toPlayer tints it red vs. gold;
  // an explicit `color` overrides that, e.g. green for poison ticks)
  | { kind: "damage"; x: number; y: number; amount: number; toPlayer: boolean; color?: string }
  // an expanding blast ring centered on a tile (firebomb / Ruin)
  | { kind: "blast"; x: number; y: number; radius: number };
