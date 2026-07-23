"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { GAMEOVER } from "@/content/ascii";
import { LEVELS } from "@/content/levels";
import { MenuButton } from "@/components/ui/MenuButton";
import { CinematicTitle } from "@/components/ui/CinematicTitle";
import { Prose } from "@/components/ui/Prose";
import { RunStats } from "@/components/ui/RunStats";
import { AsciiField } from "@/components/ui/AsciiField";
import { BoxFrame } from "@/components/ui/BoxFrame";

export default function GameOver() {
  const game = useGameStore((s) => s.game);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-auto bg-ink px-6 py-10 text-center">
      {/* dim crypt / ash field — the dark that took the realm */}
      <AsciiField mode="abstract" biome="crypt" bottom intensity={0.14} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(56% 52% at 50% 40%, rgba(150,60,60,0.1), transparent 68%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 48%, rgba(0,0,0,0.72) 100%)" }}
      />

      <BoxFrame
        accent="#c0555a"
        chip="#0c0c0e"
        className="narr-rise z-10 flex w-[min(92vw,44rem)] flex-col items-center gap-7"
        style={{ background: "rgba(9,9,12,0.55)", padding: "46px 56px" }}
      >
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
      </BoxFrame>
    </div>
  );
}
