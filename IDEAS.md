# Ember of Dawn — Feature Backlog

A running list of ideas to implement later. ⭐ = high-impact / recommended-first.

## Visual & game-feel (juice)

- **Minimap** — tiny explored-tiles map in a HUD corner for the big castle levels.

### Overlay-canvas effects

_A transparent RGBA canvas sits atop the rot.js grid (see `CanvasRenderer.paintOverlay`) — already used for torch-glow, per-biome weather, cracked-wall fissures, and blood/scorch decals. It supports alpha, gradients, blend modes, blur, and sub-cell drawing — none of which the cell grid can do. Caveat: it composites **on top** of glyphs (use additive/`screen` blend for light so it brightens rather than paints over), and full-canvas gradient repaints are heavier than cheap strokes, so throttle/cache the expensive ones._

- **Bloom / glow** — `shadowBlur` on the Sunblade, magic bolts, and bosses so bright things actually radiate.
- **Screen feedback** — a red vignette pulse when low-HP or poisoned, a white flash on a firebomb, subtle screen-shake (transform the layers, like the smooth-scroll already does).
- **Smooth AoE telegraphs** — a clean glowing circle/cone for blast radius or an incoming boss attack, instead of blocky highlighted cells.

## Gameplay depth

- ⭐ **Active abilities with cooldowns** — a dash, a cleave (hit all adjacent), a short blink — tactical tools separate from consumables. Pairs great with the classes.
- ⭐ **Ranged-attack telegraphs** — when a ranged enemy (imp/lich) is lined up to fire, flash a faint aim line / target marker the turn *before* the shot, so incoming fire is readable and dodgeable — the same fairness/counterplay the boss dark-fire barrage and trap-awareness already give. Reuses the overlay telegraph rendering.
- **Weapon properties** — the remaining ones: reach (hit 2 tiles), cleave (hit all adjacent), lifesteal, weapon-level crit. (Knockback, on-hit status, and ranged already shipped; crit currently exists as the Rogue's class trait.)

## Systems / meta / replay

- ⭐ **Run modifiers (seeded mutators)** — "the dark deepens" (−light), "restless dead" (+spawns), "brittle" (more traps) — quick variety per run. Pairs with the classes (class × mutator = lots of run variety).
- **Difficulty settings + permadeath toggle** and **seed sharing** (the seed field exists, just hidden).
- **Meta-progression** — spend leftover gold between runs to unlock starting perks/items (long-term hook; needs persistence).
- **Run history & records** — persist a short list of recent runs (score, depth reached, cause of death) + a "best run" banner on the splash. Cheap stakes for the existing run-score system.
- **Kill-streak momentum** — chained kills grant a short buff.
- **Shop upgrades** — reroll stock, a rare "deal," and the in-level shopkeeper NPC.
- **More boss mechanics** — build on Malachar's phased fight: telegraphed barrage *lines/cones*, an add that must be killed to drop a shield, an enrage timer. Consider a mini-boss version of the pattern for Gorm / the Herald.

## Content & narrative

- **Lore fragments** — collectible journal pages that flesh out Veldrin; maybe an alternate ending based on a choice.
- **More biomes/monsters/items** — always cheap to add (data-driven), e.g., a sewer, an ice cavern, a treasure vault.
- **Cracked-wall-gated pockets** — instead of `sealUnreachable` walling off an isolated open area, reclaim decent-sized ones as *optional* content: punch a **cracked wall** between the pocket and the reachable map and drop a reward inside. Reuses the existing shortcut mechanic; looks intentional, unlike a carved tunnel. Needs a min-pocket-size threshold + a guaranteed reward placement.

## Scale & world richness ("make it feel epic")

_Guiding caveat: scale only feels epic if it's **populated**. The game's strength is tight, legible, escalating levels — "bigger" without more content/POIs/pacing just trades tension for walking. Match any size bump with density (monsters, forage, altars, secrets) + turn-budget tuning. Pursue the exploration/atmosphere items freely; treat dynamic terrain as one-off set-pieces so it doesn't dilute the taut core._

Priority order: **(1)** secret areas → **(2)** sub-biome regions → **(3)** selective bigger set-pieces + vistas → **(4)** a single flooding level.

- ⭐ **Secret / optional areas** — richest & safest, no progress gating. Builds on **Cracked-wall-gated pockets** (above); extend with hidden rooms behind bump-to-reveal secret walls, a rare guarded vault, buried caches, lore fragments. Rewards the exploration we're trying to make epic and can't unbalance or gate anything.
- ⭐ **Sub-biome regions** — the biggest world-feel jump. One secondary region per level with its own palette / glyphs / atmosphere (a flooded cavern inside the dungeon, a marsh patch in the wood). Needs **per-tile region tagging** (the renderer already tints/weathers per `level.biome` — make that per-tile) + generation that carves a distinct blob (e.g. a `Cellular` cave inside a `Digger` dungeon) while preserving the connectivity/trap-avoidability guarantees. Keep to ~1 region so the screen doesn't turn to visual noise.
- **Selective bigger maps** — _no technical limit_: the renderer is already a scrolling camera viewport (rot.js paints only the visible window), and generation is `O(tiles)` and fast. The limits are gameplay — the turn budget scales with size (test [26] asserts `turnLimit ≥ shortest-path × 2`), and a sparse big map is just wandering in the dark. Enlarge **set-pieces** (Great Hall / Throne), not everything; variety of scale is itself epic. Always pair with content density + budget tuning.
- **Vistas & set-piece beats** — cheap, high atmosphere: a distant landmark glimpsed through the fog (Blackhall from the Pass), a portcullis grinding shut behind you, a collapsing bridge, a scripted ambush (doors + reinforcements already exist), dynamic lighting (a hall going dark; the throne's fire flaring in phase 3) tied to the adaptive-music swell.
- **Dynamic terrain (flooding water)** — a level that floods/drains during play, or via a lever/altar. Great spectacle, and Levitation / Frostwalk / Emberstep become clutch counters. Runtime terrain mutation already exists (Frostwalk→ice, fire→floor, cracked walls). **The hard part is fairness** — flooding the sole route recreates the forced-path problem traps had, so it needs telegraphing + a guaranteed-reachable objective. Scope to ONE signature level (e.g. the Sunken Crypt actually floods as you hunt the Sunblade), not a global system.
- **A beat of calm** — a safe room / shrine alcove between horrors; pacing that makes the danger land harder.

## Audio & UX

- **Audio polish** — a volume slider / per-category mix (SFX vs music).
- **Deeper music** — **Stereo width**: pan sparkle bells + texture across L/R via `StereoPanner` for a spacious, 3D feel. (Timbre, reverb, texture, adaptive intensity, and evolving harmony are already shipped.)
- **Inventory management** — a drop/discard action from the inventory screen for mid-level declutter (complements shop selling).
- **Examine/look mode + bestiary** — inspect a tile/monster to see its stats; an expandable combat log; and a persistent codex of monsters/items you've encountered.
- **Settings screen** — animations toggle, palette/colorblind option, motion, difficulty.

---

_Recently shipped (details in [CLAUDE.md](CLAUDE.md) / [README.md](README.md)): character classes (Warrior / Rogue / Pyromancer + passives), interactive doors, overtime (a soft turn-limit that ramps reinforcements instead of an instant death), a global trap-avoidability guarantee, adaptive music intensity + evolving harmony, a splash/title theme, cinematic title-card screens (opening / transitions / victory / game-over), the two-column shop, forage heal tiles, and the terrain-defying draughts (Levitation / Emberstep / Rimewalk / Shadowcloak / Phial of Blinking)._
