import { CONFIG } from "@/content/config";

/**
 * Spore-vent duty cycle. PURE — shared by `tickGas` (which decides whether a vent
 * emits) and the renderer (which telegraphs the turn before it does), so the phase
 * arithmetic exists in exactly one place. Duplicating it would let the warning drift
 * out of step with the thing it warns about, which is worse than no warning at all.
 *
 *  • `quiet`   — clear air; nothing to see but the vent tile itself
 *  • `priming` — the LAST quiet turn before it seeps. This is the telegraph: the vent
 *                swells and brightens for one turn so an attentive player can step
 *                out of the blast footprint. Consistent with how every other hazard
 *                here works (the barrage marks its tiles a turn early, a sensed trap
 *                shows a faint `^`) — dangerous, but never a surprise.
 *  • `seeping` — actively emitting haze.
 *
 * Each vent is offset by its own tile index so a level's vents run out of phase.
 */
export type VentState = "quiet" | "priming" | "seeping";

export function ventState(turnCount: number, ventIndex: number): VentState {
  const { ventPeriod, ventActive } = CONFIG.gas;
  const phase = (turnCount + ventIndex) % ventPeriod;
  if (phase < ventActive) return "seeping";
  // the final turn of the quiet stretch — next turn's phase wraps back to 0
  if (phase === ventPeriod - 1) return "priming";
  return "quiet";
}
