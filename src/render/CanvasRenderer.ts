import { ITEMS } from "@/content/items";
import { LEVELS } from "@/content/levels";
import { ELITE, MONSTERS } from "@/content/monsters";
import type { GameEvent } from "@/game/core/events";
import { idx } from "@/game/core/grid";
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
  type BiomeAmbient,
  computeLightMap,
  type ExtraLight,
  type LightMap,
} from "./lighting";
import {
  BIOME_ATMOSPHERE,
  CRACKED_WALL_CRACK_DIM,
  dim,
  FOG_DIM,
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
  const conf =
    kind === "blood"
      ? { color: "#8f1e1e", alpha: 0.32, reach: 0.42, drops: 2 }
      : { color: "#120d08", alpha: 0.5, reach: 0.5, drops: 0 };
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

/** Paint a deterministic jagged fissure (in the already-set strokeStyle)
 * centered on the cell's glyph, at a per-tile angle with 1–2 branches — so it
 * clearly cuts through the wall. `seed` fixes the shape so it never flickers. */
function drawFissure(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cw: number,
  ch: number,
  seed: number,
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
    const L = lm.get(i);
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
    const total: [number, number, number] = [
      Math.min(255, amb[0] + (L ? L[0] : 0)),
      Math.min(255, amb[1] + (L ? L[1] : 0)),
      Math.min(255, amb[2] + (L ? L[2] : 0)),
    ];
    return ROT.Color.toHex(
      ROT.Color.multiply(ROT.Color.fromString(color), total),
    );
  }

  private renderBase(state: GameState) {
    const { map, player } = state;
    const { cols, rows } = this;

    // Camera: center on the player, clamped so we never scroll past the map.
    this.camX = clamp(
      player.x - Math.floor(cols / 2),
      0,
      Math.max(0, map.width - cols),
    );
    this.camY = clamp(
      player.y - Math.floor(rows / 2),
      0,
      Math.max(0, map.height - rows),
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

    // colored multi-source light for this frame (see ./lighting). Ambient is
    // per-region so a sub-biome patch is lit in its own tint.
    this.regionArr = map.region ?? null;
    this.ambByRegion = (map.regionBiome ?? [level.biome]).map(ambientForBiome);

    // ── dynamic set-piece lighting beats (modulate the ambient) ──
    // Throne: the fire FLARES as the lich makes his last stand (phase 3, ≤1/3
    // HP) — the hall brightens + warms in a pulse, cresting with the danger
    // music. Crypt: the braziers GUTTER as the flood drowns it — ambient dims
    // and cools the higher the water rises.
    if (level.biome === "throne") {
      const boss = state.monsters.find((m) => MONSTERS[m.defId].isBoss);
      if (boss && boss.hp / MONSTERS[boss.defId].maxHp <= 1 / 3) {
        const p = this.reduceMotion
          ? 0.8
          : 0.55 + 0.45 * Math.abs(Math.sin(now * 0.006));
        const warm = (
          c: [number, number, number],
        ): [number, number, number] => [
          Math.min(255, c[0] + 100 * p),
          Math.min(255, c[1] + 42 * p),
          Math.max(0, c[2] - 12 * p),
        ];
        this.ambByRegion = this.ambByRegion.map((a) => ({
          center: warm(a.center),
          edge: warm(a.edge),
        }));
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

    this.lightMap = computeLightMap(
      state,
      now,
      this.reduceMotion,
      this.fxLights(now),
    );
    this.litPX = player.x;
    this.litPY = player.y;
    this.litW = map.width;

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
        color = isVis ? this.litVis(color, i, effR) : dim(color, FOG_DIM);
        // living terrain: water shimmers, marsh reeds sway (per-tile phase)
        if (isVis && !this.reduceMotion) {
          if (t === "water")
            color = dim(color, 0.82 + 0.18 * Math.sin(now * 0.004 + i * 0.9));
          else if (rBiome === "marsh" && t === "wall")
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
      const glyph =
        !this.reduceMotion && Math.sin(now * 0.03 + f.i) > 0 ? "*" : "▴";
      const base = f.life <= 1 ? "#ff5a3c" : "#ff9d3c";
      this.display.draw(sx, sy, glyph, dim(base, flick), null);
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
    if (!present.some((b) => BIOME_ATMOSPHERE[b])) return;

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

    const now = performance.now();
    ctx.save();
    for (const biome of present) {
      const atm = BIOME_ATMOSPHERE[biome];
      if (!atm) continue;
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
          g.addColorStop(0, rgba(atm.color, atm.alpha));
          g.addColorStop(1, rgba(atm.color, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
      } else {
        const size = Math.max(1.5, cw * 0.14);
        const rising = atm.kind === "embers";
        const fall = atm.kind === "snow" ? 0.03 : rising ? 0.02 : 0.012;
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
          ctx.globalAlpha = atm.alpha * (0.55 + 0.45 * frac(i + 13));
          ctx.fillRect(x, y, size, size);
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
