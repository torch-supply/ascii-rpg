# Ember of Dawn

A single-player, browser-based **ASCII RPG**. The Lich-King Malachar
shattered the Ember of Dawn and buried the realm of Veldrin in cursed dusk. You
wake a captive in his pit — escape, cross the cursed lands, breach Blackhall
Castle, recover the Sunblade, and end Malachar to rekindle the dawn.

Turn-based bump combat, procedurally-generated levels, fog-of-war with managed
torchlight, an inventory and between-level shop, and a dark terminal aesthetic
rendered on a canvas. Runs entirely in the browser — no backend, no accounts.

## Stack

- **Next.js** (App Router) + **TypeScript**, exported as a static client-only site
- **[rot.js](https://github.com/ondras/rot.js)** for the ASCII canvas display, FOV, map generation, pathfinding, and seeded RNG
- **Tailwind v4** for UI chrome; **Zustand** for state
- Pure, framework-free game core (`src/game/core/**`) — React and the canvas are read-only consumers of game state

## Run

```bash
npm install
npm run dev        # dev server at http://localhost:3000
npm run build      # static export to out/

# tests (no framework — plain tsx scripts under scripts/)
npm run test:core  # pure-engine checks: content integrity (every id/color referenced actually exists), mechanics in isolation (determinism, goals, combat, connectivity, status/fire/elites/stealth/ranged/altars/doors/…), turn-resolution behavior and generation placement RULES (quest items on open ground, traps only where a bypass exists, forage/lore in nooks, the flood's dry spine), every run modifier still honoring the generator's guarantees, camera/viewport math, and color legibility (an unreadable glyph is a bug, not taste)
npm run test:play  # autonomous playthroughs: a greedy bot plays every level across 12 seeds — beatability with per-level regression FLOORS (so a level can't quietly collapse), no mid-run invariant breaks, a difficulty table (win-rate / turns / end-HP / gold / how much of the map got seen), a run-level economy check, every CLASS held to the same bar, a full carried run through the whole quest, the run modifiers staying survivable, and whether the FINALE is actually winnable with the kit you'd arrive holding
npm run test:store # store orchestration: drives the Zustand store headlessly — screen/run flow, shop economy, targeting cursor + ability aim, overlays, death/restart, victory, save/resume, that stale or corrupt saves retire gracefully, and that a mid-run save loses nothing on reload
npm run test:all   # all three in sequence

# deeper gates, deliberately NOT in test:all (slower; run before a release or after
# touching the generator / a tuning dial)
npm run test:soak            # every level × 200 seeds of structural guarantees (-- 1000 for a release)
node scripts/mutation-audit.mjs  # breaks real game code on purpose and checks the suites redden

npm run lint       # ESLint (Next core-web-vitals + typescript, flat config)
npm run format     # Prettier --write   (format:check to verify)
# a husky pre-commit hook auto-formats + lint-gates staged files
```

## How to play

- **New Game** lets you pick a **class** — Warrior (tanky melee), Rogue (fragile, stealthy crits), or Pyromancer (bombs & bolts) — each with a distinct starting kit, passives, and a `[q]` **active ability** (Warrior Cleave / Rogue Dash / Pyromancer Scorch, on a cooldown). Then optionally toggle **trials** (see below).
- **Move / attack:** arrow keys or `wasd` — walk into a monster to attack it (bump combat)
- **Ability:** `q` · **Fire bow:** `f` (aim, then `Enter`) · **Close door:** `c` (also dams a rising flood) · **Wait:** `.` or space · **Inventory:** `i` · **Pause:** `p` / `Esc` · **Mute:** `m` · **Help:** `?`
- In the **inventory** (`i`), number keys use/equip an item. Firebombs open a **cursor targeting** mode (aim, `Enter` to throw, `Esc` to cancel). Bump a closed door to open it.
- You have 3 lives; dying costs a life and restarts the level (progress, gear, and coins carry over), and zero lives ends the run. The per-level turn limit is a **par-for-score** target, not a threat — clear a level under par for an end-screen efficiency bonus, but taking your time costs nothing. Only **survive** levels show a countdown (there, holding out _is_ the goal).

The quest runs across 10 levels (dungeon → blackwood → mire → frostspine → the
sections of Blackhall Castle → the Throne of Dusk), with narration scenes and a
merchant's shop between them. Difficulty rises as you go: monsters toughen, the
light dwindles, and the turn par tightens.

### Features

- **Character classes** — Warrior / Rogue / Pyromancer, picked on New Game; each changes your opening kit and tactics via passives (damage reduction, bigger sneak + crit chance, extra firebomb power) and a `[q]` active ability
- **Run modifiers (trials)** — optional seeded challenges toggled at New Game (dimmer light / more monsters / more traps / scarcer supplies / tougher elites / a single life) that reshape the whole run and raise your end-of-run score
- **Varied, hand-tuned levels** — each has a signature to explore: a glowing fungal cavern (the Pit), a ruined woodland hamlet haunted by drifting wisps (Blackwood), a wetland labyrinth of poison-spore fumaroles and a luminous, poisonous fungal grove (Mire), an ice-choked mountain cave network riddled with bottomless crevasses, hiding a sealed den with something asleep in it (Frostspine), a gatehouse of chambers opening onto ash-choked scorched ground where a Gate Warden holds the far gate (Iron Gate), a colonnaded cathedral (Great Hall), a crypt that floods around you as you hunt the Sunblade (the water welling up from the failed sewers beneath it), storm-lashed ramparts, and a processional **statue gallery** where gargoyle "statues" wake as you pass (the Dusk Antechamber) — built from sub-biome regions, custom generators, freestanding structures, hazard terrain, and a set-piece flood
- Five goal types in play (reach a place / collect N / find an item / slay a target / survive N turns against an escalating siege), each chosen to suit its level's size — big maps use goals that pull you across them, rather than ones you can finish in a corner (a sixth, cull N monsters, is supported but currently unused for exactly that reason)
- Hidden spike traps (with an awareness sense; every walkable tile is always reachable without stepping on a trap — a trap is an avoidable risk, never a forced toll), impassable water/chasm terrain, and torch fuel
- **Interactive doors** — bump a closed door to open it, or press `c` to shut one to break line-of-sight and wall off a chaser; most monsters reroute around a closed door, but guards and bosses force it open
- **Forage** — berries & mushrooms tucked in the wilds (and rarer arcane motes in the depths) top up a little HP when you step on them; plentiful outdoors, sparse-to-none in the barren castle and throne
- **Status effects** — poison, bleed, and burn (damage-over-time) plus chill; monsters afflict you, and your firebombs and the Frostbrand weapon afflict them. Cure debuffs with an Antidote.
- **Environmental interplay** — shove enemies into chasms with a knockback weapon (instant kill) — but beware the mirror: a **gargoyle can hurl _you_ off a ledge** into the void (a lost life; telegraphed, so it's a positioning fight, never a surprise). Set oil slicks alight and watch fire race across them; burn through **thorn brambles** that snag and bleed you (fire clears a path); skirt **spore vents** seeping a lingering poison haze; and open cracked-wall shortcuts three ways (an explosion, slamming a monster through, or bashing them down over several turns)
- **Elite champions & stealth** — buffed monsters (brute / swift / volatile-explodes) with better loot; light-gated detection so you can creep through the dark and land bonus **sneak attacks** — and if you're spotted, break line-of-sight (a corner, a shut door, dousing your torch, a blink) and wait: an alerted monster hunts your last-seen spot, then gives up (bosses excepted)
- **Ranged combat & shrines** — an equipped bow with arrows (aim with `f`); risk/reward altars that trade blood or gold for lasting boons
- **Explore for story** — readable **lore fragments** tucked in nooks off the beaten path (prisoners' scratchings, a drowned pilgrim's vow, the Sunblade's rifled tomb, the words at the base of the throne) reward curiosity with the tale of Veldrin's fall — no loot, just story
- **A world that feels alive** — rare, non-hostile **ambient wildlife** drifts through the levels and flees as you near it: will-o'-wisps in the cursed Blackwood (pale lights that lure you off-path and gutter out harmlessly if caught), carrion ravens wheeling over the ramparts, frogs plopping away in the mire, a snow hare bolting across the dead pass — so the world reads as a place, not just a kill-grid
- **Terrain-defying draughts** — rare, costly shop potions that bend a movement rule for a time: **Levitation** (drift over water/chasm, float over traps unsprung), **Emberstep** (walk through fire unscathed), **Rimewalk** (freeze the water you cross into a permanent ice bridge — which enemies can then use too), **Shadowcloak** (nothing spots you unless it's right on top of you), and the **Phial of Blinking** (aim and teleport a few tiles, even past a wall)
- **Atmosphere** — a soft torch-glow that hugs your field of view, per-biome weather (mist in the mire & crypt, snow on the frostspine, embers in the throne, dust in the castle, drifting glow-spores in the caverns, grey ash sifting over the scorched wastes) plus level-wide **rain** in the Blackwood and a full lightning **storm** on the Ramparts, lasting blood & scorch decals, and set-piece lighting that turns with the fight — the throne **breaks into dawn** as Malachar falls, the antechamber **deepens into dusk** as you close on its gatekeeper
- **Audio** (Web Audio, no asset files) — a full set of synthesized SFX (combat, pickups, explosions, arrows, doors, UI, a boss sting) plus a procedural, sparse, ethereal score that **reacts to how you play**:
  - **A place per biome** — each has its own scale, timbre, reverb and ambient bed (wind gusts, drips, ember crackle), its own **instrument** (a plucked harp in the wood, struck bells in the crypt, grand strings in the throne), and a distant wordless **choir** haunting the castle halls
  - **A theme that recurs** — the _Ember of Dawn_ leitmotif, a falling phrase stated on the title screen and woven through every biome, blooming in the throne and resolving into major in the victory fanfare
  - **Adaptive** — swells with a heartbeat pulse as danger rises (a boss in view, low HP, the siege, monsters hunting you), and holds its breath when you're creeping past something that hasn't seen you yet: melody and shimmer thin to bare drone until you're spotted
  - **Set-piece harmony** — the throne warms toward major as Malachar falls; the antechamber cools and darkens as you close on its gatekeeper
  - Short in-key **stings** for story beats (reading lore, taking an altar's bargain, clearing a level), a cozy shop theme, a drifting chord progression, and one-shot death/victory themes; global mute (`m` / HUD button), preference persists
- Monster loot drops, potions (heal, warding, might, firebomb, ruin, seeing, antidote), and a nine-tier shop you can **buy and sell** at — the economy is deliberately lean, so you can't afford everything and each visit is a real "what do I need most?" choice; plus juice: floating damage numbers, blast/projectile FX, a boss health bar, and per-level intro cards

## Project layout

The game is data-driven: the level list in `src/content/levels.ts` is the spine
(add or remove a level there and nowhere else). See
[CLAUDE.md](CLAUDE.md) for the full architecture, the load-bearing invariants
(two RNG streams, client-only canvas, pure core), and where everything lives.
Backlog ideas live in [IDEAS.md](IDEAS.md).

> **Dev tooling** (stripped from the production build): the splash has a level
> picker, `>` in play skips to the next level, and **`/style`** is a visual
> reference showing every tile, biome, glyph, tint and effect on one page with
> live contrast readings — so a color that doesn't read is obvious at a glance
> instead of being discovered eight levels into a playthrough.
