import * as ROT from "rot-js";
import type { GameState } from "@/game/core/types";
import type { GameEvent } from "@/game/core/events";
import { idx, chebyshev } from "@/game/core/grid";
import { LEVELS } from "@/content/levels";
import { ITEMS } from "@/content/items";
import { MONSTERS } from "@/content/monsters";
import { createDisplay } from "./Display";
import {
  terrainGlyph,
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

const PROJECTILE_MS = 180;
const HIT_DELAY_MS = 60;
const HIT_MS = 170;

// Distance-based lighting: brightness at the player's feet vs. at the light's
// edge (terrain fades hard for atmosphere; entities stay more legible).
const EDGE_MIN_TERRAIN = 0.4;
const EDGE_MIN_ENTITY = 0.62;
const AMBIENT_MS = 66; // ~15fps flicker redraw

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

type Fx =
  | {
      kind: "projectile";
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      glyph: string;
      t0: number;
      dur: number;
    }
  | { kind: "hit"; x: number; y: number; t0: number; dur: number };

/**
 * Owns the rot.js Display. Renders a VIEWPORT window at a fixed, readable cell
 * size with a player-following camera, plus a non-blocking cosmetic animation
 * layer (projectiles / hit flashes) driven by requestAnimationFrame. React owns
 * only the host <div>.
 */
export class CanvasRenderer {
  private display: ROT.Display;
  private host: HTMLElement;
  private cols = 0;
  private rows = 0;
  private cell = 0;

  private lastState: GameState | null = null;
  private camX = 0;
  private camY = 0;
  private fx: Fx[] = [];
  private rafId: number | null = null;
  private ambientId: number | null = null;
  private lastAmbient = 0;
  private reduceMotion = false;

  constructor(host: HTMLElement) {
    this.host = host;
    this.display = createDisplay(1, 1);
    const container = this.display.getContainer();
    if (container) {
      container.style.display = "block";
      host.appendChild(container);
    }
    this.reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    // gentle torchlight flicker: re-render the base on a throttled ambient loop
    if (!this.reduceMotion) {
      this.ambientId = requestAnimationFrame(this.ambientTick);
    }
  }

  private ambientTick = (now: number) => {
    this.ambientId = requestAnimationFrame(this.ambientTick);
    if (now - this.lastAmbient < AMBIENT_MS) return;
    this.lastAmbient = now;
    if (this.fx.length || !this.lastState) return; // effect loop redraws instead
    this.renderBase(this.lastState);
  };

  dispose() {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    if (this.ambientId != null) cancelAnimationFrame(this.ambientId);
    this.rafId = null;
    this.ambientId = null;
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

  draw(state: GameState, targeting?: { x: number; y: number } | null) {
    if (this.cols === 0) this.fit();
    this.lastState = state;
    this.renderBase(state);
    if (targeting) this.drawTargeting(targeting.x, targeting.y);
  }

  /** Firebomb aiming overlay: a reticle at the target + its 3x3 blast ring. */
  private drawTargeting(tx: number, ty: number) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const center = dx === 0 && dy === 0;
        this.drawCell(
          tx + dx,
          ty + dy,
          center ? "X" : "+",
          center ? "#ffdd55" : "#ff7a3c"
        );
      }
    }
  }

  /** Queue cosmetic effects from a resolved turn and run the animation loop. */
  playEffects(events: GameEvent[]) {
    if (!this.lastState) return;
    const now = performance.now();
    for (const e of events) {
      if (e.kind === "projectile") {
        this.fx.push({
          kind: "projectile",
          fromX: e.from.x,
          fromY: e.from.y,
          toX: e.to.x,
          toY: e.to.y,
          glyph: e.glyph,
          t0: now,
          dur: PROJECTILE_MS,
        });
      } else if (e.kind === "hit") {
        this.fx.push({
          kind: "hit",
          x: e.x,
          y: e.y,
          t0: now + HIT_DELAY_MS,
          dur: HIT_MS,
        });
      }
    }
    if (this.fx.length && this.rafId == null) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    this.rafId = null;
    this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
    const state = this.lastState;
    if (!state) return;

    this.renderBase(state);
    for (const f of this.fx) {
      const p = clamp((now - f.t0) / f.dur, 0, 1);
      if (f.kind === "projectile") {
        const wx = Math.round(f.fromX + (f.toX - f.fromX) * p);
        const wy = Math.round(f.fromY + (f.toY - f.fromY) * p);
        this.drawCell(wx, wy, f.glyph, "#ff9d3c");
      } else {
        this.drawCell(f.x, f.y, "×", p < 0.5 ? "#ffdd55" : "#ff5555");
      }
    }

    if (this.fx.length) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.renderBase(state); // clean final frame
    }
  };

  private drawCell(wx: number, wy: number, glyph: string, color: string) {
    const sx = wx - this.camX;
    const sy = wy - this.camY;
    if (sx < 0 || sy < 0 || sx >= this.cols || sy >= this.rows) return;
    this.display.draw(sx, sy, glyph, color, null);
  }

  /** Dim a visible tile by distance: full at the player, `edgeMin` at radius. */
  private lit(color: string, dist: number, effR: number, edgeMin: number) {
    const t = Math.min(1, dist / Math.max(1, effR));
    return dim(color, 1 - (1 - edgeMin) * t);
  }

  private renderBase(state: GameState) {
    const { map, player } = state;
    const { cols, rows } = this;

    // Camera: center on the player, clamped so we never scroll past the map.
    this.camX = clamp(
      player.x - Math.floor(cols / 2),
      0,
      Math.max(0, map.width - cols)
    );
    this.camY = clamp(
      player.y - Math.floor(rows / 2),
      0,
      Math.max(0, map.height - rows)
    );
    const camX = this.camX;
    const camY = this.camY;

    const level = LEVELS[state.currentLevel];
    const palette = level.palette;
    const visible = new Set(state.visible);
    const explored = new Set(state.explored);
    const knownTraps = new Set(state.knownTraps);

    // Effective light radius wobbles slightly so the torchlight edge flickers.
    const now = performance.now();
    const flicker = this.reduceMotion
      ? 0
      : Math.sin(now * 0.005) * 0.5 + Math.sin(now * 0.013) * 0.3;
    const effR = Math.max(2, player.lightRadius + flicker);

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
        let glyph = terrainGlyph(t, level.biome);
        let color = terrainColor(t, palette);
        // a sensed/detected (but still armed) trap shows as a faint warning ^
        if (t === "trap" && knownTraps.has(i)) {
          glyph = "^";
          color = "#e0904a";
        }
        color = isVis
          ? this.lit(color, chebyshev(wx, wy, player.x, player.y), effR, EDGE_MIN_TERRAIN)
          : dim(color, FOG_DIM);
        this.display.draw(sx, sy, glyph, color, null);
      }
    }

    // items (only where currently visible)
    for (const it of state.items) {
      if (!visible.has(idx(it.x, it.y, map.width))) continue;
      const sx = it.x - camX;
      const sy = it.y - camY;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const def = ITEMS[it.defId];
      const color = this.lit(
        def.color,
        chebyshev(it.x, it.y, player.x, player.y),
        effR,
        EDGE_MIN_ENTITY
      );
      this.display.draw(sx, sy, def.glyph, color, null);
    }

    // monsters (only where currently visible)
    for (const m of state.monsters) {
      if (!visible.has(idx(m.x, m.y, map.width))) continue;
      const sx = m.x - camX;
      const sy = m.y - camY;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const def = MONSTERS[m.defId];
      const color = this.lit(
        def.color,
        chebyshev(m.x, m.y, player.x, player.y),
        effR,
        EDGE_MIN_ENTITY
      );
      this.display.draw(sx, sy, def.glyph, color, null);
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
