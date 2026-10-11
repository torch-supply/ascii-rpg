import { LEVELS } from "@/content/levels";

/**
 * The site's public origin — what `metadataBase`, `robots.txt`, `sitemap.xml`
 * and the JSON-LD all resolve against. A static export doesn't know its own
 * host, so this comes from the environment at build time — and Next ERRORS (not
 * warns) on a relative OG image URL without it, so it can't just be omitted.
 *
 * **Set `NEXT_PUBLIC_SITE_URL` when building for production.** The fallback is
 * localhost on purpose: a wrong-but-obvious URL announces itself the first time
 * anyone pastes a link, whereas defaulting to a plausible-looking domain would
 * silently point the OG tags (and the sitemap) at a host we don't control.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const SITE_NAME = "Ember of Dawn";
export const TITLE = "Ember of Dawn — an ASCII RPG";

/**
 * Two lengths on purpose. Search engines cut the snippet at ~155 characters, so
 * the `<meta name="description">` is the short one and front-loads what the
 * game IS; share cards and the JSON-LD have room for the pitch.
 */
export const SEARCH_DESCRIPTION =
  `A free, single-player ASCII RPG that runs in your browser. Fight up through ` +
  `${LEVELS.length} procedurally generated levels and rekindle the dawn.`;
export const DESCRIPTION =
  `A single-player ASCII RPG that runs entirely in your browser. Wake a captive in the Lich-King's pit, ` +
  `fight up through ${LEVELS.length} procedurally generated levels of cursed wood, flooding crypt and storm-lashed rampart, ` +
  `recover the Sunblade, and rekindle the dawn. No install, no account, no backend.`;

/** Body for a prerendered `<script type="application/ld+json">`. `<` is escaped
 *  so a string in the payload can never close the script tag. */
export function jsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
