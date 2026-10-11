/**
 * Dev-only tooling gate (the level picker, `>` level skip). A NODE_ENV
 * compare, so everything behind it is dead-code-eliminated from the
 * production/static build.
 *
 * Its own module rather than living in `gameStore`: importing the flag from
 * the store drags the whole store — and through it the entire game engine,
 * since `createStore` runs at module load and can't be tree-shaken — into
 * anything that only needs to know whether this is a dev build.
 */
export const DEV = process.env.NODE_ENV !== "production";
