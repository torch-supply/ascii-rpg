// Events emitted by pure transitions. Log lines drive the message log; the
// animation cues are consumed by a cosmetic AnimationQueue later (polish).
// Transitions NEVER perform side effects — they only return these.
export type GameEvent =
  | { kind: "message"; text: string }
  | { kind: "hit"; x: number; y: number }
  | { kind: "projectile"; from: { x: number; y: number }; to: { x: number; y: number }; glyph: string };
