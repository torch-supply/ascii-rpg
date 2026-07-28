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
- **More ambient species** — the `ambient` behavior and four creatures are in; adding another is pure data (an `ambient` `MonsterDef` + a `LevelConfig.ambient` entry). Candidates: cave moths near the Pit's glowcap, bats or crows in the crypt.
- **More biomes** — the pattern is well-worn (a new `Biome` + ~6 tables + a `subBiomes[]` entry); `ashen`, `grove` and `undercity` all shipped this way. Remaining: an **ashen-wastes whole level** (it only exists as a sub-region today), and more sub-regions as levels call for them. _Follow-up for ashen:_ pre-seed scorch decals across the region (a deterministic scatter in `generate` → `LevelData.decals`) so it reads as burned everywhere, not just palette-dark.

## Set-pieces & world richness

_Caveat: scale only feels epic if it's **populated** — match any size bump with density (monsters / forage / altars / secrets). Treat dynamic terrain as one-off set-pieces so the taut core isn't diluted._

- **The Pit oubliette** — a one-way trapdoor drop into a hidden loot pocket (a drop-tile that teleports you into a sealed cache with its own way out). The next level-design beat.
- ⭐ **The Great Hall is still the sparsest level** — 1.6 POIs/100 walkable tiles against a ~2.6 median, after a density pass took it from 1.2. The untouched lever is architectural: `genHall` carves **77% floor** (every other map is 19–39%), so the grandeur currently comes from emptiness. Tightening it toward ~50% (more chapel walls, deeper aisles, denser colonnades) would raise density with NO added threats. _Caveat that cost me a round-trip: its low `medSeen` share is a measurement artifact of that open floor — in ABSOLUTE tiles walked it's the highest in the game._
- **Vistas & scripted beats** — a distant landmark glimpsed through fog (Blackhall from the Pass), a portcullis grinding shut behind you, a collapsing bridge, a scripted ambush. Needs a small scripted-trigger hook (fire on reaching a tile / picking up an item / turn N); the distant-landmark one is render-heavy.
- **Secret-area follow-ups** — hidden rooms behind bump-to-reveal secret walls; lore fragments seeded inside vaults specifically (they currently draw from the region pool like any other prop).
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

### Level design & placement

- ⭐ **"Farthest cell" is almost always a dead-end** — placing a quest item or boss at the strict maximum distance puts it at a corridor tip (measured: the Sunblade hit a 1-wide corridor on 7 of 8 seeds). It reads as the item plugging a passage, it's anticlimactic for a payoff item, and on a flooding level it's a death trap. `farthestCell` now trades a few tiles of distance for OPEN ground — but for QUEST ITEMS only. Applying it to bosses too dropped the Iron Gate 50%→17%: a corridor lets you fight a boss one-on-one while an open room lets its escort flank you, and a boss on a chokepoint is thematic anyway (the Gate Warden _holds the gate_). Generalizes twice over: when picking a spot by an extremum, check the SHAPE of what you get and not just the score — and the shape that's right for loot is wrong for a fight.
- ⭐ **A set-piece has to actually happen** — the crypt's flood started at turn 24 while runs finished around turn 43, so players saw ~2 of 7 steps: the level's whole identity was a coda. Tuning it to start early and span the hunt (with a thinner garrison so the water, not the horde, is the antagonist) raised exploration 37%→55%. Check that a signature mechanic overlaps the actual run length — `medTurns` vs the mechanic's schedule.
- ⭐ **Growing a level invalidates its whole tuning block** — `monsterBudget`, `forageCount`, `turnLimit` and (on flood levels) the flood timer are all calibrated against the OLD dimensions. Growing the Sunken Crypt 54×34 → 66×42 for a third region dropped its bot floor 50% → 17%. Two traps in the diagnosis: (1) `findItem` places its item at the FARTHEST cell, so a bigger map lengthens the hunt disproportionately — attrition, not the hazard, is what kills; (2) I assumed the flood was catching the player and retimed it, but deaths were at turn 23 with the flood starting at 32 — the hypothesis was simply wrong, and the fix that "worked" (60×38 + restored density) was a different change entirely. Re-measure after each single dial, and be suspicious when a fix lands without the metric that motivated it moving.
- **Match the GOAL to the map size** — a `killCount` cull completes wherever you happen to be fighting, so on a big map it ends in the spawn corner and the rest goes unseen; it also needs high density to stay winnable (which then makes traversal brutal). Big, varied maps want a goal that pulls you across them (`killTarget` placed farthest-from-start, `reachLocation`, scattered `collectX`). The Iron Gate moved cull → Gate Warden for exactly this, and its horde could then thin 18 → 13 (bot floor 33% → 50%, median turns up, end-HP down to 5 — it now fights the whole way).
- **Base-generator swaps hurt combat levels** — tight layouts (`rogue`/`uniform`, ~13–27% floor) leave no kiting room; navigation/collect goals tolerate them, combat goals don't. For combat-level variety, add a structural _wing_ on a forgiving digger base, or a purpose-built generator (the `hall`/`rampart`/`gallery` pattern), rather than swapping the base.
- **Per-seed variety needs real jitter** — a deterministic custom generator reads as "always the same." Add seed-driven structure changes (collapsed sections, optional transepts, varied/gated niches) like `genHall`/`genGallery` do.
- **Boss-keyed set-pieces need the right trigger** — HP-keyed effects only pay off on a long fight (the Throne dawn); on a level with a fast-dying gatekeeper, key off _approach distance_ instead (the Antechamber dusk), or the beat flashes by unseen.

