import type { Biome, Palette, TileType } from "@/game/core/types";
import { forageStyle } from "@/content/config";

export const TERRAIN_GLYPH: Record<TileType, string> = {
  wall: "#",
  crackedWall: "%", // fractured — a blast will open it
  floor: "·",
  door: "+", // closed
  doorOpen: "'", // ajar
  exit: ">",
  trap: "·", // hidden — looks like floor until sprung
  trapSprung: "^",
  oil: "≈", // a slick sheen on the floor
  water: "~",
  ice: "▒", // frozen water — a walkable bridge (Frostwalk)
  forage: "%", // default; terrainGlyph swaps per biome (berries vs. arcane mote)
  glowcap: "ψ", // glowing fungus cluster
  // a tangled thorn thicket (snags you; fire clears it). `&` reads as a knot of
  // briar and is pure ASCII; it deliberately avoids `‡`, which the ALTAR uses —
  // a hazard and a boon must never share a glyph (caught by /style's collision
  // report, where only color told them apart).
  bramble: "&",
  sporeVent: "○", // a fumarole seeping toxic spores
  chasm: " ", // a void — an empty dark gap in the floor
};

// Per-biome glyph overrides give each region its own silhouette (colored by the
// level palette). Anything not listed falls back to TERRAIN_GLYPH.
const BIOME_WALL: Partial<Record<Biome, string>> = {
  forest: "♣", // trees
  marsh: "♠", // reeds
  mountain: "▲", // crags
};
const BIOME_FLOOR: Partial<Record<Biome, string>> = {
  forest: ",", // undergrowth
  marsh: ",", // muck
};

export function terrainGlyph(t: TileType, biome: Biome): string {
  // Cracked walls wear the SAME glyph as ordinary walls — only a faint color
  // shift betrays them, so an attentive player spots the weak spot.
  if (t === "wall" || t === "crackedWall")
    return BIOME_WALL[biome] ?? TERRAIN_GLYPH.wall;
  if (t === "floor" || t === "trap")
    return BIOME_FLOOR[biome] ?? TERRAIN_GLYPH.floor;
  if (t === "forage") return forageStyle(biome).glyph;
  return TERRAIN_GLYPH[t];
}

export const PLAYER_GLYPH = "@";
export const PLAYER_COLOR = "#ffffff";
export const EXIT_COLOR = "#ffd700";
export const TRAP_COLOR = "#ff5a3c";
export const WATER_COLOR = "#3a6ea5";
export const OIL_COLOR = "#6b6f3a";
export const GLOWCAP_COLOR = "#6ad6c2"; // soft luminous teal — reads as its own light
export const BRAMBLE_COLOR = "#5f6f37"; // dead thorny green-brown
// toxic acid-green — deliberately brighter/yellower than the biome greens (and
// matched to the poison status tint) so the vent + its haze read as a HAZARD,
// not more foliage.
export const SPORE_VENT_COLOR = "#a6f03a"; // bubbling toxic vent source
export const GAS_COLOR = "#b6f24a"; // drifting poison haze (overlay)
/** Chasm cells get a cool background tint (a cold void), so the empty gap reads
 * as a distinct dark patch instead of the pure-black off-map/unseen area — and
 * clearly enough that the (lethal) drop is legible. */
export const CHASM_BG = "#0e1c34";
export const DOOR_COLOR = "#b07a3f"; // closed door — warm wood, reads as a barrier
export const DOOR_OPEN_COLOR = "#6e5330"; // open door — dim, out of the way
/** Cracked walls tint the biome wall color a touch toward this warm ochre —
 * enough to notice on a lit tile, easy to miss in the gloom. */
export const CRACKED_WALL_TINT = "#d8b878";
export const CRACKED_WALL_MIX = 0.3;
/** how much darker than the wall the crack fissure is painted (0 = black) */
export const CRACKED_WALL_CRACK_DIM = 0.25;

/** How much to darken remembered-but-not-visible (fog) tiles. */
export const FOG_DIM = 0.34;

// ── Atmosphere / weather ────────────────────────────────────────────────────
// Per-biome ambient particles drawn on the overlay canvas (clipped to the
// visible area, off under reduced-motion). "mist" is a few drifting soft blobs;
// the rest are many small moving motes.
export type WeatherKind =
  "mist" | "snow" | "embers" | "dust" | "spores" | "rain" | "ash"; // grey flakes drifting lazily down (the scorched ashen wastes)
