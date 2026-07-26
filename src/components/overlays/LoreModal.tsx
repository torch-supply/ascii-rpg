"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { BoxFrame } from "@/components/ui/BoxFrame";

// Flavor per prop kind: the glyph + how the reading is framed.
const KIND = {
  inscription: { glyph: "¶", verb: "You make out the words:" },
  remains: { glyph: "¶", verb: "Among the remains, you find:" },
} as const;

export default function LoreModal() {
  const lore = useGameStore((s) => s.activeLore);
  if (!lore) return null;
  const flavor = KIND[lore.kind];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/80 px-4">
      <BoxFrame
        accent="#cbb488"
        chip="#0c0c0e"
        className="flex w-full max-w-md flex-col items-center gap-4 text-center"
        style={{
          background: "rgba(16,16,20,0.94)",
          boxShadow: "0 0 24px rgba(203,180,136,0.14)",
          padding: "26px 30px",
        }}
      >
        <div className="text-2xl text-gold">{flavor.glyph}</div>
        <h2 className="text-balance text-lg uppercase tracking-[0.22em] text-gold">
          {lore.title}
        </h2>
        <p className="text-xs uppercase tracking-[0.2em] text-edge">
          {flavor.verb}
        </p>
        <p className="text-balance text-sm italic leading-relaxed text-dim">
          {lore.text}
        </p>

        <div className="pt-1">
          <button
            autoFocus
            onClick={() => gameStore.getState().closeLore()}
            className="border border-edge px-4 py-2 text-sm text-fg transition-colors hover:border-gold hover:text-gold"
          >
            Move on <span className="text-xs opacity-70">(Enter)</span>
          </button>
        </div>
      </BoxFrame>
    </div>
  );
}
