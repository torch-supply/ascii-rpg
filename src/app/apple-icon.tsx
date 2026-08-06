import { ImageResponse } from "next/og";

/**
 * The iOS home-screen icon. Same mark as `icon.tsx`, but at 180px there's room
 * for the ember glow the 32px version can't afford — and Apple composites onto
 * an opaque tile, so the background has to be solid rather than transparent.
 */
// Required by `output: "export"`: metadata images compile to Route Handlers, and
// a static export has no server to run one at request time, so this pins it to
// build-time generation. Without it `next build` FAILS — it does not silently
// skip the image, which is how this requirement was found.
export const dynamic = "force-static";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 50% 58%, #2a1a0c 0%, #0d0d0d 70%)",
        color: "#ffffff",
        fontSize: 104,
        lineHeight: 1,
      }}
    >
      @
    </div>,
    size,
  );
}
