import * as ROT from "rot-js";

const FONT_FAMILY = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Create a rot.js canvas display sized to a `cols x rows` grid. */
export function createDisplay(cols: number, rows: number): ROT.Display {
  return new ROT.Display({
    width: cols,
    height: rows,
    forceSquareRatio: true,
    fontFamily: FONT_FAMILY,
    fontSize: 16,
    fg: "#d5d5da",
    bg: "#0d0d0d",
  });
}
