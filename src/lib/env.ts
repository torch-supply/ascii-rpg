/**
 * Dev-only tooling gate (the level picker, `>` level skip, the `/style`
 * gallery). A NODE_ENV compare, so everything behind it is dead-code-eliminated
 * from the production/static build.
 *
 * Its own module rather than living in `gameStore`: `/style` only needs this
 * flag, and importing it from the store dragged the whole store — and through
 * it the entire game engine, since `createStore` runs at module load and can't
 * be tree-shaken — into a production page that just renders "not available".
 */
export const DEV = process.env.NODE_ENV !== "production";
