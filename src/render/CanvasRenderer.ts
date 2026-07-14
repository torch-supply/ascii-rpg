import * as ROT from "rot-js";
import type { GameState, GameMap } from "@/game/core/types";
import type { GameEvent } from "@/game/core/events";
import { idx, chebyshev } from "@/game/core/grid";
import { STATUS } from "@/game/core/status";
import type { StatusKind } from "@/game/core/types";
import { LEVELS } from "@/content/levels";
import { ITEMS } from "@/content/items";
import { MONSTERS, ELITE } from "@/content/monsters";
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
const HIT_DELAY_MS = 30;
const HIT_MS = 150;
const RING_MS = 300; // firebomb / Ruin expanding blast ring

// Distance-based lighting: brightness at the player's feet vs. at the light's
// edge (terrain fades hard for atmosphere; entities stay more legible).
const EDGE_MIN_TERRAIN = 0.4;
const EDGE_MIN_ENTITY = 0.62;
const AMBIENT_MS = 66; // ~15fps flicker redraw

// Which debuff colors an afflicted entity's glyph (first match wins).
const TINT_ORDER: StatusKind[] = ["burn", "poison", "bleed", "chill"];
function statusTint(effects?: Record<string, number>): string | null {
  if (!effects) return null;
  for (const k of TINT_ORDER) if ((effects[k] ?? 0) > 0) return STATUS[k].tint;
  return null;
}

/** Paint a deterministic jagged fissure (in the already-set strokeStyle) across
 * the cell at (ox,oy) sized (cw,ch). `seed` fixes the shape so it never flickers. */
