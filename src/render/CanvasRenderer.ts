import * as ROT from "rot-js";
import type { GameState, GameMap } from "@/game/core/types";
import type { GameEvent } from "@/game/core/events";
import { idx, chebyshev } from "@/game/core/grid";
import { STATUS } from "@/game/core/status";
import type { StatusKind, Biome } from "@/game/core/types";
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
  BIOME_ATMOSPHERE,
  CRACKED_WALL_CRACK_DIM,
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
const GLOW_RADIUS_SCALE = 1.0; // torch-glow reach relative to the light radius

// Which debuff colors an afflicted entity's glyph (first match wins).
const TINT_ORDER: StatusKind[] = ["burn", "poison", "bleed", "chill"];
function statusTint(effects?: Record<string, number>): string | null {
  if (!effects) return null;
  for (const k of TINT_ORDER) if ((effects[k] ?? 0) > 0) return STATUS[k].tint;
  return null;
}

/** Deterministic pseudo-random in [0,1) from an integer — for stable particle
 * seeds without any stored state. */
function frac(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** "#rrggbb" + alpha → an `rgba(...)` string (for gradient stops). */
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Paint a deterministic jagged fissure (in the already-set strokeStyle)
 * centered on the cell's glyph, at a per-tile angle with 1–2 branches — so it
 * clearly cuts through the wall. `seed` fixes the shape so it never flickers. */
function drawFissure(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cw: number,
  ch: number,
  seed: number
) {
  const rnd = (n: number) => frac(seed * 3.1 + n * 7.7);
  ctx.lineWidth = Math.max(1.4, cw * 0.14);

  // A main fracture through (near) the glyph's center at a seeded angle,
  // spanning most of the glyph, with a jagged kink at the middle.
  const cx = ox + cw * 0.5 + (rnd(1) - 0.5) * cw * 0.14;
  const cy = oy + ch * 0.5 + (rnd(2) - 0.5) * ch * 0.14;
  const ang = rnd(3) * Math.PI; // 0–180°, so it reads as a diagonal/vertical split
  const half = cw * (0.34 + 0.08 * rnd(4));
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const px = -dy;
  const py = dx;
  const jag = (rnd(5) - 0.5) * cw * 0.3; // perpendicular offset of the mid kink
  const ax = cx - dx * half;
  const ay = cy - dy * half;
  const bx = cx + dx * half;
  const by = cy + dy * half;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(cx + px * jag, cy + py * jag);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // 1–2 branch cracks splintering off the center
  const branches = 1 + (rnd(6) > 0.5 ? 1 : 0);
  for (let k = 0; k < branches; k++) {
    const ba = ang + (k === 0 ? 1 : -1) * (0.5 + rnd(10 + k) * 0.7);
    const bl = half * (0.5 + rnd(20 + k) * 0.5);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ba) * bl, cy + Math.sin(ba) * bl);
    ctx.stroke();
  }
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

    // altars/shrines (drawn from memory too, so you can navigate back to one)
    for (const a of state.altars) {
      const i = idx(a.x, a.y, map.width);
      const isVis = visible.has(i);
      if (!isVis && !explored.has(i)) continue;
      const sx = a.x - camX;
      const sy = a.y - camY;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const base = a.used ? "#6a6a6a" : "#d6a4ff";
      const color = isVis
        ? this.lit(base, chebyshev(a.x, a.y, player.x, player.y), effR, EDGE_MIN_ENTITY)
        : dim(base, FOG_DIM);
      this.display.draw(sx, sy, "‡", color, null);
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

    this.paintOverlay(state, camX, camY, effR, visible, explored);
  }

  /**
   * The transparent overlay atop the rot.js canvas carries two effects, painted
   * each frame and kept aligned/scrolled with the base:
   *   1. a soft warm torch-glow around the player + pools cast by fire tiles
   *      (additive light — softens the hard per-cell falloff), then
   *   2. cracked-wall knockout fissures in the background color (see below).
   */
  private paintOverlay(
    state: GameState,
    camX: number,
    camY: number,
    effR: number,
    visible: Set<number>,
    explored: Set<number>
  ) {
    const cvs = this.display.getContainer() as HTMLCanvasElement | null;
    const overlay = this.crack;
    if (!cvs || !overlay) return;
    overlay.style.left = `${cvs.offsetLeft}px`;
    overlay.style.top = `${cvs.offsetTop}px`;
    overlay.style.width = `${cvs.clientWidth}px`;
    overlay.style.height = `${cvs.clientHeight}px`;
    if (overlay.width !== cvs.width || overlay.height !== cvs.height) {
      overlay.width = cvs.width;
      overlay.height = cvs.height;
    }
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const cw = overlay.width / this.cols;
    const ch = overlay.height / this.rows;

    // 1) soft torch-glow + biome atmosphere, then clipped to the visible area
    // together so neither bleeds into the dark past the walls
    this.paintGlow(ctx, state, camX, camY, effR, visible, cw, ch);
    this.paintAtmosphere(ctx, LEVELS[state.currentLevel].biome, cw, ch, overlay.width, overlay.height);
    this.clipToVisible(ctx, camX, camY, visible, cw, ch, state.map.width, state.map.height);

    // 2) cracked-wall knockout fissures (only on levels that have them)
    if (state.map !== this.crackMap) {
      this.crackMap = state.map;
      this.crackAny = state.map.tiles.includes("crackedWall");
    }
    if (this.crackAny) {
      const { map } = state;
      const palette = LEVELS[state.currentLevel].palette;
      const wallBase = terrainColor("crackedWall", palette);
      const player = state.player;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let sy = 0; sy < this.rows; sy++) {
        for (let sx = 0; sx < this.cols; sx++) {
          const wx = sx + camX;
          const wy = sy + camY;
          if (wx < 0 || wy < 0 || wx >= map.width || wy >= map.height) continue;
          const i = wy * map.width + wx;
          if (map.tiles[i] !== "crackedWall") continue;
          const isVis = visible.has(i);
          if (!isVis && !explored.has(i)) continue;
          // the crack is the wall's own color, darker — a shadowed fracture
          // that stays legible under the torch glow (vs. a flat knockout)
          const shown = isVis
            ? this.lit(wallBase, chebyshev(wx, wy, player.x, player.y), effR, EDGE_MIN_TERRAIN)
            : dim(wallBase, FOG_DIM);
          ctx.strokeStyle = dim(shown, CRACKED_WALL_CRACK_DIM);
          drawFissure(ctx, sx * cw, sy * ch, cw, ch, i);
        }
      }
    }
  }

  /** A warm radial glow on the player (scaled to their light radius) plus a
   * smaller pool under each visible fire tile, blended additively. */
  private paintGlow(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camX: number,
    camY: number,
    effR: number,
    visible: Set<number>,
    cw: number,
    ch: number
  ) {
    const now = this.reduceMotion ? 0 : performance.now();
    const player = state.player;
    ctx.save();
    ctx.globalCompositeOperation = "lighter"; // light adds, it doesn't occlude

    const px = (player.x - camX + 0.5) * cw;
    const py = (player.y - camY + 0.5) * ch;
    const flick = this.reduceMotion
      ? 1
      : 0.94 + 0.06 * Math.sin(now * 0.006) + 0.04 * Math.sin(now * 0.017);
    const radius = Math.max(cw * 2, effR * cw * GLOW_RADIUS_SCALE * flick);
    const g = ctx.createRadialGradient(px, py, cw * 0.4, px, py, radius);
    g.addColorStop(0, "rgba(255, 178, 102, 0.10)");
    g.addColorStop(0.5, "rgba(255, 150, 70, 0.035)");
    g.addColorStop(1, "rgba(255, 140, 60, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);

    const w = state.map.width;
    for (const f of state.fireTiles) {
      if (!visible.has(f.i)) continue;
      const fx = ((f.i % w) - camX + 0.5) * cw;
      const fy = (Math.floor(f.i / w) - camY + 0.5) * ch;
      const wob = this.reduceMotion ? 0 : 0.5 * Math.abs(Math.sin(now * 0.02 + f.i));
      const fr = cw * (1.7 + wob);
      const fg = ctx.createRadialGradient(fx, fy, cw * 0.2, fx, fy, fr);
      fg.addColorStop(0, "rgba(255, 140, 50, 0.18)");
      fg.addColorStop(1, "rgba(255, 120, 40, 0)");
      ctx.fillStyle = fg;
      ctx.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
    }
    ctx.restore();
  }

  /** Per-biome ambient particles (drifting mist blobs, or many small moving
   * motes for snow/embers/dust). Procedural from the clock — no stored state —
   * and skipped entirely under reduced-motion. */
  private paintAtmosphere(
    ctx: CanvasRenderingContext2D,
    biome: Biome,
    cw: number,
    ch: number,
    W: number,
    H: number
  ) {
    if (this.reduceMotion) return;
    const atm = BIOME_ATMOSPHERE[biome];
    if (!atm) return;
    const now = performance.now();
    ctx.save();

    if (atm.kind === "mist") {
      for (let i = 0; i < atm.count; i++) {
        const drift = Math.sin(now * 0.00006 * (1 + (i % 3)) + i * 1.7) * W * 0.25;
        const x = (((frac(i) * W + drift) % W) + W) % W;
        const y = frac(i + 41) * H + Math.sin(now * 0.0001 + i) * ch * 0.5;
        const r = cw * (3.5 + (i % 3));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(atm.color, atm.alpha));
        g.addColorStop(1, rgba(atm.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    } else {
      const size = Math.max(1.5, cw * 0.14);
      const rising = atm.kind === "embers";
      const fall = atm.kind === "snow" ? 0.03 : rising ? 0.02 : 0.012;
      ctx.fillStyle = atm.color;
      for (let i = 0; i < atm.count; i++) {
        const sway = Math.sin(now * 0.001 + i * 2.3) * cw * 0.5;
        const drift = now * fall * (0.6 + frac(i + 7)) * (rising ? -1 : 1);
        const x = (((frac(i) * W + sway) % W) + W) % W;
        const y = (((frac(i + 41) * H + drift) % H) + H) % H;
        ctx.globalAlpha = atm.alpha * (0.55 + 0.45 * frac(i + 13));
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Keep only the overlay pixels over currently-visible tiles (one fill, so
   * `destination-in` clips to the whole FOV rather than erasing per rect). */
  private clipToVisible(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    visible: Set<number>,
    cw: number,
    ch: number,
    mapW: number,
    mapH: number
  ) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    for (let sy = 0; sy < this.rows; sy++) {
      for (let sx = 0; sx < this.cols; sx++) {
        const wx = sx + camX;
        const wy = sy + camY;
        if (wx < 0 || wy < 0 || wx >= mapW || wy >= mapH) continue;
        if (visible.has(wy * mapW + wx)) ctx.rect(sx * cw, sy * ch, cw, ch);
      }
    }
    ctx.fill();
    ctx.restore();
  }
}
