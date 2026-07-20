"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { MenuButton } from "@/components/ui/MenuButton";
import { CinematicTitle } from "@/components/ui/CinematicTitle";
import { Prose } from "@/components/ui/Prose";

export default function Narration() {
  const n = useGameStore((s) => s.narration);
  if (!n) return null;

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-7 overflow-auto bg-ink px-6 py-10 text-center">
      <CinematicTitle title={n.title} gradient={n.artGradient} accent={n.accent} />

      <div className="narr-rise" style={{ animationDelay: "200ms" }}>
        <Prose text={n.body} className="max-w-xl text-sm leading-relaxed text-fg" />
      </div>

      <div className="narr-rise" style={{ animationDelay: "400ms" }}>
        <MenuButton accent autoFocus onClick={() => gameStore.getState().continueNarration()}>
          {n.buttonLabel}
          <span className="ml-1 text-xs opacity-70">(Enter)</span>
        </MenuButton>
      </div>
    </div>
  );
}
