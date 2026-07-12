"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { GAMEOVER } from "@/content/ascii";
import { LEVELS } from "@/content/levels";
import { MenuButton } from "@/components/ui/MenuButton";
import { AsciiArt } from "@/components/ui/AsciiArt";
import { Prose } from "@/components/ui/Prose";
import { RunStats } from "@/components/ui/RunStats";

export default function GameOver() {
  const game = useGameStore((s) => s.game);

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 overflow-auto bg-ink px-6 py-10 text-center">
      <h2 className="text-balance text-2xl uppercase tracking-[0.4em] text-danger">
        {GAMEOVER.title}
      </h2>
      <AsciiArt
        art={GAMEOVER.scene.art}
        gradient={GAMEOVER.scene.gradient}
        lineColors={GAMEOVER.scene.lineColors}
        colors={GAMEOVER.scene.colors}
        className="text-[11px] sm:text-sm"
      />
      <Prose text={GAMEOVER.body} className="max-w-lg text-sm text-fg" />
      {game && (
        <p className="text-balance text-xs text-dim">
          You fell in Level {game.currentLevel + 1}:{" "}
          {LEVELS[game.currentLevel].title}.
        </p>
      )}
      <RunStats />
      <MenuButton accent onClick={() => gameStore.getState().quitToTitle()}>
        ▸ Return to title
        <span className="ml-1 text-xs opacity-70">(Enter)</span>
      </MenuButton>
    </div>
  );
}