function drawFissure(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cw: number,
  ch: number,
  seed: number
) {
  const rnd = (n: number) => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  ctx.lineWidth = Math.max(1, cw * 0.1);
  // main fissure: top → jagged middle → bottom, wandering across the glyph
  const topX = ox + cw * (0.32 + 0.36 * rnd(1));
  const midX = ox + cw * (0.28 + 0.44 * rnd(2));
  const botX = ox + cw * (0.32 + 0.36 * rnd(3));
  const midY = oy + ch * (0.42 + 0.16 * rnd(6));
  ctx.beginPath();
  ctx.moveTo(topX, oy + ch * 0.12);
  ctx.lineTo(midX, midY);
  ctx.lineTo(botX, oy + ch * 0.88);
  ctx.stroke();
  // a short branch off the middle
  ctx.beginPath();
  ctx.moveTo(midX, midY);
  ctx.lineTo(ox + cw * (0.2 + 0.6 * rnd(4)), oy + ch * (0.25 + 0.5 * rnd(5)));
  ctx.stroke();
}

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
  | { kind: "hit"; x: number; y: number; t0: number; dur: number }
  | { kind: "ring"; x: number; y: number; radius: number; t0: number; dur: number };

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
  private targeting: { x: number; y: number } | null = null;
  private camX = 0;
  private camY = 0;
  private fx: Fx[] = [];
  private rafId: number | null = null;
  private ambientId: number | null = null;
  private lastAmbient = 0;
  private reduceMotion = false;
  // smooth-scroll: slide the canvas one cell when the camera follows the player
  private lastCamX = 0;
  private lastCamY = 0;
  private camPrimed = false;
  // overlay canvas for cracked-wall knockout fissures (painted, not glyphs)
  private crack: HTMLCanvasElement | null = null;
  // cache: which map we last scanned, and whether it has any cracked walls, so
  // levels without them skip the overlay entirely
  private crackMap: GameMap | null = null;
  private crackAny = false;

  constructor(host: HTMLElement) {
    this.host = host;
    this.display = createDisplay(1, 1);
    const container = this.display.getContainer();
    if (container) {
      container.style.display = "block";
      host.appendChild(container);
    }
    // A transparent overlay canvas sitting exactly atop the rot.js canvas.
    // Cracked walls are "knocked out" here — fissures painted in the background
    // color that cut through the wall glyph so it reads as broken, not X'd.
    const crack = document.createElement("canvas");
    crack.style.position = "absolute";
    crack.style.pointerEvents = "none";
    crack.style.display = "block";
    host.appendChild(crack);
    this.crack = crack;
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
    if (this.targeting) this.drawTargeting(this.targeting.x, this.targeting.y);
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
    if (this.crack && this.crack.parentNode === this.host) {
      this.host.removeChild(this.crack);
    }
    this.crack = null;
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
    this.targeting = targeting ?? null;
    this.renderBase(state);
    if (this.targeting) this.drawTargeting(this.targeting.x, this.targeting.y);
    this.maybeScroll();
  }

  /**
   * When the camera follows the player by a single cell, slide the whole canvas
   * from the old alignment to the new one so the world scrolls smoothly instead
   * of snapping. Larger jumps (level load) and reduced-motion snap instantly.
   */
  private maybeScroll() {
    const canvas = this.display.getContainer();
    if (!canvas) return;
    const dcx = this.camX - this.lastCamX;
    const dcy = this.camY - this.lastCamY;
    this.lastCamX = this.camX;
    this.lastCamY = this.camY;
    if (!this.camPrimed) {
      this.camPrimed = true; // no slide on the first paint of a level
      return;
    }
    if (this.reduceMotion || Math.abs(dcx) + Math.abs(dcy) !== 1) return;
    const cw = canvas.clientWidth / this.cols;
    const ch = canvas.clientHeight / this.rows;
    // start shifted to the old position, then transition to identity — the
    // crack overlay rides along so its fissures stay aligned to their walls
    const layers = [canvas, this.crack].filter(Boolean) as HTMLElement[];
    for (const el of layers) {
      el.style.transition = "none";
      el.style.transform = `translate(${dcx * cw}px, ${dcy * ch}px)`;
    }
    requestAnimationFrame(() => {
      for (const el of layers) {
        el.style.transition = "transform 110ms ease-out";
        el.style.transform = "translate(0px, 0px)";
      }
    });
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
      } else if (e.kind === "blast") {
        this.fx.push({
          kind: "ring",
          x: e.x,
          y: e.y,
          radius: e.radius,
          t0: now,
          dur: RING_MS,
        });
      } else if (e.kind === "damage") {
        this.spawnDamageNumber(e.x, e.y, e.amount, e.toPlayer, e.color);
      }
    }
    if (this.fx.length && this.rafId == null) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  /** A small number that floats up off a tile and fades (DOM overlay). */
  private spawnDamageNumber(
    wx: number,
    wy: number,
    amount: number,
    toPlayer: boolean,
    color?: string
  ) {
    if (this.reduceMotion) return;
    const canvas = this.display.getContainer();
    if (!canvas) return;
    const sx = wx - this.camX;
    const sy = wy - this.camY;
    if (sx < 0 || sy < 0 || sx >= this.cols || sy >= this.rows) return;
    const cw = canvas.clientWidth / this.cols;
    const ch = canvas.clientHeight / this.rows;
    const el = document.createElement("div");
    el.className = "dmg-num";
    el.textContent = String(amount);
    el.style.left = `${canvas.offsetLeft + sx * cw + cw / 2}px`;
    el.style.top = `${canvas.offsetTop + sy * ch}px`;
    el.style.color = color ?? (toPlayer ? "#ff6a6a" : "#ffe14d");
    el.style.fontSize = `${Math.max(11, Math.round(cw * 0.7))}px`;
    el.addEventListener("animationend", () => el.remove());
    this.host.appendChild(el);
  }

  private tick = (now: number) => {
    this.rafId = null;
    this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
    const state = this.lastState;
    if (!state) return;

    this.renderBase(state);
    if (this.targeting) this.drawTargeting(this.targeting.x, this.targeting.y);
    for (const f of this.fx) {
      if (now < f.t0) continue; // not started yet (delayed flash)
      const p = clamp((now - f.t0) / f.dur, 0, 1);
      if (f.kind === "projectile") {
        // head + a short fading trail behind it
        for (let k = 0; k < 3; k++) {
          const pk = p - k * 0.16;
          if (pk < 0) continue;
          const wx = Math.round(f.fromX + (f.toX - f.fromX) * pk);
          const wy = Math.round(f.fromY + (f.toY - f.fromY) * pk);
          this.drawCell(wx, wy, f.glyph, dim("#ff9d3c", 1 - k * 0.34));
        }
      } else if (f.kind === "ring") {
        // an expanding ring of sparks over the blast radius
        const front = p * (f.radius + 1);
        for (let dy = -f.radius; dy <= f.radius; dy++) {
          for (let dx = -f.radius; dx <= f.radius; dx++) {
            const d = Math.max(Math.abs(dx), Math.abs(dy));
            if (d > f.radius || Math.abs(front - d) > 0.9) continue;
            this.drawCell(f.x + dx, f.y + dy, "*", dim("#ffb347", 1 - p * 0.6));
          }
        }
      } else {
        // hit flash: a bright spark on the struck tile, white → ember
        this.drawCell(f.x, f.y, "*", p < 0.45 ? "#ffffff" : "#ff6a3c");
      }
    }

    if (this.fx.length) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.renderBase(state); // clean final frame
      if (this.targeting) this.drawTargeting(this.targeting.x, this.targeting.y);
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
        // living terrain: water shimmers, marsh reeds sway (per-tile phase)
        if (isVis && !this.reduceMotion) {
          if (t === "water")
            color = dim(color, 0.82 + 0.18 * Math.sin(now * 0.004 + i * 0.9));
          else if (level.biome === "marsh" && t === "wall")
            color = dim(color, 0.9 + 0.1 * Math.sin(now * 0.0035 + i * 0.6));
        }
        this.display.draw(sx, sy, glyph, color, null);
      }
    }

    // lingering fire (over terrain, beneath entities)
    for (const f of state.fireTiles) {
      if (!visible.has(f.i)) continue;
      const fx = f.i % map.width;
      const fy = Math.floor(f.i / map.width);
      const sx = fx - camX;
      const sy = fy - camY;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const flick = this.reduceMotion
        ? 0.85
        : 0.6 + 0.4 * Math.abs(Math.sin(now * 0.02 + f.i));
      const glyph = !this.reduceMotion && Math.sin(now * 0.03 + f.i) > 0 ? "*" : "▴";
      const base = f.life <= 1 ? "#ff5a3c" : "#ff9d3c";
      this.display.draw(sx, sy, glyph, dim(base, flick), null);
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
      // debuff tint wins (so poison/burn still read); else elites glow their
      // champion color; else the monster's own color
      const baseColor =
        statusTint(m.effects) ?? (m.elite ? ELITE[m.elite].color : def.color);
      const color = this.lit(
        baseColor,
        chebyshev(m.x, m.y, player.x, player.y),
        effR,
        EDGE_MIN_ENTITY
      );
      this.display.draw(sx, sy, def.glyph, color, null);
    }

    // player (always drawn; camera guarantees it's on-screen) — glyph takes on
    // the color of whatever debuff currently afflicts them
    this.display.draw(
      player.x - camX,
      player.y - camY,
      PLAYER_GLYPH,
      statusTint(player.effects) ?? PLAYER_COLOR,
      null
    );

    this.paintCracks(state, camX, camY, visible, explored);
  }

  /**
   * Paint knockout fissures for cracked walls onto the overlay canvas. Each
   * crack is a jagged line in the background color that cuts through the wall
   * glyph beneath — so the wall reads as fractured rather than marked. The
   * shape is deterministic per tile (no flicker) and the overlay is kept
   * exactly aligned with (and scrolled in lockstep with) the rot.js canvas.
   */
  private paintCracks(
    state: GameState,
    camX: number,
    camY: number,
    visible: Set<number>,
    explored: Set<number>
  ) {
    const cvs = this.display.getContainer() as HTMLCanvasElement | null;
    const crack = this.crack;
    if (!cvs || !crack) return;
    // rescan only when the level's map changes; most levels have no cracks
    if (state.map !== this.crackMap) {
      this.crackMap = state.map;
      this.crackAny = state.map.tiles.includes("crackedWall");
      crack.getContext("2d")?.clearRect(0, 0, crack.width, crack.height);
    }
    if (!this.crackAny) return;
    crack.style.left = `${cvs.offsetLeft}px`;
    crack.style.top = `${cvs.offsetTop}px`;
    crack.style.width = `${cvs.clientWidth}px`;
    crack.style.height = `${cvs.clientHeight}px`;
    if (crack.width !== cvs.width || crack.height !== cvs.height) {
      crack.width = cvs.width;
      crack.height = cvs.height;
    }
    const ctx = crack.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, crack.width, crack.height);

    const { map } = state;
    const cw = crack.width / this.cols;
    const ch = crack.height / this.rows;
    ctx.strokeStyle = "#0d0d0d"; // the display background — a true knockout
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let sy = 0; sy < this.rows; sy++) {
      for (let sx = 0; sx < this.cols; sx++) {
        const wx = sx + camX;
        const wy = sy + camY;
        if (wx < 0 || wy < 0 || wx >= map.width || wy >= map.height) continue;
        const i = wy * map.width + wx;
        if (map.tiles[i] !== "crackedWall") continue;
        if (!visible.has(i) && !explored.has(i)) continue;
        drawFissure(ctx, sx * cw, sy * ch, cw, ch, i);
      }
    }
  }
}
