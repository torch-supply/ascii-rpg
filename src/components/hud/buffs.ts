/** The six terrain/combat buffs, with the app's existing glyphs and colours —
 * the compact tokens at the right of the HUD's level row. Its own module so the
 * `/style` gallery can show them without importing the HUD (and through it the
 * store and engine). */
export const BUFFS: {
  key: string;
  glyph: string;
  label: string;
  color: string;
}[] = [
  { key: "ward", glyph: "⛨", label: "ward", color: "#7fdfff" },
  { key: "might", glyph: "⚔", label: "might", color: "#ff9d3c" },
  { key: "levitate", glyph: "☁", label: "float", color: "#a9d8ff" },
  { key: "emberstep", glyph: "✷", label: "ember", color: "#ff7a3c" },
  { key: "frostwalk", glyph: "❆", label: "rime", color: "#bfe8ff" },
  { key: "shadow", glyph: "◐", label: "shadow", color: "#9a8cff" },
];
