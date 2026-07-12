import type { Biome } from "@/game/core/types";

export interface Scene {
  art: string;
  gradient: string;
}

// ── Gradients (multi-stop; painted over aligned monospace art via AsciiArt) ──
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
export const G_THRONE =
  "linear-gradient(180deg,#fff0a0 0%,#ffd24d 28%,#ff8c00 58%,#c04cff 100%)";
export const G_DAWN =
  "linear-gradient(180deg,#fffbe6 0%,#ffe14d 34%,#ff9d3c 68%,#ff5a3c 100%)";
export const G_DEATH =
  "linear-gradient(180deg,#9aa1a9 0%,#7a4b4b 52%,#2a1414 100%)";

// ── Title (figlet "Standard") — EMBER and DAWN as separate blocks so each can
// be centered independently while its own columns stay left-aligned. ──────────
export const EMBER_ART = String.raw`
 _____ __  __ ____  _____ ____
| ____|  \/  | __ )| ____|  _ \
|  _| | |\/| |  _ \|  _| | |_) |
| |___| |  | | |_) | |___|  _ <
|_____|_|  |_|____/|_____|_| \_\
`;
export const DAWN_ART = String.raw`
 ____    ___        ___   _
|  _ \  / \ \      / / \ | |
| | | |/ _ \ \ /\ / /|  \| |
| |_| / ___ \ V  V / | |\  |
|____/_/   \_\_/\_/  |_| \_|
`;
export const SUBTITLE = "A ROGUELIKE QUEST";

// ── Scene art (block-element + box-drawing glyphs — all single-width) ────────
const PIT = String.raw`
       \    .   |   .    /
    ‒‒‒╤════╤════╤════╤‒‒‒
       ║    ║    ║    ║
   ┌─────────────────────┐
   │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
   │▓                   ▓│
   │▓                   ▓│
   │▓         @         ▓│
   │▓                   ▓│
   │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
   └─────────────────────┘`;

const FOREST = String.raw`
       ▲        ▲▲         ▲
      ▲▲▲      ▲▲▲▲       ▲▲▲      ▲
     ▲▲▲▲▲    ▲▲▲▲▲▲     ▲▲▲▲▲    ▲▲▲
    ▲▲▲▲▲▲▲  ▲▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  ▲▲▲▲▲
       ┃         ┃          ┃        ┃
       ┃         ┃          ┃        ┃
  ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,`;

const MARSH = String.raw`
    \|/    \\|//    \|/     \|/
   \\|//    \|/    \\|//   \|/
  ≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈
  ~~~~~≈≈≈~~~~~≈≈~~~~~≈≈≈~~~~≈≈~
  ≈≈~~~~~≈≈≈~~~~~≈≈~~~~~≈≈≈~~~~~
  ~~~~≈≈~~~~~≈≈≈~~~~~≈≈~~~~~≈≈≈~`;

const MOUNTAIN = String.raw`
             /\
            /  \         /\
           /    \       /  \        /\
          / /\   \     / /\ \      /  \
         / /  \   \   / /  \ \    / /\ \
        /_/    \___\ /_/    \_\  /_/  \_\
       /            V            V       \
      ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`;

const CASTLE = String.raw`
    ▟█▙     ▟█▙    ▟█▙    ▟█▙
    ███     ███    ███    ███
    ███▄▄▄▄▄███▄▄▄▄███▄▄▄▄███▄▄▄▄▄
    ██████████████████████████████
    ████▛▜████▛▜██████▛▜████▛▜████
    ██████████████▐▌██████████████
    █████████████▐██▌█████████████
    ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀`;

const THRONE = String.raw`
            \      |      /
         \      \   |   /      /
        ▲      ▲    ▲    ▲      ▲
      ██████████████████████████
      ██████████████████████████
      ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
              ┌─────┐
              │  M  │
              └─────┘`;

const DAWN = String.raw`
              \     |     /
          \      \  |  /      /
        ‾‾‾‾‾  .:*░#░*:.  ‾‾‾‾‾
      ‒‒‒‒  .:*░#######░*:.  ‒‒‒‒
            *#############*
      ____  ':*░#######░*:'  ____
         \    ':*░#░*:'    /
        /      /  |  \      \
`;

const SKULL = String.raw`
         ,----------------,
        /    __________     \
       |    /          \     |
       |   |  ▄▄    ▄▄  |    |
       |   |  ██    ██  |    |
       |   |     ▂▂     |    |
       |    \   ▀▀▀▀   /     |
        \    |¦¦¦¦¦¦¦¦|     /
         '--'          '---'`;

export const BIOME_SCENE: Record<Biome, Scene> = {
  dungeon: { art: PIT, gradient: G_PIT },
  forest: { art: FOREST, gradient: G_FOREST },
  marsh: { art: MARSH, gradient: G_MARSH },
  mountain: { art: MOUNTAIN, gradient: G_MOUNTAIN },
  castle: { art: CASTLE, gradient: G_CASTLE },
  throne: { art: THRONE, gradient: G_THRONE },
};

// ── Narrative set-pieces ────────────────────────────────────────────────────
export const OPENING = {
  title: "The Pit",
  body: `Cold iron. Wet stone. The last thing you remember is the Ember of Dawn breaking, and the sky going out.

You are in Malachar's pit — and something down here is already awake.

Find the way up. Move.`,
  scene: BIOME_SCENE.dungeon,
};

export const VICTORY = {
  title: "Dawn",
  body: `Malachar's crown cracks. The dark that poured from him pulls back like a held breath released, and the Ember of Dawn re-forms in the air, whole and blazing.

Light spills down the throne stairs, across the castle, over the pass and the wood, into the pit you crawled out of. The realm of Veldrin wakes to its first true dawn in a hundred years.

You lower the Sunblade, and for the first time it is warm because of the sun — not because of you.

THE END.`,
  scene: { art: DAWN, gradient: G_DAWN } as Scene,
};

export const GAMEOVER = {
  title: "Darkness",
  body: `The dark takes you, as it took the realm. Somewhere, an Ember stays broken.

GAME OVER.`,
  scene: { art: SKULL, gradient: G_DEATH } as Scene,
};
