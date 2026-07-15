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

## Systems / meta / replay

- ⭐ **Run modifiers (seeded mutators)** — "the dark deepens" (−light), "restless dead" (+spawns), "brittle" (more traps) — quick variety per run.
- **Difficulty settings + permadeath toggle** (Phase 3 already noted) and **seed sharing** (the seed field exists, just hidden).
- **Meta-progression** — spend leftover gold between runs to unlock starting perks/items (long-term hook; needs persistence).
- **Kill-streak momentum** — chained kills grant a short buff.
- **Shop upgrades** — ~~sell items~~ (done — flat % of base value), plus reroll stock, a rare "deal," and the in-level shopkeeper NPC (Phase 3 noted).
- **Boss mechanics** — give Malachar phases (summon adds, telegraphed barrage tiles, teleport) so the finale is a real fight.

## Content & narrative

- **Lore fragments** — collectible journal pages that flesh out Veldrin; maybe an alternate ending based on a choice.
- **More biomes/monsters/items** — always cheap to add (data-driven), e.g., a sewer, an ice cavern, a treasure vault.

## Audio & UX

_(audio deferred so far, but it's the classic "up a notch")_

- **Sound** — _(largely done: a synthesized SFX set in `lib/sound.ts` — hit/hurt, pickup/coin, quaff, shoot/thud, blast, crumble, trap, step, altar, ui blips, boss sting, level-clear, death, + a persisted on/off toggle)_. Still to do: per-biome ambient beds, a fuller victory/game-over theme, maybe a volume slider or per-category mix.
- **Examine/look mode** — inspect a tile/monster to see its stats; expandable combat log.
- **Settings screen** — animations toggle, palette/colorblind option, motion, difficulty.
