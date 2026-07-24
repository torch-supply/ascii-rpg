"use client";

import { BoxFrame } from "@/components/ui/BoxFrame";
import { MenuButton } from "@/components/ui/MenuButton";
import { gameStore } from "@/store/gameStore";

// [keys, description, wide?] — `wide` rows span both columns (the movement row's
// key is long, so it gets its own full-width line).
const ROWS: [string, string, boolean?][] = [
  ["↑ ↓ ← →  ·  wasd", "Move — bump a monster to attack it", true],
  [".  ·  Space", "Wait one turn"],
  ["f", "Fire the equipped bow (aim, Enter)"],
  ["q", "Class ability (aim with a direction)"],
  ["c", "Close an adjacent door"],
  ["i", "Open inventory"],
  ["1 – 9", "Use / equip a bag item"],
  ["p  ·  Esc", "Pause"],
  ["?", "This help"],
  ["Enter", "Confirm / continue"],
];

const LEGEND: [string, string, string][] = [
  ["@", "#ffffff", "you"],
  ["g", "#3fbf3f", "monster"],
  ["$", "#ffd700", "gold"],
  ["!", "#ff5fa2", "potion"],
  ["*", "#7fdfff", "quest"],
  [">", "#ffd700", "exit"],
];

export default function HelpModal() {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/80 px-4">
      <BoxFrame
        accent="#ffb347"
        chip="#0c0c0e"
        className="flex w-[min(92vw,44rem)] flex-col gap-5"
        style={{ background: "rgba(16,16,20,0.94)", padding: "32px 40px" }}
      >
        {/* title + ◈ divider — matches the inventory / shop headers */}
        <div className="flex flex-col items-center gap-3">
          <h2
            className="m-0 text-lg font-semibold uppercase tracking-[0.34em] text-gold"
            style={{ textIndent: "0.34em" }}
          >
            How to Play
          </h2>
          <div className="flex w-[300px] max-w-full items-center gap-3">
            <span
              className="h-px flex-1"
              style={{
                background: "linear-gradient(to right,transparent,#ffb347)",
              }}
            />
            <span className="text-xs text-[#ffb347]">◈</span>
            <span
              className="h-px flex-1"
              style={{
                background: "linear-gradient(to left,transparent,#ffb347)",
              }}
            />
          </div>
        </div>

        <p className="text-balance text-center text-sm leading-relaxed text-dim">
          A turn-based ASCII RPG: the world only moves when you do. Explore in
          the torchlight, fight what you must, and complete each level&apos;s
          goal (shown top-right) to press on toward the Throne.
        </p>

        {/* controls — two columns, each a key + description on a ruled row */}
        <div className="grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2 border-t border-[#242430]">
          {ROWS.map(([keys, desc, wide]) => (
            <div
              key={keys}
              className={`flex items-baseline gap-3 border-b border-[#242430] py-2 ${wide ? "sm:col-span-2" : ""}`}
            >
              <span className="min-w-[6.5rem] shrink-0 font-semibold text-magic">
                {keys}
              </span>
              <span className="text-fg">{desc}</span>
            </div>
          ))}
        </div>

        {/* glyph legend */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1  text-sm text-dim">
          {LEGEND.map(([glyph, color, label]) => (
            <span key={label}>
              <span style={{ color }}>{glyph}</span> {label}
            </span>
          ))}
        </div>

        <div className="flex justify-center pt-1">
          <MenuButton
            accent
            autoFocus
            onClick={() => gameStore.getState().setMode("playing")}
          >
            ▸ Back
          </MenuButton>
        </div>
      </BoxFrame>
    </div>
  );
}
