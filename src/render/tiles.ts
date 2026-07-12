import type { Biome, Palette, TileType } from "@/game/core/types";

export const TERRAIN_GLYPH: Record<TileType, string> = {
  wall: "#",
  floor: "·",
  door: "+",
  exit: ">",
  trap: "·", // hidden — looks like floor until sprung
  trapSprung: "^",
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
  // Armed traps masquerade as floor (that's the trap).
  if (t === "wall") return BIOME_WALL[biome] ?? TERRAIN_GLYPH.wall;
  if (t === "floor" || t === "trap")
    return BIOME_FLOOR[biome] ?? TERRAIN_GLYPH.floor;
  return TERRAIN_GLYPH[t];
}

export const PLAYER_GLYPH = "@";
export const PLAYER_COLOR = "#ffffff";
export const EXIT_COLOR = "#ffd700";
export const TRAP_COLOR = "#ff5a3c";
export const WATER_COLOR = "#3a6ea5";

/** How much to darken remembered-but-not-visible (fog) tiles. */
export const FOG_DIM = 0.34;

export function terrainColor(t: TileType, palette: Palette): string {
  switch (t) {
    case "wall":
      return palette.wall;
    case "floor":
    case "trap": // hidden: same as floor
      return palette.floor;
    case "door":
      return palette.accent;
    case "exit":
      return EXIT_COLOR;
    case "trapSprung":
      return TRAP_COLOR;
    case "water":
      return WATER_COLOR;
  }
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
