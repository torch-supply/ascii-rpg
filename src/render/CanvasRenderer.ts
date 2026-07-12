import * as ROT from "rot-js";
import type { GameState } from "@/game/core/types";
import { idx } from "@/game/core/grid";
import { LEVELS } from "@/content/levels";
import { ITEMS } from "@/content/items";
import { MONSTERS } from "@/content/monsters";
import { createDisplay } from "./Display";
import {
  TERRAIN_GLYPH,
  PLAYER_GLYPH,
  PLAYER_COLOR,
  FOG_DIM,
  terrainColor,
  dim,
} from "./tiles";

/**
 * Owns the rot.js Display. React owns only the host <div>; this class appends
 * the canvas into it and never lets React reconcile the canvas contents.
 */
export class CanvasRenderer {
  private display: ROT.Display;
  private host: HTMLElement;
  private cols = 0;
  private rows = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    this.display = createDisplay(1, 1);
    const container = this.display.getContainer();
    if (container) host.appendChild(container);
  }

  dispose() {
    const container = this.display.getContainer();
    if (container && container.parentNode === this.host) {
      this.host.removeChild(container);
    }
  }

  /** Resize the logical grid if the map dimensions changed, then refit. */
  private ensureSize(w: number, h: number) {
    if (w !== this.cols || h !== this.rows) {
      this.cols = w;
      this.rows = h;
      this.display.setOptions({ width: w, height: h });
    }
  }

  /** Scale the font so the whole grid fits the host element. */
  fit() {
    const cw = this.host.clientWidth;
    const ch = this.host.clientHeight;
    if (cw <= 0 || ch <= 0 || this.cols <= 0) return;
    const fs = this.display.computeFontSize(cw, ch);
    this.display.setOptions({ fontSize: Math.max(6, fs) });
  }

  draw(state: GameState) {
    const { map } = state;
    this.ensureSize(map.width, map.height);

    const palette = LEVELS[state.currentLevel].palette;
    const visible = new Set(state.visible);
    const explored = new Set(state.explored);

    this.display.clear();

    // terrain
    for (let i = 0; i < map.tiles.length; i++) {
      const isVis = visible.has(i);
      const isExp = explored.has(i);
      if (!isVis && !isExp) continue; // unseen -> background

      const t = map.tiles[i];
      let color = terrainColor(t, palette);
      if (!isVis) color = dim(color, FOG_DIM);
      this.display.draw(i % map.width, Math.floor(i / map.width), TERRAIN_GLYPH[t], color, null);
    }

    // items (only where currently visible)
    for (const it of state.items) {
      if (!visible.has(idx(it.x, it.y, map.width))) continue;
      const def = ITEMS[it.defId];
      this.display.draw(it.x, it.y, def.glyph, def.color, null);
    }

    // monsters (only where currently visible)
    for (const m of state.monsters) {
      if (!visible.has(idx(m.x, m.y, map.width))) continue;
      const def = MONSTERS[m.defId];
      this.display.draw(m.x, m.y, def.glyph, def.color, null);
    }

    // player (always drawn)
    this.display.draw(state.player.x, state.player.y, PLAYER_GLYPH, PLAYER_COLOR, null);
  }
}
