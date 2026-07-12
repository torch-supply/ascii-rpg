import type { Biome } from "@/game/core/types";

// Splash title — figlet "Standard" font (stroke-based, so it stays connected
// and perfectly column-aligned in any monospace font). "EMBER" over "DAWN",
// DAWN centered beneath, with a small "of" between.
export const SPLASH_ART = String.raw`
 _____ __  __ ____  _____ ____
| ____|  \/  | __ )| ____|  _ \
|  _| | |\/| |  _ \|  _| | |_) |
| |___| |  | | |_) | |___|  _ <
|_____|_|  |_|____/|_____|_| \_\
   of
 ____    ___        ___   _
|  _ \  / \ \      / / \ | |
| | | |/ _ \ \ /\ / /|  \| |
| |_| / ___ \ V  V / | |\  |
|____/_/   \_\_/\_/  |_| \_|
`;

// A little adventurer beneath the title.
export const SPLASH_HERO = String.raw`
                    ___
                   /   \\
                   | @ |
                   \\___/
                  --|@|--      the pit is dark,
                    | |        and something is
                   _/ \\_       already awake...
`;

export const OPENING_NARRATION = {
  title: "The Pit",
  body: `Cold iron. Wet stone. The last thing you remember is the Ember of Dawn breaking, and the sky going out.

You are in Malachar's pit — and something down here is already awake.

Find the way up. Move.`,
};

export const VICTORY_NARRATION = {
  title: "Dawn",
  body: `Malachar's crown cracks. The dark that poured from him pulls back like a held breath released, and the Ember of Dawn re-forms in the air, whole and blazing.

Light spills down the throne stairs, across the castle, over the pass and the wood, into the pit you crawled out of. The realm of Veldrin wakes to its first true dawn in a hundred years.

You lower the Sunblade, and for the first time it is warm because of the sun — not because of you.

THE END.`,
};

export const GAMEOVER_NARRATION = {
  title: "Darkness",
  body: `The dark takes you, as it took the realm. Somewhere, an Ember stays broken.

GAME OVER.`,
};

// Small biome scenes shown on narration/transition screens.
export const BIOME_ART: Record<Biome, string> = {
  dungeon: String.raw`
    |###|###|###|###|
    |   |   |   |   |
    | . | . | @ | . |
    |___|___|___|___|
       the deep cells`,
  forest: String.raw`
       &   &&   &   &&&
      &&& &&&&  &&&  &&&
     \|/  \|/   \|/  \|/
      |    |     |    |
     the whispering Blackwood`,
  mountain: String.raw`
        /\      /\  /\
       /  \  /\/  \/  \
      / /\ \/        /\ \
     /_/  \__________/  \_\
        the Frostspine Pass`,
  castle: String.raw`
     |^|   |^^^|   |^|
     | |###|   |###| |
     | | . | + | . | |
     |_|___|___|___|_|
        Blackhall Castle`,
  throne: String.raw`
          .-="""=-.
         /  _   _  \
        |  (o) (o)  |    M
         \    ^    /   __|__
          '-.___.-'   the Throne of Dusk`,
};
