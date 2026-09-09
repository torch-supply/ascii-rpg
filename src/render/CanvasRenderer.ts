import { ITEMS } from "@/content/items";
import { LEVELS } from "@/content/levels";
import { isTransparent } from "@/game/core/grid";
import { CONFIG } from "@/content/config";
import {
  unaidedSight,
  torchFlickerDepth,
  TORCH_FLICKER_AMP,
} from "@/game/core/light";
import { ELITE, MONSTERS } from "@/content/monsters";
import type { GameEvent } from "@/game/core/events";
import { idx } from "@/game/core/grid";
import { ventState } from "@/game/core/gas";
import { STATUS } from "@/game/core/status";
import type {
  Biome,
  DecalKind,
  GameMap,
  GameState,
  StatusKind,
} from "@/game/core/types";
import * as ROT from "rot-js";
import { createDisplay } from "./Display";
import {
  AMBIENT_ENTITY,
  ambientForBiome,
  beatAmbient,
  type BiomeAmbient,
  computeLightMap,
  type ExtraLight,
  type LightMap,
} from "./lighting";
import {
  BIOME_ATMOSPHERE,
  WEATHER_ATMOSPHERE,
  CHASM_BG,
  SCONCE_LIT,
  SCONCE_COLD,
  CRACKED_WALL_CRACK_DIM,
  dim,
  GAS_COLOR,
  DECAL_STYLE,
  SPORE_VENT_PRIMING_GLYPH,
  SPORE_VENT_PRIMING_COLOR,
  FOG_DIM,
  ATMO_LIT_REF,
  ATMO_MIN_SCALE,
  ATMO_EMISSIVE,
  PLAYER_COLOR,
  PLAYER_GLYPH,
  terrainColor,
  terrainGlyph,
} from "./tiles";

// Aim to show roughly this many tiles vertically; cell size derives from it.
const TARGET_ROWS = 26;
const MIN_CELL = 12;
const MAX_CELL = 30;

const PROJECTILE_MS = 180;
const HIT_DELAY_MS = 30;
const HIT_MS = 150;
const RING_MS = 300; // firebomb / Ruin expanding blast ring

const AMBIENT_MS = 132; // ~8fps flicker redraw

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

/** Draw a persistent floor stain as a soft, seeded organic blob — an oval
 * pool (rotated, squashed) with a couple of splatter droplets for blood. All
 * deterministic from `seed` (tile index) so it never shifts frame to frame. */
