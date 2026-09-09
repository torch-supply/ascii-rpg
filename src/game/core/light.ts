import { CONFIG } from "@/content/config";
import { ITEMS } from "@/content/items";
import { LEVELS } from "@/content/levels";
import { MONSTERS } from "@/content/monsters";
import { idx, isTransparent } from "@/game/core/grid";
import { computeVisible } from "@/game/core/map/fov";
import type { Biome, GameMap, GameState } from "@/game/core/types";
import * as ROT from "rot-js";

/**
 * LIGHT — the model the game actually sees by, and therefore CORE, not render.
 *
 * Sight is line-of-sight out to `CONFIG.sightRange`, and a tile you have LOS to
 * is visible when SOMETHING lights it above `CONFIG.sightLightMin` — your torch,
 * a wall sconce, a fire, a glowcap bed, an altar. Under an open sky you also get
 * `SKYLIGHT` for free; in the pitch dark you are down to `CONFIG.unlitSight`.
 *
 * This lived in `src/render/` as a look-and-feel probe, with the renderer
 * keeping a private visible-set and a private `explored` memory while
 * `state.visible` stayed on the old torch-radius model. That split was not
 * sustainable: the two disagreed everywhere it mattered. You could see a lit
 * room and not be allowed to SHOOT into it (`shootAt` gates on `state.visible`);
 * a boss in plain sight got no HP bar and no musical sting; a monster you were
 * watching died of poison with no message; and because the renderer's memory was
 * neither saved nor reset per-attempt, resuming a save showed an unexplored map
 * while a death-restart showed one already explored.
 *
 * Now `recomputeFOV` calls `lightGatedVisible` and `state.visible` IS this set,
 * so the core, HUD, audio, save and tests all agree by construction.
 *
 * FLICKER IS NOT VISIBILITY. `computeLightMap` takes `now`/`reduceMotion` and is
 * shared with the renderer, but the core always calls it STEADY (`now = 0`,
 * `reduceMotion = true`, no FX). A torch guttering at 60fps must not make tiles
 * wink in and out of `state.visible` in a turn-based game — the renderer layers
 * flicker and transient FX on top for COLOUR only.
 */

/**
 * Skylight. How far you can see UNAIDED, by biome.
 *
 * Under an open sky you should see a fair way with no torch at all, and a torch
 * should barely widen it (it competes with daylight). Underground and indoors
 * the opposite: without a flame you're down to arm's length. The model had none
 * of this — `CONFIG.unlitSight` was global, so the Blackwood at night behaved
 * exactly like a sealed crypt (measured: 33 tiles unlit, and a lantern ADDED 58).
 *
 * Note the renderer's biome ambient is NOT this: it's a flat colour tint at luma
 * 96-103 for every biome, indoor and out. It tints; it doesn't illuminate.
 */
export const SKYLIGHT: Partial<Record<Biome, number>> = {
  // scorched open ground — the Iron Gate's wastes, and the Great Hall's
  // collapsed nave where the roof fell in. Ash-choked, so dimmer than clear sky.
  ashen: 7,
  forest: 9, // dappled, but it's still daylight
  marsh: 10, // open water and low reeds — the most exposed
  mountain: 11, // snow throws light back at you
  // Blackhall's burial ground is OUTDOORS — the level's own ambient calls it
  // "overcast daylight on wet stone". Its absence here was a real bug rather
  // than a tuning choice: the Iron Gate's base region gave you the pitch-dark
  // floor of 3 while the burned wastes beside it gave 7, so walking off the
  // graves onto open ground made you see FURTHER.
  graveyard: 9,
  // the drowned temple is a RUIN — its ambient is literally "daylight through a
  // broken roof onto standing water". Lower than open sky: most of the nave is
  // still roofed, and the light that gets in is green off the water.
  sanctum: 6,
};

export const SCONCE_BIOMES = new Set<Biome>([
  "dungeon",
  "castle",
  "crypt",
  "throne",
]);

