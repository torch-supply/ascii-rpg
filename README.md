# Ember of Dawn

A single-player, browser-based **ASCII roguelike RPG**. The Lich-King Malachar
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
npm run test:core  # pure-engine checks: mechanics in isolation (determinism, goals, combat, connectivity, status/fire/elites/stealth/ranged/altars/doors/…)
npm run test:play  # autonomous playthroughs: a greedy bot plays every level across many seeds — beatability, no mid-run invariant breaks, plus a per-level difficulty table
npm run test:store # store orchestration: drives the Zustand store headlessly — screen/run flow, shop economy, death/restart, victory, save/resume
npm run test:all   # all three in sequence
```

## How to play

- **New Game** lets you pick a **class** — Warrior (tanky melee), Rogue (fragile, stealthy crits), or Pyromancer (bombs & bolts) — each with a distinct starting kit and passives
- **Move / attack:** arrow keys or `wasd` — walk into a monster to attack it (bump combat)
- **Fire bow:** `f` (aim, then `Enter`)  ·  **Close door:** `c`  ·  **Wait:** `.` or space  ·  **Inventory:** `i`  ·  **Pause:** `p` / `Esc`  ·  **Mute:** `m`  ·  **Help:** `?`
- In the **inventory** (`i`), number keys use/equip an item. Firebombs open a **cursor targeting** mode (aim, `Enter` to throw, `Esc` to cancel). Bump a closed door to open it.
- You have 3 lives; dying costs a life and restarts the level (progress, gear, and coins carry over), and zero lives ends the run. Each level has a **turn budget** — run it out and you don't die, but the level turns hostile: reinforcements close in until you finish the goal or fall.

The quest runs across 10 levels (dungeon → blackwood → mire → frostspine → the
sections of Blackhall Castle → the Throne of Dusk), with narration scenes and a
merchant's shop between them. Difficulty rises as you go: the turn budget
shrinks, monsters toughen, and the light dwindles.

### Features

- **Character classes** — Warrior / Rogue / Pyromancer, picked on New Game; each changes your opening kit and tactics via passives (damage reduction, bigger sneak + crit chance, extra firebomb power)
- Six goal types (reach / collect / find / kill-boss / cull N monsters / survive N turns)
- Hidden spike traps (with an awareness sense; every walkable tile is always reachable without stepping on a trap — a trap is an avoidable risk, never a forced toll), impassable water/chasm terrain, and torch fuel
- **Interactive doors** — bump a closed door to open it, or press `c` to shut one to break line-of-sight and wall off a chaser; most monsters reroute around a closed door, but guards and bosses force it open
- **Forage** — berries & mushrooms tucked in the wilds (and rarer arcane motes in the depths) top up a little HP when you step on them; plentiful outdoors, sparse-to-none in the barren castle and throne
- **Status effects** — poison, bleed, and burn (damage-over-time) plus chill; monsters afflict you, and your firebombs and the Frostbrand weapon afflict them. Cure debuffs with an Antidote.
- **Environmental interplay** — shove enemies into chasms with a knockback weapon (instant kill), set oil slicks alight and watch the fire spread, and open cracked-wall shortcuts three ways (an explosion, slamming a monster through, or bashing it down over several turns)
- **Elite champions & stealth** — buffed monsters (brute / swift / volatile-explodes) with better loot; light-gated detection so you can creep through the dark and land bonus **sneak attacks** — and if you're spotted, break line-of-sight (a corner, a shut door, dousing your torch, a blink) and wait: an alerted monster hunts your last-seen spot, then gives up (bosses excepted)
- **Ranged combat & shrines** — an equipped bow with arrows (aim with `f`); risk/reward altars that trade blood or gold for lasting boons
- **Terrain-defying draughts** — rare, costly shop potions that bend a movement rule for a time: **Levitation** (drift over water/chasm, float over traps unsprung), **Emberstep** (walk through fire unscathed), **Rimewalk** (freeze the water you cross into a permanent ice bridge — which enemies can then use too), **Shadowcloak** (nothing spots you unless it's right on top of you), and the **Phial of Blinking** (aim and teleport a few tiles, even past a wall)
- **Atmosphere** — a soft torch-glow that hugs your field of view, per-biome weather (mist in the mire & crypt, snow on the frostspine, embers in the throne, dust in the castle), and lasting blood & scorch decals
- **Audio** (Web Audio, no asset files) — a full set of synthesized SFX (combat, pickups, explosions, arrows, doors, UI, a boss sting) plus procedural, ethereal background music: a per-biome + shop bed and a title theme, all with **adaptive intensity** (swells and adds a heartbeat pulse as danger rises — a boss in view, low HP, the survive siege) and a slowly **drifting chord progression**, with one-shot death and victory themes; global mute (`m` / HUD button), preference persists
- Monster loot drops, potions (heal, warding, might, firebomb, ruin, seeing, antidote), a five-tier shop you can **buy and sell** at, and juice: floating damage numbers, blast/projectile FX, a boss health bar, and per-level intro cards

## Project layout

The game is data-driven: the level list in `src/content/levels.ts` is the spine
(add or remove a level there and nowhere else). See
[CLAUDE.md](CLAUDE.md) for the full architecture, the load-bearing invariants
(two RNG streams, client-only canvas, pure core), and where everything lives.
Backlog ideas live in [IDEAS.md](IDEAS.md).

> **Dev tooling** (stripped from the production build): the splash has a level
> picker, and `>` in play skips to the next level.
