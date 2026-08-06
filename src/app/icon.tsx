import { ImageResponse } from "next/og";

/**
 * The favicon: the player's `@` on the game's ink background.
 *
 * Generated rather than shipped as a binary so it stays in step with the
 * palette — the colours here are the real `PLAYER_COLOR` and the ember accent,
 * not a designer's copy of them. `@` is the right mark because it IS the player:
 * anyone who has seen the game recognises it, and at 32px a glyph survives where
 * a detailed illustration would turn to mush.
 *
 * Runs at BUILD time under `output: "export"` — Next prerenders metadata images
 * for static routes, so this ships as a plain PNG with no server involved.
 */
// Required by `output: "export"`: metadata images compile to Route Handlers, and
// a static export has no server to run one at request time, so this pins it to
// build-time generation. Without it `next build` FAILS — it does not silently
// skip the image, which is how this requirement was found.
export const dynamic = "force-static";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0d0d0d",
        // a hairline ember rim so the tile reads as a lit terminal cell rather
        // than a black square, which is what it becomes on a dark browser chrome
        border: "1px solid #ff9d3c",
        color: "#ffffff",
        fontSize: 22,
        lineHeight: 1,
      }}
    >
      @
    </div>,
    size,
  );
}
