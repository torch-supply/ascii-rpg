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
npm run test:core  # pure-engine checks (determinism, goals, combat, connectivity, mechanics)
```

## How to play

- **Move / attack:** arrow keys, `hjkl`, or `wasd` — walk into a monster to attack it (bump combat)
- **Fire bow:** `f` (aim, then `Enter`)  ·  **Wait:** `.` or space  ·  **Inventory:** `i`  ·  **Pause:** `p` / `Esc`  ·  **Help:** `?`
- Number keys use/equip a bag item; firebombs open a **cursor targeting** mode (aim, `Enter` to throw, `Esc` to cancel)
- You have 3 lives and a per-level **turn budget** — running out of either costs a life and restarts the level. Progress, gear, and coins carry over. Zero lives ends the run.

The quest runs across 10 levels (dungeon → blackwood → mire → frostspine → the
sections of Blackhall Castle → the Throne of Dusk), with narration scenes and a
merchant's shop between them. Difficulty rises as you go: the turn budget
shrinks, monsters toughen, and the light dwindles.

### Features

- Six goal types (reach / collect / find / kill-boss / cull N monsters / survive N turns)
- Hidden spike traps (with an awareness sense and a guaranteed trap-free route to every objective), impassable water/chasm terrain, and torch fuel
- **Status effects** — poison, bleed, and burn (damage-over-time) plus chill; monsters afflict you, and your firebombs and the Frostbrand weapon afflict them. Cure debuffs with an Antidote.
- **Environmental interplay** — shove enemies into chasms with a knockback weapon (instant kill), set oil slicks alight and watch the fire spread, and blast open cracked walls for new shortcuts
- **Elite champions & stealth** — buffed monsters (brute / swift / volatile-explodes) with better loot; light-gated detection so you can creep through the dark and land bonus **sneak attacks**
- **Ranged combat & shrines** — an equipped bow with arrows (aim with `f`); risk/reward altars that trade blood or gold for lasting boons
- Monster loot drops, potions (heal, warding, might, firebomb, ruin, seeing, antidote), a five-tier shop, and juice: floating damage numbers, blast/projectile FX, a boss health bar, and per-level intro cards

## Project layout

The game is data-driven: the level list in `src/content/levels.ts` is the spine
(add or remove a level there and nowhere else). See
[CLAUDE.md](CLAUDE.md) for the full architecture, the load-bearing invariants
(two RNG streams, client-only canvas, pure core), and where everything lives.
Backlog ideas live in [IDEAS.md](IDEAS.md).

> **Dev tooling** (stripped from the production build): the splash has a level
> picker, and `>` in play skips to the next level.
