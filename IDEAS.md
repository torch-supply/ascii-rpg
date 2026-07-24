# Ember of Dawn — Feature Backlog

A running list of ideas to implement later. ⭐ = high-impact / recommended-first.

## Direction: pacing & the turn counter (open decision)

The game is drifting from tight roguelike toward an **exploratory RPG** feel, and the per-level turn budget is the mechanic most in tension with that. Note the clock is ALREADY soft — running `turnsLeft` to 0 isn't death, it just starts `overtime` reinforcements ([config.ts](src/content/config.ts)); the _rush_ feeling comes from the **visible HUD countdown**, not a fail-state. Stakes for exploration already exist elsewhere — **torch fuel** (a resource clock), **wandering monsters**, **HP/consumable attrition** — so the countdown is largely redundant with them.

Options (pick an altitude — the engine keeps counting turns internally either way; determinism, monster AI, save, and the `survive` goal all depend on it, so this is a HUD + `maybeReinforce`-gating change, **not** a core rewrite):

1. ⭐ **Survive-only timer** — show the countdown + run `overtime` ONLY on `survive` levels (where "hold out X turns" _is_ the goal); everywhere else, no countdown and no overtime.
2. ⭐ **Par-for-score** — keep `turnLimit` as a _par time_: beat it → an end-screen score/gold bonus. A target for speedrunners, ignorable by explorers, never a threat.
3. **Soft "restlessness"** — no countdown; a hidden, generous pressure that only ramps after an egregious overstay, so the world still can't be camped forever.

Recommendation: **#1 + #2 together** — a visible timer only on survive levels; the old budget becomes a quiet par-bonus everywhere else. Bonus: this removes the test-`[26]` turn-budget-vs-map-size guard as a design constraint, freeing **bigger, slower, exploratory** levels.

## Visual & game-feel (juice)

- **Minimap** — tiny explored-tiles map in a HUD corner for the big castle levels.

### Overlay-canvas effects

_A transparent RGBA canvas sits atop the rot.js grid (see `CanvasRenderer.paintOverlay`) — already used for bloom, per-biome atmosphere, cracked-wall fissures, and blood/scorch decals. It supports alpha, gradients, blend modes, blur, and sub-cell drawing — none of which the cell grid can do. Caveat: it composites **on top** of glyphs (use additive/`screen` blend for light so it brightens rather than paints over), and full-canvas gradient repaints are heavier than cheap strokes, so throttle/cache the expensive ones._

- **Screen feedback** — a red vignette pulse when low-HP or poisoned, a white flash on a firebomb, subtle screen-shake (transform the layers, like the smooth-scroll already does).
- **Smooth AoE telegraphs** — a clean glowing circle/cone for blast radius or an incoming boss attack, instead of blocky highlighted cells.
- **Weather events & time-of-day** — a passing storm (rain particles + occasional **lightning** that briefly floods the light map), fog that thickens/thins over a level, and a **dawn-breaking** beat on the final approach (the light map slowly warms toward the Throne, paying off the "rekindle the Ember" arc visually). Extends the existing per-biome atmosphere + set-piece lighting beats (throne flare / crypt darken) — mostly ambient-tint + particle work on the overlay canvas.

## Gameplay depth

