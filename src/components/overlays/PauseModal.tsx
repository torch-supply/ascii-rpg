"use client";

import { gameStore } from "@/store/gameStore";
import { MenuButton } from "@/components/ui/MenuButton";
import { BoxFrame } from "@/components/ui/BoxFrame";

export default function PauseModal() {
  const s = () => gameStore.getState();
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/75 px-4">
      <BoxFrame
        accent="#ffb347"
        chip="#0c0c0e"
        className="flex flex-col items-center gap-4 text-center"
        style={{ background: "rgba(16,16,20,0.94)", padding: "28px 34px" }}
      >
        <h2 className="text-balance text-lg uppercase tracking-[0.3em] text-gold">Paused</h2>
        <div className="flex flex-col gap-2">
          <MenuButton accent autoFocus onClick={() => s().setMode("playing")}>
            ▸ Resume <span className="text-xs opacity-70">(Esc)</span>
          </MenuButton>
          <MenuButton onClick={() => s().setMode("help")}>
            ? How to play
          </MenuButton>
          <MenuButton onClick={() => s().quitToTitle()}>
            ◂ Return to title
          </MenuButton>
        </div>
        <p className="text-balance text-[11px] text-edge">
          Your run is saved automatically — you can resume from the title.
        </p>
      </BoxFrame>
    </div>
  );
}