function drawDecal(
  ctx: CanvasRenderingContext2D,
  kind: DecalKind,
  seed: number,
  ox: number,
  oy: number,
  cw: number,
  ch: number,
) {
  const conf = DECAL_STYLE[kind];
  const cx = ox + cw * 0.5 + (frac(seed + 1) - 0.5) * cw * 0.16;
  const cy = oy + ch * 0.5 + (frac(seed + 2) - 0.5) * ch * 0.16;
  const r = cw * conf.reach * (0.85 + 0.3 * frac(seed + 5));

  // main pool: a rotated, squashed radial gradient reads as an oval puddle
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(frac(seed) * Math.PI);
  ctx.scale(1, 0.6 + 0.3 * frac(seed + 3));
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgba(conf.color, conf.alpha));
  g.addColorStop(0.65, rgba(conf.color, conf.alpha * 0.7));
  g.addColorStop(1, rgba(conf.color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // extra overlapping lobes: an irregular, settled puddle rather than one clean
  // ellipse. Each is a smaller offset copy of the main pool, so the silhouette gets
  // bays and headlands instead of a perfect rim.
  for (let l = 0; l < conf.lobes; l++) {
    const a = frac(seed + 40 + l) * Math.PI * 2;
    const off = r * (0.3 + 0.3 * frac(seed + 50 + l));
    const lr = r * (0.45 + 0.3 * frac(seed + 60 + l));
    const lx = cx + Math.cos(a) * off;
    const ly = cy + Math.sin(a) * off;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(frac(seed + 70 + l) * Math.PI);
    ctx.scale(1, 0.55 + 0.35 * frac(seed + 80 + l));
    const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, lr);
    lg.addColorStop(0, rgba(conf.color, conf.alpha * 0.8));
    lg.addColorStop(0.7, rgba(conf.color, conf.alpha * 0.5));
    lg.addColorStop(1, rgba(conf.color, 0));
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(0, 0, lr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // scattered droplets around the pool (blood)
  for (let d = 0; d < conf.drops; d++) {
    const a = frac(seed + 10 + d) * Math.PI * 2;
    const dist = cw * (0.28 + 0.2 * frac(seed + 20 + d));
    const dr = cw * 0.09 * (0.6 + frac(seed + 30 + d));
    const dx = cx + Math.cos(a) * dist;
    const dy = cy + Math.sin(a) * dist;
    const dg = ctx.createRadialGradient(dx, dy, 0, dx, dy, dr);
    dg.addColorStop(0, rgba(conf.color, conf.alpha * 0.9));
    dg.addColorStop(1, rgba(conf.color, 0));
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.arc(dx, dy, dr, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Paint a deterministic fracture (in the already-set strokeStyle) over a cell.
 *
 * Built as a TEMPLATE in unit space — a long main crack through the origin plus a few
 * branches splintering off it — which is then rotated, scaled and offset as a single
 * assembly. That's the shape of a real fracture: one running split with subsidiary
 * ones peeling away from a common point. The origin itself is never drawn; it's just
 * where the branches meet.
 *
 * Everything derives from `seed` (the tile index), so a given wall always cracks the
 * same way and never flickers between frames.
 *
 * Two details that matter for the look:
 *  • every line is a POLYLINE with small perpendicular jitter, not a straight
 *    segment — a crack wanders, and straight branch stubs read as drawn-on marks;
 *  • the transform is applied to the POINTS rather than via `ctx.scale`, because
 *    scaling the canvas would scale the stroke too and the hairline weight is
 *    load-bearing (fine splinters read as fractured stone; heavy ones read as ink).
 */
function drawFissure(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cw: number,
  ch: number,
  seed: number,
) {
  const rnd = (n: number) => frac(seed * 3.1 + n * 7.7);
  ctx.save();
  // Clip to this cell. The template is deliberately drawn LARGER than one cell so the
  // lines run out to the boundary and read as a fracture continuing into the
  // surrounding stone (as in the reference sketch, where the cracks leave the frame).
  // Without the clip that overspill lands on neighbouring tiles — measured at up to
  // 10% of a cell, i.e. stray marks on the floor next door.
  ctx.beginPath();
  ctx.rect(ox, oy, cw, ch);
  ctx.clip();
  ctx.lineWidth = Math.max(1.1, cw * 0.11);
  ctx.lineCap = "round";

  // one seeded transform for the whole assembly: orientation, a little squash, and a
  // nudge off dead-centre so cracks don't all radiate from the same pixel
  const ang = rnd(3) * Math.PI; // 0-180°, so it reads as a split not a direction
  const scx = 0.88 + 0.24 * rnd(4);
  const scy = 0.88 + 0.24 * rnd(5);
  const offX = (rnd(1) - 0.5) * 0.16;
  const offY = (rnd(2) - 0.5) * 0.16;
  const cosA = Math.cos(ang);
  const sinA = Math.sin(ang);
  /** unit space (origin = the crack's meeting point) → canvas pixels */
  const P = (ux: number, uy: number): [number, number] => {
    const x = ux * scx + offX;
    const y = uy * scy + offY;
    return [
      ox + cw * (0.5 + (x * cosA - y * sinA)),
      oy + ch * (0.5 + (x * sinA + y * cosA)),
    ];
  };
  const stroke = (pts: [number, number][]) => {
    ctx.beginPath();
    const [x0, y0] = P(pts[0][0], pts[0][1]);
    ctx.moveTo(x0, y0);
    for (let k = 1; k < pts.length; k++) {
      const [x, y] = P(pts[k][0], pts[k][1]);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  // the main split: runs nearly the full cell, wandering as it goes
  const wob = (n: number) => (rnd(n) - 0.5) * 0.13;
  stroke([
    [-0.62, wob(6)],
    [-0.28, wob(7)],
    [0.04, wob(8)],
    [0.33, wob(9)],
    [0.62, wob(10)],
  ]);

  // 2-3 branches peeling off the meeting point, each kinked and of its own length
  const branches = 2 + (rnd(11) > 0.45 ? 1 : 0);
  for (let k = 0; k < branches; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const ba = side * (0.5 + rnd(20 + k) * 0.8 + k * 0.13); // fan them apart
    const len = 0.3 + rnd(30 + k) * 0.3;
    const c = Math.cos(ba);
    const sn = Math.sin(ba);
    // walk outward in three steps, drifting a little each time
    const seg = (f: number, d: number): [number, number] => [
      c * len * f - sn * d,
      sn * len * f + c * d,
    ];
    stroke([
      [0, 0],
      seg(0.45, (rnd(40 + k) - 0.5) * 0.09),
      seg(0.78, (rnd(50 + k) - 0.5) * 0.1),
      seg(1, (rnd(60 + k) - 0.5) * 0.07),
    ]);
  }
  ctx.restore();
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Where the viewport's top-left sits for a given player position — centered on the
 * player, then clamped so the view never scrolls past the map edge.
 *
 * Extracted as a PURE function (rather than living inline in `renderBase`) because
 * it's the one piece of renderer logic a test can actually assert: an off-by-one in
 * either clamp is a visible bug — a column of dead space at a map edge, or the
 * player drifting off-centre — and the renderer is otherwise unreachable from a
 * headless suite. Covered by `[61]`.
 *
 * A viewport LARGER than the map clamps to 0 (the map is drawn flush and the extra
 * space is simply off-map), which is why the upper bound is `max(0, …)`.
 */
export function cameraOrigin(
  playerX: number,
  playerY: number,
  cols: number,
  rows: number,
  mapWidth: number,
  mapHeight: number,
): { camX: number; camY: number } {
  return {
    camX: clamp(
      playerX - Math.floor(cols / 2),
      0,
      Math.max(0, mapWidth - cols),
    ),
    camY: clamp(
      playerY - Math.floor(rows / 2),
      0,
      Math.max(0, mapHeight - rows),
    ),
  };
}

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
  | {
      kind: "ring";
      x: number;
      y: number;
      radius: number;
      t0: number;
      dur: number;
    };

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
  private targeting: { x: number; y: number; kind?: string } | null = null;
  private camX = 0;
  private camY = 0;
  private fx: Fx[] = [];
  private rafId: number | null = null;
  private ambientId: number | null = null;
  private lastAmbient = 0;
  private reduceMotion = false;
  // dynamic lighting: per-tile colored light, recomputed each render
  private lightMap: LightMap | null = null;
  // player pos + map width, cached for litVis's radial edge-fade (round vignette)
  private litPX = 0;
  private litPY = 0;
  private litW = 1;
  // per-region ambient floor (center → edge), indexed by tile region id, set
  // each render from the level's biome + any sub-biome
  private regionArr: number[] | null = null;
  private ambByRegion: BiomeAmbient[] = [];
  private effR = 8; // last frame's ambient-falloff radius (shared with the overlay)
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

  draw(
    state: GameState,
    targeting?: { x: number; y: number; kind?: string } | null,
  ) {
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

  /** Aiming overlay. For a directional class ability: chevrons on the four
   * cardinal tiles around the player ("press a way to go"). Otherwise (firebomb
   * / ranged / blink): a reticle at the target tile + its 3x3 blast ring. */
  private drawTargeting(tx: number, ty: number) {
    if (this.targeting?.kind === "ability") {
      const arrows: [number, number, string][] = [
        [0, -1, "↑"],
        [0, 1, "↓"],
        [-1, 0, "←"],
        [1, 0, "→"],
      ];
      for (const [dx, dy, glyph] of arrows) {
        this.drawCell(tx + dx, ty + dy, glyph, "#ffdd55");
      }
      return;
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const center = dx === 0 && dy === 0;
        this.drawCell(
          tx + dx,
          ty + dy,
          center ? "X" : "+",
          center ? "#ffdd55" : "#ff7a3c",
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
      } else if (e.kind === "heal") {
        this.spawnDamageNumber(e.x, e.y, e.amount, false, "#7fdf6a"); // green +heal
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
    color?: string,
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
      if (this.targeting)
        this.drawTargeting(this.targeting.x, this.targeting.y);
    }
  };

  private drawCell(wx: number, wy: number, glyph: string, color: string) {
    const sx = wx - this.camX;
    const sy = wy - this.camY;
    if (sx < 0 || sy < 0 || sx >= this.cols || sy >= this.rows) return;
    this.display.draw(sx, sy, glyph, color, null);
  }

  /** Transient light sources from active cosmetic FX (bolts, explosions, hit
   * sparks), color/intensity-scaled for the current frame. */
  /**
   * PROTOTYPE — lit sconces on the walls.
   *
   * Light-gated sight is only as interesting as the lights in the level, and
   * right now there are barely any static ones: measured from the spawn it
   * reveals +0 tiles on three levels. Sconces give it something to show.
   *
   * Mounted on WALL tiles facing open floor, so nothing about walkability or the
   * connectivity guarantees changes — the wall stays a wall, it just burns.
   * Positions come from an integer hash of the level index, memoised, so there
   * is no generation pass and nothing in the save.
   */
  /**
   * Sconces as light sources — emitted from the floor tile the bracket FACES,
   * not from the wall it's mounted on.
   *
   * A wall is opaque, so `ROT.Lighting`'s shadowcasting from a source inside one
   * is blocked at its own cell: measured, a light on a wall lit **0** tiles,
   * while the same light one step onto the floor lit **38**. The first version
   * put it on the wall, so every sconce was a glyph that illuminated nothing —
   * and the gains I measured were coming from glowcaps and altars, not sconces
   * at all. Physically this is also just right: the flame throws its light out
   * into the room, not into the masonry behind it.
   */
  private sconceLights(state: GameState, now: number): ExtraLight[] {
    const map = state.map;
    const w = map.width;
    const out: ExtraLight[] = [];
    for (const i of state.map.sconces ?? []) {
      const f = this.reduceMotion
        ? 1
        : 0.82 + 0.18 * Math.abs(Math.sin(now * 0.011 + i));
      // the open neighbour it faces; a bracket always has one (see sconceTiles)
      const face = [i + 1, i - 1, i + w, i - w].find((j) =>
        isTransparent(map, j % w, Math.floor(j / w)),
      );
      if (face === undefined) continue;
      out.push({
        x: face % w,
        y: Math.floor(face / w),
        color: [225 * f, 168 * f, 96 * f] as [number, number, number],
      });
    }
    return out;
  }

  private fxLights(now: number): ExtraLight[] {
    const out: ExtraLight[] = [];
    for (const f of this.fx) {
      if (now < f.t0) continue;
      const p = clamp((now - f.t0) / f.dur, 0, 1);
      if (f.kind === "projectile") {
        // a warm light rides along with the bolt head
        const hx = Math.round(f.fromX + (f.toX - f.fromX) * p);
        const hy = Math.round(f.fromY + (f.toY - f.fromY) * p);
        out.push({ x: hx, y: hy, color: [255, 150, 70] });
      } else if (f.kind === "ring") {
        // explosion: a bright flash that pops, then fades over the first ~60%
        const k = Math.max(0, 1 - p * 1.6);
        if (k > 0.03)
          out.push({ x: f.x, y: f.y, color: [255 * k, 175 * k, 90 * k] });
      } else {
        // hit spark: a small, brief white flash
        const k = p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) / 0.5);
        if (k > 0.03)
          out.push({ x: f.x, y: f.y, color: [150 * k, 150 * k, 160 * k] });
      }
    }
    return out;
  }

  /**
   * Color a visible tile: multiply the base glyph color by (ambient + computed
   * light) so sources tint and brighten their surroundings. `effR` shapes the
   * ambient edge-fade; `entity` uses the flat readability floor.
   */
  private litVis(color: string, i: number, effR: number, entity = false) {
    const lm = this.lightMap;
    if (!lm) return color; // no light computed yet (pre-first-render); unreachable in practice
    const total = this.tileLight(i, effR, entity);
    return ROT.Color.toHex(
      ROT.Color.multiply(ROT.Color.fromString(color), total),
    );
  }

  /**
   * The light a tile is RENDERED under: the eased per-region ambient plus the
   * computed light. ONE choke point, because both the glyph colour and the
   * atmosphere read it — otherwise a snowflake can be brighter than the ground
   * it is falling on, which is exactly what happened on the Frostspine once
   * sight stopped being a torch disc.
   */
  private tileLight(
    i: number,
    effR: number,
    entity = false,
  ): [number, number, number] {
    const lm = this.lightMap;
    const L = lm?.get(i);
    // Fade ONLY the ambient floor with distance, leaving the computed light
    // (the torch pool + colored sources) intact — so the pool keeps its clean
    // falloff while the flat ambient no longer forms a lit plateau that meets
    // the vision edge on a hard line (or lets you see far into the dark).
    // Entities keep a constant ambient floor so they stay legible in the dark.
    let amb: [number, number, number];
    if (entity) {
      amb = AMBIENT_ENTITY;
    } else {
      // Ease the ambient from the biome's center tint (player) to its edge
      // tint (~fog level) at the vision edge — bright-ish near you, never
      // dropping below the explored-memory brightness, so the FOV rim blends
      // into the remembered tiles instead of forming a black ring.
      const ex = i % this.litW;
      const ey = Math.floor(i / this.litW);
      const d = Math.hypot(ex - this.litPX, ey - this.litPY);
      const t = Math.min(1, d / Math.max(1, effR));
      const af = 1 - t * t * (3 - 2 * t); // 1 at player → 0 at the vision edge
      // per-region ambient tint (sub-biome patches glow in their own color)
      const ra =
        this.ambByRegion[this.regionArr ? this.regionArr[i] : 0] ??
        this.ambByRegion[0];
      const c = ra.center;
      const e = ra.edge;
      amb = [
        e[0] + (c[0] - e[0]) * af,
        e[1] + (c[1] - e[1]) * af,
        e[2] + (c[2] - e[2]) * af,
      ];
    }
    return [
      Math.min(255, amb[0] + (L ? L[0] : 0)),
      Math.min(255, amb[1] + (L ? L[1] : 0)),
      Math.min(255, amb[2] + (L ? L[2] : 0)),
    ];
  }

  private renderBase(state: GameState) {
    const { map, player } = state;
    const { cols, rows } = this;

    // Camera: center on the player, clamped so we never scroll past the map.
    const cam = cameraOrigin(
      player.x,
      player.y,
      cols,
      rows,
      map.width,
      map.height,
    );
    this.camX = cam.camX;
    this.camY = cam.camY;
    const camX = this.camX;
    const camY = this.camY;

    const level = LEVELS[state.currentLevel];
    const palette = level.palette;
    // Straight from state — the renderer no longer keeps a visibility model or a
    // fog memory of its own. It had both while light-gating was a render-side
    // probe, and they drifted: the private `explored` set was never saved (a
    // resumed game showed an unexplored map) and was keyed only on the level
    // index, so a death-restart handed you a level already mapped.
    const visible = new Set(state.visible);
    const explored = new Set(state.explored);
    const knownTraps = new Set(state.knownTraps);

    // Effective light radius wobbles slightly so the torchlight edge flickers.
    const now = performance.now();
    // The torchlight EDGE wobbles on the same curve as the flame's colour, and
    // under the same rule: a lit torch or lantern only, damped away outdoors
    // (`torchFlickerDepth`). It was unconditional, so the rim of your vision
    // breathed even when you carried no flame at all — nothing was flickering.
    const depth = this.reduceMotion ? 0 : torchFlickerDepth(state);
    const flicker =
      depth === 0
        ? 0
        : ((Math.sin(now * 0.005) * 0.5 + Math.sin(now * 0.013) * 0.3) *
            depth) /
          TORCH_FLICKER_AMP;
    const effR = Math.max(
      2,
      player.lightRadius + flicker,
      // skylight has to widen the ambient falloff as well as the visible set —
      // `litVis` eases ambient to its edge (fog-level) tint at effR, so a tile
      // lit by sky but beyond effR would render as a ghost
      CONFIG.sight === "lightGated" ? unaidedSight(state) : 0,
    );
    this.effR = effR;

    // colored multi-source light for this frame (see ./lighting). Ambient is
    // per-region so a sub-biome patch is lit in its own tint.
    this.regionArr = map.region ?? null;
    this.ambByRegion = (map.regionBiome ?? [level.biome]).map(ambientForBiome);

    // ── dynamic set-piece lighting beats (modulate the ambient) ──
    // dawn/dusk shift the hall as you close the quest. They use DIFFERENT
    // triggers because the two levels are shaped differently:
    //  • DAWN (Throne) — keyed to Malachar's remaining HP. His fight IS the
    //    level (an 80-HP multi-phase brawl → victory), so the sky rekindling as
    //    his HP drains plays out over a long, visible arc, cresting on the kill.
    //  • DUSK (Antechamber) — keyed to how far you've ADVANCED toward the Herald
    //    (the gate to the throne), NOT his HP. The Herald dies fast and the level
    //    then transitions, so an HP-keyed dusk would only bottom out for the one
    //    instant before you leave. Distance-keyed, the dread instead deepens
    //    across the whole approach and peaks as you reach him — actually felt.
    if (level.lightingBeat === "dawn" || level.lightingBeat === "dusk") {
      const boss = state.monsters.find((m) => MONSTERS[m.defId].isBoss);
      if (boss) {
        let prog: number;
        if (level.lightingBeat === "dawn") {
          prog = 1 - Math.max(0, boss.hp) / MONSTERS[boss.defId].maxHp;
        } else {
          const start = state.entryPlayer ?? player; // this level's spawn tile
          const full = Math.abs(start.x - boss.x) + Math.abs(start.y - boss.y);
          const cur = Math.abs(player.x - boss.x) + Math.abs(player.y - boss.y);
          prog = full > 0 ? clamp(1 - cur / full, 0, 1) : 0;
        }
        const pulse = this.reduceMotion
          ? 1
          : 0.85 + 0.15 * Math.abs(Math.sin(now * 0.006));
        const g = prog * pulse;
        this.ambByRegion = this.ambByRegion.map((a) =>
          beatAmbient(level.lightingBeat!, g, a),
        );
      }
    } else if (level.flood && state.floodStep) {
      const t = Math.min(
        1,
        state.floodStep / Math.max(1, level.flood.maxSteps),
      );
      const k = 1 - 0.45 * t; // dim toward 55% at full flood
      const drown = (c: [number, number, number]): [number, number, number] => [
        c[0] * k,
        c[1] * k,
        Math.min(255, c[2] * k * 1.2), // hold the blue → reads colder as it darkens
      ];
      this.ambByRegion = this.ambByRegion.map((a) => ({
        center: drown(a.center),
        edge: drown(a.edge),
      }));
    }

    // COLOUR only. `state.visible` is already the light-gated set (computed
    // steady, once per turn, in `recomputeFOV`); this pass adds flicker and
    // transient FX on top so the picture breathes without the SET breathing —
    // tiles must not wink in and out of visibility at 60fps in a turn game.
    this.lightMap = computeLightMap(state, now, this.reduceMotion, [
      ...this.fxLights(now),
    ]);

    this.litPX = player.x;
    this.litPY = player.y;
    this.litW = map.width;

    this.display.clear();

    // A sconce needs to be VISIBLE as the source of its own light — a glow with
    // nothing making it is what made the light-shaft attempt read as a smudge.
    // Drawn as a warm mark over its wall tile; the tiles come from the MAP now,
    // placed at generation, because light decides `state.visible`.
    const sconces = new Set(state.map.sconces ?? []);

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
        // resolve this tile's biome/palette (sub-biome region or the level's own)
        const rid = map.region ? map.region[i] : 0;
        const rBiome = map.regionBiome ? map.regionBiome[rid] : level.biome;
        const rPalette = map.regionPalette ? map.regionPalette[rid] : palette;
        let glyph = terrainGlyph(t, rBiome);
        let color = terrainColor(t, rPalette, rBiome);
        // a sensed/detected (but still armed) trap shows as a faint warning ^
        if (t === "trap" && knownTraps.has(i)) {
          glyph = "^";
          color = "#e0904a";
        }
        // a spore vent one turn from blowing swells + brightens, so an attentive
        // player can step out of the footprint before the haze lands
        if (t === "sporeVent" && ventState(state.turnCount, i) === "priming") {
          glyph = SPORE_VENT_PRIMING_GLYPH;
          color = SPORE_VENT_PRIMING_COLOR;
        }
        color = isVis ? this.litVis(color, i, effR) : dim(color, FOG_DIM);
        // living terrain: water shimmers, marsh reeds sway (per-tile phase)
        if (isVis && !this.reduceMotion) {
          if (t === "water")
            color = dim(color, 0.82 + 0.18 * Math.sin(now * 0.004 + i * 0.9));
          else if (rBiome === "marsh" && t === "wall")
            color = dim(color, 0.9 + 0.1 * Math.sin(now * 0.0035 + i * 0.6));
        }
        // a chasm is a blank glyph — a faint cool bg tint marks the void so it
        // reads as a hole, not the pure-black off-map dark (dimmer in memory).
        //
        // Deliberately the ONLY tile with a bg tint. A solid fill is a hard-edged
        // rectangle on the cell grid, so it reads as a UI highlight rather than as
        // texture — tried on cracked walls to make them look distressed and it looked
        // like a selected cell. A chasm gets away with it because a chasm IS a
        // featureless block of nothing; a wall is supposed to have surface.
        const bg =
          t === "chasm" ? (isVis ? CHASM_BG : dim(CHASM_BG, FOG_DIM)) : null;
        if (sconces.has(i) && (isVis || isExp)) {
          const flick = this.reduceMotion
            ? 1
            : 0.8 + 0.2 * Math.abs(Math.sin(now * 0.011 + i));
          this.display.draw(
            sx,
            sy,
            // Ω, not ‼ — a bracket shape, and unlike two stacked exclamation
            // marks it can't be misread as the `!` twelve potions share.
            "Ω",
            isVis ? dim(SCONCE_LIT, flick) : dim(SCONCE_COLD, FOG_DIM), // remembered = cold iron, not a flame
            bg,
          );
          continue;
        }
        this.display.draw(sx, sy, glyph, color, bg);
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
      const glyph =
        // ▵/▴ — the hollow twin of the burning frame, so the alternation reads
        // as ONE flame guttering. It was `*`, which the quest shards also use:
        // a fire that looks like the thing a collect level sends you to pick up.
        !this.reduceMotion && Math.sin(now * 0.03 + f.i) > 0 ? "▵" : "▴";
      const base = f.life <= 1 ? "#ff5a3c" : "#ff9d3c";
      this.display.draw(sx, sy, glyph, dim(base, flick), null);
    }

    // drifting poison haze (spore vents) — a faint toxic shimmer over terrain
    for (const g of state.gasTiles) {
      if (!visible.has(g.i)) continue;
      const gx = g.i % map.width;
      const gy = Math.floor(g.i / map.width);
      const sx = gx - camX;
      const sy = gy - camY;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const swirl = this.reduceMotion
        ? 0.7
        : 0.5 + 0.28 * Math.abs(Math.sin(now * 0.006 + g.i * 0.7));
      const glyph =
        !this.reduceMotion && Math.sin(now * 0.008 + g.i) > 0 ? "∴" : "°";
      this.display.draw(sx, sy, glyph, dim(GAS_COLOR, swirl), null);
    }

    // lich barrage telegraph: tiles about to be hit by dark fire next turn —
    // a pulsing danger glyph over a dark-red cell so the player can step clear
    for (const bi of state.barrage) {
      if (!visible.has(bi)) continue;
      const bx = bi % map.width;
      const by = Math.floor(bi / map.width);
      const sx = bx - camX;
      const sy = by - camY;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const pulse = this.reduceMotion
        ? 0.7
        : 0.45 + 0.4 * Math.abs(Math.sin(now * 0.012));
      const bg = dim("#7a1512", pulse);
      this.display.draw(sx, sy, "✷", dim("#ff6a4a", 0.6 + 0.4 * pulse), bg);
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
        ? this.litVis(base, i, effR, true)
        : dim(base, FOG_DIM);
      this.display.draw(sx, sy, "‡", color, null);
    }

    // lore props (drawn from memory too — a curiosity you can return to). Gold
    // while unread, dimmed once read.
    for (const l of state.lore ?? []) {
      const i = idx(l.x, l.y, map.width);
      const isVis = visible.has(i);
      if (!isVis && !explored.has(i)) continue;
      const sx = l.x - camX;
      const sy = l.y - camY;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const base = l.read
        ? "#6a6a66"
        : l.kind === "remains"
          ? "#b0a890"
          : "#cbb488";
      const color = isVis
        ? this.litVis(base, i, effR, true)
        : dim(base, FOG_DIM);
      this.display.draw(sx, sy, "¶", color, null);
    }

    // items (only where currently visible)
    for (const it of state.items) {
      if (!visible.has(idx(it.x, it.y, map.width))) continue;
      const sx = it.x - camX;
      const sy = it.y - camY;
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      const def = ITEMS[it.defId];
      const color = this.litVis(
        def.color,
        idx(it.x, it.y, map.width),
        effR,
        true,
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
      const color = this.litVis(
        baseColor,
        idx(m.x, m.y, map.width),
        effR,
        true,
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
      null,
    );

    this.paintOverlay(state, camX, camY, effR, visible, explored);
  }

  /**
   * The transparent overlay atop the rot.js canvas, painted each frame and kept
   * aligned/scrolled with the base:
   *   1. additive bloom on bright sources + per-biome atmosphere + decals, all
   *      clipped together to the visible area so nothing bleeds past walls, then
   *   2. cracked-wall knockout fissures in the background color (see below).
   */
  private paintOverlay(
    state: GameState,
    camX: number,
    camY: number,
    effR: number,
    visible: Set<number>,
    explored: Set<number>,
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

    // 1) additive bloom halos on the brightest sources + biome atmosphere, then
    // clipped to the visible area so neither bleeds into the dark past the walls.
    // (The per-tile light map already provides the torch/ambient glow.)
    this.paintBloom(ctx, state, camX, camY, visible, cw, ch);
    this.paintAtmosphere(
      ctx,
      state,
      camX,
      camY,
      cw,
      ch,
      overlay.width,
      overlay.height,
    );
    this.paintLightning(ctx, state, overlay.width, overlay.height);
    this.paintDecals(ctx, state, camX, camY, visible, cw, ch);
    this.clipToVisible(
      ctx,
      camX,
      camY,
      visible,
      cw,
      ch,
      state.map.width,
      state.map.height,
    );

    // 2) cracked-wall knockout fissures (only on levels that have them)
    if (state.map !== this.crackMap) {
      this.crackMap = state.map;
      this.crackAny = state.map.tiles.includes("crackedWall");
    }
    if (this.crackAny) {
      const { map } = state;
      const levelPalette = LEVELS[state.currentLevel].palette;
      const levelBiome = LEVELS[state.currentLevel].biome;
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
          const rid = map.region ? map.region[i] : 0;
          const rBiome = map.regionBiome ? map.regionBiome[rid] : levelBiome;
          const rPalette = map.regionPalette
            ? map.regionPalette[rid]
            : levelPalette;
          const wallBase = terrainColor("crackedWall", rPalette, rBiome);
          // the crack is the wall's own color, darker — a shadowed fracture
          // that stays legible under the torch glow (vs. a flat knockout)
          const shown = isVis
            ? this.litVis(wallBase, i, effR)
            : dim(wallBase, FOG_DIM);
          ctx.strokeStyle = dim(shown, CRACKED_WALL_CRACK_DIM);
          drawFissure(ctx, sx * cw, sy * ch, cw, ch, i);
        }
      }
    }
  }

  /** Subtle additive bloom on the brightest sources — fire, the Sunblade, and
   * in-flight bolts — as a soft radial-gradient glow (wide, smooth falloff, no
   * hard core), blended with `lighter` so those things radiate. Painted before
   * the visible-clip so it never bleeds past walls. */
  private paintBloom(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camX: number,
    camY: number,
    visible: Set<number>,
    cw: number,
    ch: number,
  ) {
    const now = this.reduceMotion ? 0 : performance.now();
    const w = state.map.width;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // a soft light bloom: bright-ish center easing smoothly to transparent
    const glow = (
      sx: number,
      sy: number,
      hex: string,
      radius: number,
      peak: number,
    ) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
      g.addColorStop(0, rgba(hex, peak));
      g.addColorStop(0.35, rgba(hex, peak * 0.4));
      g.addColorStop(0.7, rgba(hex, peak * 0.1));
      g.addColorStop(1, rgba(hex, 0));
      ctx.fillStyle = g;
      ctx.fillRect(sx - radius, sy - radius, radius * 2, radius * 2);
    };

    // lingering fire — flickering orange bloom per tile
    for (const f of state.fireTiles) {
      if (!visible.has(f.i)) continue;
      const fx = ((f.i % w) - camX + 0.5) * cw;
      const fy = (Math.floor(f.i / w) - camY + 0.5) * ch;
      const flick = this.reduceMotion
        ? 0.85
        : 0.62 + 0.38 * Math.abs(Math.sin(now * 0.02 + f.i));
      glow(fx, fy, "#ff8a30", cw * 2.6, 0.15 * flick);
    }

    // poison haze — a soft sickly-green wash over each spore cloud
    for (const g of state.gasTiles) {
      if (!visible.has(g.i)) continue;
      const gx = ((g.i % w) - camX + 0.5) * cw;
      const gy = (Math.floor(g.i / w) - camY + 0.5) * ch;
      const swirl = this.reduceMotion
        ? 0.7
        : 0.5 + 0.3 * Math.abs(Math.sin(now * 0.006 + g.i * 0.7));
      glow(gx, gy, GAS_COLOR, cw * 2.2, 0.12 * swirl);
    }

    // bioluminescent fungi — soft teal halos, each gently pulsing
    for (const i of visible) {
      if (state.map.tiles[i] !== "glowcap") continue;
      const gx = ((i % w) - camX + 0.5) * cw;
      const gy = (Math.floor(i / w) - camY + 0.5) * ch;
      const pulse = this.reduceMotion
        ? 0.85
        : 0.66 + 0.34 * Math.abs(Math.sin(now * 0.006 + i));
      glow(gx, gy, "#4fd6c0", cw * 1.9, 0.09 * pulse);
    }

    // glowing creatures (a drifting wisp) — a small pulsing halo in their light
    for (const m of state.monsters) {
      const gl = MONSTERS[m.defId]?.glow;
      if (!gl) continue;
      if (!visible.has(idx(m.x, m.y, w))) continue;
      const sx = (m.x - camX + 0.5) * cw;
      const sy = (m.y - camY + 0.5) * ch;
      const pulse = this.reduceMotion
        ? 0.8
        : 0.55 + 0.45 * Math.abs(Math.sin(now * 0.009 + m.x * 1.7 + m.y));
      const hex = `#${gl.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
      glow(sx, sy, hex, cw * 1.7, 0.12 * pulse);
    }

    // the Sunblade on the ground — a gently pulsing gold radiance
    for (const it of state.items) {
      if (ITEMS[it.defId]?.questTag !== "sunblade") continue;
      if (!visible.has(idx(it.x, it.y, w))) continue;
      const sx = (it.x - camX + 0.5) * cw;
      const sy = (it.y - camY + 0.5) * ch;
      const pulse = this.reduceMotion
        ? 0.9
        : 0.82 + 0.18 * Math.sin(now * 0.004);
      glow(sx, sy, "#ffe14d", cw * 3.2, 0.2 * pulse);
    }

    // in-flight bolts — a warm bloom on the projectile head. Round to the same
    // cell the head glyph is drawn at (see the projectile FX in `tick`) so the
    // glow sits exactly under the bolt instead of sliding sub-cell ahead of it.
    for (const f of this.fx) {
      if (f.kind !== "projectile" || now < f.t0) continue;
      const p = clamp((now - f.t0) / f.dur, 0, 1);
      const hx = Math.round(f.fromX + (f.toX - f.fromX) * p);
      const hy = Math.round(f.fromY + (f.toY - f.fromY) * p);
      const bx = (hx - camX + 0.5) * cw;
      const by = (hy - camY + 0.5) * ch;
      glow(bx, by, "#ff9d3c", cw * 2.0, 0.18);
    }

    ctx.restore();
  }

  /** Per-biome ambient particles (drifting mist blobs, or many small moving
   * motes for snow/embers/dust). Procedural from the clock — no stored state —
   * and skipped under reduced-motion. Each biome present (the level's + any
   * sub-biome) draws its own weather, gated per-particle to the world tile under
   * it, so a sub-region's atmosphere only drifts over that region. */
  /** Storm lightning (levels with `weather:"rain"`): a periodic white flash over
   * the visible scene — a quick main strike + a smaller aftershock, then dark.
   * Driven purely by the clock; the caller clips it to the visible FOV. Off
   * under reduced-motion. */
  private paintLightning(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    w: number,
    h: number,
  ) {
    if (this.reduceMotion) return;
    if (LEVELS[state.currentLevel].weather !== "storm") return; // only the storm flashes
    const t = performance.now() % 6400; // one strike per ~6.4s
    let f = 0;
    if (t < 55)
      f = t / 55; // flash in
    else if (t < 170)
      f = 1 - (t - 55) / 115; // fade out
    else if (t < 210)
      f = 0.45 * ((t - 170) / 40); // aftershock in
    else if (t < 320) f = 0.45 * (1 - (t - 210) / 110); // aftershock out
    if (f <= 0.01) return;
    ctx.save();
    ctx.fillStyle = `rgba(200,216,255,${(0.17 * f).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  private paintAtmosphere(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camX: number,
    camY: number,
    cw: number,
    ch: number,
    W: number,
    H: number,
  ) {
    if (this.reduceMotion) return;
    const map = state.map;
    const levelBiome = LEVELS[state.currentLevel].biome;
    // biomes in play: the level's own + any distinct sub-biome
    const present: Biome[] = [levelBiome];
    if (map.regionBiome) {
      for (const b of map.regionBiome)
        if (!present.includes(b)) present.push(b);
    }
    // a level-wide `weather` overrides the BASE biome's atmosphere (sub-regions
    // keep their own) — e.g. a storm's driving rain instead of the biome default.
    const weather = LEVELS[state.currentLevel].weather;
    const atmFor = (b: Biome) =>
      b === levelBiome && weather
        ? WEATHER_ATMOSPHERE[weather]
        : BIOME_ATMOSPHERE[b];
    if (!present.some((b) => atmFor(b))) return;

    // biome of the world tile under an overlay pixel (weather is screen-space,
    // gated by whatever region currently sits beneath it)
    const biomeAtPx = (px: number, py: number): Biome => {
      const tx = camX + Math.floor(px / cw);
      const ty = camY + Math.floor(py / ch);
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height)
        return levelBiome;
      const rid = map.region ? map.region[ty * map.width + tx] : 0;
      return map.regionBiome ? map.regionBiome[rid] : levelBiome;
    };

    // How brightly a mote at this pixel should read. Snow, rain, ash, dust and
    // mist REFLECT — they are lit by whatever lights the ground, so their alpha
    // has to follow it. Embers and spores EMIT (a coal, a bioluminescent spore),
    // so they keep full strength in the dark, which is the whole point of them.
    //
    // Alpha used to be a flat constant, which was safe only while `visible` WAS
    // the torch radius — everything you could see was lit. Under light-gated
    // sight a tile can be visible on skylight alone with nothing in the light
    // map, and the Frostspine showed what that costs: 57% of visible tiles dim
    // or unlit, with snow (particle luma 130) painting over ground at 93. The
    // snow was the brightest thing on screen across half the view.
    const lumaOf = (c: [number, number, number]) =>
      0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const groundScale = (px: number, py: number) => {
      const tx = camX + Math.floor(px / cw);
      const ty = camY + Math.floor(py / ch);
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 1;
      const l = lumaOf(this.tileLight(ty * map.width + tx, this.effR));
      return clamp(l / ATMO_LIT_REF, ATMO_MIN_SCALE, 1);
    };

    const now = performance.now();
    ctx.save();
    for (const biome of present) {
      const atm = atmFor(biome);
      if (!atm) continue;
      const emits = ATMO_EMISSIVE.has(atm.kind);
      const scaleAt = (px: number, py: number) =>
        emits ? 1 : groundScale(px, py);
      // The base biome fills most of the screen — keep the whole-screen drift,
      // gated per-particle. A SUB-biome covers only a patch, so scatter its
      // particles across the region's own cells (concentrated there) — otherwise
      // whole-screen particles almost never land on a small patch.
      const cells =
        biome === levelBiome
          ? null
          : this.regionCells(state, biome, camX, camY, cw, ch);
      if (cells && cells.length === 0) continue;

      if (atm.kind === "mist") {
        for (let i = 0; i < atm.count; i++) {
          let x: number, y: number;
          if (cells) {
            // spread the blobs evenly through the region's cells (row-major)
            const c = cells[Math.floor(((i + 0.5) / atm.count) * cells.length)];
            x = c.x + Math.sin(now * 0.0004 + i * 1.7) * cw * 1.3;
            y = c.y + Math.cos(now * 0.0003 + i * 2.1) * ch * 0.9;
          } else {
            const drift =
              Math.sin(now * 0.00006 * (1 + (i % 3)) + i * 1.7) * W * 0.25;
            x = (((frac(i) * W + drift) % W) + W) % W;
            y = frac(i + 41) * H + Math.sin(now * 0.0001 + i) * ch * 0.5;
            if (biomeAtPx(x, y) !== biome) continue;
          }
          const r = cw * (3.5 + (i % 3));
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, rgba(atm.color, atm.alpha * scaleAt(x, y)));
          g.addColorStop(1, rgba(atm.color, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
      } else {
        const size = Math.max(1.5, cw * 0.14);
        const rising = atm.kind === "embers" || atm.kind === "spores";
        const fall =
          atm.kind === "rain"
            ? 0.06 // driving rain falls fast
            : atm.kind === "snow"
              ? 0.03
              : atm.kind === "ash"
                ? 0.013 // ash sifts down lazily
                : atm.kind === "spores"
                  ? 0.009 // spores waft up slow
                  : rising
                    ? 0.02
                    : 0.012;
        // scale mote count to a sub-region's size so a small patch isn't a blizzard
        const n = cells
          ? Math.min(atm.count, Math.max(6, Math.round(cells.length * 0.4)))
          : atm.count;
        ctx.fillStyle = atm.color;
        for (let i = 0; i < n; i++) {
          let x: number, y: number;
          if (cells) {
            const c = cells[Math.floor(((i + 0.5) / n) * cells.length)];
            x = c.x + Math.sin(now * 0.001 + i * 2.3) * cw * 0.6;
            y =
              c.y +
              (rising ? -1 : 1) *
                (((now * fall * (0.6 + frac(i + 7))) % ch) - ch * 0.5);
          } else {
            const sway = Math.sin(now * 0.001 + i * 2.3) * cw * 0.5;
            const drift = now * fall * (0.6 + frac(i + 7)) * (rising ? -1 : 1);
            x = (((frac(i) * W + sway) % W) + W) % W;
            y = (((frac(i + 41) * H + drift) % H) + H) % H;
            if (biomeAtPx(x, y) !== biome) continue;
          }
          ctx.globalAlpha =
            atm.alpha * (0.55 + 0.45 * frac(i + 13)) * scaleAt(x, y);
          // rain draws as a thin falling streak; everything else as a mote
          if (atm.kind === "rain") ctx.fillRect(x, y, 1.5, ch * 0.5);
          else ctx.fillRect(x, y, size, size);
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  /** Viewport screen-pixel centers of every visible cell whose (sub-)biome is
   * `biome` — used to scatter a sub-region's atmosphere over its own patch. */
  private regionCells(
    state: GameState,
    biome: Biome,
    camX: number,
    camY: number,
    cw: number,
    ch: number,
  ): { x: number; y: number }[] {
    const map = state.map;
    const levelBiome = LEVELS[state.currentLevel].biome;
    const out: { x: number; y: number }[] = [];
    for (let sy = 0; sy < this.rows; sy++) {
      for (let sx = 0; sx < this.cols; sx++) {
        const wx = camX + sx;
        const wy = camY + sy;
        if (wx < 0 || wy < 0 || wx >= map.width || wy >= map.height) continue;
        const rid = map.region ? map.region[wy * map.width + wx] : 0;
        const bb = map.regionBiome ? map.regionBiome[rid] : levelBiome;
        if (bb === biome) out.push({ x: (sx + 0.5) * cw, y: (sy + 0.5) * ch });
      }
    }
    return out;
  }

  /** Draw persistent floor stains as soft organic blobs (only the visible,
   * on-screen ones), so they read as pooled liquid rather than a filled cell. */
  private paintDecals(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    camX: number,
    camY: number,
    visible: Set<number>,
    cw: number,
    ch: number,
  ) {
    const w = state.map.width;
    for (const key in state.decals) {
      const i = Number(key);
      if (!visible.has(i)) continue;
      const sx = (i % w) - camX;
      const sy = Math.floor(i / w) - camY;
      if (sx < 0 || sy < 0 || sx >= this.cols || sy >= this.rows) continue;
      drawDecal(ctx, state.decals[i], i, sx * cw, sy * ch, cw, ch);
    }
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
    mapH: number,
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
