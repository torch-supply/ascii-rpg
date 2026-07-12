"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { MenuButton } from "@/components/ui/MenuButton";

export default function Narration() {
  const n = useGameStore((s) => s.narration);
  if (!n) return null;

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-7 overflow-auto bg-ink px-6 py-10 text-center">
      <h2 className="text-lg uppercase tracking-[0.3em] text-gold">
        {n.title}
      </h2>
      {n.art && (
        <pre className="ascii text-[10px] leading-[1.1] text-magic sm:text-xs">
          {n.art}
        </pre>
      )}
      <p className="max-w-xl whitespace-pre-line text-sm leading-relaxed text-fg">
        {n.body}
      </p>
      <MenuButton accent onClick={() => gameStore.getState().continueNarration()}>
        {n.buttonLabel}
        <span className="ml-1 text-xs opacity-70">(Enter)</span>
      </MenuButton>
    </div>
  );
}
