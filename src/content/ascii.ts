import type { Biome } from "@/game/core/types";

// ── Gradients (multi-stop; clipped onto the gradient-caps titles + wordmark) ──
// Two halves of one ember gradient — EMBER (top) flows into DAWN (bottom).
export const G_EMBER =
  "linear-gradient(180deg,#fff2b0 0%,#ffd24d 45%,#ff9d3c 100%)";
export const G_DAWN_TITLE =
  "linear-gradient(180deg,#ff9d3c 0%,#ff5a3c 55%,#c0392b 100%)";
export const G_PIT =
  "linear-gradient(180deg,#ffe14d 0%,#e0913c 42%,#8a7a5a 72%,#565663 100%)";
export const G_FOREST =
  "linear-gradient(180deg,#c8f39a 0%,#6fcf4f 38%,#2f9e44 68%,#184a24 100%)";
export const G_MARSH =
  "linear-gradient(180deg,#a7c26a 0%,#5f7a3c 38%,#3c5a4a 70%,#284a58 100%)";
export const G_MOUNTAIN =
  "linear-gradient(180deg,#eef8ff 0%,#a9e0ff 42%,#6f9bd1 74%,#37506f 100%)";
export const G_CASTLE =
  "linear-gradient(180deg,#ecc4ff 0%,#c04cff 42%,#7a5cff 74%,#38284f 100%)";
export const G_CRYPT =
  "linear-gradient(180deg,#dfe6d0 0%,#9fb08a 34%,#6a7a6a 66%,#3a4048 100%)";
export const G_THRONE =
  "linear-gradient(180deg,#fff0a0 0%,#ffd24d 28%,#ff8c00 58%,#c04cff 100%)";
export const G_DAWN =
  "linear-gradient(180deg,#fffbe6 0%,#ffe14d 34%,#ff9d3c 68%,#ff5a3c 100%)";
export const G_DEATH =
  "linear-gradient(180deg,#9aa1a9 0%,#7a4b4b 52%,#2a1414 100%)";

export const SUBTITLE = "AN ASCII RPG";

// Biome → chapter-title gradient (paints the narration title). The throne now
// gets its own royal gradient too, since it's a gradient title, not a drawing.
export const BIOME_GRADIENT: Record<Biome, string> = {
  dungeon: G_PIT,
  forest: G_FOREST,
  marsh: G_MARSH,
  mountain: G_MOUNTAIN,
  crypt: G_CRYPT,
  castle: G_CASTLE,
  throne: G_THRONE,
  // cavern only ever appears as a sub-region, never a whole-level biome, so this
  // title gradient is unused in practice — present to satisfy the exhaustive map.
  cavern: "linear-gradient(180deg,#bff5ec 0%,#4fd8c0 45%,#1f6b60 100%)",
  // ashen is likewise sub-region-only (unused title gradient) — grey ash → ember → char
  ashen: "linear-gradient(180deg,#d8ccc0 0%,#b0703c 48%,#3a2e28 100%)",
  // grove + undercity are sub-region-only too (unused; present for exhaustiveness)
  grove: "linear-gradient(180deg,#e2f79a 0%,#8fbe5a 45%,#3a2b48 100%)",
  undercity: "linear-gradient(180deg,#bfe6d2 0%,#4f8f76 45%,#16211d 100%)",
  graveyard:
    "linear-gradient(180deg,#d6dae4 0%,#8b93a6 42%,#3f4654 74%,#20242c 100%)",
  sanctum:
    "linear-gradient(180deg,#dff0e2 0%,#7fae9a 40%,#3d6058 72%,#1b2a28 100%)",
};

// ── Narrative set-pieces ────────────────────────────────────────────────────
export const OPENING = {
  title: "The Pit",
  body: `Cold iron. Wet stone. The last thing you remember is the Ember of Dawn breaking, and the sky going out.

You are in Malachar's pit — and something down here is already awake.

Find the way up. Move.`,
  gradient: BIOME_GRADIENT.dungeon,
};

export const VICTORY = {
  title: "Dawn",
  body: `Malachar's crown cracks. The dark that poured from him pulls back like a held breath released, and the Ember of Dawn re-forms in the air, whole and blazing.

Light spills down the throne stairs, across the castle, over the pass and the wood, into the pit you crawled out of. The realm of Veldrin wakes to its first true dawn in a hundred years.

You lower the Sunblade, and for the first time it is warm because of the sun — not because of you.

THE END.`,
  gradient: G_DAWN,
};

export const GAMEOVER = {
  title: "Darkness",
  body: `The dark takes you, as it took the realm. Somewhere, an Ember stays broken.

GAME OVER.`,
  gradient: G_DEATH,
};
