import * as ROT from "rot-js";
import type { Biome, GameState } from "@/game/core/types";
import { ITEMS } from "@/content/items";
import { MONSTERS } from "@/content/monsters";
import { idx, isTransparent } from "@/game/core/grid";

/**
 * Dynamic colored lighting via `ROT.Lighting`.
 *
 * Instead of the renderer's flat distance-dimming, this computes real
 * multi-source light that spreads through the FOV and bounces off surfaces:
 * a warm torch pool on the player, orange light thrown by lingering fire, a
 * gold glow from the Sunblade, cold violet from unspent altars + the boss, an
 * ominous red underlight on the lich's telegraphed barrage, and transient
 * flashes from bolts/explosions (passed in as `extra`). The renderer multiplies
 * each visible tile's glyph color by (ambient + light), so bright things
 * illuminate their surroundings.
 *
 * All the look lives in the knobs below.
 */

// ── ambient floor (per biome) ────────────────────────────────────────────────
// Baseline light on a visible tile with no source nearby. The renderer eases it
// from `center` (at the player) down to `edge` (~fog/explored level) at the
// vision edge, so a visible tile never reads DARKER than remembered terrain.
// Tinted per biome so each level's darkness has its own mood.
export interface BiomeAmbient {
  center: [number, number, number];
  edge: [number, number, number];
}
const BIOME_AMBIENT: Record<Biome, BiomeAmbient> = {
  dungeon: { center: [100, 98, 116], edge: [88, 86, 100] },
  forest: { center: [80, 106, 88], edge: [72, 92, 80] },
  marsh: { center: [84, 102, 86], edge: [76, 92, 80] },
  mountain: { center: [92, 104, 126], edge: [82, 94, 114] },
  crypt: { center: [96, 104, 96], edge: [86, 94, 88] },
  castle: { center: [102, 92, 122], edge: [90, 82, 108] },
  throne: { center: [114, 98, 94], edge: [100, 88, 84] },
};
export function ambientForBiome(biome: Biome): BiomeAmbient {
  return BIOME_AMBIENT[biome] ?? BIOME_AMBIENT.dungeon;
}
// Flat floor keeping monsters/items readable in the dark (not biome-tinted).
export const AMBIENT_ENTITY: [number, number, number] = [132, 128, 148];

// ── emitted light colors (0–255 per channel) ────────────────────────────────
const TORCH_LIT: [number, number, number] = [235, 198, 150]; // torch burning
const TORCH_EMBER: [number, number, number] = [165, 135, 100]; // bare light, no torch
const FIRE_LIGHT: [number, number, number] = [255, 140, 50];
const SUNBLADE_LIGHT: [number, number, number] = [255, 225, 120];
const ALTAR_LIGHT: [number, number, number] = [150, 95, 225];
const BOSS_LIGHT: [number, number, number] = [95, 40, 130]; // cold necrotic aura
const BARRAGE_LIGHT: [number, number, number] = [215, 45, 30]; // dark-fire telegraph

const LOW_FUEL = 20; // torch starts guttering at/under this (matches HUD warning)
const REFLECTIVITY = 0.12; // how much surfaces bounce light (0–1)
const PASSES = 2; // reflection bounces (1 = direct only)

export type LightMap = Map<number, [number, number, number]>;
/** A transient light the renderer injects from active cosmetic FX (bolts,
 * explosions, hit sparks) — already color/intensity-scaled for this frame. */
export interface ExtraLight {
  x: number;
  y: number;
  color: [number, number, number];
}

const scale = (
  c: [number, number, number],
  k: number,
): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];

/** Compute per-tile colored light for the current state. `now` (ms) drives the
 * torch/fire/barrage flicker; `reduceMotion` holds them steady; `extra` are
 * transient FX lights for this frame. Cells absent from the map receive no
 * source light (the renderer falls back to ambient). */
