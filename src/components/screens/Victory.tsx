"use client";

import { gameStore } from "@/store/gameStore";
import { VICTORY } from "@/content/ascii";
import { MenuButton } from "@/components/ui/MenuButton";
import { CinematicTitle } from "@/components/ui/CinematicTitle";
import { Prose } from "@/components/ui/Prose";
import { RunStats } from "@/components/ui/RunStats";
import { AsciiField } from "@/components/ui/AsciiField";
import { BoxFrame } from "@/components/ui/BoxFrame";

export default function Victory() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-auto bg-ink px-6 py-10 text-center">
      {/* dawn: warm gold light-motes rising, a brightening sky, a soft warm
         vignette that glows outward rather than darkening to black */}
      <AsciiField
        mode="abstract"
        biome="throne"
        bottom
        intensity={0.18}
        className="dawn-rise"
      />
      <div
        aria-hidden
        className="dawn-rise pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 42%, rgba(255,205,100,0.18), transparent 72%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 60%, rgba(28,17,3,0.42) 100%)",
        }}
      />

      <BoxFrame
        accent="#ffd24d"
        chip="#0c0c0e"
        className="narr-rise z-10 flex w-[min(92vw,44rem)] flex-col items-center gap-7"
        style={{ background: "rgba(9,9,12,0.5)", padding: "46px 56px" }}
      >
        <CinematicTitle
          title={VICTORY.title}
          gradient={VICTORY.gradient}
          accent="#ffd24d"
          shimmer
        />

        <div className="narr-rise" style={{ animationDelay: "220ms" }}>
          <Prose
            text={VICTORY.body}
            className="max-w-xl text-sm leading-relaxed text-fg"
          />
        </div>

        <div className="narr-rise" style={{ animationDelay: "340ms" }}>
          <RunStats animate />
        </div>

        <div className="narr-rise" style={{ animationDelay: "460ms" }}>
          <MenuButton
            accent
            autoFocus
            onClick={() => gameStore.getState().quitToTitle()}
          >
            ▸ Return to title
            <span className="ml-1 text-xs opacity-70">(Enter)</span>
          </MenuButton>
        </div>
      </BoxFrame>
    </div>
  );
}
