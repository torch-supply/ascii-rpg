import type { Biome, Palette, TileType } from "@/game/core/types";

export const TERRAIN_GLYPH: Record<TileType, string> = {
  wall: "#",
  crackedWall: "%", // fractured — a blast will open it
  floor: "·",
  door: "+",
  exit: ">",
  trap: "·", // hidden — looks like floor until sprung
  trapSprung: "^",
  oil: "≈", // a slick sheen on the floor
  water: "~",
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
  return TERRAIN_GLYPH[t];
}

export const PLAYER_GLYPH = "@";
export const PLAYER_COLOR = "#ffffff";
export const EXIT_COLOR = "#ffd700";
export const TRAP_COLOR = "#ff5a3c";
export const WATER_COLOR = "#3a6ea5";
export const OIL_COLOR = "#6b6f3a";
/** Cracked walls tint the biome wall color a touch toward this warm ochre —
 * enough to notice on a lit tile, easy to miss in the gloom. */
export const CRACKED_WALL_TINT = "#caa46a";
export const CRACKED_WALL_MIX = 0.24;

/** How much to darken remembered-but-not-visible (fog) tiles. */
export const FOG_DIM = 0.34;

export function terrainColor(t: TileType, palette: Palette): string {
  switch (t) {
    case "wall":
      return palette.wall;
    case "crackedWall":
      return mix(palette.wall, CRACKED_WALL_TINT, CRACKED_WALL_MIX);
    case "floor":
    case "trap": // hidden: same as floor
      return palette.floor;
    case "door":
      return palette.accent;
    case "exit":
      return EXIT_COLOR;
    case "trapSprung":
      return TRAP_COLOR;
    case "oil":
      return OIL_COLOR;
    case "water":
      return WATER_COLOR;
  }
}

/** Linearly blend two #rrggbb colors; `t`=0 → a, `t`=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  if (pa.length !== 6 || pb.length !== 6) return a;
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  const lerp = (i: number) => Math.round(ch(pa, i) * (1 - t) + ch(pb, i) * t);
  const to2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${to2(lerp(0))}${to2(lerp(2))}${to2(lerp(4))}`;
}

/** Multiply an #rrggbb color toward black by `factor`. */
export function dim(hex: string, factor: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = Math.round(parseInt(h.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(h.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(h.slice(4, 6), 16) * factor);
  const to2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}
