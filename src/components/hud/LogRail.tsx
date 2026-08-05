"use client";

import { useGameStore } from "@/store/gameStore";
import { FramePanel } from "./Frame";
import { classifyLog } from "./logStyle";
import { BG } from "./palette";

/**
 * The message log as a vertical rail left of the map.
 *
 * Lines WRAP rather than truncate — that's the whole reason for a tall narrow
 * column — and the rail shows as many as fit, scrolling back through the store's
 * full retained history (`CONFIG.messageLogMax`) rather than a fixed handful.
 *
 * Like the character panel this is a real flex sibling of the map region, not an
 * overlay: it has to take width so the canvas ResizeObserver narrows the
 * viewport instead of the rail covering live map. It is also the more expensive
 * of the two panels — see `LOG_RAIL_WIDTH`.
 */

/** Costs map COLUMNS (cell size derives from height), so it's the number to
 * re-check by eye on the 84-tile maps — the Ramparts especially, where sightline
 * along the wall-walk is the tactical read. */
export const LOG_RAIL_WIDTH = 232;

/** Height of the fade at the top of the rail. It's a MASK on the viewport, not
 * per-line opacity: the fade has to stay pinned to the panel edge while you
 * scroll, so whatever line happens to be topmost is the one fading out. A
 * per-index ramp would scroll away with its lines and leave a hard cut. */
const FADE_PX = 100;

export default function LogRail() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;

  // Newest first. Paired with `flex-col-reverse` this pins the newest line to
  // the BOTTOM and — the reason for the reverse rather than a scroll effect —
  // makes the browser hold the scroll anchored there as messages arrive, while
  // still letting you drag back through the history.
  const recent = [...game.messageLog].reverse();
  const total = game.messageLog.length;

  return (
    <FramePanel
      as="aside"
      corners={["tl", "bl"]}
      className="z-10 flex shrink-0 flex-col overflow-hidden p-3"
      style={{
        width: LOG_RAIL_WIDTH,
        background: `linear-gradient(180deg,${BG.panel},#0e0e12)`,
      }}
      aria-label="Message log"
    >
      <div
        className="no-scrollbar flex min-h-0 flex-1 flex-col-reverse justify-start gap-2 overflow-y-auto"
        style={{
          maskImage: `linear-gradient(to bottom, transparent 0, #000 ${FADE_PX}px)`,
          WebkitMaskImage: `linear-gradient(to bottom, transparent 0, #000 ${FADE_PX}px)`,
          scrollbarWidth: "none",
        }}
      >
        {recent.map((line, i) => {
          const c = classifyLog(line);
          return (
            <span
              // Keyed by the entry's absolute position in the log, so a new
              // message shifts every key and only the newest row mounts fresh —
              // that's what makes the entry animation fire once per message
              // rather than on every re-render.
              key={total - i}
              className={`flex gap-1.5 ${i === 0 ? "log-in" : ""}`}
              style={{
                // Only the newest line gets full weight; the rest sit one step
                // back so recency still reads. The gradual falloff is the mask's
                // job, not this.
                opacity: i === 0 ? 1 : 0.72,
                color: c.color,
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {/* The glyph is its own flex child rather than inline text, so a
                  wrapped line aligns to the TEXT edge instead of tucking under
                  the icon — a hanging indent. */}
              <span className="shrink-0" style={{ color: c.glyphColor }}>
                {c.glyph}
              </span>
              <span className="min-w-0 flex-1">{line}</span>
            </span>
          );
        })}
      </div>
    </FramePanel>
  );
}
