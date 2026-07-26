# Ember of Dawn — Feature Backlog

Ideas to build later. ⭐ = high-impact / recommended-first. Everything already
shipped lives in [CLAUDE.md](CLAUDE.md) — this file is only what's _left to do_.

## Visual & game-feel

- ⭐ **Ranged-attack telegraphs** — flash a faint aim line / target marker the turn _before_ an imp/lich fires, so incoming ranged fire is as readable and dodgeable as the boss dark-fire barrage and trap-awareness already are. Reuses the overlay telegraph layer.
- **Screen feedback** — a red vignette pulse when low-HP/poisoned, a white flash on a firebomb, subtle screen-shake (transform the layers, like the smooth-scroll already does).
- **Smooth AoE telegraphs** — a clean glowing circle/cone for a blast radius or an incoming attack, instead of blocky highlighted cells.
- **Minimap** — a tiny explored-tiles map in a HUD corner for the big levels.
- **Weather follow-ups** — fog that thickens/thins over a level; optional thunder SFX synced to the Ramparts lightning.

## Gameplay depth

- **More class abilities** — a second `[q]` ability per class, a charge/resource system, or ability upgrades bought in the shop.
- **Remaining weapon properties** — reach (hit 2 tiles), cleave (all adjacent), lifesteal, weapon-level crit. (Knockback / on-hit status / ranged already shipped; crit is currently the Rogue's trait.)
- **More boss mechanics** — build on Malachar's phased fight: barrage _lines/cones_, an add that must be killed to drop a shield, an enrage timer; maybe a mini-boss version of the pattern for Gorm / the Herald.

## Systems / meta / replay

- **Mutator follow-ups** — trade-off trials (a downside paired with an upside), more trials, a per-run "daily seed" (the shared-seed field already exists).
- **Difficulty settings + permadeath toggle**, and **seed sharing** (the seed field exists, just hidden).
- **Meta-progression** — spend leftover gold between runs on starting perks/items (long-term hook; needs cross-run persistence).
- **Run history & records** — persist recent runs (score / depth reached / cause of death) + a "best run" banner on the splash. Cheap stakes on the existing run-score.
- **Kill-streak momentum** — chained kills grant a short buff.
- **Shop upgrades** — reroll stock, a rare "deal."

## Content & narrative

- ⭐ **In-level shopkeeper NPC** — the first live NPC: bump → reuse the Shop UI. Proves the "entity with a face" pattern before generalizing.
- **NPC encounters** — rare, strange, ambiguous figures (a trapped spirit, a dying fellow captive, a bargaining shade) — _not_ townsfolk. Mechanically an **altar with a face**: reuse the walkable-POI + bump-to-modal + pure-effect pattern (like `applyAltar`/lore props) via a data-driven `content/npcs.ts` registry. Tiers, cheap → deep: flavor/lore → a hint (reveal the exit / nearby traps) → a gift/boon → a one-beat **choice with consequence** (free the captive: helps later, or it's a trap). No dialogue trees. **Tone caveat:** Veldrin's strength is _lonely dread_ — keep them rare and unsettling; one eerie encounter every few levels lands harder than a populated world.
- **Lore follow-ups** — fragments seeded _specifically_ inside secret vaults / structures (currently biome-pool placement); an in-game **lore log** to reread collected fragments; maybe an alternate ending from a choice.
- **More ambient species** — a deer that bolts, circling carrion birds — just new `ambient` monster defs, no new code.
- **More biomes** (data-driven: palette + atmosphere + an existing hazard) — **ashen wastes** (falling ash, scorch decals everywhere, oil/ember), a **fungal grove / spore caverns** (glowcap mushrooms + the spore-vent haze — both pieces now exist, just needs a level), a **sunken undercity / sewers** (water channels + a claustrophobic maze wing).

## Set-pieces & world richness

_Caveat: scale only feels epic if it's **populated** — match any size bump with density (monsters / forage / altars / secrets). Treat dynamic terrain as one-off set-pieces so the taut core isn't diluted._

- **The Pit oubliette** — a one-way trapdoor drop into a hidden loot pocket (a drop-tile that teleports you into a sealed cache with its own way out). The next level-design beat.
- **Vistas & scripted beats** — a distant landmark glimpsed through fog (Blackhall from the Pass), a portcullis grinding shut behind you, a collapsing bridge, a scripted ambush. Needs a small scripted-trigger hook (fire on reaching a tile / picking up an item / turn N); the distant-landmark one is render-heavy.
- **Secret-area follow-ups** — hidden rooms behind bump-to-reveal secret walls; a _guarded_ vault (monster + loot); more lore tucked inside.
- **Flood follow-ups** — a lever/altar-triggered flood, draining, or a second signature dynamic-terrain level.
- **A beat of calm** — a safe room / shrine alcove between horrors, so the danger lands harder by contrast.

## rot.js features to explore

_We use a slice: `RNG`, `Display`, `Map.Digger/Uniform/Cellular/Rogue/DividedMaze`, `FOV.PreciseShadowcasting`, `Path.AStar`, `Lighting`, `Noise.Simplex`._

- **`ROT.StringGenerator`** — Markov-chain procedural names/text (elite epithets, crypt epitaphs, altar incantations, unique weapon names), different per seed. Feed it our seeded RNG (its default is `Math.random`) to stay deterministic.
- **Lighting follow-ups** — biome-specific `REFLECTIVITY` (wet marsh bounces more than dry stone); cache the full light pass and reapply only the per-frame flicker scalar if the big castle levels dip.
- **`ROT.Noise` follow-ups** — drive organic water/oil placement off coherent noise instead of the blob walk; swap the hand-rolled value-noise in `AsciiField`/atmosphere.
- _Skipping by design: `Scheduler`/`EventQueue`/`Engine` (our pure-core `LoopDriver` seam is intentional — revisit only for real-time mode); graphical tiles / hex grid / `ROT.Text` / built-in keyboard handling (against the ASCII + React-HUD design)._

## Audio & UX

- **Audio polish** — a volume slider / per-category mix (SFX vs music); **stereo width** (pan sparkle bells + texture L/R via `StereoPanner`).
- **Inventory drop/discard** — a mid-level declutter action (complements shop selling).
- **Examine/look mode + bestiary** — inspect a tile/monster for its stats; an expandable combat log; a persistent codex of monsters/items encountered.
- **Settings screen** — animations/motion toggle, palette/colorblind option, difficulty.

## Design lessons (hard-won — keep in mind)

- **`killCount` wants density** — sparse big maps tank the greedy-bot floor (see the Iron Gate). Scale monster count with map size on cull goals.
- **Base-generator swaps hurt combat levels** — tight layouts (`rogue`/`uniform`, ~13–27% floor) leave no kiting room; navigation/collect goals tolerate them, combat goals don't. For combat-level variety, add a structural _wing_ on a forgiving digger base, or a purpose-built generator (the `hall`/`rampart`/`gallery` pattern), rather than swapping the base.
- **Per-seed variety needs real jitter** — a deterministic custom generator reads as "always the same." Add seed-driven structure changes (collapsed sections, optional transepts, varied/gated niches) like `genHall`/`genGallery` do.
- **Boss-keyed set-pieces need the right trigger** — HP-keyed effects only pay off on a long fight (the Throne dawn); on a level with a fast-dying gatekeeper, key off _approach distance_ instead (the Antechamber dusk), or the beat flashes by unseen.

---

_Shipped so far — see [CLAUDE.md](CLAUDE.md) for full details: par-for-score pacing (survive-only countdown + efficiency bonus); character classes + `[q]` active abilities; seeded run modifiers; dynamic colored lighting (`ROT.Lighting`) + bloom + per-biome atmosphere/weather (rain/storm) + dawn/dusk set-piece lighting; sub-biome regions + custom generators (`hall`/`rampart`/`gallery`) + freestanding structures + secret vaults; the flooding Sunken Crypt; hazard terrain (water / chasm + shove-falls / oil / bramble / spore vents / ice / glowcap); interactive doors; forage; the terrain-defying draughts (Levitation / Emberstep / Rimewalk / Shadowcloak / Blinking); elites + light-based stealth; ranged weapons + altars; readable lore props; ambient wildlife (will-o'-wisps); status effects; monster loot; the five-tier buy/sell shop; and full synthesized audio + adaptive music._
