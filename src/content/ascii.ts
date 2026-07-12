import type { Biome } from "@/game/core/types";

// Splash title. Kept within ~60 cols so it fits comfortably.
export const SPLASH_ART = String.raw`
   ______           __                 ____
  / ____/___ ___   / /_  ___  _____   / __ \____ _      ______
 / __/ / __ '__ \ / __ \/ _ \/ ___/  / / / / __ \ | /| / / __ \
/ /___/ / / / / // /_/ /  __/ /     / /_/ / /_/ / |/ |/ / / / /
\____/_/ /_/ /_//_.___/\___/_/      \____/\__,_/|__/|__/_/ /_/

              a  r o g u e l i k e   q u e s t
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
