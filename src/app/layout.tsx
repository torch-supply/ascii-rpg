import { LEVELS } from "@/content/levels";
import type { Metadata, Viewport } from "next";
import "./globals.css";

const TITLE = "Ember of Dawn — an ASCII RPG";
const DESCRIPTION =
  `A single-player ASCII RPG that runs entirely in your browser. Wake a captive in the Lich-King's pit, ` +
  `fight up through ${LEVELS.length} procedurally generated levels of cursed wood, flooding crypt and storm-lashed rampart, ` +
  `recover the Sunblade, and rekindle the dawn. No install, no account, no backend.`;

/**
 * Where relative metadata URLs resolve from. A static export doesn't know its
 * own host, so this comes from the environment at build time — and Next ERRORS
 * (not warns) on a relative OG image URL without it, so it can't just be
 * omitted.
 *
 * **Set `NEXT_PUBLIC_SITE_URL` when building for production.** The fallback is
 * localhost on purpose: a wrong-but-obvious URL announces itself the first time
 * anyone pastes a link, whereas defaulting to a plausible-looking domain would
 * silently point the OG tags at a host we don't control.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    // sub-pages get "X · Ember of Dawn"; the dev-only /style gallery is the
    // only one today, but the template means new routes can't forget the game
    template: "%s · Ember of Dawn",
  },
  description: DESCRIPTION,
  applicationName: "Ember of Dawn",
  keywords: [
    "roguelike",
    "ASCII",
    "RPG",
    "browser game",
    "procedural generation",
    "turn-based",
    "dungeon crawler",
  ],
  category: "games",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Ember of Dawn",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
  // `icon.tsx`, `apple-icon.tsx` and `opengraph-image.tsx` are picked up by file
  // convention — declaring them here too would double the emitted tags.
};

export const viewport: Viewport = {
  themeColor: "#0d0d0d", // matches the map plate, so mobile chrome blends in
  colorScheme: "dark",
  // The game fills the window and owns its own input; letting the page zoom or
  // rubber-band just fights the canvas.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-ink text-fg font-mono antialiased select-none">
        {children}
      </body>
    </html>
  );
}
