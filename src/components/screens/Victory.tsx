"use client";

import { gameStore } from "@/store/gameStore";
import { VICTORY } from "@/content/ascii";
import { MenuButton } from "@/components/ui/MenuButton";
import { CinematicTitle } from "@/components/ui/CinematicTitle";
import { Prose } from "@/components/ui/Prose";
import { RunStats } from "@/components/ui/RunStats";

export default function Victory() {
  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-7 overflow-auto bg-ink px-6 py-10 text-center">
      <CinematicTitle title={VICTORY.title} gradient={VICTORY.gradient} accent="#ffd24d" shimmer />

      <div className="narr-rise" style={{ animationDelay: "220ms" }}>
        <Prose text={VICTORY.body} className="max-w-xl text-sm leading-relaxed text-fg" />
      </div>

      <div className="narr-rise" style={{ animationDelay: "340ms" }}>
        <RunStats />
      </div>

      <div className="narr-rise" style={{ animationDelay: "460ms" }}>
        <MenuButton accent autoFocus onClick={() => gameStore.getState().quitToTitle()}>
          ▸ Return to title
          <span className="ml-1 text-xs opacity-70">(Enter)</span>
        </MenuButton>
      </div>
    </div>
  );
}
