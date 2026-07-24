"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { ALTAR_OFFERS, canAffordAltar } from "@/game/core/altar";
import { BoxFrame } from "@/components/ui/BoxFrame";

export default function AltarModal() {
  const game = useGameStore((s) => s.game);
  const altar = useGameStore((s) => s.activeAltar);
  if (!game || !altar) return null;
  const offer = ALTAR_OFFERS[altar.kind];
  const afford = canAffordAltar(game, altar.kind);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/80 px-4">
      <BoxFrame
        accent="#7fdfff"
        chip="#0c0c0e"
        className="flex w-full max-w-md flex-col items-center gap-4 text-center"
        style={{
          background: "rgba(16,16,20,0.94)",
          boxShadow: "0 0 24px rgba(200,107,255,0.15)",
          padding: "26px 30px",
        }}
      >
        <div className="text-2xl text-magic">‡</div>
        <h2 className="text-balance text-lg uppercase tracking-[0.25em] text-magic">
          {offer.title}
        </h2>
        <p className="text-balance text-sm leading-relaxed text-dim">
          {offer.prompt}
        </p>
        {!afford.ok && <p className="text-xs text-hp">{afford.reason}</p>}

        <div className="flex flex-wrap justify-center gap-3 pt-1">
          <button
            autoFocus
            disabled={!afford.ok}
            onClick={() => gameStore.getState().acceptAltar()}
            className={`border px-4 py-2 text-sm transition-colors ${
              afford.ok
                ? "border-magic/60 text-magic hover:bg-magic/15"
                : "cursor-not-allowed border-edge text-edge"
            }`}
          >
            {offer.acceptLabel}
          </button>
          <button
            onClick={() => gameStore.getState().declineAltar()}
            className="border border-edge px-4 py-2 text-sm text-fg transition-colors hover:border-gold hover:text-gold"
          >
            Leave it <span className="text-xs opacity-70">(Esc)</span>
          </button>
        </div>
      </BoxFrame>
    </div>
  );
}
