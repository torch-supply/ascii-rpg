<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Ember of Dawn — ASCII RPG

A single-player, browser-based ASCII RPG. Next.js (App Router) + TypeScript, **client-only** (no backend; static export to `out/`), rendered with **rot.js** on a canvas, styled with **Tailwind v4**, state in **Zustand**.

## Run

- `npm run test:core` — pure-engine checks: one hand-built scenario per mechanic (`scripts/verify-core.mts`).
- `npm run test:play` — autonomous-playthrough / balance harness: a greedy bot plays every level across many seeds with the real class kit (`scripts/verify-playthrough.mts`).
- `npm run test:store` — store-level orchestration harness: run/screen flow, shop, death/restart, save/resume at every phase (`scripts/verify-store.mts`).
- `npm run test:soak` — generation soak: the structural guarantees across every level × 200 seeds (`-- 1000` before a release). **Not** in `test:all` — run it before a release or after touching the generator (`scripts/verify-soak.mts`).
- `npm run test:all` — runs all three fast suites in sequence (core + play + store; soak is separate).
- `npm run typecheck` — `tsc --noEmit`. The test suites run under `tsx`, which strips types without checking them, so this (or `next build`) is the only type gate. The pre-commit hook runs it FIRST, over the whole project, and a type error blocks the commit.
- `npm run lint` / `lint:fix` — ESLint (flat config `eslint.config.mjs`: `eslint-config-next` core-web-vitals + typescript, with `eslint-config-prettier` last; React-hooks rules off for the pure `src/game/**` + `scripts/**`). `npm run format` / `format:check` — Prettier (`.prettierrc`, double quotes). A **husky pre-commit hook** (`.husky/pre-commit`) runs `npm run typecheck` (whole project), then `lint-staged`: Prettier `--write` **then** ESLint (no `--fix`, so a lint error fails the commit) on staged files.
- What each suite checks, per-check rationale, mutation-audit findings, and the traps to avoid when writing or debugging these suites: `scripts/CLAUDE.md` (loads automatically when working under `scripts/`).

