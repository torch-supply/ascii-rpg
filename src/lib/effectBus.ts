import type { GameEvent } from "@/game/core/events";

// A tiny decoupled bus so the store can hand cosmetic turn events to the
// renderer without importing it. The canvas registers a sink on mount; the
// store emits after committing a turn. Animations are purely visual — they
// never touch game state.
type Sink = (fx: GameEvent[]) => void;

let sink: Sink | null = null;

export function setEffectSink(s: Sink | null): void {
  sink = s;
}

export function emitEffects(fx: GameEvent[]): void {
  if (sink && fx.length) sink(fx);
}
