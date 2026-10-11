import {
  DESCRIPTION,
  SEARCH_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  TITLE,
} from "@/lib/site";
import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    // sub-pages get "X · Ember of Dawn"; the /style gallery is the
    // only one today, but the template means new routes can't forget the game
    template: "%s · Ember of Dawn",
  },
  description: SEARCH_DESCRIPTION,
  applicationName: SITE_NAME,
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
    siteName: SITE_NAME,
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
        {/* Vercel Web Analytics: page views only (enable it in the Vercel
            project's Analytics tab). It's a no-op in development, and the
            game is one route, so this counts visits, not play. */}
        <Analytics />
      </body>
    </html>
  );
}
