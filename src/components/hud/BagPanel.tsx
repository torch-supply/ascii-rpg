"use client";

import { ITEMS } from "@/content/items";
import { hotbar } from "@/game/core/hotbar";
import { gameStore, useGameStore } from "@/store/gameStore";

/**
 * The always-up bag strip down the right edge of the play area.
 *
 * It is a LEGEND, not a control surface. The number keys 1-9 are already bound
 * globally in `keymap.ts` and act during play; this panel exists so you can see
 * what each one currently holds without opening the sheet. Nothing here is
 * focusable — no tab stops, no focus ring, no "how do I get keyboard control
 * back to the map". Clicking is a convenience that routes to the very same
 * `useBagSlot`, and it deliberately blurs (`onMouseDown` preventDefault) so
 * focus never parks on a row where a subsequent arrow key would re-fire it
 * instead of moving the player.
 *
 * Width is the one number worth tuning by eye: the viewport's cell size is set
 * by HEIGHT (`ch / TARGET_ROWS`), so this costs map COLUMNS rather than glyph
 * size. That's the cheap axis — but on the wide maps (Blackwood, Ramparts at 84
 * tiles) columns are exactly what you want, so keep it narrow.
 */
const PANEL_WIDTH = "14rem";

export default function BagPanel() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const slots = hotbar(game.player);

  return (
    <aside
      className="relative z-10 flex shrink-0 flex-col gap-[6px] overflow-y-auto border-l border-edge px-2 py-[10px]"
      style={{ width: PANEL_WIDTH }}
      aria-label="Bag hotkeys"
    >
      <div className="px-0.5 pb-0.5 text-[10px] uppercase tracking-[0.2em] text-[#6f7078]">
        Bag
      </div>

      {slots.length === 0 ? (
        <p className="px-0.5 text-[11px] leading-[1.5] text-[#5a5a64]">
          Empty. Walk over items to pick them up.
        </p>
      ) : (
        slots.map((entry, i) => {
          const n = i + 1;
          if (!entry) {
            // A reserved-but-spent slot. Rendered rather than skipped so the
            // numbering stays readable and you can see what ran out.
            return (
              <div
                key={n}
                className="flex items-center gap-1.5 border border-[#1e1e26] px-1.5 py-[5px] text-[11px] text-[#3d3d46]"
              >
                <span>[{n}]</span>
                <span>—</span>
              </div>
            );
          }
          const def = ITEMS[entry.defId];
          return (
            <button
              key={n}
              type="button"
              tabIndex={-1}
              title={`${def.name}${entry.count > 1 ? ` ×${entry.count}` : ""}`}
              onMouseDown={(e) => e.preventDefault()} // never take focus
              onClick={() => gameStore.getState().useBagSlot(n)}
              className="flex items-center gap-1.5 border border-[#2c2c36] bg-[rgba(18,18,22,0.5)] px-1.5 py-[5px] text-left text-[11px] hover:border-gold/50 hover:bg-[rgba(40,34,20,0.5)]"
            >
              <span className="shrink-0 text-magic">[{n}]</span>
              <span className="shrink-0" style={{ color: def.color }}>
                {def.glyph}
              </span>
              <span className="truncate text-fg">{def.name}</span>
              {entry.count > 1 && (
                <span className="ml-auto shrink-0 text-[#6f7078]">
                  ×{entry.count}
                </span>
              )}
            </button>
          );
        })
      )}

      <p className="mt-auto px-0.5 pt-2 text-[10px] leading-[1.5] text-[#5a5a64]">
        Press the number or click. Using an item spends a turn.
      </p>
    </aside>
  );
}
