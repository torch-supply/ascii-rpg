"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { EMBER_ART, DAWN_ART, G_EMBER, G_DAWN_TITLE, SUBTITLE } from "@/content/ascii";
import { LEVELS } from "@/content/levels";
import { MenuButton } from "@/components/ui/MenuButton";
import { AsciiArt } from "@/components/ui/AsciiArt";
import { Embers } from "@/components/ui/Embers";

export default function Splash() {
  const hasSave = useGameStore((s) => s.hasSave);
  const saveInfo = useGameStore((s) => s.saveInfo);
  const startNew = () => {
    if (
      hasSave &&
      !window.confirm("Start a new game? This erases your saved run.")
    ) {
      return;
    }
    gameStore.getState().newGame();
  };

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 overflow-auto bg-ink px-4 py-8 text-center">
      <div className="relative flex flex-col items-center gap-1 px-6 pt-8">
        <Embers />
        <div className="ember-flicker relative z-10 flex flex-col items-center gap-1">
          <AsciiArt art={EMBER_ART} gradient={G_EMBER} className="text-[11px] sm:text-base" />
          <div className="text-sm italic text-[#ff8c00] sm:text-base">of</div>
          <AsciiArt
            art={DAWN_ART}
            gradient={G_DAWN_TITLE}
            className="-mt-[18px] text-[11px] sm:text-base"
          />
        </div>
        <div className="relative z-10 mt-3 text-[11px] tracking-[0.4em] text-dim sm:text-xs">
          {SUBTITLE}
        </div>
      </div>
      <p className="max-w-md text-balance text-sm leading-relaxed text-dim">
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
      </div>

      <p className="max-w-md text-balance text-xs text-dim">
        v1 · {LEVELS.length} levels · move with arrows or hjkl · bump to attack ·
        find the way, then live to tell it
      </p>
    </div>
  );
}
