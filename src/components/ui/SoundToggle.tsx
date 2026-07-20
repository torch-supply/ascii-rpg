"use client";

import { useGameStore } from "@/store/gameStore";

/** Global SFX + music on/off toggle (preference persists across sessions).
 * Shared by the HUD footer and the splash screen; `[m]` toggles it too. */
export function SoundToggle({ className = "" }: { className?: string }) {
  const soundOn = useGameStore((s) => s.soundOn);
  const toggleSound = useGameStore((s) => s.toggleSound);
  return (
    <button
      onClick={toggleSound}
      title={`Sound ${soundOn ? "on" : "off"} — click or press [m]`}
      aria-label={`Sound ${soundOn ? "on" : "off"}`}
      className={`shrink-0 border px-2 py-0.5 text-[17px] transition-colors ${
        soundOn
          ? "border-gold/50 text-gold hover:bg-gold/15"
          : "border-edge text-edge hover:text-dim"
      } ${className}`}
    >
      {soundOn ? "♪ on" : "♪ off"}
    </button>
  );
}
