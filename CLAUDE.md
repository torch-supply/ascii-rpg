<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Ember of Dawn — ASCII roguelike

A single-player, browser-based ASCII roguelike RPG. Next.js (App Router) + TypeScript, **client-only** (no backend; static export to `out/`), rendered with **rot.js** on a canvas, styled with **Tailwind v4**, state in **Zustand**.

## Run
- `npm run dev` — dev server
- `npm run build` — static export
- `npm run test:core` — pure-engine checks (determinism, goals, combat, connectivity, Phase 2 mechanics) via `scripts/verify-core.mts`

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
3. **Pure core.** `src/game/core/**` has no React/Zustand/DOM imports. `resolveTurn` (`src/game/core/actions/index.ts`) mutates a GameState and returns a `TurnResult` (including cosmetic `events` for the animation layer — animations NEVER touch game state).

## Where things live
- `src/content/levels.ts` — **the spine.** Ordered `LevelConfig[]`; add/remove a level HERE ONLY (last element auto-ends the run → victory). The level count appears nowhere else in code.
- `src/content/monsters.ts`, `items.ts` (+ `SHOP_TIERS`), `config.ts`, `ascii.ts` (title/narration/biome art).
- `src/game/core/` — `types.ts`, `state.ts` (beginLevel/FOV/light), `actions/` (turn resolution + monster AI + firebomb), `combat.ts`, `goals.ts`, `inventory.ts` (shared equip/acquire), `map/` (generate/fov/pathfinding).
- `src/game/input/` — `keymap.ts` (keys → `InputCommand` contract) + `KeyboardInput.ts` (the input adapter; swap this + `LoopDriver` for a real-time model). `src/game/loop/LoopDriver.ts` — the turn/real-time seam (interface).
- `src/store/gameStore.ts` — game state, UI `mode`, turn driver (`submitAction`), input routing (`handleCommand`), level transitions, shop, save/resume.
- `src/render/` — `CanvasRenderer.ts` (viewport camera + fog + animation overlay), `Display.ts`, `tiles.ts` (glyphs/colors + biome variants). `src/lib/` — `effectBus.ts` (decoupled cosmetic-effect bus), `hash.ts` (`levelSeed`/`gameplaySeed` derivation), `debounce.ts`.
- `src/save/` — versioned localStorage snapshot (`schema`/`serialize`/`storage`). `src/components/` — `GameRoot`, `GameCanvas`, `hud/`, `screens/` (Splash/Narration/Shop/GameOver/Victory), `overlays/` (Pause/Inventory/Help), `ui/MenuButton`.

## Rendering
Camera-based viewport: the renderer draws a window sized to the host at a fixed cell size (`TARGET_ROWS`) and scrolls to keep the player in view (edge-clamped) — the map may exceed the viewport. Fog-of-war: `visible` (bright) / `explored` (dim memory) / unseen (black). ASCII art (`AsciiArt`) supports flat color, CSS `gradient`, per-row `lineColors`, or per-region inline `{key}` `colors` tokens (tokens are zero-width → alignment safe); parents use `text-center`, so `.ascii` forces `text-align:left` to keep columns.

## Status
**Phase 1 + Phase 2 + much of Phase 3 complete and verified.**
- Phase 1: splash → **10** procedural levels with narration → win/lose; turn-based bump combat; fog-of-war; items/inventory/equip; all goal types; lives/HP/turn-budget; save & resume. Arc: dungeon → blackwood → mire → frostspine → **Blackhall Castle sections** (iron gate → great hall → sunken crypt → ramparts → dusk antechamber) → throne; difficulty rises across the run (turn budget shrinks, monsters toughen, light dwindles).
- Phase 2: between-level shop (5 tiers); firebomb; monster AI variety (zombie slow-chase, wraith armor-pierce, guardChase mini-boss, ranged lich); non-blocking hit/projectile animations; per-biome glyph variants.
- Phase 3 (done): **hidden spike traps** + **impassable water/chasm** terrain (`generate.ts` places them reachability-safely; `TileType` trap/trapSprung/water); **torch fuel** (light is a managed resource; burns out over turns); **cursor firebomb targeting** (a `targeting` UI mode + `throwAt` action + renderer blast overlay); **more content** — marsh biome + The Mire level, spider/imp monsters, mace/scale/lantern items.

**Phase 3 remaining:** in-level shopkeeper NPC (reuse Shop UI via an `onBump` handler); difficulty multiplier; a real-time mode (implement `src/game/loop/LoopDriver.ts` + an animation-gated input model). Saves are versioned via `CONFIG.contentVersion` (bump it when content/shape changes so old saves retire cleanly).

## Workflow notes
- Do NOT auto-commit; the user commits. Verify with `tsc`/`build`/`test:core` and leave changes for the user to review on their own dev server (don't launch `npm run dev`).
