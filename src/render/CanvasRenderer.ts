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

// Aim to show roughly this many tiles vertically; cell size derives from it.
const TARGET_ROWS = 26;
const MIN_CELL = 12;
const MAX_CELL = 30;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Owns the rot.js Display. Renders a VIEWPORT window at a fixed, readable cell
 * size and scrolls a camera to keep the player in view — so the map can be
 * larger than the screen without ever overflowing it (classic roguelike scroll).
 * React owns only the host <div>; this class appends the canvas into it.
 */
export class CanvasRenderer {
  private display: ROT.Display;
  private host: HTMLElement;
  private cols = 0;
  private rows = 0;
  private cell = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    this.display = createDisplay(1, 1);
    const container = this.display.getContainer();
    if (container) {
      container.style.display = "block";
      host.appendChild(container);
    }
  }

  dispose() {
    const container = this.display.getContainer();
    if (container && container.parentNode === this.host) {
      this.host.removeChild(container);
    }
  }

  /** Size the viewport grid to fill the host at a readable, square cell size. */
  fit() {
    const cw = this.host.clientWidth;
    const ch = this.host.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    const cell = clamp(Math.floor(ch / TARGET_ROWS), MIN_CELL, MAX_CELL);
    const cols = Math.max(10, Math.floor(cw / cell));
    const rows = Math.max(10, Math.floor(ch / cell));
    if (cols !== this.cols || rows !== this.rows || cell !== this.cell) {
      this.cols = cols;
      this.rows = rows;
      this.cell = cell;
      this.display.setOptions({ width: cols, height: rows, fontSize: cell });
    }
  }

  draw(state: GameState) {
    if (this.cols === 0) this.fit();
    const { map, player } = state;
    const { cols, rows } = this;

    // Camera: center on the player, clamped so we never scroll past the map.
    const camX = clamp(
      player.x - Math.floor(cols / 2),
      0,
      Math.max(0, map.width - cols)
    );
    const camY = clamp(
      player.y - Math.floor(rows / 2),
      0,
      Math.max(0, map.height - rows)
    );

    const palette = LEVELS[state.currentLevel].palette;
    const visible = new Set(state.visible);
    const explored = new Set(state.explored);

    this.display.clear();

    // terrain within the viewport window
    for (let sy = 0; sy < rows; sy++) {
      for (let sx = 0; sx < cols; sx++) {
        const wx = sx + camX;
        const wy = sy + camY;
        if (wx < 0 || wy < 0 || wx >= map.width || wy >= map.height) continue;
        const i = wy * map.width + wx;
        const isVis = visible.has(i);
        const isExp = explored.has(i);
        if (!isVis && !isExp) continue; // unseen -> background

        const t = map.tiles[i];
        let color = terrainColor(t, palette);
        if (!isVis) color = dim(color, FOG_DIM);
        this.display.draw(sx, sy, TERRAIN_GLYPH[t], color, null);
      }
    }

    // items (only where currently visible)
    for (const it of state.items) {
      if (!visible.has(idx(it.x, it.y, map.width))) continue;
      const sx = it.x - camX;
      const sy = it.y - camY;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const def = ITEMS[it.defId];
      this.display.draw(sx, sy, def.glyph, def.color, null);
    }

    // monsters (only where currently visible)
    for (const m of state.monsters) {
      if (!visible.has(idx(m.x, m.y, map.width))) continue;
      const sx = m.x - camX;
      const sy = m.y - camY;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const def = MONSTERS[m.defId];
      this.display.draw(sx, sy, def.glyph, def.color, null);
    }

    // player (always drawn; camera guarantees it's on-screen)
    this.display.draw(
      player.x - camX,
      player.y - camY,
      PLAYER_GLYPH,
      PLAYER_COLOR,
      null
    );
  }
}
