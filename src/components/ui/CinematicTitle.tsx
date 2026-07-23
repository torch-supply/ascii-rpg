"use client";

import type { CSSProperties } from "react";
import { AccentDivider } from "@/components/ui/AccentDivider";

/**
 * The shared cinematic screen title used by the narration, victory, and
 * game-over screens: a big title — painted with a biome/ending gradient, else a
 * flat accent + soft glow — over a thin accent divider with a centred sigil.
 * Rises in via `.narr-rise`. `shimmer` sweeps a bright band across a gradient
 * title (reserved for the payoff screens).
 */
export function CinematicTitle({
  title,
  gradient,
  accent = "#ffd24d",
  shimmer = false,
  className = "text-4xl sm:text-5xl",
}: {
  title: string;
  gradient?: string;
  accent?: string;
  shimmer?: boolean;
  className?: string;
}) {
  const clip: CSSProperties = {
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "transparent",
  };
  const glow = `drop-shadow(0 0 20px ${accent}55)`;
  let style: CSSProperties;
  if (gradient && shimmer) {
    style = {
      ...clip,
      backgroundImage: `linear-gradient(100deg, transparent 42%, rgba(255,248,220,0.85) 50%, transparent 58%), ${gradient}`,
      backgroundSize: "250% 100%, 100% 100%",
      backgroundRepeat: "no-repeat",
      filter: glow,
    };
  } else if (gradient) {
    style = { ...clip, backgroundImage: gradient, filter: glow };
  } else {
    style = { color: accent, textShadow: `0 0 20px ${accent}55` };
  }

  return (
    <div className="narr-rise flex flex-col items-center gap-5">
      <h2
        className={`whitespace-pre-line text-balance font-semibold uppercase leading-tight tracking-[0.2em] ${
          gradient && shimmer ? "ascii-shimmer" : ""
        } ${className}`}
        style={style}
      >
        {title}
      </h2>
      <AccentDivider accent={accent} />
    </div>
  );
}
