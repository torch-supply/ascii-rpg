"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { VICTORY } from "@/content/ascii";
import { MenuButton } from "@/components/ui/MenuButton";
import { AsciiArt } from "@/components/ui/AsciiArt";
import { Prose } from "@/components/ui/Prose";

export default function Victory() {
  const game = useGameStore((s) => s.game);

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 overflow-auto bg-ink px-6 py-10 text-center">
      <h2 className="text-balance text-2xl uppercase tracking-[0.4em] text-gold">
        {VICTORY.title}
      </h2>
      <AsciiArt
        art={VICTORY.scene.art}
        gradient={VICTORY.scene.gradient}
        lineColors={VICTORY.scene.lineColors}
        colors={VICTORY.scene.colors}
        className="text-[11px] sm:text-sm"
      />
      <Prose text={VICTORY.body} className="max-w-xl text-sm text-fg" />
      {game && (
        <p className="text-balance text-xs text-dim">
          Gold gathered: {game.player.coins} · lives remaining:{" "}
          {game.player.lives}
        </p>
      )}
      <MenuButton accent onClick={() => gameStore.getState().quitToTitle()}>
        ▸ Return to title
        <span className="ml-1 text-xs opacity-70">(Enter)</span>
      </MenuButton>
    </div>
  );
}
