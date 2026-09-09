"use client";

import { useState } from "react";
import { useGameStore } from "@/store/gameStore";
import { FramePanel } from "./Frame";
import { classifyLog } from "./logStyle";
import { BG } from "./palette";
import { loreByTitle } from "@/content/lore";

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
 *
 * TWO TABS share the rail: the running log, and a LORE journal of everything
 * read so far. The journal exists because `GameState.lore` is per-level — a
 * fresh `beginLevel` discards it — so a fragment you read two levels ago was
 * simply gone, which is a poor deal for the one collectible whose entire payoff
 * is the text. It reads `player.loreSeen` (titles, carried across levels) and
 * resolves the prose through `loreByTitle`.
 *
 * The tabs live INSIDE the existing panel rather than adding chrome: the rail
 * already costs map columns, and a second panel would cost more.
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

type Tab = "log" | "lore";

function TabButton({
  id,
  active,
  count,
  onPick,
  children,
}: {
  id: Tab;
  active: boolean;
  count?: number;
  onPick: (t: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Focus must not park here: an arrow key afterwards would re-fire the
      // button instead of moving the player — the same rule the bag panel keeps.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(id)}
      className="flex-1 border-b px-1 pb-1 text-[10px] uppercase tracking-[0.18em] transition-colors"
      style={{
        color: active ? "#ffd24d" : "#6a6a76",
        borderColor: active ? "#ffd24d" : "transparent",
      }}
    >
      {children}
      {count != null && count > 0 && (
        <span style={{ opacity: 0.6 }}> {count}</span>
      )}
    </button>
  );
}

export default function LogRail() {
  const game = useGameStore((s) => s.game);
  const [tab, setTab] = useState<Tab>("log");
  if (!game) return null;
  const seen = game.player.loreSeen ?? [];

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
      <div className="mb-2 flex shrink-0 gap-1">
        <TabButton id="log" active={tab === "log"} onPick={setTab}>
          Log
        </TabButton>
        <TabButton
          id="lore"
          active={tab === "lore"}
          count={seen.length}
          onPick={setTab}
        >
          Lore
        </TabButton>
      </div>

      {tab === "lore" ? (
        <div
          className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {seen.length === 0 ? (
            <p className="text-[12px] leading-[1.5] text-[#5a5a64]">
              Nothing read yet. Inscriptions and remains are tucked away off the
              main path — step on a ¶ to read one, and it will be kept here.
            </p>
          ) : (
            // Newest first: you are most likely reaching for the one you just
            // found and walked away from.
            [...seen].reverse().map((title) => {
              const e = loreByTitle(title);
              if (!e) return null;
              return (
                <div key={title}>
                  <div
                    className="text-[11px] uppercase tracking-[0.14em]"
                    style={{ color: "#cbb488" }}
                  >
                    ¶ {e.title}
                  </div>
                  <p
                    className="mt-1 whitespace-pre-line text-[12px] leading-[1.5]"
                    style={{ color: "#9a9aa6" }}
                  >
                    {e.text}
                  </p>
                </div>
              );
            })
          )}
        </div>
      ) : (
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
      )}
    </FramePanel>
  );
}
