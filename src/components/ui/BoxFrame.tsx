"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * The ASCII box frame (splash / narration pick 1b, 1e): a subtle blurred panel
 * with ╔ ╗ ╚ ╝ corner glyphs and a centred ◈ pip on the top edge, all in the
 * biome accent. The corner/pip glyphs sit on small ink chips so they read as
 * breaks in the border rather than floating characters.
 *
 * `accent`  border/glyph color (biome accent — e.g. #ffb347 ember, #a9e0ff mountain)
 * `chip`    the ink color the glyphs punch through (match the screen bg; default ink)
 */
export function BoxFrame({
  accent = "#ffb347",
  chip = "#0c0c0e",
  className = "",
  style,
  children,
}: {
  accent?: string;
  chip?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const glyph = (extra: CSSProperties): CSSProperties => ({
    position: "absolute",
    color: accent,
    background: chip,
    lineHeight: 1,
    ...extra,
  });
  return (
    <div
      className={`relative ${className}`}
      style={{
        border: "1px solid rgba(158,160,173,0.4)",
        outline: "1px solid rgba(158,160,173,0.2)",
        outlineOffset: "5px",
        backdropFilter: "blur(1.5px)",
        ...style,
      }}
    >
      <span style={glyph({ top: -12, left: -9, fontSize: 17 })}>╔</span>
      <span style={glyph({ top: -12, right: -9, fontSize: 17 })}>╗</span>
      <span style={glyph({ bottom: -12, left: -9, fontSize: 17 })}>╚</span>
      <span style={glyph({ bottom: -12, right: -9, fontSize: 17 })}>╝</span>
      <span
        style={glyph({
          top: -9,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "0 10px",
          fontSize: 11,
        })}
      >
        ◈
      </span>
      {children}
    </div>
  );
}
