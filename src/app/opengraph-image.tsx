import { ImageResponse } from "next/og";
import { LEVELS } from "@/content/levels";
import { SUBTITLE } from "@/content/ascii";
import { EXIT_COLOR, PLAYER_COLOR } from "@/render/tiles";
import { BG, MARK, TEXT } from "@/components/hud/palette";

/**
 * The social-share card.
 *
 * Built from the game's OWN data — `LEVELS` for the level count, `SUBTITLE`,
 * and the real glyph colours from `tiles.ts` / the HUD palette — so it can't
 * quietly describe a different game than the one that ships. The framed plate
 * borrows the HUD's chrome language (`hud/palette.ts`) but deliberately skips
 * its corner glyphs: those exist to seat a panel in the shell gutter, and on a
 * single plate they'd be four faint marks that vanish at thumbnail scale.
 *
 * **The monospace problem.** `ImageResponse` renders through Satori, which has
 * only the bundled Geist (proportional) — an ASCII game rendered in a
 * proportional face looks wrong, and any real ASCII art would misalign outright.
 * So the glyph strip lays each character in a FIXED-WIDTH cell, exactly as the
 * game's own renderer does. The grid comes from the layout, not the typeface,
 * which makes the font irrelevant and avoids shipping a font binary against the
 * 500KB ImageResponse budget.
 *
 * Satori is flexbox-only and requires an explicit `display: flex` on any element
 * with more than one child — hence the verbosity below.
 */
// Required by `output: "export"`: metadata images compile to Route Handlers, and
// a static export has no server to run one at request time, so this pins it to
// build-time generation. Without it `next build` FAILS — it does not silently
// skip the image, which is how this requirement was found.
export const dynamic = "force-static";

export const alt = "Ember of Dawn — an ASCII RPG";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Glyphs the player actually meets, in their real in-game colours. */
const LEGEND: [string, string][] = [
  ["@", PLAYER_COLOR], // you
  ["#", "#6b6b78"], // wall
  ["♣", "#3f8f4f"], // the Blackwood
  ["~", "#3a6ea5"], // water
  ["!", "#e05a8a"], // potion
  ["*", "#9fdfff"], // a quest shard
  ["†", "#cfd6e0"], // the dead
  ["‡", "#c86bff"], // an altar
  [">", EXIT_COLOR], // the way onward
];

const CELL = 58;

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: BG.shell,
        padding: 48,
      }}
    >
      {/* the framed plate — the HUD's own chrome language */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          border: `2px solid ${MARK.frame}`,
          background: `linear-gradient(180deg, ${BG.header} 0%, ${BG.map} 100%)`,
        }}
      >
        {/* an ember bloom behind the title, as if a fire were just off-frame */}
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 200,
            width: 800,
            height: 340,
            background:
              "radial-gradient(circle, rgba(255,157,60,0.18) 0%, rgba(255,157,60,0) 70%)",
          }}
        />

        <div
          style={{
            fontSize: 20,
            letterSpacing: 14,
            color: TEXT.secondary,
            display: "flex",
          }}
        >
          {SUBTITLE}
        </div>

        <div
          style={{
            marginTop: 18,
            fontSize: 104,
            letterSpacing: 6,
            color: "#ffd24d",
            display: "flex",
          }}
        >
          EMBER OF DAWN
        </div>

        <div
          style={{
            marginTop: 22,
            fontSize: 27,
            color: TEXT.primary,
            display: "flex",
          }}
        >
          Escape the pit. Recover the Sunblade. End the Lich-King.
        </div>

        {/* the glyph strip — a fixed cell per character, so alignment comes
              from the layout rather than from font metrics */}
        <div style={{ marginTop: 46, display: "flex" }}>
          {LEGEND.map(([glyph, color]) => (
            <div
              key={glyph}
              style={{
                width: CELL,
                height: CELL,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 34,
                color,
                border: `1px solid ${MARK.separator}`,
              }}
            >
              {glyph}
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 34,
            fontSize: 19,
            letterSpacing: 4,
            // secondary, not tertiary: share cards get scaled to a thumbnail,
            // and the HUD's faintest tier disappears entirely at that size
            color: TEXT.secondary,
            display: "flex",
          }}
        >
          {LEVELS.length} PROCEDURAL LEVELS · TURN-BASED · PLAYS IN YOUR BROWSER
        </div>
      </div>
    </div>,
    size,
  );
}
