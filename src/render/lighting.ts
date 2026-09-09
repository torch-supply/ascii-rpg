import type { Biome } from "@/game/core/types";

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
  // a dim, neutral rock cave — readable natural walls; the teal comes from the
  // fungi's own (local) light, not the ambient
  cavern: { center: [86, 84, 82], edge: [72, 70, 68] },
  // scorched dead ground — a dim, warm ashen gloom (a faint ember undertone)
  ashen: { center: [106, 88, 76], edge: [88, 72, 62] },
  // fungal grove — a dim violet rot, kept low so the glowcaps' own teal blazes
  grove: { center: [88, 74, 98], edge: [72, 60, 82] },
  // flooded undercity — cold, damp green-grey stone; light drowns down here
  undercity: { center: [76, 94, 88], edge: [62, 78, 74] },
  // overcast daylight on wet stone — cool, flat, no warmth in it
  graveyard: { center: [96, 102, 112], edge: [72, 78, 88] },
  // daylight through a broken roof onto standing water — green, and colder
  // than the marsh outside because the stone holds no heat
  sanctum: { center: [88, 104, 100], edge: [64, 78, 76] },
};
export function ambientForBiome(biome: Biome): BiomeAmbient {
  return BIOME_AMBIENT[biome] ?? BIOME_AMBIENT.dungeon;
}

/**
 * Every biome, at runtime — DERIVED, so it can't fall out of step with the
 * `Biome` union. `BIOME_AMBIENT` is a complete `Record<Biome, …>`, so TypeScript
 * already forces an entry for any biome you add; reading its keys means a new
 * biome shows up here (and anywhere consuming this, like `/style`) for free.
 * The alternative — a hand-written list — silently omits whatever you forget.
 */
export const BIOMES = Object.keys(BIOME_AMBIENT) as Biome[];

/**
 * The dawn/dusk set-piece ambient shift (pure — no DOM, so it's unit-testable).
 * `g` is the eased 0→1 intensity (boss-HP or approach-distance × a pulse):
 *  • `"dawn"` warms + brightens every channel toward a rekindled sunrise;
 *  • `"dusk"` dims all channels but holds the blue, so it darkens AND cools.
 * `g = 0` returns the ambient unchanged. Applied per region in `renderBase`.
 */
export function beatAmbient(
  beat: "dawn" | "dusk",
  g: number,
  amb: BiomeAmbient,
): BiomeAmbient {
  const shift =
    beat === "dawn"
      ? (c: [number, number, number]): [number, number, number] => [
          Math.min(255, c[0] + 122 * g), // warm gold + brighten toward
          Math.min(255, c[1] + 96 * g), // full daylight as the sun returns
          Math.min(255, c[2] + 44 * g),
        ]
      : (c: [number, number, number]): [number, number, number] => {
          const k = 1 - 0.5 * g; // dim toward 50% as you near the gate
          return [c[0] * k, c[1] * k, Math.min(255, c[2] * k * 1.15)]; // hold blue → colder
        };
  return { center: shift(amb.center), edge: shift(amb.edge) };
}
// Flat floor keeping monsters/items readable in the dark (not biome-tinted).
export const AMBIENT_ENTITY: [number, number, number] = [132, 128, 148];

// ── emitted light colors (0–255 per channel) ────────────────────────────────
// The light COMPUTATION itself lives in `@/game/core/light` — it decides
// `state.visible`, so it is core, not render. Re-exported here so the renderer's
// call sites read as one lighting module; what stays on this side is the part
// that is purely look: the per-biome AMBIENT tint, which colours a visible tile
// but never illuminates one.
export type { LightMap, ExtraLight } from "@/game/core/light";
export { computeLightMap } from "@/game/core/light";
