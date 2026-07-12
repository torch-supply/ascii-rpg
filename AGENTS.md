<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Ember of Dawn — ASCII roguelike

A single-player, browser-based ASCII roguelike RPG. Next.js (App Router) + TypeScript, **client-only** (no backend; static export to `out/`), rendered with **rot.js** on a canvas, styled with **Tailwind v4**, state in **Zustand**.

## Run
- `npm run dev` — dev server
- `npm run build` — static export
- `npm run test:core` — pure-engine checks (determinism, goals, combat) via `scripts/verify-core.mts`

## Architecture — one-directional data flow
```
KeyboardInput → store.handleCommand → store.submitAction (the turn-based LoopDriver)
   → pure core transitions (resolveTurn) → new GameState
       ├→ React HUD/screens (Zustand selectors)
       └→ rot.js CanvasRenderer (store.subscribe)
```
React and the canvas are **read-only consumers** of state. No timing lives in the core — that keeps a future turn-based→real-time swap contained (replace `submitAction`/`LoopDriver`, add tweening; core/renderer/save untouched).

### Load-bearing rules
1. **Two RNG streams** (`src/game/core/rng.ts`). Map geometry is seeded from the GLOBAL `ROT.RNG` via `seedMapGen(levelSeed(master, index))` — a pure function of seed+index. Gameplay uses a separate cloned `Rng` whose state is persisted in the save. Never let them share.
2. **Canvas is client-only.** `src/app/page.tsx` dynamically imports `GameRoot` with `ssr:false`; `ROT.Display` is created in a `useEffect` and appended to a React-owned div. React never reconciles canvas contents.
3. **Pure core.** `src/game/core/**` has no React/Zustand/DOM imports. `resolveTurn` (`src/game/core/actions/index.ts`) mutates a GameState and returns a `TurnResult`.

## Where things live
- `src/content/levels.ts` — **the spine.** Ordered `LevelConfig[]`; add/remove a level HERE ONLY (last element auto-ends the run → victory). The level count appears nowhere else in code.
- `src/content/monsters.ts`, `items.ts` (+ `SHOP_TIERS`), `ascii.ts` (art + narration).
- `src/game/core/` — `types.ts`, `state.ts` (beginLevel/FOV/light), `actions/` (turn resolution), `combat.ts`, `goals.ts`, `map/` (generate/fov/pathfinding).
- `src/store/gameStore.ts` — game state, UI `mode`, turn driver, input routing, level transitions, save/resume.
- `src/render/` — `CanvasRenderer.ts`, `Display.ts`, `tiles.ts`. `src/save/` — versioned localStorage snapshot. `src/components/` — `GameRoot`, `GameCanvas`, `hud/`, `screens/`, `overlays/`.

## Status
**Phase 1 (core loop) complete + verified:** splash → 5 procedural levels with narration → win/lose; turn-based movement + bump-to-attack; fog-of-war; items/inventory/equip; all goal types (reach/collect/find/kill); lives/HP/turn-budget; save & resume.

**Designed-in but not yet built (see plan):** between-level shop (data in `SHOP_TIERS`), potion throwing/firebomb, torch tuning, projectile/hit animations (core already emits `GameEvent` cues → `AnimationQueue`), monster behavior variety (zombie slow / wraith pierce / boss ranged), biome wall-glyph variants. A real-time mode would implement `src/game/loop/LoopDriver.ts`.
