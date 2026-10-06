"use client";

import dynamic from "next/dynamic";
import { DEV } from "@/lib/env";

// Dev-only visual reference at /style — every tile, biome, glyph and tint on one
// screen with live contrast readings. `DEV` is a NODE_ENV compare, so the whole
// gallery tree-shakes out of the production export (it renders a stub instead).
const StyleGallery = dynamic(
  () => import("@/components/screens/StyleGallery"),
  { ssr: false },
);

export default function StylePage() {
  if (!DEV)
    return (
      <div className="flex h-full w-full items-center justify-center text-dim">
        not available
      </div>
    );
  return <StyleGallery />;
}