**Dev tooling** (gated on `DEV` from `src/lib/env.ts`, so it's absent from the static build): the splash has a level picker (`store.debugJumpTo`), `>` in play skips a level (`debugSkipLevel`), and **`/style`** (`app/style/page.tsx` → `screens/StyleGallery.tsx`) is the dev-only visual reference — the place to sanity-check anything visual. How the gallery works and what it must cover: `src/components/CLAUDE.md`.

## Architecture — one-directional data flow

```
KeyboardInput → store.handleCommand → store.submitAction (the turn-based LoopDriver)
   → pure core transitions (resolveTurn) → new GameState
       ├→ React HUD/screens (Zustand selectors)
       └→ rot.js CanvasRenderer (store.subscribe)  +  cosmetic effects via effectBus
```

React and the canvas are **read-only consumers** of state. No timing lives in the core — that keeps a future turn-based→real-time swap contained (replace `submitAction`/`LoopDriver`, add tweening; core/renderer/save untouched).

### Load-bearing rules

1. **Two RNG streams** (`src/game/core/rng.ts`). Map geometry is seeded from the GLOBAL `ROT.RNG` via `seedMapGen(levelSeed(master, index))` — a pure function of seed+index. Gameplay uses a separate cloned `Rng` whose state is persisted in the save. Never let them share.
2. **Canvas is client-only.** `src/app/page.tsx` dynamically imports `GameRoot` with `ssr:false`; `ROT.Display` is created in a `useEffect` and appended to a React-owned div. React never reconciles canvas contents.
3. **Pure core.** `src/game/core/**` has no React/Zustand/DOM imports.
4. **Light is CORE, not render** (`src/game/core/light.ts`). Sight is line-of-sight to `CONFIG.sightRange` filtered by what is actually LIT above `CONFIG.sightLightMin`, plus `SKYLIGHT` under an open sky and `CONFIG.unlitSight` in the pitch dark — and `recomputeFOV` computes exactly that, so **`state.visible` IS the light-gated set**.
   - The history — why light moved out of the renderer, flicker vs. visibility, world vs. carried light, skylight, atmosphere — lives in `src/game/core/CLAUDE.md`. **Check any new light against the table in `light.ts` and against `sightLightMin` before trusting it.**

`resolveTurn` (`src/game/core/actions/index.ts`) mutates a GameState and returns a `TurnResult` (including cosmetic `events` for the animation layer — animations NEVER touch game state).

## Where things live

- `src/content/levels.ts` — **the spine.** Ordered `LevelConfig[]`; add/remove a level HERE ONLY (last element auto-ends the run → victory). The level count appears nowhere else in code.
- `src/content/monsters.ts`, `items.ts` (+ `SHOP_TIERS`), `config.ts`, `ascii.ts` (title/narration/biome art), `classes.ts` (character classes — starting kit + passives + `[q]` active ability; `CLASS_LIST` is the picker, `classDef(id)` the lookup, `"wanderer"` the neutral no-class baseline for tests/dev/legacy saves), `mutators.ts` (run modifiers — see `src/content/CLAUDE.md`), `lore.ts` (environmental-storytelling fragments — `LORE_POOLS` keyed by biome; `loreForBiome(biome)`).
- `src/game/core/` — `types.ts`, `state.ts` (beginLevel/FOV/light), `light.ts` (**the sight model** — rule 4 above), `actions/` (turn resolution + monster AI + firebomb + status/fire ticks), `combat.ts`, `status.ts` (status-effect behavior table), `goals.ts`, `inventory.ts` (shared equip/acquire — **one weapon, one suit**), `hotbar.ts` (stable bag-slot allocation — see `src/components/CLAUDE.md`), `map/` (generate/fov/pathfinding — `generate.ts` also carves **sub-biome regions** + **secret vaults**). Mechanics notes: `src/game/core/CLAUDE.md` and `src/game/core/map/CLAUDE.md`.
- `src/game/input/` — `keymap.ts` (keys → `InputCommand` contract; ignores Cmd/Ctrl/Alt chords so browser shortcuts never act in-game, and `repeatsWhenHeld` lets only turn actions auto-repeat — a held bag key used to drink potion after potion, or BUY repeatedly in the shop) + `KeyboardInput.ts` (the input adapter; swap this + `LoopDriver` for a real-time model). Both rules are pinned in `[S19]`. `src/game/loop/LoopDriver.ts` — the turn/real-time seam (interface).
- `src/store/gameStore.ts` — game state, UI `mode`, turn driver (`submitAction`), input routing (`handleCommand`), level transitions, shop, save/resume.
- `src/render/` — `CanvasRenderer.ts` (viewport camera + fog + animation overlay), `Display.ts`, `tiles.ts` (glyphs/colours, biome variants, and the colour math: `mix`/`dim`, `colorDistance`, `luminance`, `contrastRatio`). **Glyphs must stay unique across meanings** — a hazard and a boon sharing one is a bug; the history and how test `[69]` enforces it are in `src/render/CLAUDE.md`.
- `src/lib/` — `effectBus.ts` (decoupled cosmetic-effect bus), `sound.ts` (synthesized SFX) + `music.ts` (procedural adaptive score) — see `src/lib/CLAUDE.md` — `env.ts` (`DEV`), `hash.ts` (`levelSeed`/`gameplaySeed` derivation), `debounce.ts`.
- `src/save/` — versioned localStorage snapshot (`schema`/`serialize`/`storage`). The save records the run **phase** (`playing` / `cleared` / `shop` + `shopPurchases`), derived inside `persist()` from the UI mode so no call site can save the wrong one; `resumeGame` reopens that phase. A death with lives left saves the RESTARTED level. `migrate()` chains versions (v1 → v2 is the first real one).
- `src/components/` — `GameRoot`, `GameCanvas`, the HUD, screens and overlays; internals in `src/components/CLAUDE.md`.

## Rendering

Renderer internals — camera, lighting, set-piece lighting beats, cosmetic FX, the overlay canvas and decals — live in `src/render/CLAUDE.md`. HUD chrome, the bag panel & hotbar slots, the death freeze-frame and ASCII art live in `src/components/CLAUDE.md`. Both load automatically when working in those directories.

**Width is the design trade-off, and it is the one number to re-check by eye.** Cell size derives from HEIGHT (`ch / TARGET_ROWS`), so the rails cost map COLUMNS at unchanged glyph size. Chrome went from 224px (the old single panel) to 518px — about 13 columns at a typical cell, ~51 → 36 at a 1360px window. That is fine on most levels and worst on the **Ramparts**, an 84-tile linear wall-walk where sightline along the wall is the whole tactical read. `LOG_RAIL_WIDTH` and `CHAR_PANEL_WIDTH` are the dials; the rail is the one to shrink first. Vertically it comes out slightly ahead — the footer shrinking more than pays for the new gutter.

## Game systems — where the detail lives

The design notes for each system — the rationale, the measured tuning, and the bug each rule exists to prevent — live beside the code they govern and load when you work there:

- **`src/game/core/CLAUDE.md`** — light is core (the history), terrain & hazards (water/chasm, oil, bramble, spore vents, cracked walls, doors, forage, knockback, skylight, torch fuel), inventory (one weapon, one suit), status effects / combat / AI (resistance, elites, stealth, ranged), classes & abilities, the boss fight.
- **`src/game/core/map/CLAUDE.md`** — the **generation guarantees** (traps always avoidable, every wing connects, no dead pockets), sub-biome regions & wings (organic wings, `noStart`/`goalHere` and the journey distances, adding a biome), secret vaults, freestanding structures, the flooding set-piece.
- **`src/content/CLAUDE.md`** — loop, goals & pacing (siege tuning), economy & shop lessons (tune the GLOBAL dials), POIs & lore (advice must not lie), run modifiers (generation-time fields only), per-level signature beats.
- **`src/lib/CLAUDE.md`**, `src/render/CLAUDE.md`, `src/components/CLAUDE.md`, `scripts/CLAUDE.md` — audio, renderer, HUD & `/style`, and test-suite rationale.

## Not built yet

In-level shopkeeper NPC (reuse the Shop UI via an `onBump` handler); difficulty multiplier; a real-time mode (implement `src/game/loop/LoopDriver.ts` + an animation-gated input model).

## Workflow notes

- Do NOT auto-commit; the user commits. Verify with `tsc`/`build`/`test:core` + `npm run lint` and leave changes for the user to review on their own dev server (don't launch `npm run dev`). A pre-commit hook type-checks the project, then auto-formats (Prettier) and lint-gates staged files; any failure blocks the commit.
- **Page metadata & social images** live in `src/app/`: `layout.tsx` (title template, description, OpenGraph/Twitter, `viewport` for theme-colour) plus three generated images — `icon.tsx` (32px favicon), `apple-icon.tsx` (180px), `opengraph-image.tsx` (1200×630) — built with `ImageResponse` from `next/og`, so there are no binary image assets in the repo. Three things are load-bearing: each image route **must** `export const dynamic = "force-static"` or `next build` fails under `output: "export"` (metadata images compile to Route Handlers, and a static export has no server); the OG card is built from real game data (`LEVELS.length`, `SUBTITLE`, `tiles.ts` colours, `hud/palette.ts`) so it can't drift from the game; and Satori is **flexbox-only** and needs an explicit `display: flex` on any element with more than one child. Because only a proportional font is bundled (`Geist-Regular.ttf`), the glyph strip gets its monospace alignment from FIXED-WIDTH CELLS rather than the typeface — the same trick the game's renderer uses, and it avoids spending the 500KB `ImageResponse` budget on a font binary.
- **Set `NEXT_PUBLIC_SITE_URL` for production builds.** `metadataBase` needs an absolute origin and a static export can't know its own host; the fallback is `http://localhost:3000` on purpose, so a missing value shows up the first time someone pastes a link rather than silently pointing the OG tags at a domain we don't own.
- Bump `CONFIG.contentVersion` on any content/shape change so old saves retire cleanly (currently `"64"`).
