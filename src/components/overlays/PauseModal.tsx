"use client";

import { gameStore } from "@/store/gameStore";
import { MenuButton } from "@/components/ui/MenuButton";

export default function PauseModal() {
  const s = () => gameStore.getState();
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/75">
      <div className="flex flex-col items-center gap-4 border border-edge bg-panel px-8 py-7 text-center">
        <h2 className="text-lg uppercase tracking-[0.3em] text-gold">Paused</h2>
        <div className="flex flex-col gap-2">
          <MenuButton accent onClick={() => s().setMode("playing")}>
            ▸ Resume <span className="text-xs opacity-70">(Esc)</span>
          </MenuButton>
          <MenuButton onClick={() => s().setMode("help")}>
            ? How to play
          </MenuButton>
          <MenuButton onClick={() => s().quitToTitle()}>
            ◂ Return to title
          </MenuButton>
        </div>
        <p className="text-[11px] text-edge">
          Your run is saved automatically — you can resume from the title.
        </p>
      </div>
    </div>
  );
}
