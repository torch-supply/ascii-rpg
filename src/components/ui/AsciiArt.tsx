"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Renders monospace ASCII art with perfect column alignment (white-space: pre,
 * line-height 1, mono font — via the `.ascii` class). Coloring options, in
 * priority order:
 *   • `colors` + inline `{key}` tokens → per-REGION color (distinct zones within
 *     a piece; tokens are zero-width so alignment is untouched).
 *   • `lineColors` → per-ROW color (one entry per line).
 *   • `gradient` → a CSS gradient painted over the text.
 *   • `color` → a single flat color.
 */
export function AsciiArt({
  art,
  gradient,
  color = "#ffe14d",
  lineColors,
  colors,
  className = "",
}: {
  art: string;
  gradient?: string;
  color?: string;
  lineColors?: string[];
  colors?: Record<string, string>;
  className?: string;
}) {
  // Strip leading/trailing blank lines (an artifact of the `\n...\n` raw
  // strings) so stacked art blocks sit tight.
  const content = art.replace(/^\n+/, "").replace(/\n+$/, "");
  const cls = `ascii ${className}`;

  // ── per-region: inline {key} tokens ──
  if (colors) {
    const runs: { text: string; color: string }[] = [];
    const re = /\{([a-z0-9_]+)\}/g;
    let cur = color;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m.index > last)
        runs.push({ text: content.slice(last, m.index), color: cur });
      cur = colors[m[1]] ?? cur;
      last = re.lastIndex;
    }
    if (last < content.length)
      runs.push({ text: content.slice(last), color: cur });
    return (
      <pre className={cls}>
        {runs.map((r, i) => (
          <span key={i} style={{ color: r.color }}>
            {r.text}
          </span>
        ))}
      </pre>
    );
  }

  // ── per-row colors ──
  if (lineColors) {
    const lines = content.split("\n");
    const nodes: ReactNode[] = [];
    lines.forEach((line, i) => {
      nodes.push(
        <span key={i} style={{ color: lineColors[i] ?? color }}>
          {line}
        </span>
      );
      if (i < lines.length - 1) nodes.push("\n");
    });
    return <pre className={cls}>{nodes}</pre>;
  }

  // ── gradient / flat color ──
  const style: CSSProperties = gradient
    ? {
        backgroundImage: gradient,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        color: "transparent",
      }
    : { color };
  return (
    <pre className={cls} style={style}>
      {content}
    </pre>
  );
}
