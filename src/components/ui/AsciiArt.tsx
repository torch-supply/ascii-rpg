"use client";

import type { CSSProperties } from "react";

/**
 * Renders monospace ASCII art with perfect column alignment (white-space: pre,
 * line-height 1, mono font — set by the `.ascii` class). Optionally paints it
 * with a CSS gradient via background-clip, which gives rich multi-hue coloring
 * WITHOUT touching the characters, so alignment can never break.
 */
export function AsciiArt({
  art,
  gradient,
  color = "#ffe14d",
  className = "",
}: {
  art: string;
  gradient?: string;
  color?: string;
  className?: string;
}) {
  const style: CSSProperties = gradient
    ? {
        backgroundImage: gradient,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        color: "transparent",
      }
    : { color };

  // Strip leading/trailing blank lines (an authoring artifact of the `\n...\n`
  // raw strings) so stacked art blocks sit tight against each other.
  const content = art.replace(/^\n+/, "").replace(/\n+$/, "");

  return (
    <pre className={`ascii ${className}`} style={style}>
      {content}
    </pre>
  );
}