const TORCH_LIT: [number, number, number] = [235, 198, 150]; // torch burning
const TORCH_EMBER: [number, number, number] = [165, 135, 100]; // bare light, no torch
const FIRE_LIGHT: [number, number, number] = [255, 140, 50];
const SUNBLADE_LIGHT: [number, number, number] = [255, 225, 120];
const ALTAR_LIGHT: [number, number, number] = [150, 95, 225];
// Cold necrotic aura. Brightened from [95, 40, 130], whose luma was 58 against a
// `sightLightMin` of 55 — it cleared the visibility bar by THREE, on the boss's
// own tile and nowhere else. So the boss revealed itself from anywhere in line of
// sight while lighting exactly zero tiles around it: the worst of both readings,
// and the exact opposite of "a glow that precedes it into a room".
//
// Violet is inherently dim by luma (blue is weighted 0.0722), which is how it got
// this dark without anyone noticing. At luma 145 the aura now reaches 3 tiles —
// brighter than an altar, as a boss should be — so the dread arrives before the
// shape does, and the boss being visible at range is earned rather than accidental.
const BOSS_LIGHT: [number, number, number] = [160, 130, 255];
const BARRAGE_LIGHT: [number, number, number] = [215, 45, 30]; // dark-fire telegraph
const GLOWCAP_LIGHT: [number, number, number] = [58, 168, 146]; // bioluminescent teal (soft)
const SCONCE_LIGHT: [number, number, number] = [225, 168, 96]; // a tended wall flame

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

  const fov = new ROT.FOV.PreciseShadowcasting(
    (x, y) => isTransparent(map, x, y),
    { topology: 8 },
  );
  const reflectivity = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < map.width && y < map.height ? REFLECTIVITY : 0;

  // TWO light fields, summed. `ROT.Lighting` exposes a single `range`, and its
  // falloff is `1 - r/range` measured FROM THE SOURCE — so one shared range let
  // the player's torch dictate the size AND brightness of every other light on
  // the map. Dousing your torch dimmed the braziers. Splitting them costs a
  // second pass (~0.3ms) and is what makes distant light behave like light.
  const world = new ROT.Lighting(reflectivity, {
    range: CONFIG.worldLightRange,
    passes: PASSES,
  });
  world.setFOV(fov);
  const carried = new ROT.Lighting(reflectivity, {
    range: Math.max(3, Math.round(p.lightRadius)),
    passes: PASSES,
  });
  carried.setFOV(fov);

  // ── player light ────────────────────────────────────────────────────────────
  // A LIT torch/lantern flickers and reaches far (the extended range comes from
  // lightRadius); with none, it's a faint, STEADY ember — just your eyes, a
  // small unwavering pool. As a torch's fuel runs low the flame dims,
  // warm-shifts (loses green/blue), and its flicker deepens — a guttering torch.
  const lit = p.hasTorch && p.torchFuel > 0;
  const health = lit && p.torchFuel <= LOW_FUEL ? p.torchFuel / LOW_FUEL : 1;
  const amp = reduceMotion ? 0 : torchFlickerDepth(state); // shared with the renderer
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
  // The torchless ember stays, and it matters under light-gated sight: without
  // it the eye-adjust disc is VISIBLE but UNLIT, so a monster standing right
  // next to you renders as a grey ghost and only flashes into colour when a
  // hit-spark lights it. That looked like a rendering bug, and was.
  //
  // It was briefly removed on the measurement that the ember alone lit 68 tiles
  // — true at the time, when the visibility threshold was 30. At 100 the same
  // ember reaches only ~9 tiles, out to 1.4 distance: it lights what your eyes
  // give you and nothing further. Two fixes for one problem; raising the
  // threshold was the right one and made this removal redundant.
  carried.setLight(p.x, p.y, scale(torchColor, torchFlicker));

  // ── lingering fire — each tile flickers on its own phase ─────────────────────
  for (const f of state.fireTiles) {
    const ff = reduceMotion
      ? 1
      : 0.68 + 0.32 * Math.abs(Math.sin(now * 0.02 + f.i));
    world.setLight(f.i % w, Math.floor(f.i / w), scale(FIRE_LIGHT, ff));
  }

  // ── bioluminescent fungi — glowing teal light, each on its own gentle pulse ──
  const tiles = map.tiles;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== "glowcap") continue;
    const gp = reduceMotion
      ? 1
      : 0.72 + 0.28 * Math.abs(Math.sin(now * 0.006 + i));
    world.setLight(i % w, Math.floor(i / w), scale(GLOWCAP_LIGHT, gp));
  }

  // ── wall sconces ────────────────────────────────────────────────────────────
  // Emitted from the floor tile the bracket FACES, not from the wall it hangs
  // on. A wall is opaque, so `ROT.Lighting`'s shadowcasting from a source inside
  // one is blocked at its own cell: measured, a light on a wall lit **0** tiles
  // while the same light one step onto the floor lit **38**. The first version
  // put it on the wall, so every sconce was a glyph that illuminated nothing —
  // and the gains attributed to sconces were really coming from glowcaps and
  // altars. Physically it is also just right: the flame throws its light into
  // the room, not into the masonry behind it.
  for (const si of map.sconces ?? []) {
    const sf = reduceMotion
      ? 1
      : 0.82 + 0.18 * Math.abs(Math.sin(now * 0.011 + si));
    const face = [si + 1, si - 1, si + w, si - w].find((j) =>
      isTransparent(map, j % w, Math.floor(j / w)),
    );
    if (face === undefined) continue;
    world.setLight(face % w, Math.floor(face / w), scale(SCONCE_LIGHT, sf));
  }

  // ── the Sunblade on the ground gives off a warm gold light ──────────────────
  for (const it of state.items) {
    if (ITEMS[it.defId]?.questTag === "sunblade") {
      world.setLight(it.x, it.y, SUNBLADE_LIGHT);
    }
  }

  // ── unspent altars glow cold violet ─────────────────────────────────────────
  for (const a of state.altars) {
    if (!a.used) world.setLight(a.x, a.y, ALTAR_LIGHT);
  }

  // ── boss aura — a cold necrotic glow that precedes it into a room ────────────
  for (const m of state.monsters) {
    if (MONSTERS[m.defId]?.isBoss) world.setLight(m.x, m.y, BOSS_LIGHT);
  }

  // ── glowing creatures (a drifting wisp) — a small pulsing light source ───────
  for (const m of state.monsters) {
    const glow = MONSTERS[m.defId]?.glow;
    if (!glow) continue;
    const wp = reduceMotion
      ? 0.85
      : 0.6 + 0.4 * Math.abs(Math.sin(now * 0.009 + m.x * 1.7 + m.y));
    world.setLight(m.x, m.y, scale(glow, wp));
  }

  // ── lich dark-fire barrage — pulsing red underlight on the telegraphed tiles ─
  if (state.barrage.length) {
    const pulse = reduceMotion
      ? 0.8
      : 0.55 + 0.45 * Math.abs(Math.sin(now * 0.012));
    for (const bi of state.barrage) {
      world.setLight(bi % w, Math.floor(bi / w), scale(BARRAGE_LIGHT, pulse));
    }
  }

  // ── transient FX lights (bolts, explosions, hit sparks) ─────────────────────
  for (const e of extra) {
    world.setLight(e.x, e.y, e.color);
  }

  // Sum the fields. Two sources overlapping already add inside `ROT.Lighting`
  // (`result[i] += color[i] * formFactor`), so adding across the two fields is
  // the same arithmetic — it just lets each keep its own falloff radius.
  const out: LightMap = new Map();
  const accumulate = (lighting: InstanceType<typeof ROT.Lighting>) => {
    lighting.compute((x, y, color) => {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
      const i = idx(x, y, w);
      const prev = out.get(i);
      if (prev) {
        prev[0] += color[0];
        prev[1] += color[1];
        prev[2] += color[2];
      } else {
        out.set(i, [color[0], color[1], color[2]]);
      }
    });
  };
  accumulate(world);
  accumulate(carried);
  return out;
}

