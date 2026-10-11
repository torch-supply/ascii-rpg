"use client";

import dynamic from "next/dynamic";
import { DESCRIPTION, jsonLd, SITE_NAME, SITE_URL, TITLE } from "@/lib/site";

// The whole game touches the DOM/canvas and window, so it must never run
// during SSR/prerender. Load it client-only. (ssr:false is allowed here
// because this is a Client Component.)
const GameRoot = dynamic(() => import("@/components/GameRoot"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-dim">
      loading…
    </div>
  ),
});

// Structured data for search engines. Everything else on this page is drawn
// client-side, so without this (and the <noscript> below) the prerendered HTML
// says nothing about the game beyond its <head>.
const GAME_LD = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: SITE_NAME,
  alternateName: TITLE,
  description: DESCRIPTION,
  url: new URL("/", SITE_URL).href,
  image: new URL("/opengraph-image", SITE_URL).href,
  genre: ["Roguelike", "Role-playing game"],
  gamePlatform: "Web browser",
  applicationCategory: "Game",
  operatingSystem: "Any",
  playMode: "SinglePlayer",
  inLanguage: "en",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(GAME_LD) }}
      />
      <noscript>
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-gold tracking-[0.2em]">{TITLE}</h1>
          <p className="max-w-md text-dim">{DESCRIPTION}</p>
          <p className="text-dim">The game needs JavaScript to run.</p>
        </div>
      </noscript>
      <GameRoot />
    </>
  );
}
