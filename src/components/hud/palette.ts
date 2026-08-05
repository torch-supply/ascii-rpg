/**
 * The HUD chrome palette — the "Grimoire · slate" greys.
 *
 * A single source so the components paint from it and test `[66]` measures the
 * SAME values. Inlining these as literals would let the test pass while the
 * chrome drifted underneath it, which is the failure mode `DECAL_STYLE` exists
 * to prevent for decals.
 *
 * Gameplay colours (HP, gold, status tints, class colours) are NOT here — those
 * belong to `@theme` tokens and the content data files, and the HUD reads them
 * from there.
 */

/** Panel backgrounds. The gradients run to a darker second stop; contrast is
 * measured against the LIGHTER end, which is the harder case. */
export const BG = {
  shell: "#0a0a0c", // the gutter behind everything, one step under the map
  header: "#15151a",
  panel: "#131318", // log rail + character panel
  footer: "#101014",
  map: "#0d0d0d",
} as const;

/** Text, in descending prominence. */
export const TEXT = {
  primary: "#dcdce2", // item names, values — the things you read
  secondary: "#8a8a96", // section headers, unit labels
  // nudged up from #7a7a86, which measured 4.48 against the footer plate —
  // just under WCAG AA, and this row is the key hints, which want reading
  footer: "#80828e",
  tertiary: "#5a5a64", // "PRESS 1–9" — the faintest text in the HUD
  key: "#c9a227", // footer key letters, the gold disc, the objective star
} as const;

/** Structural marks. These are drawn to be SEEN, not read — a border or an
 * empty-slot dash needs to register as present, not to be legible as text, so
 * they sit far below the text tiers by design. */
export const MARK = {
  frame: "#3a3a45", // panel borders
  corner: "#55555f", // the box-drawing corner glyphs
  emptySlot: "#3d3d46", // an unclaimed/spent item row
  separator: "#26262e", // dotted rules between item rows
  gaugeEmpty: "#2c2c34", // unfilled vitality blocks
  pipEmpty: "#55555f", // unfilled objective pips
  // Region outlines. The map is delineated by its BORDER, not by its fill: the
  // gutter and the map plate differ by only ~8, which is nothing. The border is
  // what carries that edge, so it's the thing worth pinning.
  mapBorder: "#2a2a32",
  shellBorder: "#2e2e37",
  rule: "#2a2a32", // the dashed rule between header rows
} as const;