/**
 * The biome of a single TILE, not of the level.
 *
 * Sub-biome regions already drive glyphs, palette and ambient per tile; light
 * has to follow, or a level that mixes outside and inside can't work. Standing
 * in the graveyard you have a sky over you; two steps into the gatehouse you do
 * not, and that transition IS the level.
 */
export function biomeAtTile(map: GameMap, i: number, base: Biome): Biome {
  const r = map.region?.[i] ?? 0;
  return map.regionBiome?.[r] ?? base;
}

/** How far you see with no light of your own — arm's length indoors, most of a
 * clearing under an open sky. Resolved where the PLAYER stands, so walking
 * through a gate takes the sky away from you. */
export function unaidedSight(state: GameState): number {
  return Math.max(CONFIG.unlitSight, skylightAtPlayer(state));
}

/** The sky over the tile the player is standing on (0 = a roof). */
function skylightAtPlayer(state: GameState): number {
  const level = LEVELS[state.currentLevel];
  const base = level?.biome ?? "dungeon";
  const i = idx(state.player.x, state.player.y, state.map.width);
  const here = biomeAtTile(state.map, i, base);
  const raw = SKYLIGHT[here] ?? 0;
  // A level may override the sky its biome implies (`LevelConfig.skylight`):
  // it REPLACES the base biome's value and CAPS every sub-region, because a
  // level has one sky. See the field's doc — the Ramparts is why it exists.
  if (level?.skylight === undefined) return raw;
  return here === base ? level.skylight : Math.min(raw, level.skylight);
}

