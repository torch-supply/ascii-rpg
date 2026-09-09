"use client";

// ─────────────────────────────────────────────────────────────────────────
// DEV-ONLY visual reference. Every tile in every biome, every monster, item,
// status tint and atmosphere — on one screen.
//
// Why this exists: the visual bugs that actually shipped (a spore haze that
// vanished into the foliage, a chasm that read as off-map black) were caught by
// EYE, late, after playing to the level that showed them. Test [54] puts a
// numeric floor under the worst cases, but color judgement can't be automated
// — so make the eyeball pass instant and systematic instead of a playthrough.
// Contrast numbers are shown inline so a weak pairing is obvious, not guessed.
// ─────────────────────────────────────────────────────────────────────────
import type { TileType } from "@/game/core/types";
import { LEVELS } from "@/content/levels";
import { ELITE, MONSTERS } from "@/content/monsters";
import { CLASS_LIST } from "@/content/classes";
import { ITEMS } from "@/content/items";
import { STATUS } from "@/game/core/status";
import { classifyLog } from "@/components/hud/logStyle";
import { BG, MARK } from "@/components/hud/palette";
import { ambientForBiome, BIOMES } from "@/render/lighting";
import { SKYLIGHT } from "@/game/core/light";
import {
  BIOME_ATMOSPHERE,
  WEATHER_ATMOSPHERE,
  CHASM_BG,
  colorDistance,
  contrastRatio,
  luminance,
  rgbOf,
  dim,
  FOG_DIM,
  GAS_COLOR,
  DECAL_STYLE,
  SPORE_VENT_COLOR,
  ATMO_EMISSIVE,
  SPORE_VENT_PRIMING_GLYPH,
  SPORE_VENT_PRIMING_COLOR,
  SCONCE_LIT,
  SCONCE_COLD,
  PLAYER_COLOR,
  terrainColor,
  terrainGlyph,
  TERRAIN_GLYPH,
} from "@/render/tiles";

const INK = "#0d0d0d";
// DERIVED from the renderer's own decal table, so it can't disagree with what the
// game paints (it used to be a hand-copied literal).
const DECALS = Object.entries(DECAL_STYLE);

/** The darkest floor in the game, including sub-biome palettes — the worst case for a
 * decal's legibility, and the backdrop the decal swatches use. Derived rather than
 * hard-coded: the ashen wastes are darkest today, but that shouldn't be baked in. */
const DARKEST_FLOOR = [
  ...LEVELS.map((l) => l.palette.floor),
  ...LEVELS.flatMap((l) => (l.subBiomes ?? []).map((sb) => sb.palette?.floor)),
]
  .filter((c): c is string => !!c)
  .reduce((a, b) => (luminance(b) < luminance(a) ? b : a));

/** One line per log kind, taken from the real message templates with their
 * interpolations filled in — the same corpus test [64] asserts against. Keeping
 * them here rather than inventing prose is the point: the classifier is a
 * heuristic OVER THIS TEXT, so a sample that isn't real proves nothing. */
const LOG_SAMPLES = [
  "You strike the Skeleton for 8 (4 left).",
  "You slay the Skeleton.",
  "The Skeleton hits you for 2.",
  "A hidden spike trap! You take 4 damage.",
  "You drink the Healing Potion. (+10 hp)",
  "You pick up 6 gold.",
  "You take up the War Axe, setting down the Frostbrand.",
];

/** `#rrggbb` + alpha → rgba(), so a swatch can show a decal at its REAL opacity. */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
const TILES = Object.keys(TERRAIN_GLYPH) as TileType[];

/** A contrast reading, colored by how comfortable it is. */
function Dist({ a, b }: { a: string; b: string }) {
  const d = colorDistance(a, b);
  const tone = d < 110 ? "#ff6a6a" : d < 200 ? "#e0b050" : "#5aa86a";
  return (
    <span style={{ color: tone, fontSize: 12 }} title="perceptual distance">
      {d.toFixed(0)}
    </span>
  );
}

