"use client";

import type { Biome } from "@/game/core/types";
import { gameStore, useGameStore } from "@/store/gameStore";
import { MenuButton } from "@/components/ui/MenuButton";
import { CinematicTitle } from "@/components/ui/CinematicTitle";
import { BoxFrame } from "@/components/ui/BoxFrame";
import { AsciiField } from "@/components/ui/AsciiField";
import { Prose } from "@/components/ui/Prose";

/**
 * Design 1e — chapter transition: a per-biome silhouette-horizon ASCII field
 * behind a box-framed card (title · divider · prose · continue), the frame and
 * glow tinted by the biome accent. Same store wiring as before.
 */

// AsciiField labels the dungeon "pit"; every other biome name matches 1:1.
type FieldBiome =
  | "pit" | "forest" | "marsh" | "mountain" | "castle" | "crypt" | "throne";
function fieldBiome(b: Biome | undefined): FieldBiome {
  return !b || b === "dungeon" ? "pit" : b;
}

export default function Narration() {
  const n = useGameStore((s) => s.narration);
  if (!n) return null;
  const accent = n.accent ?? "#ffb347";
  const chip = "#0b0d0f";

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-auto bg-ink px-6 py-10 text-center">
      {/* biome silhouette-horizon ASCII field */}
      <AsciiField mode="scene" biome={fieldBiome(n.biome)} intensity={0.13} />
      {/* faint biome-accent glow + a vignette that pulls focus to the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(52% 48% at 50% 40%, ${accent}12, transparent 66%)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 54%, rgba(0,0,0,0.62) 100%)" }}
      />

      <BoxFrame
        accent={accent}
        chip={chip}
        className="narr-rise z-10 flex max-w-[min(92vw,46rem)] flex-col items-center gap-[22px] text-center"
        style={{ background: "rgba(9,11,14,0.5)", padding: "46px 60px" }}
      >
        <CinematicTitle title={n.title} gradient={n.artGradient} accent={accent} />

        <Prose text={n.body} className="max-w-[27.5rem] text-sm leading-[1.7] text-fg" />

        <MenuButton accent autoFocus onClick={() => gameStore.getState().continueNarration()}>
          {n.buttonLabel}
          <span className="ml-1 text-xs opacity-70">(Enter)</span>
        </MenuButton>
      </BoxFrame>
    </div>
  );
}