/**
 * How hard the carried flame flickers. 0 = rock steady.
 *
 * Only a LIT torch or lantern flickers. The torchless ember is your own eyes
 * adjusting to the dark, and it has to be perfectly still — if it wavers, the
 * darkness itself appears to pulse, which reads as a rendering fault rather
 * than as a flame. A guttering torch (low fuel) flickers harder.
 *
 * Damped by SKYLIGHT so it fades to nothing outdoors. A flame competes with
 * daylight: under an open sky your torch is a minor contributor, and animating
 * it there makes the whole field seem to breathe instead of one small fire.
 * Indoors it is the only light you have and carries the full depth.
 */
export const TORCH_FLICKER_AMP = 0.2; // depth at full fuel, fully indoors
const TORCH_GUTTER_AMP = 0.45; // extra depth as the last of the fuel burns
const SKY_FULL = 11; // the brightest SKYLIGHT — at or above it, no flicker at all

export function torchFlickerDepth(state: GameState): number {
  const p = state.player;
  if (!p.hasTorch || p.torchFuel <= 0) return 0;
  const health = p.torchFuel <= LOW_FUEL ? p.torchFuel / LOW_FUEL : 1;
  // A glassed flame wavers less than a bare one, and the multiplier scales the
  // WHOLE curve rather than just the base: a lantern down to its last oil still
  // falters, but never as wildly as a torch burning out.
  const steadiness = (p.torchId ? ITEMS[p.torchId]?.flicker : undefined) ?? 1;
  const amp =
    (TORCH_FLICKER_AMP + (1 - health) * TORCH_GUTTER_AMP) * steadiness;
  const sky = skylightAtPlayer(state);
  return amp * Math.max(0, 1 - sky / SKY_FULL);
}

/**
 * The light-gated visible set: what your eyes give you unaided, plus every tile
 * in line of sight that something lights brightly enough to read.
 *
 * The unaided disc is NOT the old `lightRadius` FOV — that was already a room's
 * worth and is what made darkness harmless. Your torch gets no special case: it
 * is a light source in the map like any other, so its pool comes back through
 * the lit test below rather than being added as a radius.
 *
 * `sightLightMin` is the dial that decides how far you read a light, far more
 * than `sightRange` does — most lights are near, so shortening the range barely
 * bites. At 30 a broad field of barely-lit tiles read as "I can see everything
 * faintly" instead of as pools with dark between them.
 */
export function lightGatedVisible(
  state: GameState,
  lightMap: LightMap,
): number[] {
  const out = new Set(
    computeVisible(
      state.map,
      state.player.x,
      state.player.y,
      unaidedSight(state),
    ),
  );
  const los = computeVisible(
    state.map,
    state.player.x,
    state.player.y,
    CONFIG.sightRange,
  );
  for (const i of los) {
    if (out.has(i)) continue;
    const c = lightMap.get(i);
    if (!c) continue;
    const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    if (luma >= CONFIG.sightLightMin) out.add(i);
  }
  return [...out];
}
