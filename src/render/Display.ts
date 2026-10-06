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

/**
 * Stop a display for good. rot.js has no destroy: its constructor starts a
 * `requestAnimationFrame` loop whose `_tick` reschedules itself unconditionally,
 * so a display dropped from the DOM keeps ticking at 60fps — holding its canvas
 * backing store and cell cache — for the life of the page. `GameCanvas` remounts
 * at every narration, shop, death and restart, which leaked ~30 such loops per
 * run. `_tick` re-reads `this._backend.schedule` and `this._tick` on each frame,
 * so swapping both on the instance ends the loop on its next frame.
 */
export function destroyDisplay(display: ROT.Display) {
  const d = display as unknown as {
    _tick: () => void;
    _backend: { schedule: (cb: () => void) => void };
    _data: Record<string, unknown>;
  };
  d._tick = () => {};
  d._backend.schedule = () => {};
  d._data = {};
  const canvas = display.getContainer();
  if (canvas instanceof HTMLCanvasElement) canvas.width = canvas.height = 0;
}
