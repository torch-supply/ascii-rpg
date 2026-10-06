"use client";

import { useGameStore } from "@/store/gameStore";

/** Global SFX + music on/off toggle (preference persists across sessions).
 * Shared by the HUD footer and the splash screen; `[m]` toggles it too.
 *
 * `compact` is the HUD-footer variant: a small chip sized to sit in the 30px key
 * strip as one more item in the run, rather than the standalone control the
 * splash wants. Same component, same behavior — only the box changes. */
export function SoundToggle({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const soundOn = useGameStore((s) => s.soundOn);
  const toggleSound = useGameStore((s) => s.toggleSound);
  const size = compact
    ? "px-[7px] py-px text-[12px]"
    : "px-2 py-0.5 text-[17px]";
  const tone = compact
    ? soundOn
      ? "border-gold/40 text-gold hover:bg-gold/15"
      : "hover:text-dim"
    : soundOn
      ? "border-gold/50 text-gold hover:bg-gold/15"
      : "border-edge text-edge hover:text-dim";
  return (
    <button
      onClick={toggleSound}
      // In the HUD the button must never hold focus: `KeyboardInput` hands a
      // focused button first claim on Space/Enter, so one click on it turned
      // Space (wait) into "mute" for the rest of the level. `[m]` is the
      // keyboard route, so it also leaves the tab order. The splash variant
      // stays a normal focusable control — there it IS the menu.
      onMouseDown={compact ? (e) => e.preventDefault() : undefined}
      tabIndex={compact ? -1 : undefined}
      title={`Sound ${soundOn ? "on" : "off"} — click or press [m]`}
      aria-label={`Sound ${soundOn ? "on" : "off"}`}
      className={`shrink-0 border transition-colors ${size} ${tone} ${className}`}
      style={
        compact && !soundOn
          ? { borderColor: "#3a3a45", color: "#5a5a64" }
          : undefined
      }
    >
      {soundOn ? "♪ on" : "♪ off"}
    </button>
  );
}
