"use client";

import { useState } from "react";
import { gameStore, useGameStore } from "@/store/gameStore";
import { SPLASH_ART } from "@/content/ascii";
import { LEVELS } from "@/content/levels";
import { MenuButton } from "@/components/ui/MenuButton";

export default function Splash() {
  const hasSave = useGameStore((s) => s.hasSave);
  const saveInfo = useGameStore((s) => s.saveInfo);
  const [showSeed, setShowSeed] = useState(false);
  const [seed, setSeed] = useState("");

  const startNew = () => {
    if (
      hasSave &&
      !window.confirm("Start a new game? This erases your saved run.")
    ) {
      return;
    }
    gameStore.getState().newGame(seed);
  };

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 overflow-auto bg-ink px-4 py-8 text-center">
      <pre className="ascii text-[9px] leading-[1.1] text-gold sm:text-xs">
        {SPLASH_ART}
      </pre>
      <p className="max-w-md text-sm leading-relaxed text-dim">
        Escape the pit. Cross the cursed land. Recover the Sunblade. End the
        Lich-King Malachar — and rekindle the dawn.
      </p>

      <div className="flex flex-col items-center gap-3">
        {hasSave && saveInfo && (
          <MenuButton accent onClick={() => gameStore.getState().resumeGame()}>
            ▸ Resume
            <span className="ml-1 text-xs opacity-80">
              — Level {saveInfo.level + 1}: {saveInfo.title} · turn{" "}
              {saveInfo.turn}
            </span>
          </MenuButton>
        )}

        <MenuButton onClick={startNew}>
          ▸ New Game
          {hasSave && (
            <span className="ml-1 text-xs text-dim">(overwrites save)</span>
          )}
        </MenuButton>

        <button
          onClick={() => setShowSeed((v) => !v)}
          className="pointer-events-auto text-xs text-dim underline underline-offset-2 hover:text-fg"
        >
          {showSeed ? "hide seed" : "custom seed (optional)"}
        </button>
        {showSeed && (
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="leave blank for random"
            className="pointer-events-auto w-72 max-w-[85vw] border border-edge bg-panel px-3 py-1.5 text-center text-sm text-fg outline-none focus:border-gold"
          />
        )}
      </div>

      <p className="text-[11px] text-edge">
        v1 · {LEVELS.length} levels · move with arrows or hjkl · bump to attack ·
        find the way, then live to tell it
      </p>
    </div>
  );
}