export function computeLightMap(
  state: GameState,
  now = 0,
  reduceMotion = false,
  extra: ExtraLight[] = [],
): LightMap {
  const map = state.map;
  const w = map.width;
  const p = state.player;
  const range = Math.max(3, Math.round(p.lightRadius));

  const fov = new ROT.FOV.PreciseShadowcasting(
    (x, y) => isTransparent(map, x, y),
    { topology: 8 }
  );
  const reflectivity = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < map.width && y < map.height ? REFLECTIVITY : 0;

  const lighting = new ROT.Lighting(reflectivity, { range, passes: PASSES });
  lighting.setFOV(fov);

  // ── player light ────────────────────────────────────────────────────────────
  // A LIT torch/lantern flickers and reaches far (the extended range comes from
  // lightRadius); with none, it's a faint, STEADY ember — just your eyes, a
  // small unwavering pool. As a torch's fuel runs low the flame dims,
  // warm-shifts (loses green/blue), and its flicker deepens — a guttering torch.
  const lit = p.hasTorch && p.torchFuel > 0;
  const health = lit && p.torchFuel <= LOW_FUEL ? p.torchFuel / LOW_FUEL : 1;
  const amp = reduceMotion ? 0 : 0.2 + (1 - health) * 0.45; // flicker depth
  const s = 0.5 + 0.5 * Math.sin(now * 0.017) * Math.sin(now * 0.041);
  const torchFlicker = lit ? 1 - amp * (1 - s) : 1; // no flicker without a flame
  let torchColor: [number, number, number] = lit
    ? [TORCH_LIT[0], TORCH_LIT[1], TORCH_LIT[2]]
    : [TORCH_EMBER[0], TORCH_EMBER[1], TORCH_EMBER[2]];
  if (lit && health < 1) {
    const dimK = 0.5 + 0.5 * health; // dims toward 50% as it dies
    torchColor = [
      torchColor[0] * dimK,
      torchColor[1] * dimK * (0.72 + 0.28 * health), // cut green (→ warmer)
      torchColor[2] * dimK * (0.55 + 0.45 * health), // cut blue more
    ];
  }
  lighting.setLight(p.x, p.y, scale(torchColor, torchFlicker));

  // ── lingering fire — each tile flickers on its own phase ─────────────────────
  for (const f of state.fireTiles) {
    const ff = reduceMotion ? 1 : 0.68 + 0.32 * Math.abs(Math.sin(now * 0.02 + f.i));
    lighting.setLight(f.i % w, Math.floor(f.i / w), scale(FIRE_LIGHT, ff));
  }

  // ── the Sunblade on the ground gives off a warm gold light ──────────────────
  for (const it of state.items) {
    if (ITEMS[it.defId]?.questTag === "sunblade") {
      lighting.setLight(it.x, it.y, SUNBLADE_LIGHT);
    }
  }

  // ── unspent altars glow cold violet ─────────────────────────────────────────
  for (const a of state.altars) {
    if (!a.used) lighting.setLight(a.x, a.y, ALTAR_LIGHT);
  }

  // ── boss aura — a cold necrotic glow that precedes it into a room ────────────
  for (const m of state.monsters) {
    if (MONSTERS[m.defId]?.isBoss) lighting.setLight(m.x, m.y, BOSS_LIGHT);
  }

  // ── lich dark-fire barrage — pulsing red underlight on the telegraphed tiles ─
  if (state.barrage.length) {
    const pulse = reduceMotion ? 0.8 : 0.55 + 0.45 * Math.abs(Math.sin(now * 0.012));
    for (const bi of state.barrage) {
      lighting.setLight(bi % w, Math.floor(bi / w), scale(BARRAGE_LIGHT, pulse));
    }
  }

  // ── transient FX lights (bolts, explosions, hit sparks) ─────────────────────
  for (const e of extra) {
    lighting.setLight(e.x, e.y, e.color);
  }

  const out: LightMap = new Map();
  lighting.compute((x, y, color) => {
    if (x >= 0 && y >= 0 && x < map.width && y < map.height) {
      out.set(idx(x, y, w), [color[0], color[1], color[2]]);
    }
  });
  return out;
}