---

_Shipped so far — see [CLAUDE.md](CLAUDE.md) for full details: par-for-score pacing (survive-only countdown + efficiency bonus); character classes + `[q]` active abilities; seeded run modifiers; dynamic colored lighting (`ROT.Lighting`) + bloom + per-biome atmosphere/weather (rain/storm) + dawn/dusk set-piece lighting; sub-biome regions + custom generators (`hall`/`rampart`/`gallery`) + freestanding structures + secret vaults; the flooding Sunken Crypt; hazard terrain (water / chasm + shove-falls / oil / bramble / spore vents / ice / glowcap); interactive doors; forage; the terrain-defying draughts (Levitation / Emberstep / Rimewalk / Shadowcloak / Blinking); elites + light-based stealth; ranged weapons + altars; readable lore props; ambient wildlife (will-o'-wisps); status effects; monster loot; the five-tier buy/sell shop; and full synthesized audio + adaptive music._

- ⭐ **A carried run is much poorer than the per-level table suggests** — `[P4]` (full-run continuity) shows a real character banks only ~54–110g before the run ends, against the ~198g "full run" figure the per-level medians imply (that figure assumes clearing all ten levels). Early shops also offer the Warrior almost nothing: tier 1 is `w_short` pow5 / `a_leather` red1 — exactly the starting kit — and the first real upgrade (`w_mace`, pow6, 24g) is usually unaffordable at tier 2. Worth revisiting: make tier 1 offer a genuine (if small) upgrade, or shift some gear earlier, so the first shops feel like progress rather than a heal vendor.

### Readability (an unreadable glyph is a bug)

- ⭐ **"Sealed" must mean sealed to SIGHT, not just to movement** — the secret-vault enclosure check tested the 4 orthogonal neighbors, but FOV runs at `topology: 8`: one transparent diagonal corner let you see the entire vault (hoard, guardian and all) through the "sealed" wall, from 15+ tiles away. Structural containment and optical containment are different properties — whenever something is meant to be hidden, assert it against the FOV's own topology (test `[56]`), not against walkability.
- **A hazard and a boon must never share a glyph** — bramble and the altar both drew `‡`, separated only by color, so a thing that bleeds you looked like a thing that helps you. Bramble moved to `&` (ASCII, dense, tangled, not a letter so it can't read as a monster). Sharing a glyph across an item _category_ is fine and conventional (`!` for every potion); sharing one across opposite MEANINGS is the bug. `/style`'s collision report is the standing check — and it must read the RENDERED glyph (`terrainGlyph`), not the raw table, or it invents collisions that never reach the screen (it flagged `%` for crackedWall/forage, both of which are overridden before drawing).
- **Water is the game's thinnest color read** — measured across every hazard×terrain pair that can really co-occur, water is the bottom four: **121** on the Frostspine's grey-blue crags, then 161 (Blackwood trees), 165, 183. Everything else is ≥221. It survives on its `~` glyph plus the shimmer animation, but it's the one worth an art pass — a slightly deeper or greener blue on the mountain would lift the weakest pairing in the game. Test `[54]`'s floor sits just under it (110), so retinting water should come with tightening that bar.

### Testing discipline

- ⭐ **Mutation-audit the suite periodically** — deliberately break real game code, one bug at a time, and see whether the suite turns red. The first audit scored 5 caught / 4 genuine holes: the **min-1 damage floor**, **DoT dealing 0 damage**, and the **sneak multiplier** were all documented load-bearing rules with no test, and the economy's wide 15–90% ratio rail happily absorbed a **4× coin inflation**. All four are now covered (`[53]` + a tuned-income band). Two lessons for running one: substitute ALL occurrences (a no-`/g` replace silently hits the wrong line and fakes a result), and expect **equivalent mutants** — `wardMitigate`'s floor looked like a survivor but is genuinely unobservable, since `mitigate` already guarantees `dmg ≥ 1`. A survivor needs diagnosing, not reflex-patching.
- **Verify the guard, not just the test** — after adding a safety net (`checkOver`, `levelIndexBy`), prove it actually FAILS on the case it guards (and exits non-zero) before trusting it. A guard that can't fail is worse than none: it looks like coverage. Both were confirmed end-to-end by temporarily breaking a premise and checking the exit code.
- **A test can pass while testing nothing** — three ways this has bitten: (1) `[].every(...)` is `true`, so an assertion over a collection a setup silently failed to build reports green having checked zero items (the Cleave test was one bad arena away from this) — use `checkOver`, which fails on an empty set; (2) mutating `LEVELS` at runtime from a test does NOT reach the engine — the test's module instance and the engine's are separate under tsx, so the override is invisible to `goalConfigFor` and the "test" verifies nothing. Prefer real config + hand-built state over monkey-patching shared content; (3) a bare `LEVELS.findIndex(...)` for a test's premise silently yields -1 when content moves — use `levelIndexBy`, which names the lost premise and exits 1.