function Swatch({ hex, label }: { hex: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 14,
          height: 14,
          background: hex,
          border: "1px solid #333",
          display: "inline-block",
        }}
      />
      <span style={{ fontSize: 13, color: "#9aa" }}>
        {label} <span style={{ color: "#556" }}>{hex}</span>
      </span>
    </div>
  );
}

export default function StyleGallery() {
  return (
    // globals.css sets `body { overflow: hidden }` so the game can fill the
    // window — so this page owns its own scroll container rather than relying
    // on page scroll (which is disabled app-wide).
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflowY: "auto",
        background: INK,
        color: "#ddd",
        padding: 28,
        fontFamily: "ui-monospace, monospace",
        fontSize: 14,
        // `layout.tsx` puts Tailwind's `select-none` on <body> so dragging during
        // play never highlights the HUD. This page is a REFERENCE, though — you want
        // to copy a hex value or a glyph out of it — so opt selection back in here.
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
    >
      <h1 style={{ fontSize: 26, letterSpacing: "0.2em", color: "#ffb347" }}>
        EMBER OF DAWN — STYLE GALLERY
      </h1>
      <p style={{ fontSize: 14, color: "#889", maxWidth: 860 }}>
        Dev-only visual reference. Numbers are perceptual contrast against the
        surrounding terrain —{" "}
        <span style={{ color: "#ff6a6a" }}>red &lt;110</span> (likely
        invisible), <span style={{ color: "#e0b050" }}>amber &lt;200</span>{" "}
        (thin), <span style={{ color: "#5aa86a" }}>green</span> (comfortable).
        Test [54] enforces the floors; this is for the judgement calls it can’t
        make.
      </p>

      {/* ── tiles × biomes ───────────────────────────────────────────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 30 }}>
        Tiles × biomes (glyph as rendered, with contrast vs. that biome’s floor)
      </h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th
                style={{ textAlign: "left", padding: "4px 8px", color: "#778" }}
              >
                tile
              </th>
              {BIOMES.map((b) => (
                <th
                  key={b}
                  style={{
                    padding: "4px 10px",
                    color: "#778",
                    fontWeight: 400,
                  }}
                >
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TILES.map((t) => (
              <tr key={t} style={{ borderTop: "1px solid #1c1c22" }}>
                <td style={{ padding: "4px 8px", color: "#9aa" }}>{t}</td>
                {BIOMES.map((b) => {
                  // a representative palette for this biome (first level using it)
                  const lvl =
                    LEVELS.find((l) => l.biome === b) ??
                    LEVELS.find((l) =>
                      l.subBiomes?.some((s) => s.biome === b),
                    ) ??
                    LEVELS[0];
                  const pal =
                    LEVELS.flatMap((l) => l.subBiomes ?? []).find(
                      (s) => s.biome === b,
                    )?.palette ?? lvl.palette;
                  const fg = terrainColor(t, pal, b);
                  const bg = t === "chasm" ? CHASM_BG : INK;
                  return (
                    <td
                      key={b}
                      style={{ padding: "4px 10px", textAlign: "center" }}
                    >
                      <div
                        style={{
                          background: bg,
                          padding: "2px 6px",
                          fontSize: 26,
                          color: fg,
                          lineHeight: 1.1,
                        }}
                      >
                        {terrainGlyph(t, b)}
                      </div>
                      <Dist a={fg} b={pal.floor} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── POIs & overlays: everything drawn ON TOP of the tile grid ─── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        POIs &amp; overlays — drawn over the tiles, not part of them
      </h2>
      <p style={{ fontSize: 13, color: "#778", maxWidth: 860 }}>
        Altars, lore props, the player and the transient effects aren’t{" "}
        <code>TileType</code>s — the renderer paints them on top, so they never
        appear in the tile grid above. Several carry a <em>spent</em> state that
        must still read as “there, but done”. Contrast is vs. dungeon floor.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {
          // HAND-MAINTAINED — these are drawn OVER the cell grid by CanvasRenderer
          // (search `state.altars`, `state.lore`, `state.fireTiles`, `state.gasTiles`,
          // `state.barrage`), so they aren't `TileType`s and there's no table to
          // enumerate. Every colour below was checked against those draw calls; if you
          // retint a POI, change it here too. The 4th slot is the BACKGROUND the glyph
          // really sits on, which matters for the contrast reading: the barrage is
          // painted over a dark-red cell, not over floor.
          (
            [
              ["@", PLAYER_COLOR, "you"],
              ["‡", "#d6a4ff", "altar — unspent"],
              ["‡", "#6a6a6a", "altar — spent"],
              ["¶", "#cbb488", "lore — inscription"],
              ["¶", "#b0a890", "lore — remains"],
              ["¶", "#6a6a66", "lore — already read"],
              ["▴", "#ff9d3c", "fire — burning"],
              ["▵", "#ff5a3c", "fire — guttering out"],
              // fire and gas each ALTERNATE two glyphs frame to frame (the flicker /
              // drift), so both shapes have to read — not just the one you'd screenshot
              ["∴", GAS_COLOR, "poison haze"],
              ["°", GAS_COLOR, "poison haze — alt frame"],
              ["✷", "#ff6a4a", "lich barrage telegraph", "#7a1512"],
              // a spore vent's WARNING state: one turn before it seeps it swells and
              // brightens. Shown here beside the idle vent because the whole point is
              // that the two are tellable apart at a glance mid-play.
              [TERRAIN_GLYPH.sporeVent, SPORE_VENT_COLOR, "spore vent — idle"],
              [
                SPORE_VENT_PRIMING_GLYPH,
                SPORE_VENT_PRIMING_COLOR,
                "spore vent — about to blow",
              ],
              // A lit wall bracket, and the cold iron you REMEMBER seeing once the
              // tile leaves view. Missing here entirely until now, which is how it
              // kept a glyph two exclamation marks wide while twelve potions use
              // one: nothing in the gallery ever put the two side by side.
              ["Ω", SCONCE_LIT, "wall sconce — lit"],
              ["Ω", SCONCE_COLD, "wall sconce — remembered (cold iron)"],
            ] as const
          ).map(([glyph, color, label, bg], i) => (
            <div
              key={i}
              style={{
                border: "1px solid #1c1c22",
                padding: "8px 12px",
                textAlign: "center",
                minWidth: 116,
                background: bg ?? LEVELS[0].palette.floor,
              }}
            >
              <div style={{ fontSize: 28, color, lineHeight: 1.2 }}>
                {glyph}
              </div>
              <div style={{ fontSize: 12, color: "#9aa" }}>{label}</div>
              <Dist a={color} b={bg ?? LEVELS[0].palette.floor} />
            </div>
          ))
        }
      </div>

      {/* ── fog dimming: does a color survive being REMEMBERED? ───────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        Lit vs. remembered (fog ×{FOG_DIM}) — a second legibility axis
      </h2>
      <p style={{ fontSize: 13, color: "#778", maxWidth: 860 }}>
        Explored-but-not-visible tiles are drawn at {FOG_DIM}× brightness. A
        color that reads fine when lit can collapse into the background from
        memory — this row is the same glyph lit (left) and fogged (right), with
        the fogged contrast against the page black.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {TILES.filter((t) => t !== "chasm").map((t) => {
          const pal = LEVELS[0].palette;
          const lit = terrainColor(t, pal, "dungeon");
          const fogged = dim(lit, FOG_DIM);
          return (
            <div
              key={t}
              style={{
                border: "1px solid #1c1c22",
                padding: "6px 10px",
                textAlign: "center",
                minWidth: 84,
              }}
            >
              <div style={{ fontSize: 11, color: "#667" }}>{t}</div>
              <div style={{ fontSize: 26, lineHeight: 1.2 }}>
                <span style={{ color: lit }}>{terrainGlyph(t, "dungeon")}</span>{" "}
                <span style={{ color: fogged }}>
                  {terrainGlyph(t, "dungeon")}
                </span>
              </div>
              <Dist a={fogged} b={INK} />
            </div>
          );
        })}
      </div>

      {/* ── glyph collisions: same character, different meaning ───────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        Glyph collisions — where one character means two things
      </h2>
      <p style={{ fontSize: 13, color: "#778", maxWidth: 860 }}>
        Sharing a glyph across a whole item category is roguelike convention
        (every potion is <code>!</code>). Sharing one between a{" "}
        <em>hazard and a reward</em> is worth a second look — only color tells
        them apart.
      </p>
      <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        {(() => {
          type Use = { label: string; color: string };
          const uses = new Map<string, Use[]>();
          const add = (g: string, label: string, color: string) => {
            if (!g || g === " ") return;
            const cur = uses.get(g) ?? [];
            if (cur.some((u) => u.label === label)) return; // dedupe across biomes
            uses.set(g, [...cur, { label, color }]);
          };
          // Collisions that are DELIBERATE design, not defects — a hidden trap
          // is supposed to be indistinguishable from floor until you sense it.
          // Collisions that are CONVENTIONS, not bugs. Labelling them is what
          // lets a real one stand out instead of drowning in a list of expected
          // pairs — the report is only useful if its output is short.
          const intentional: Record<string, string> = {
            "·": "by design — hidden traps must look like floor",
            ",": "by design — hidden traps must look like floor",
            "#": "by design — a cracked wall must look like the wall it hides in",
            "♣": "by design — a cracked wall must look like the wall it hides in",
            "♠": "by design — a cracked wall must look like the wall it hides in",
            "▲": "by design — a cracked wall must look like the wall it hides in",
            "/": "by design — one glyph per item CLASS (weapons)",
            "[": "by design — one glyph per item CLASS (armor)",
            "!": "by design — one glyph per item CLASS (potions)",
            "(": "by design — one glyph per item CLASS (light sources)",
            "✷": "harmless — the class badge is HUD chrome, never drawn on the map",
          };
          // Use the RENDERED glyph, not the raw table: `terrainGlyph` overrides
          // several (a cracked wall draws as the biome's wall; forage uses
          // `forageStyle`), so reading TERRAIN_GLYPH directly invents
          // collisions that never appear on screen.
          for (const t of TILES)
            for (const b of BIOMES)
              add(
                terrainGlyph(t, b),
                `tile: ${t}`,
                terrainColor(t, LEVELS[0].palette, b),
              );
          add("‡", "altar / shrine", "#d6a4ff");
          add("¶", "lore prop", "#cbb488");
          add("@", "player", PLAYER_COLOR);
          for (const m of Object.values(MONSTERS))
            add(m.glyph, `monster: ${m.id}`, m.color);
          // ITEMS and OVERLAYS were never in this report's input, which is why it
          // read clean while `∴` meant both a healing arcane mote and a cloud of
          // poison (the mote is `❖` now), `‼` for a wall sconce was two of the `!`
          // twelve potions share (`Ω` now), and `*` was both a guttering fire and
          // the quest shards a collect level sends you to pick up (fire guessed
          // `▵` now, the hollow twin of its own burning frame). All three were
          // hazard/boon or scenery/loot pairs invisible here, because the report
          // only ever compared terrain against monsters.
          for (const it of Object.values(ITEMS))
            add(it.glyph, `item: ${it.id}`, it.color);
          for (const c of CLASS_LIST)
            if (c.glyph) add(c.glyph, `class badge: ${c.id}`, "#ffd24d");
          add("▴", "fire — burning", "#ff9d3c");
          add("▵", "fire — guttering", "#ff5a3c");
          add("∴", "poison haze", GAS_COLOR);
          add("✷", "lich barrage telegraph", "#ff6a4a");
          add("Ω", "wall sconce", SCONCE_LIT);
          add(
            SPORE_VENT_PRIMING_GLYPH,
            "spore vent priming",
            SPORE_VENT_PRIMING_COLOR,
          );
          return [...uses.entries()]
            .filter(([, u]) => u.length > 1)
            .map(([g, u]) => (
              <div
                key={g}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  border: "1px solid #1c1c22",
                  padding: "6px 10px",
                }}
              >
                <span style={{ fontSize: 26, color: "#889", minWidth: 28 }}>
                  {g}
                </span>
                <span style={{ fontSize: 13 }}>
                  {u.map((x, i) => (
                    <span key={i} style={{ marginRight: 14 }}>
                      <span style={{ color: x.color, fontSize: 20 }}>{g}</span>{" "}
                      <span style={{ color: "#889" }}>{x.label}</span>
                    </span>
                  ))}
                </span>
                <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                  {intentional[g] ? (
                    <span style={{ color: "#5aa86a", fontSize: 12 }}>
                      ✓ {intentional[g]}
                    </span>
                  ) : (
                    u.length === 2 && <Dist a={u[0].color} b={u[1].color} />
                  )}
                </span>
              </div>
            ));
        })()}
      </div>

      {/* ── biome palettes + ambient + atmosphere ────────────────────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        Biome palette · light ambient · atmosphere
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))",
          gap: 12,
        }}
      >
        {BIOMES.map((b) => {
          const amb = ambientForBiome(b);
          const atm = BIOME_ATMOSPHERE[b];
          const pal =
            LEVELS.find((l) => l.biome === b)?.palette ??
            LEVELS.flatMap((l) => l.subBiomes ?? []).find((s) => s.biome === b)
              ?.palette;
          const rgb = (c: [number, number, number]) =>
            `rgb(${c.map(Math.round).join(",")})`;
          return (
            <div
              key={b}
              style={{ border: "1px solid #1c1c22", padding: 12, fontSize: 13 }}
            >
              <div style={{ color: "#ffb347", marginBottom: 6 }}>{b}</div>
              {pal && (
                <>
                  <Swatch hex={pal.wall} label="wall" />
                  <Swatch hex={pal.floor} label="floor" />
                  <Swatch hex={pal.accent} label="accent" />
                  <div style={{ marginTop: 4, color: "#778" }}>
                    wall↔floor <Dist a={pal.wall} b={pal.floor} />
                  </div>
                </>
              )}
              <Swatch hex={rgb(amb.center)} label="ambient center" />
              <Swatch hex={rgb(amb.edge)} label="ambient edge" />
              <div style={{ marginTop: 4, color: "#667" }}>
                atmosphere:{" "}
                {atm
                  ? `${atm.kind} ×${atm.count} · ${
                      ATMO_EMISSIVE.has(atm.kind)
                        ? "emissive (keeps full strength in the dark)"
                        : "reflective (dims with the ground)"
                    }`
                  : "—"}
              </div>
              {/* How far you see here with NO light of your own — the biome's own
                  daylight. Absent = the pitch-dark floor (`CONFIG.unlitSight`),
                  which is only correct indoors: the Iron Gate's graveyard read as
                  a sealed cellar until it was given a value. */}
              <div style={{ marginTop: 2, color: "#667" }}>
                unaided sight:{" "}
                {SKYLIGHT[b] != null ? `${SKYLIGHT[b]} (open sky)` : "indoors"}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── monsters ─────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        Monsters (glyph · color · behaviour)
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))",
          gap: 8,
        }}
      >
        {Object.values(MONSTERS).map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid #1c1c22",
              padding: "4px 8px",
            }}
          >
            <span style={{ color: m.color, fontSize: 28 }}>{m.glyph}</span>
            <span style={{ fontSize: 13 }}>
              <div>{m.name}</div>
              <div style={{ color: "#667" }}>
                {m.behavior}
                {m.isBoss ? " · boss" : ""}
                {m.glow ? " · glows" : ""}
              </div>
            </span>
          </div>
        ))}
      </div>

      {/* ── items + status tints ─────────────────────────────────────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        Items · status tints
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {Object.values(ITEMS).map((it) => (
          <span
            key={it.id}
            title={it.id}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            {/* sized to match the monster rows above — item names were the
                smallest text on the page at 11px, which defeats the point of a
                legibility reference */}
            <span style={{ color: it.color, fontSize: 28 }}>{it.glyph}</span>
            <span style={{ color: "#9aa", fontSize: 13 }}>{it.name}</span>
          </span>
        ))}
      </div>
      {/* Same shape as the item rows above — this sits under the same heading, so a
          different glyph size read as an accident. Pairs `hudGlyph` with `hudColor`
          (the HUD chip as actually drawn); `tint` is the separate map-glyph colour
          shown in the entity-tint section. They happen to be identical for all four
          effects today, so this is about the code saying what it means. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          marginTop: 12,
        }}
      >
        {Object.values(STATUS).map((s) => (
          <span
            key={s.key}
            title={`hud ${s.hudColor} · map tint ${s.tint}`}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ color: s.hudColor, fontSize: 28 }}>
              {s.hudGlyph}
            </span>
            <span style={{ color: "#9aa", fontSize: 13 }}>{s.key}</span>
          </span>
        ))}
      </div>

      {/* ── class badges (HUD header + picker, never on the map) ──────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        Class badges (HUD only)
      </h2>
      <div style={{ display: "flex", gap: 18, fontSize: 16 }}>
        {CLASS_LIST.map((c) => (
          <span key={c.id} style={{ color: c.color }}>
            <span style={{ fontSize: 26 }}>{c.glyph}</span> {c.name}
          </span>
        ))}
      </div>

      {/* ── an entity under every tint it can wear ────────────────────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        One monster, every tint it can wear
      </h2>
      <p style={{ fontSize: 13, color: "#778", maxWidth: 860 }}>
        A glyph’s color is overloaded: its own species color, a champion tint,
        or a debuff tint (debuff wins). These are the states a single skeleton
        can actually appear in — they need to stay tellable apart.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13 }}>
        {[
          { label: "normal", color: MONSTERS.skeleton.color },
          ...Object.entries(ELITE).map(([k, e]) => ({
            label: `elite: ${k}`,
            color: e.color,
          })),
          ...Object.values(STATUS).map((s) => ({
            label: `debuff: ${s.key}`,
            color: s.tint,
          })),
        ].map((x) => (
          <div
            key={x.label}
            style={{
              border: "1px solid #1c1c22",
              padding: "6px 12px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 28, color: x.color, lineHeight: 1.2 }}>
              {MONSTERS.skeleton.glyph}
            </div>
            <div style={{ color: "#889" }}>{x.label}</div>
            <Dist a={x.color} b={LEVELS[0].palette.floor} />
          </div>
        ))}
      </div>

      {/* ── decals ───────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        Floor decals (painted on the overlay, over terrain)
      </h2>
      <p style={{ fontSize: 13, color: "#778", maxWidth: 860 }}>
        Shown at each decal&apos;s REAL alpha, over the darkest floor in the
        game ({DARKEST_FLOOR}) — the worst case for reading one. The swatch used
        to draw the bare colour at full opacity on a mid-tone floor, which made
        the faintest decal look like the boldest: ash is painted at{" "}
        {DECAL_STYLE.ash.alpha} but appeared solid here. Shape is still
        approximate (a plain disc); in game the pool is squashed and rotated
        with lobes and droplets, which a DOM swatch can&apos;t reproduce.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {DECALS.map(([name, v]) => (
          <div
            key={name}
            style={{
              background: DARKEST_FLOOR,
              padding: "10px 18px",
              border: "1px solid #1c1c22",
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${withAlpha(v.color, v.alpha)} 0%, transparent 70%)`,
              }}
            />
            <div style={{ fontSize: 13, color: "#889" }}>{name}</div>
            <div style={{ fontSize: 11, color: "#667" }}>
              α{v.alpha} · lobes {v.lobes} · drops {v.drops}
            </div>
            <Dist a={v.color} b={DARKEST_FLOOR} />
          </div>
        ))}
      </div>

      {/* ── activity log ─────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        Activity log · message kinds
      </h2>
      <p style={{ fontSize: 13, color: "#778", maxWidth: 780, marginTop: 4 }}>
        Lines are lifted from the REAL templates in{" "}
        <code>actions/index.ts</code> and <code>status.ts</code> — the same
        corpus test <code>[64]</code> asserts against — so this shows what the
        rail actually paints, not a designer&apos;s idea of it. The left column
        is the rail at its true width and background; the right names the kind
        each line resolves to. Harm is keyed on YOU being the grammatical
        object, which is what keeps &ldquo;You strike&nbsp;…&rdquo; out of the
        injury colour.
      </p>
      <div
        style={{ display: "flex", gap: 22, flexWrap: "wrap", marginTop: 12 }}
      >
        {/* the rail, as drawn */}
        <div
          style={{
            width: 232,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            border: `1px solid ${MARK.frame}`,
            background: `linear-gradient(180deg,${BG.panel},#0e0e12)`,
          }}
        >
          {LOG_SAMPLES.map((line) => {
            const c = classifyLog(line);
            return (
              <span
                key={line}
                style={{
                  display: "flex",
                  gap: 6,
                  color: c.color,
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                <span style={{ color: c.glyphColor, flexShrink: 0 }}>
                  {c.glyph}
                </span>
                <span>{line}</span>
              </span>
            );
          })}
        </div>

        {/* what each resolves to, with the readings the tests pin */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {LOG_SAMPLES.map((line) => {
            const c = classifyLog(line);
            return (
              <div
                key={line}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    width: 60,
                    color: c.color,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {c.kind}
                </span>
                <span style={{ color: c.glyphColor, width: 14 }}>
                  {c.glyph}
                </span>
                <span style={{ color: "#556", width: 62 }}>{c.color}</span>
                <span style={{ color: "#778" }}>
                  AA{" "}
                  <span
                    style={{
                      color:
                        contrastRatio(c.color, BG.panel) >= 4.5
                          ? "#5aa86a"
                          : "#ff6a6a",
                    }}
                  >
                    {contrastRatio(c.color, BG.panel).toFixed(2)}
                  </span>
                </span>
                <span style={{ color: "#556" }}>
                  vs&nbsp;rail <Dist a={c.color} b={BG.panel} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* status afflictions produce log lines too — and the SAME template aimed
          at a monster is not harm to you, which is the pair worth seeing side by
          side rather than trusting a regex about */}
      <h3 style={{ fontSize: 14, color: "#9aa", marginTop: 18 }}>
        Status afflictions — you vs. a monster
      </h3>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginTop: 6,
        }}
      >
        {Object.values(STATUS).flatMap((st) =>
          ["You", "The Skeleton"].map((who) => {
            const line = st.onApply(who);
            const c = classifyLog(line);
            return (
              <div
                key={`${st.key}-${who}`}
                style={{ display: "flex", gap: 8, fontSize: 13 }}
              >
                <span style={{ width: 60, color: "#556", fontSize: 11 }}>
                  {c.kind}
                </span>
                <span style={{ color: c.glyphColor, width: 12 }}>
                  {c.glyph}
                </span>
                <span style={{ color: c.color }}>{line}</span>
              </div>
            );
          }),
        )}
      </div>

      {/* ── weather ──────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 17, color: "#ffb347", marginTop: 34 }}>
        Level weather overrides
      </h2>
      <div style={{ fontSize: 14, color: "#9aa" }}>
        {Object.entries(WEATHER_ATMOSPHERE).map(([k, a]) => (
          <div key={k}>
            {k}: {a!.kind} ×{a!.count} @{a!.alpha}{" "}
            <span style={{ color: a!.color }}>■</span>{" "}
            <span style={{ color: "#667" }}>
              {ATMO_EMISSIVE.has(a!.kind) ? "emissive" : "reflective"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
