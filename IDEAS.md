# Ember of Dawn — Feature Backlog

A running list of ideas to implement later. ⭐ = high-impact / recommended-first.

## Visual & game-feel (juice)

- **Minimap** — tiny explored-tiles map in a HUD corner for the big castle levels.

### Overlay-canvas effects

_A transparent RGBA canvas now sits atop the rot.js grid (added for the cracked-wall knockout fissures). It supports alpha, gradients, blend modes, blur, and sub-cell drawing — none of which the cell grid can do. It rides the existing render/scroll loops. Caveat: it composites **on top** of glyphs (use additive/`screen` blend for light so it brightens rather than paints over), and full-canvas gradient repaints are heavier than the cheap crack strokes, so throttle/cache the expensive ones._

- ⭐ **Soft torch-glow lighting** — a warm radial glow around the player (and colored, flickering light pools cast by fire tiles) layered over the existing per-cell distance-dim, for a much softer falloff. Natural first use of the overlay.
- **Atmospheric fog / mist** — drifting translucent wisps (radial gradients + low alpha) instead of flat dimming; great for the Mire and crypt.
- **Per-biome weather** — snow on Frostspine, drifting embers/ash in the Throne, rain streaks — sub-cell particles the grid can't render.
- **Bloom / glow** — `shadowBlur` on the Sunblade, magic bolts, and bosses so bright things actually radiate.
- **Screen feedback** — a red vignette pulse when low-HP or poisoned, a white flash on a firebomb, subtle screen-shake (transform the layers, like the smooth-scroll already does).
- **Smooth AoE telegraphs** — a clean glowing circle/cone for blast radius or an incoming boss attack, instead of blocky highlighted cells.
- **Persistent decals** — scorch marks under burnt oil, blood splatter — sub-cell and lasting.

## Gameplay depth

- ⭐ **Active abilities with cooldowns** — a dash, a cleave (hit all adjacent), a short blink — tactical tools separate from consumables. Pairs great with classes.
- ⭐ **Character classes / starting kits** — Warrior (melee+armor), Rogue (stealth+crit), Pyromancer (bombs+bolts). Big replay boost, picked on the splash.
- **Weapon properties** — reach (hit 2 tiles), cleave, lifesteal, crit chance — so weapons aren't just "bigger number."
- **Player ranged option** — an equipped bow/sling with ammo, distinct from the firebomb. _(Pass 2 — in progress.)_
- **Altars/shrines** — risk/reward: sacrifice HP or gold for a boon; cursed-but-strong items. _(Pass 2 — in progress.)_

## Systems / meta / replay

- ⭐ **Run modifiers (seeded mutators)** — "the dark deepens" (−light), "restless dead" (+spawns), "brittle" (more traps) — quick variety per run.
- **Difficulty settings + permadeath toggle** (Phase 3 already noted) and **seed sharing** (the seed field exists, just hidden).
- **Meta-progression** — spend leftover gold between runs to unlock starting perks/items (long-term hook; needs persistence).
- **Kill-streak momentum** — chained kills grant a short buff.
- **Shop upgrades** — sell items, reroll stock, a rare "deal," and the in-level shopkeeper NPC (Phase 3 noted).
- **Boss mechanics** — give Malachar phases (summon adds, telegraphed barrage tiles, teleport) so the finale is a real fight.

## Content & narrative

- **Lore fragments** — collectible journal pages that flesh out Veldrin; maybe an alternate ending based on a choice.
- **More biomes/monsters/items** — always cheap to add (data-driven), e.g., a sewer, an ice cavern, a treasure vault.

## Audio & UX

_(audio deferred so far, but it's the classic "up a notch")_

- **Sound** — hit/pickup/level-clear SFX, per-biome ambience, a victory sting. Huge impact for modest effort.
- **Examine/look mode** — inspect a tile/monster to see its stats; expandable combat log.
- **Settings screen** — animations toggle, palette/colorblind option, motion, difficulty.
