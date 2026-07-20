"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { GAMEOVER } from "@/content/ascii";
import { LEVELS } from "@/content/levels";
import { MenuButton } from "@/components/ui/MenuButton";
import { CinematicTitle } from "@/components/ui/CinematicTitle";
import { Prose } from "@/components/ui/Prose";
import { RunStats } from "@/components/ui/RunStats";

export default function GameOver() {
  const game = useGameStore((s) => s.game);

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-7 overflow-auto bg-ink px-6 py-10 text-center">
      <CinematicTitle title={GAMEOVER.title} gradient={GAMEOVER.gradient} accent="#ff5a5a" />

      <div className="narr-rise" style={{ animationDelay: "220ms" }}>
        <Prose text={GAMEOVER.body} className="max-w-lg text-sm leading-relaxed text-fg" />
      </div>

      {game && (
        <div className="narr-rise" style={{ animationDelay: "320ms" }}>
          <p className="text-balance text-xs text-dim">
            You fell in Level {game.currentLevel + 1}:{" "}
            {LEVELS[game.currentLevel].title}.
          </p>
        </div>
      )}

      <div className="narr-rise" style={{ animationDelay: "420ms" }}>
        <RunStats />
      </div>

      <div className="narr-rise" style={{ animationDelay: "540ms" }}>
        <MenuButton accent autoFocus onClick={() => gameStore.getState().quitToTitle()}>
          ▸ Return to title
          <span className="ml-1 text-xs opacity-70">(Enter)</span>
        </MenuButton>
      </div>
    </div>
  );
}
