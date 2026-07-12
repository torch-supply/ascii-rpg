"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { GAMEOVER_NARRATION } from "@/content/ascii";
import { LEVELS } from "@/content/levels";
import { MenuButton } from "@/components/ui/MenuButton";

export default function GameOver() {
  const game = useGameStore((s) => s.game);

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-7 bg-ink px-6 text-center">
      <h2 className="text-balance text-2xl uppercase tracking-[0.4em] text-danger">
        {GAMEOVER_NARRATION.title}
      </h2>
      <p className="max-w-lg text-balance whitespace-pre-line text-sm leading-relaxed text-fg">
        {GAMEOVER_NARRATION.body}
      </p>
      {game && (
        <p className="text-balance text-xs text-dim">
          You fell in Level {game.currentLevel + 1}:{" "}
          {LEVELS[game.currentLevel].title}.
        </p>
      )}
      <MenuButton accent onClick={() => gameStore.getState().quitToTitle()}>
        ▸ Return to title
        <span className="ml-1 text-xs opacity-70">(Enter)</span>
      </MenuButton>
    </div>
  );
}