- ✅ **Active abilities with cooldowns** — shipped as **class-specific** actives on `[q]` (`ClassDef.ability`, `PlayerState.abilityCooldown`): Warrior **Cleave** (all adjacent), Rogue **Dash** (leap 3, aim a direction), Pyromancer **Scorch** (fire cone). Directional ones aim via cardinal arrows around the `@`. _Remaining: more/second abilities per class, resource or charge systems, ability upgrades in the shop._
- ⭐ **Ranged-attack telegraphs** — when a ranged enemy (imp/lich) is lined up to fire, flash a faint aim line / target marker the turn _before_ the shot, so incoming fire is readable and dodgeable — the same fairness/counterplay the boss dark-fire barrage and trap-awareness already give. Reuses the overlay telegraph rendering.
- **Weapon properties** — the remaining ones: reach (hit 2 tiles), cleave (hit all adjacent), lifesteal, weapon-level crit. (Knockback, on-hit status, and ranged already shipped; crit currently exists as the Rogue's class trait.)

## Systems / meta / replay

- ✅ **Run modifiers (seeded mutators)** — shipped (`content/mutators.ts` + the "Choose Your Trials" picker after class select): toggle any of 6 trials (dark / +spawns / +traps / −time / champions / 1-life), each reshaping the run via `applyLevelMutators` in `beginLevel` and raising the end score. _Remaining: trade-off mutators (a downside + an upside), more trials, and a per-run "daily seed" using the shared-seed field._
- **Difficulty settings + permadeath toggle** and **seed sharing** (the seed field exists, just hidden).
- **Meta-progression** — spend leftover gold between runs to unlock starting perks/items (long-term hook; needs persistence).
- **Run history & records** — persist a short list of recent runs (score, depth reached, cause of death) + a "best run" banner on the splash. Cheap stakes for the existing run-score system.
- **Kill-streak momentum** — chained kills grant a short buff.
- **Shop upgrades** — reroll stock, a rare "deal," and the in-level shopkeeper NPC.
- **More boss mechanics** — build on Malachar's phased fight: telegraphed barrage _lines/cones_, an add that must be killed to drop a shield, an enrage timer. Consider a mini-boss version of the pattern for Gorm / the Herald.

## Content & narrative

- **Lore fragments** — collectible journal pages that flesh out Veldrin; maybe an alternate ending based on a choice.
- **NPC encounters** — rare, strange, ambiguous figures (a trapped spirit, a dying fellow captive, a shade that bargains) — _not_ townsfolk. Mechanically an **altar with a face + a voice**: reuse the walkable-POI + bump-to-open-modal + pure-effect pattern (like `applyAltar`) via a data-driven `content/npcs.ts` registry (`glyph`, `name`, a line or two, an effect). Tiers, cheap → deep: (1) flavor/lore only; (2) knowledge/hints (reveal the exit or nearby traps, warn of the boss); (3) a gift/boon (heal, item, buff, trade); (4) a one-beat **choice with consequence** (free the captive — helps later, or it's a trap). Keep each to a single beat — no dialogue trees. **Tone caveat:** Veldrin's strength is _lonely dread_, so keep them rare and unsettling — one eerie encounter every few levels lands harder than a populated world. Concrete first step: ship the planned in-level **shopkeeper NPC** (bump → reuse the Shop UI) to prove the entity, then generalize. Pairs tightly with **Secret / optional areas** (an NPC tucked in a break-through room) and **Lore fragments** (NPCs deliver lore + feed the alternate-ending hook). Enrichment tier — same bucket as secret areas / sub-biomes, not a gameplay-depth win.
- **More biomes** — cheap & data-driven (palette + atmosphere + a hazard you already have). Candidates leaning exploratory: a ⭐ **bioluminescent cavern** (glowing fungi as colored **light sources** — a showcase for the lighting engine; dark and calm, the world glows teal/violet where you explore), **ashen wastes** (post-fire: falling ash, scorch decals everywhere, oil/ember hazards — a dead grey-orange world), a **fungal grove / spore caverns** (glowing mushrooms + drifting spores, later gating a poison-cloud hazard), a **sunken undercity / sewers** (water channels + a claustrophobic maze wing), and a ⭐ **ruined hamlet / waystation** — a cluster of freestanding **structures** forming a tiny "town" (pairs with the in-level shopkeeper NPC below; the single strongest add for RPG feel — a populated, safe beat between dungeons).
- **Environmental storytelling** — lore inscriptions on shrines/walls, remains of prior adventurers, readable notes tucked in secret vaults / structures. Rewards curiosity with _story_ instead of loot — the core exploratory payoff. Reuses the altar/POI + bump-to-open-modal pattern; feeds the **Lore fragments** hook above.
- **Ambient (non-hostile) creatures** — a deer that bolts, a will-o'-wisp that drifts off, carrion birds circling. Cosmetic AI (wander / flee-on-sight, never attacks) so the world feels alive rather than a kill-grid. Cheap: a `MonsterBehavior` that flees and deals no damage.
- ✅ **Cracked-wall-gated pockets** — shipped as **secret vaults** (`LevelConfig.secretVault` → `placeSecretVault`): a fully-walled room reachable only through one breakable cracked wall, loot inside, kept by `sealUnreachable` but physically gated until you blast/bash in.

## Scale & world richness ("make it feel epic")

_Guiding caveat: scale only feels epic if it's **populated**. The game's strength is tight, legible, escalating levels — "bigger" without more content/POIs/pacing just trades tension for walking. Match any size bump with density (monsters, forage, altars, secrets) + turn-budget tuning. Pursue the exploration/atmosphere items freely; treat dynamic terrain as one-off set-pieces so it doesn't dilute the taut core._

Priority order: **(1)** secret areas → **(2)** sub-biome regions → **(3)** selective bigger set-pieces + vistas → **(4)** a single flooding level.

- ✅ **Secret / optional areas** — shipped and broadened: **secret vaults** now open via a chosen `gate` — a **cracked wall** (blast/bash) OR a shut **door** (a dungeon cell / castle strongroom / crypt reliquary) — and **freestanding structures** (`LevelConfig.structure` → `placeStructure`) stamp a visible wall-box building onto an open clearing (a woodsman's hut, a mire wayshrine, a frostspine watchpost), each tagged its own timber/stone region so it reads as _built_. _Remaining: hidden rooms behind bump-to-reveal secret walls, a guarded vault (monster + loot), lore fragments inside._
- ✅ **Sub-biome regions** — shipped (first pass). Per-tile region tagging (`GameMap.region`/`regionBiome`/`regionPalette`) drives per-region palette / glyph / atmosphere / lighting-ambient; `carveSubBiome` shapes either an organic Simplex-noise blob or a **generator-carved wing** (`spec.layout`, e.g. a maze), with optional **hazard terrain** (`spec.hazards[]`, e.g. bog water / scorched oil / frozen ice) — all carved before the connectivity pass so guarantees hold. Now an **array** (`LevelConfig.subBiomes[]`) so a level can host several regions at once (the Blackwood carries a bog AND a bright glade), and **every level** now has a signature terrain beat (Pit cavern, Mire hummock, Frostspine ice grotto, Ramparts frozen stretch, …). _Remaining: more regions/biomes, richer per-region hazards, a gated sub-region as a secret._
- ✅ **Selective bigger maps** — first pass shipped: the **Great Hall** is now a grand 72×46 set-piece (from 56×34), density tuned _down_ per-area for spaciousness (not a grind) and `turnLimit` up to clear the test-[26] guard. _Remaining: enlarge another set-piece (the Throne stays tight for the boss), and keep pairing size with content density + budget._
- **Vistas & set-piece beats** — cheap, high atmosphere. ✅ **Dynamic-lighting beats shipped**: the Throne fire FLARES in the lich's final phase (ambient brightens + warms in a pulse, cresting with the danger music), and the Sunken Crypt's braziers GUTTER as the flood drowns it (ambient dims + cools with `floodStep`) — both modulate `ambByRegion` in `CanvasRenderer` off existing triggers. _Remaining (liked, for later): a distant landmark glimpsed through the fog (Blackhall from the Pass), a portcullis grinding shut behind you, a collapsing bridge, a scripted ambush (doors + reinforcements already exist). These need a small scripted-trigger hook (fire on reaching a tile / picking up an item / turn N) + some are render-heavy (the distant landmark)._
- ✅ **Dynamic terrain (flooding water)** — shipped on the **Sunken Crypt** (`LevelConfig.flood` + `computeFloodPlan` + `tickFlood`). Fair by construction: a protected dry **spine** (start→objectives) never floods (verified reachable even at full submersion), while the rest rises ring-by-ring from far corners, capped at `maxSteps`, never onto an occupied tile. Levitation/Rimewalk are the counters; the crypt also darkens as it fills (a lighting beat). _Remaining: a lever/altar-triggered flood, draining, or a second signature level._
- **A beat of calm** — a safe room / shrine alcove between horrors; pacing that makes the danger land harder.

## rot.js features to explore

_We currently use a small slice of rot.js: `RNG` (seeded/weighted/clone), `Display`, `Map.Digger/Uniform/Cellular`, `FOV.PreciseShadowcasting`, `Path.AStar`. Unused features worth experimenting with, ranked by fit for this game:_

- ✅ **`ROT.Lighting` (+ `ROT.Color`) — shipped** (the flat distance-dimming + old `paintGlow`/`lit()` were removed). Multi-source colored light that spreads through the FOV and bounces off surfaces, in `src/render/lighting.ts` (`computeLightMap` → per-tile RGB), blended through the renderer's single `litVis` choke point. Sources: torch (flickering, guttering dim/warm-shift as fuel runs low; a steady eyes-only ember when unlit), per-tile-flickering fire, Sunblade, altars, boss aura, the lich's dark-fire barrage (pulsing red underlight), and transient bolt/explosion/hit flashes (from the FX layer via `fxLights`). Per-biome ambient (`ambientForBiome`) eases center→edge to a fog-level floor (no black ring). Bright sources get additive radial-gradient **bloom** via `paintBloom`. All tuning lives at the top of `lighting.ts`. _Remaining follow-ups: **reflection tuning** — biome-specific `REFLECTIVITY` (wet marsh bounces more than dry stone); **perf** — cache the full light pass and reapply only the flicker scalar per frame if the big castle levels dip._
- **`ROT.StringGenerator`** — Markov-chain procedural text/names, trained on a tiny corpus: elite epithets, crypt epitaphs, altar incantations, unique weapon names — different per seed. Cheap flavor. Caveat: defaults to `Math.random`, so keep it cosmetic-only or feed it our seeded RNG to stay deterministic.
- ✅ **More map generators** — `rogue` (rooms + corridors) + `maze` (`DividedMaze`) added via the shared `genGrid` helper; whole-level-capable and used to carve sub-region wings (the crypt catacombs). _The other maze variants (`IceyMaze`/`EllerMaze`) are trivially addable if we want more labyrinth flavors._
- **`ROT.Noise` (Simplex)** — now used to shape sub-biome blobs (`carveSubBiomeBlob`). _Still optional: swap the hand-rolled value-noise in `AsciiField`/atmosphere, and drive organic water/oil placement off coherent noise instead of the blob walk._

_Deliberately skipping (conflict with our design): `Scheduler`/`EventQueue`/`Engine` (our pure-core `LoopDriver` seam is intentional — only revisit for real-time mode), graphical tiles / hex grid / `ROT.Text` / built-in keyboard handling (against the ASCII aesthetic / React HUD / our own keymap)._

## Audio & UX

- **Audio polish** — a volume slider / per-category mix (SFX vs music).
- **Deeper music** — **Stereo width**: pan sparkle bells + texture across L/R via `StereoPanner` for a spacious, 3D feel. (Timbre, reverb, texture, adaptive intensity, and evolving harmony are already shipped.)
- **Inventory management** — a drop/discard action from the inventory screen for mid-level declutter (complements shop selling).
- **Examine/look mode + bestiary** — inspect a tile/monster to see its stats; an expandable combat log; and a persistent codex of monsters/items you've encountered.
- **Settings screen** — animations toggle, palette/colorblind option, motion, difficulty.

---

_Recently shipped (details in [CLAUDE.md](CLAUDE.md) / [README.md](README.md)): run modifiers / seeded trials (opt-in challenges chosen at New Game that raise the score), class-specific active abilities (`[q]` — Warrior Cleave / Rogue Dash / Pyromancer Scorch, on cooldowns), a flooding set-piece (the Sunken Crypt fills during play, protected dry spine keeps the goal reachable), a larger grand-hall set-piece, dynamic set-piece lighting beats (throne fire flare / crypt darkens as it floods), sub-biome regions (per-tile palette/glyph/atmosphere/lighting — noise-blob + generator-carved wings + multi-hazard kits, now `subBiomes[]` so every level has a signature terrain beat), secret vaults gated by a cracked wall OR a shut door, freestanding structures (visible wall-box buildings on open ground — hut / wayshrine / watchpost), `rogue`/`maze` map generators, dynamic colored lighting (`ROT.Lighting` — flickering/guttering torch, fire/Sunblade/altar/boss/barrage sources, per-biome ambient, bloom on bright sources), character classes (Warrior / Rogue / Pyromancer + passives), interactive doors, overtime (a soft turn-limit that ramps reinforcements instead of an instant death), a global trap-avoidability guarantee, adaptive music intensity + evolving harmony, a splash/title theme, cinematic title-card screens (opening / transitions / victory / game-over), the two-column shop, forage heal tiles, and the terrain-defying draughts (Levitation / Emberstep / Rimewalk / Shadowcloak / Phial of Blinking)._
