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

- ⭐ **Active abilities with cooldowns** — a dash, a cleave (hit all adjacent), a short blink — tactical tools separate from consumables. Pairs great with classes.
- ⭐ **Character classes / starting kits** — Warrior (melee+armor), Rogue (stealth+crit), Pyromancer (bombs+bolts). Big replay boost, picked on the splash.
- **Weapon properties** — the remaining ones: reach (hit 2 tiles), cleave (hit all adjacent), lifesteal, crit chance. (Knockback, on-hit status, and ranged already shipped.)
- ⭐ **Ranged-attack telegraphs** — when a ranged enemy (imp/lich) is lined up to fire, flash a faint aim line / target marker the turn *before* the shot, so incoming fire is readable and dodgeable — the same fairness/counterplay the boss dark-fire barrage and trap-awareness already give. Reuses the overlay telegraph rendering; strong readability win now that ranged crossfire is a real threat.
- **Interactive doors** — open/close the door tiles (`+`/`'`) to break line-of-sight and body-block a chaser into a chokepoint. A light tactical layer on terrain that already exists (pairs with stealth-via-light).

## Systems / meta / replay

- ⭐ **Run modifiers (seeded mutators)** — "the dark deepens" (−light), "restless dead" (+spawns), "brittle" (more traps) — quick variety per run.
- **Difficulty settings + permadeath toggle** (Phase 3 already noted) and **seed sharing** (the seed field exists, just hidden).
- **Meta-progression** — spend leftover gold between runs to unlock starting perks/items (long-term hook; needs persistence).
- **Run history & records** — persist a short list of recent runs (score, depth reached, cause of death) + a "best run" banner on the splash. Cheap stakes for the existing run-score system, short of full meta-progression.
- **Kill-streak momentum** — chained kills grant a short buff.
- **Shop upgrades** — reroll stock, a rare "deal," and the in-level shopkeeper NPC (Phase 3 noted). _(Buying + selling already shipped.)_
- **More boss mechanics** — build on Malachar's phased fight (shipped: HP-gated phases, telegraphed dark-fire barrages, summoned adds, blink-when-cornered): e.g. telegraphed barrage *lines/cones*, an add that must be killed to drop a shield, an enrage timer. Consider a mini-boss version of the pattern for Gorm/the Herald.

## Content & narrative

- **Lore fragments** — collectible journal pages that flesh out Veldrin; maybe an alternate ending based on a choice.
- **More biomes/monsters/items** — always cheap to add (data-driven), e.g., a sewer, an ice cavern, a treasure vault.
- **Cracked-wall-gated pockets** — instead of `sealUnreachable` walling off an isolated open area, reclaim decent-sized ones as *optional* content: punch a **cracked wall** between the pocket and the reachable map and drop a reward inside. Turns dead space into a break-through side-room (reuses the existing shortcut mechanic; looks intentional, unlike a carved tunnel). Would need a min-pocket-size threshold + a guaranteed reward placement.

## Audio & UX

_(SFX + music are implemented — `lib/sound.ts` / `lib/music.ts`; the below is what's left.)_

- **Audio polish** — a volume slider / per-category mix (SFX vs music). _(Splash/title theme already shipped.)_
- **Deeper music** — **Stereo width**: pan sparkle bells + texture across L/R via `StereoPanner` for a spacious, 3D feel. The last one left — timbre, reverb, texture, adaptive intensity, and evolving harmony are all shipped.
- **Inventory management** — a drop/discard action from the inventory screen for mid-level declutter (complements shop selling; keeps unwanted spare gear from piling up between shops).
- **Examine/look mode + bestiary** — inspect a tile/monster to see its stats; an expandable combat log; and a persistent codex of monsters/items you've encountered (rewards exploration, gives the world texture).
- **Settings screen** — animations toggle, palette/colorblind option, motion, difficulty.
