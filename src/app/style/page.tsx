import type { Metadata } from "next";
import StyleGallery from "@/components/screens/StyleGallery";
import { SITE_NAME } from "@/lib/site";
import { alt, contentType, size } from "../opengraph-image";

// Visual reference at /style — every tile, biome, glyph and tint on one screen
// with live contrast readings. Public, and PRERENDERED: unlike the game it is
// plain DOM built from the content tables (no canvas, store or engine), so the
// exported HTML carries the whole gallery rather than an empty shell.

const TITLE = `Style Gallery · ${SITE_NAME}`;
const DESCRIPTION =
  `Every tile, biome, monster, item and status tint in ${SITE_NAME} on one ` +
  `screen, with live contrast readings — the game's visual reference.`;

// Reuse the root's generated card. Metadata merges SHALLOWLY, so redefining
// `openGraph`/`twitter` below drops the file-convention image the root would
// otherwise hand down — it has to be named again here.
const SHARE_IMAGE = {
  url: "/opengraph-image",
  alt,
  type: contentType,
  ...size,
};

// `canonical` is load-bearing: the root layout's `"/"` would otherwise be
// inherited, declaring this page a duplicate of the game. `openGraph`/`twitter`
// are overridden for the same reason — inherited, they'd share as the game's
// title and URL.
export const metadata: Metadata = {
  title: "Style Gallery",
  description: DESCRIPTION,
  alternates: { canonical: "/style" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    url: "/style",
    locale: "en_US",
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

export default function StylePage() {
  return <StyleGallery />;
}
