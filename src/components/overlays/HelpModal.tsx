"use client";

import { gameStore } from "@/store/gameStore";
import { MenuButton } from "@/components/ui/MenuButton";

const ROWS: [string, string][] = [
  ["↑ ↓ ← →  /  h j k l  /  w a s d", "Move (bump a monster to attack it)"],
  [".  or  Space", "Wait one turn"],
  ["1 – 9", "Use / equip a bag item by slot"],
  ["i", "Open inventory"],
  ["p  or  Esc", "Pause"],
  ["?", "This help"],
  ["Enter", "Confirm / continue"],
];

export default function HelpModal() {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/80 px-4">
      <div className="flex w-full max-w-lg flex-col gap-4 border border-edge bg-panel px-7 py-6">
        <h2 className="text-center text-lg uppercase tracking-[0.3em] text-gold">
          How to Play
        </h2>
        <p className="text-center text-xs leading-relaxed text-dim">
          A turn-based roguelike: the world only moves when you do. Explore in
          the torchlight, fight what you must, and complete each level&apos;s
          goal (shown top-right) before your turns run out.
        </p>
        <div className="flex flex-col gap-1.5 text-[13px]">
          {ROWS.map(([keys, desc]) => (
            <div key={keys} className="flex items-baseline justify-between gap-4">
              <span className="text-magic">{keys}</span>
              <span className="text-right text-fg">{desc}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1 border-t border-edge pt-3 text-[12px] text-dim">
          <span>
            <span className="text-fg">@</span> you ·{" "}
            <span style={{ color: "#3fbf3f" }}>g</span>{" "}
            <span style={{ color: "#d9d9d9" }}>s</span> monsters ·{" "}
            <span className="text-gold">$</span> gold ·{" "}
            <span style={{ color: "#ff5fa2" }}>!</span> potion ·{" "}
            <span style={{ color: "#7fdfff" }}>*</span> quest ·{" "}
            <span className="text-gold">&gt;</span> exit
          </span>
        </div>
        <div className="flex justify-center pt-1">
          <MenuButton accent onClick={() => gameStore.getState().setMode("playing")}>
            ▸ Back
          </MenuButton>
        </div>
      </div>
    </div>
  );
}
