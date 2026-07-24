"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

/**
 * Procedural ASCII luminance-field background (drifting mist / rising embers, or
 * a silhouette-horizon "scene"). Self-contained: owns its own <canvas>, RAF loop
 * and resize handling, and tears them down on unmount. Sits behind screen content
 * as an absolutely-positioned layer.
 *
 *   <div className="relative">
 *     <AsciiField mode="abstract" biome="pit" bottom intensity={0.15} />
 *     … content (give it a higher z-index) …
 *   </div>
 *
 * Respects prefers-reduced-motion: renders one static frame instead of animating.
 */

type Biome =
  "pit" | "forest" | "marsh" | "mountain" | "castle" | "crypt" | "throne";

// Field tints — kept in sync with the game's biome palette (see content/ascii.ts).
const TINT: Record<string, string> = {
  pit: "#e0a94a",
  pitHot: "#ff7a3c",
  forest: "#5f9a4a",
  marsh: "#6f8f74",
  mountain: "#93c4f0",
  castle: "#a97bff",
  crypt: "#9aa88a",
  throne: "#ffbe6a",
};
const RAMP = " .\u00b7:-=+*x#%@";

// ── cheap value noise ──────────────────────────────────────────────────────
function hash(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const tl = hash(xi, yi),
    tr = hash(xi + 1, yi);
  const bl = hash(xi, yi + 1),
    br = hash(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
}
function fbm(x: number, y: number) {
  let a = 0,
    amp = 0.5,
    f = 1;
  for (let i = 0; i < 4; i++) {
    a += amp * vnoise(x * f, y * f);
    f *= 2;
    amp *= 0.5;
  }
  return a;
}
function smooth(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

interface Grid {
  w: number;
  h: number;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  font: string;
}

export function AsciiField({
  mode = "abstract",
  biome = "pit",
  bottom = false,
  intensity = 0.34,
  className = "",
  style,
}: {
  mode?: "abstract" | "scene";
  biome?: Biome;
  bottom?: boolean;
  intensity?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fs = 24;
    const g: Grid = {
      w: 0,
      h: 0,
      cols: 0,
      rows: 0,
      cellW: 0,
      cellH: 0,
      font: "",
    };

    const measure = () => {
      const w = canvas.clientWidth || 960;
      const h = canvas.clientHeight || 600;
      g.w = w;
      g.h = h;
      canvas.width = w;
      canvas.height = h;
      g.font = `${fs}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.font = g.font;
      g.cellW = ctx.measureText("M").width || fs * 0.6;
      g.cellH = fs * 1.12;
      g.cols = Math.ceil(w / g.cellW) + 1;
      g.rows = Math.ceil(h / g.cellH) + 1;
    };

    const field = (cx: number, cy: number, t: number): number => {
      if (mode === "scene") return scene(cx, cy, t);
      const sway = Math.sin(t * 0.13 + cy * 0.06) * 1.4;
      let n = fbm((cx + sway) * 0.11, cy * 0.15 - t * 0.3);
      n = Math.max(0, Math.min(1, (n - 0.4) * 2.4));
      if (bottom) {
        const gg = smooth(0, g.rows * 0.95, cy);
        n *= 0.3 + 1.05 * gg;
        const sp = hash((cx * 5) | 0, Math.floor(cy + t * 6) | 0);
        if (gg > 0.4 && sp > 0.992) n = Math.min(1, n + 0.6);
      }
      return Math.max(0, Math.min(1, n));
    };

    const scene = (cx: number, cy: number, t: number): number => {
      const rows = g.rows;
      let horizon: number;
      if (biome === "mountain") {
        horizon = rows * 0.5 + (fbm(cx * 0.05, 12.3) - 0.5) * rows * 0.72;
      } else if (biome === "forest") {
        const canopy = (fbm(cx * 0.11, 3.1) - 0.5) * rows * 0.34;
        const jag = (vnoise(cx * 0.55, 7.7) - 0.5) * rows * 0.1;
        horizon = rows * 0.58 + canopy + jag;
      } else {
        const period = 9;
        const tooth = Math.floor(cx / (period / 2)) % 2 === 0 ? rows * 0.11 : 0;
        horizon = rows * 0.58 - tooth - (fbm(cx * 0.03, 2) - 0.5) * rows * 0.16;
      }
      if (cy > horizon) {
        let base = 0.55 + 0.42 * fbm(cx * 0.22 + t * 0.08, cy * 0.26);
        if (biome === "mountain") {
          const crest = smooth(horizon, horizon + 2.5, cy);
          base += (1 - crest) * 0.35;
        }
        return Math.min(1, base);
      }
      const hs = hash(cx * 3 + 1, cy * 7 + 2);
      if (hs > 0.986)
        return 0.42 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.4 + hs * 40));
      const near = smooth(horizon - 5, horizon, cy);
      return 0.16 * near * fbm(cx * 0.16, cy * 0.2 - t * 0.08);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, g.w, g.h);
      ctx.font = g.font;
      ctx.textBaseline = "top";
      const L = RAMP.length - 1;
      const cxMid = g.cols / 2,
        cyMid = g.rows * 0.45;
      for (let cy = 0; cy < g.rows; cy++) {
        for (let cx = 0; cx < g.cols; cx++) {
          const v = field(cx, cy, t);
          if (v <= 0.03) continue;
          const ch = RAMP[Math.max(0, Math.min(L, Math.round(v * L)))];
          if (ch === " ") continue;
          const dx = (cx - cxMid) / cxMid,
            dy = (cy - cyMid) / (g.rows * 0.6);
          const d = Math.sqrt(dx * dx + dy * dy);
          const vign = smooth(0.32, 1.08, d);
          const a = 1.32 * intensity * (0.35 + 0.65 * v) * (0.2 + 0.8 * vign);
          if (a < 0.015) continue;
          ctx.globalAlpha = Math.min(0.92, a);
          if (biome === "pit") {
            ctx.fillStyle = cy / g.rows > 0.62 ? TINT.pitHot : TINT.pit;
          } else {
            ctx.fillStyle = TINT[biome] || "#8a8a9a";
          }
          ctx.fillText(ch, cx * g.cellW, cy * g.cellH);
        }
      }
      ctx.globalAlpha = 1;
    };

    measure();

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      draw(0);
      const ro = new ResizeObserver(() => {
        measure();
        draw(0);
      });
      ro.observe(canvas);
      return () => ro.disconnect();
    }

    let raf = 0,
      last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 62) return; // ~16fps — plenty for a background
      last = t;
      draw(t * 0.001);
    };
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => measure());
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mode, biome, bottom, intensity]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 block h-full w-full ${className}`}
      style={style}
    />
  );
}
