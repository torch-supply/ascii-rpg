"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { MenuButton } from "@/components/ui/MenuButton";
import { AsciiArt } from "@/components/ui/AsciiArt";
import { Prose } from "@/components/ui/Prose";

export default function Narration() {
  const n = useGameStore((s) => s.narration);
  if (!n) return null;

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 overflow-auto bg-ink px-6 py-10 text-center">
      <h2 className="text-balance text-lg uppercase tracking-[0.3em] text-gold">
        {n.title}
      </h2>
      {n.art && (
        <AsciiArt
          art={n.art}
          gradient={n.artGradient}
          lineColors={n.artLineColors}
          colors={n.artColors}
          color="#7fdfff"
          className="text-[11px] sm:text-sm"
        />
      )}
      <Prose text={n.body} className="max-w-xl text-sm text-fg" />
      <MenuButton accent autoFocus onClick={() => gameStore.getState().continueNarration()}>
        {n.buttonLabel}
        <span className="ml-1 text-xs opacity-70">(Enter)</span>
      </MenuButton>
    </div>
  );
}
