import type { PlayerAction } from "@/game/core/types";

// ─────────────────────────────────────────────────────────────────────────
// THE SEAM. A LoopDriver decides *when* time advances and *how* input is
// consumed. The turn-based implementation lives in the game store's
// `submitAction` (world advances only on a player action). To add a real-time
// mode later you implement this same interface with a requestAnimationFrame
// tick calling the SAME pure core transitions — the core, renderer, store
// shape, and save format stay untouched.
// ─────────────────────────────────────────────────────────────────────────
export interface LoopDriver {
  submitAction(action: PlayerAction): void;
  isBusy(): boolean; // true while animating / resolving (always false in core)
  pause(): void;
  resume(): void;
}