export interface AtmosphereDef {
  kind: WeatherKind;
  color: string;
  count: number;
  alpha: number;
}
export const BIOME_ATMOSPHERE: Partial<Record<Biome, AtmosphereDef>> = {
  marsh: { kind: "mist", color: "#8fb488", count: 7, alpha: 0.09 }, // bog vapor
  crypt: { kind: "mist", color: "#9098a8", count: 6, alpha: 0.05 }, // cold haze
  mountain: { kind: "snow", color: "#e6ecff", count: 80, alpha: 0.55 },
  throne: { kind: "embers", color: "#ff8040", count: 44, alpha: 0.6 },
  castle: { kind: "dust", color: "#b8ad94", count: 34, alpha: 0.15 },
  cavern: { kind: "spores", color: "#8ff0dc", count: 30, alpha: 0.4 }, // drifting glow-spores
  ashen: { kind: "ash", color: "#9a9088", count: 46, alpha: 0.34 }, // grey ash sifting down
  grove: { kind: "spores", color: "#d7f06a", count: 34, alpha: 0.34 }, // sickly drifting spores
  undercity: { kind: "mist", color: "#7fb49a", count: 7, alpha: 0.08 }, // dank sewer vapor
};

// Level-wide weather (`LevelConfig.weather`) — overrides the base biome's
// atmosphere for the whole level. Keyed by the core `weather` string.
export const WEATHER_ATMOSPHERE: Partial<Record<string, AtmosphereDef>> = {
  rain: { kind: "rain", color: "#9fb4d0", count: 64, alpha: 0.3 }, // gentle rain
  storm: { kind: "rain", color: "#a9c0e0", count: 110, alpha: 0.46 }, // driving rain (+ lightning)
};

export function terrainColor(
  t: TileType,
  palette: Palette,
  biome: Biome,
): string {
  switch (t) {
    case "wall":
      return palette.wall;
    case "forage":
      return forageStyle(biome).color;
    case "crackedWall":
      return mix(palette.wall, CRACKED_WALL_TINT, CRACKED_WALL_MIX);
    case "floor":
    case "trap": // hidden: same as floor
      return palette.floor;
    case "door":
      return DOOR_COLOR;
    case "doorOpen":
      return DOOR_OPEN_COLOR;
    case "exit":
      return EXIT_COLOR;
    case "trapSprung":
      return TRAP_COLOR;
    case "oil":
      return OIL_COLOR;
    case "ice":
      return "#bfe8ff"; // pale frost
    case "glowcap":
      return GLOWCAP_COLOR;
    case "bramble":
      return BRAMBLE_COLOR;
    case "sporeVent":
      return SPORE_VENT_COLOR;
    case "water":
      return WATER_COLOR;
    case "chasm":
      return "#12141c"; // near-black void (glyph is blank, so mostly unseen)
  }
}

/** Parse "#rrggbb" → [r,g,b]; NaNs on malformed input (guarded by test [0]). */
export function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Perceptual distance between two colors (0 = identical, ~765 = max), using the
 * low-cost "redmean" approximation — closer to human vision than raw RGB.
 *
 * This is a LEGIBILITY tool, not decoration. The game is ASCII: everything is a
 * colored glyph on a dark field, so "can you tell these two apart at a glance"
 * IS the rendering contract. Two separate bugs shipped from getting this wrong
 * (a spore-haze green that vanished into the foliage; a chasm that read as
 * off-map black), which is why test [54] asserts minimum distances.
 */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  const rmean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(
    (2 + rmean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rmean) / 256) * db * db,
  );
}

/** WCAG relative luminance (0–1) — how bright a color reads to the eye. */
export function luminance(hex: string): number {
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** WCAG contrast ratio (1 = identical, 21 = black-on-white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linearly blend two #rrggbb colors; `t`=0 → a, `t`=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  if (pa.length !== 6 || pb.length !== 6) return a;
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  const lerp = (i: number) => Math.round(ch(pa, i) * (1 - t) + ch(pb, i) * t);
  const to2 = (n: number) =>
    Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${to2(lerp(0))}${to2(lerp(2))}${to2(lerp(4))}`;
}

/** Multiply an #rrggbb color toward black by `factor`. */
export function dim(hex: string, factor: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = Math.round(parseInt(h.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(h.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(h.slice(4, 6), 16) * factor);
  const to2 = (n: number) =>
    Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}
