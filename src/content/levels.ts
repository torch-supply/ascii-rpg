import type { LevelConfig } from "@/game/core/types";

// ─────────────────────────────────────────────────────────────────────────
// THE LEVEL SPINE. Everything about the game's flow is driven by this ordered
// array. To add/remove a level, edit ONLY this file — the number of levels
// appears nowhere else in engine code. The last element automatically ends the
// run (victory), because the loop checks `currentLevel < LEVELS.length`.
//
// Arc: escape the pit → cross the cursed wild (wood, mire, pass) → fight through
// Blackhall Castle (gate → halls → crypt → ramparts → antechamber) → the Throne.
// Difficulty rises across the run: turn budget shrinks, monsters grow tougher
// and more numerous, light dwindles, coins richen to fund the climb.
// ─────────────────────────────────────────────────────────────────────────
export const LEVELS: LevelConfig[] = [
  {
    id: "dungeon_depths",
    title: "The Pit",
    biome: "dungeon",
    palette: { wall: "#6b6b7c", floor: "#3b3b46", accent: "#ffe14d" },
    // a bioluminescent grotto breaks out of the dug cellblock — a near-dark
    // cavern lit by its own glowing fungi (navigate toward the teal glow)
    subBiomes: [
      {
        biome: "cavern",
        // readable warm cave rock (the walls you can SEE are the walls that
        // block) — the teal glow comes from the fungi's own light, not the tiles
        palette: { wall: "#5c5048", floor: "#241f1b", accent: "#79f2dc" },
        layout: "cellular",
        size: 0.46, // a larger natural cave now the Pit is bigger
        // SEVERAL glowing fungal hollows scattered through the cave — distinct
        // pockets of light to find, not the whole wing lit up
        hazards: [{ type: "glowcap", density: 0.1, clumps: 3 }],
      },
    ],
    // a neighboring cell — a shut door to open, a little relief inside
    secretVault: {
      gate: "door",
      loot: [{ itemId: "p_heal" }, { itemId: "c_gold" }],
    },
    // A deliberately larger opening level — room to explore the cave and its
    // glowing hollows. Density scaled to match (not a bigger grind); par raised
    // to suit (the turn limit is a score target now, so a roomy par is fine).
    mapWidth: 56,
    mapHeight: 34,
    generator: "digger",
    monsterBudget: 9,
    spawnTable: [
      { monsterId: "rat", weight: 6 },
      { monsterId: "bat", weight: 4 },
    ],
    turnLimit: 540,
    itemDropCount: 6,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 3 },
      { itemId: "w_short", weight: 2 },
      { itemId: "i_torch", weight: 1 },
    ],
    coinRichness: 1.15,
    baseLightRadius: 8,
    trapCount: 4,
    doorCount: 3,
    forageCount: 5,
    loreCount: 2, // prisoners' scratchings in the pit
    goal: { type: "reachLocation" },
    narration:
      "You haul yourself out of the pit into cold night air. No stars — only a black wall of trees ahead, whispering, the sagging roofs of a hamlet the wood has all but swallowed, and pale lights drifting between the trunks that nobody lit. The Blackwood. Somewhere past its ruins lies the path the dead don't want you to find.",
    shopTier: 1,
  },
  {
    id: "blackwood",
    title: "The Blackwood",
    biome: "forest",
    palette: { wall: "#3f7a45", floor: "#2f4326", accent: "#7fdfff" },
    // a cold rain falls through the cursed wood (gentle — no lightning here)
    weather: "rain",
    subBiomes: [
      // a boggy marsh patch soaks through part of the wood (water pools)
      {
        biome: "marsh",
        palette: { wall: "#5f6b3a", floor: "#39402b", accent: "#8fd0a0" },
        threshold: 0.05,
        hazards: [{ type: "water", density: 0.16 }], // pools to weave around
      },
      // a brighter, drier glade — a calm clearing amid the black trees
      {
        biome: "forest",
        palette: { wall: "#5aa85f", floor: "#3e5a30", accent: "#d8f0a0" },
        scale: 0.16,
        threshold: 0.28,
        hazards: [],
      },
      // a thorn-choked briar — tangled bramble thickets that snag and bleed you;
      // burn a path through (firebombs / the Pyromancer's cone shine here)
      {
        biome: "forest",
        palette: { wall: "#3f5a2c", floor: "#2a3a1e", accent: "#8faf5f" },
        scale: 0.14,
        threshold: 0.3,
        hazards: [{ type: "bramble", density: 0.28, clumps: 4 }],
      },
    ],
    // the ruins of a woodcutters' hamlet, swallowed by the cursed wood — several
    // huts to break into (the shards lie scattered among them and the trees)
    structures: [
      {
        // a woodsman's cabin — timber, a healing cache
        size: { w: 4, h: 4 },
        palette: { wall: "#9c6b3f", floor: "#4a3626", accent: "#c98a4a" },
        loot: [{ itemId: "p_gheal" }, { itemId: "c_gold" }],
      },
      {
        // a moss-grown cottage — stone, a little coin
        size: { w: 4, h: 3 },
        palette: { wall: "#6f7a5c", floor: "#33382a", accent: "#a9c07a" },
        loot: [{ itemId: "c_gold" }],
      },
      {
        // a burned-out shell — char, picked clean long ago (empty)
        size: { w: 3, h: 3 },
        palette: { wall: "#5a4b46", floor: "#241d1a", accent: "#a07a5a" },
        loot: [],
      },
      {
        // a collapsed shed — timber, a stashed draught + gear
        size: { w: 3, h: 4 },
        palette: { wall: "#8a6a48", floor: "#3e2f22", accent: "#c0966a" },
        loot: [{ itemId: "a_leather" }, { itemId: "p_heal" }],
      },
      {
        // a storehouse gone to moss — greyed stone, coin only
        size: { w: 4, h: 3 },
        palette: { wall: "#64705a", floor: "#2e3328", accent: "#98b078" },
        loot: [{ itemId: "c_gold" }],
      },
    ],
    // a big, open cursed wood — room to roam, a hamlet scattered through it
    mapWidth: 84,
    mapHeight: 52,
    generator: "cellular",
    monsterBudget: 20,
    spawnTable: [
      { monsterId: "rat", weight: 3 },
      { monsterId: "bat", weight: 4 },
      { monsterId: "goblin", weight: 4 },
      { monsterId: "spider", weight: 3 },
    ],
    turnLimit: 720,
    itemDropCount: 9,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 3 },
      { itemId: "a_leather", weight: 2 },
    ],
    coinRichness: 1.15,
    baseLightRadius: 6,
    trapCount: 4,
    waterCount: 22,
    forageCount: 14,
    loreCount: 2, // the fall of the woodcutters' hamlet
    ambient: [{ monsterId: "wisp", count: 3 }], // pale lights drifting in the cursed wood
    goal: { type: "collectX", questTag: "moonstone", count: 3 },
    narration:
      "The three shards flare as one, and a silver thread pulls you downward — toward a reek of rot and black standing water. The Mire. Somewhere out in the reeds a soft light is burning that has nothing to do with fire. Whatever the dead are guarding, the only path runs through it.",
    shopTier: 2,
  },
  {
    id: "the_mire",
    title: "The Mire",
    biome: "marsh",
    palette: { wall: "#5f7a3c", floor: "#2e3a28", accent: "#7fdfff" },
    subBiomes: [
      // firmer, grassy hummocks — dry islands of footing amid the black water
      {
        biome: "forest",
        palette: { wall: "#5aa85f", floor: "#3e5a30", accent: "#d8f0a0" },
        scale: 0.14,
        threshold: 0.2, // larger/more islands across the bigger bog
        hazards: [],
      },
      // a tangled reed-thicket labyrinth — a marsh `maze` (green ♠ reed walls),
      // distinct from the crypt's bone catacombs; a wing to get lost in
      {
        biome: "marsh",
        palette: { wall: "#4f6b3a", floor: "#2a3826", accent: "#8fd0a0" },
        layout: "maze",
        size: 0.38,
      },
      // a fungal grove — luminous caps growing out of the rot. Beautiful and
      // poisonous: the glow draws you in, the bog's spore vents do the rest.
      {
        biome: "grove",
        palette: { wall: "#6d4f7a", floor: "#241f2b", accent: "#c8f06a" },
        scale: 0.13,
        threshold: 0.1,
        hazards: [{ type: "glowcap", density: 0.18, clumps: 3 }],
      },
    ],
    // a half-sunken wayshrine of the old dawn-faith — a lone ruin, offerings in
    structures: [
      {
        palette: { wall: "#6f7a5c", floor: "#33382a", accent: "#a9c07a" },
        loot: [{ itemId: "p_detect" }, { itemId: "p_gheal" }],
      },
    ],
    // a big, sprawling wetland — water channels, reed maze, and dry hummocks
    mapWidth: 72,
    mapHeight: 46,
    generator: "cellular",
    monsterBudget: 16,
    spawnTable: [
      { monsterId: "spider", weight: 4 },
      { monsterId: "imp", weight: 2 },
      { monsterId: "goblin", weight: 3 },
    ],
    turnLimit: 620,
    itemDropCount: 6,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 3 },
      { itemId: "p_detect", weight: 1 },
      { itemId: "i_torch", weight: 1 },
    ],
    coinRichness: 1.15,
    baseLightRadius: 6,
    trapCount: 4,
    forageCount: 10,
    waterCount: 64,
    oilCount: 16,
    sporeVentCount: 5, // fumaroles seeping poison haze across the rotting bog
    eliteChance: 0.1,
    altarCount: 1,
    loreCount: 2, // drowned pilgrims, a liar's signpost
    ambient: [{ monsterId: "marsh_frog", count: 3 }], // frogs plop away in the bog
    goal: { type: "reachLocation" },
    narration:
      "You drag onto the last stone of the causeway, mud to the knee, and the air turns suddenly cold and clean. Ahead the ground climbs into a warren of ice-choked caves and black crevasses — the Frostspine Pass — and something enormous is breathing on the wind.",
    shopTier: 3,
  },
  {
    id: "frostspine_pass",
    title: "The Frostspine Pass",
    biome: "mountain",
    palette: { wall: "#7d8ea0", floor: "#40454f", accent: "#a9e0ff" },
    subBiomes: [
      // a sheltered ice grotto — a broad frozen pocket (Rimewalk/Levitation)
      {
        biome: "mountain",
        palette: { wall: "#5a6b7a", floor: "#2c343d", accent: "#bfe8ff" },
        scale: 0.14,
        threshold: 0.16, // a larger frozen cavern in the bigger network
        hazards: [{ type: "ice", density: 0.32 }],
      },
      // a second, smaller frozen hollow deeper in the caves
      {
        biome: "mountain",
        palette: { wall: "#52616f", floor: "#28303a", accent: "#bfe8ff" },
        scale: 0.17,
        threshold: 0.26,
        hazards: [{ type: "ice", density: 0.3 }],
      },
    ],
    // a ruined border watchpost — the realm's last outpost before Blackhall
    structures: [
      {
        palette: { wall: "#8792a0", floor: "#3a4048", accent: "#c6d6e6" },
        loot: [{ itemId: "a_chain" }, { itemId: "c_gold" }],
      },
    ],
    // A BEAST'S DEN sealed behind ice-choked rubble — bash or blast your way in
    // and the thing that hoarded all this wakes up. Wholly optional and off the
    // route to Gorm, so it's a risk you choose; the hoard is worth the mauling.
    secretVault: {
      gate: "crackedWall",
      guardian: "cave_bear",
      loot: [
        { itemId: "p_gheal" },
        { itemId: "w_frost" },
        { itemId: "c_gold" },
      ],
    },
    // a sprawling mountain cave network, the pass choked with impassable
    // crevasses (deep chasms you weave around — or glide/freeze across)
    mapWidth: 72,
    mapHeight: 46,
    generator: "cellular",
    monsterBudget: 17,
    spawnTable: [
      { monsterId: "goblin", weight: 5 },
      { monsterId: "skeleton", weight: 5 },
    ],
    turnLimit: 640,
    itemDropCount: 5,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 2 },
      { itemId: "w_axe", weight: 1 },
    ],
    coinRichness: 1.25,
    baseLightRadius: 5,
    trapCount: 4,
    // crevasses: frozen tarns (water — Rimewalk can bridge) AND bottomless
    // chasms (only Levitation crosses) — the pass choked with both
    waterCount: 18,
    chasmCount: 28,
    forageCount: 8,
    eliteChance: 0.12,
    loreCount: 2, // the border-watch's retreat, a frozen climber
    ambient: [{ monsterId: "snow_hare", count: 2 }], // a hare bolts across the snow
    goal: { type: "killTarget", monsterId: "frost_troll" },
    narration:
      "Gorm topples off the bridge into the white below, and the way is open. Across the chasm the gates of Blackhall Castle loom — iron and old bone — above ground burned black and still drifting with ash, where the siege starved and nothing has grown since. The Warden who holds that gate has already seen you.",
    shopTier: 4,
  },
  {
    id: "iron_gate",
    title: "The Iron Gate",
    biome: "castle",
    palette: { wall: "#6a5c6e", floor: "#2e2833", accent: "#d24a4a" },
    // an `ashen` wastes region — the war-scorched approach to Blackhall: falling
    // ash, dim ember glow, oil-soaked ground that a firebomb turns to an inferno.
    subBiomes: [
      {
        // an ash-choked, scorched expanse — the siege burned this approach to
        // the gate to nothing; falling ash, ember glow, pooled pitch (oil) to fire
        biome: "ashen",
        palette: { wall: "#3a332e", floor: "#241f1c", accent: "#ff7a2a" },
        threshold: 0.1, // a real ashen expanse, not just a pocket
        hazards: [{ type: "oil", density: 0.3 }],
      },
    ],
    // a grander gate approach — bigger halls, thick with the dead. The Gate
    // Warden holds the FAR end (killTarget places it at farthest-from-start), so
    // you must fight across the whole gatehouse + ashen approach to reach it.
    mapWidth: 66,
    mapHeight: 42,
    generator: "rogue", // a defended gatehouse — a grid of connected chambers
    // the old budget (18) was high because a CULL goal needs density; now that
    // you must cross the whole gatehouse to the warden, the garrison is thinner
    monsterBudget: 13,
    spawnTable: [
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "ghoul", weight: 4 },
      // Gargoyles are the heaviest regular spawn in the game (dmg 6 / hp 22 against
      // this level's dmg 4 / hp 10-12) AND the knockback threat. At weight 3 they
      // were 27% of encounters and made this the harshest level by a wide margin —
      // 30% win with a median end-HP of 2, deaths late (turn ~89), i.e. attrition
      // rather than a spike. Weight 1 measured 43% over 30 seeds, in line with the
      // Great Hall and Antechamber (both 42%). Weight 2 measured identical to 3,
      // so there is no half-step here.
      { monsterId: "gargoyle", weight: 1 },
    ],
    turnLimit: 560,
    itemDropCount: 6,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 2 },
      { itemId: "p_bomb", weight: 1 },
    ],
    coinRichness: 1.3,
    baseLightRadius: 5,
    trapCount: 5,
    crackedWallCount: 4,
    doorCount: 3,
    forageCount: 6, // a few arcane motes to soften the cull grind (→ ~2 after lootScale)
    eliteChance: 0.15,
    altarCount: 1,
    loreCount: 1, // the castle's surrender, in gilt
    goal: { type: "killTarget", monsterId: "gate_captain" },
    narration:
      "The Gate Warden falls, and the portcullis grinds upward on rusted chains. Beyond spreads the great hall of Blackhall — cold, vast, and thick with the castle's restless dead.",
    shopTier: 5,
  },
  {
    id: "great_hall",
    title: "The Great Hall",
    biome: "castle",
    palette: { wall: "#5c4b70", floor: "#342d40", accent: "#c04cff" },
    // a sealed strongroom off the hall — a heavy shut door, rich loot within
    secretVault: {
      gate: "door",
      loot: [
        { itemId: "a_chain" },
        { itemId: "p_gheal" },
        { itemId: "c_gold" },
      ],
    },
    mapWidth: 72,
    mapHeight: 46,
    generator: "hall", // a grand cathedral nave + flanking chambers
    // the hall is the most OPEN map in the game (~77% floor), so a budget tuned
    // for a normal map leaves it hollow — this is the "thick with the castle's
    // restless dead" hall, and the long walk should meet something
    monsterBudget: 20,
    spawnTable: [
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "zombie", weight: 3 },
      { monsterId: "ghoul", weight: 4 },
      { monsterId: "wraith", weight: 2 },
    ],
    turnLimit: 560,
    itemDropCount: 9,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_gheal", weight: 2 },
      { itemId: "a_chain", weight: 1 },
    ],
    coinRichness: 1.4,
    baseLightRadius: 5,
    trapCount: 5,
    oilCount: 16,
    crackedWallCount: 6,
    doorCount: 5,
    forageCount: 6, // a little more relief to match the fuller hall
    eliteChance: 0.15,
    altarCount: 3,
    loreCount: 3, // a servant's diary, a guardsman at his post, a besieger's helm
    goal: { type: "collectX", questTag: "sigil", count: 3 },
    narration:
      "The three dusk-sigils lock into the crypt door and it swings inward on a breath of grave-air — and, far below, the sound of running water. The underworks beneath failed long ago, and the water is still coming up. Down there the last kings hid the one blade that can still cut the night: the Sunblade. Take it before the water does.",
    shopTier: 6,
  },
  {
    id: "sunken_crypt",
    title: "The Sunken Crypt",
    biome: "crypt",
    palette: { wall: "#6a6a5a", floor: "#262620", accent: "#9fe0b0" },
    subBiomes: [
      // a bone-walled catacomb maze fills one wing of the crypt (structural contrast)
      {
        biome: "crypt",
        palette: { wall: "#585044", floor: "#1c1c17", accent: "#9fe0b0" },
        layout: "maze",
        size: 0.36,
      },
      // bioluminescent fungi have colonized a damp hollow — glowing islands that
      // stay dry+lit as the flood rises around them (the crypt's dark makes them
      // blaze); cool wet cave rock, distinct from the Pit's warm grotto
      {
        biome: "cavern",
        palette: { wall: "#3f4a48", floor: "#1a2220", accent: "#79f2dc" },
        scale: 0.13,
        threshold: 0.12, // a generous blob so the fragmented crypt floor still
        hazards: [{ type: "glowcap", density: 0.2, clumps: 2 }], // yields full hollows
      },
      // the Blackhall UNDERWORKS break through beneath the tombs — green-stained
      // sewer stone and flooded channels. This is where the water comes from:
      // the sluice-gates failed, and the crypt has been drowning ever since.
      {
        biome: "undercity",
        palette: { wall: "#4a5a52", floor: "#161d1b", accent: "#7fd0a8" },
        scale: 0.15,
        threshold: 0.04,
        hazards: [{ type: "water", density: 0.14 }],
      },
    ],
    // The sunken crypt lives up to its name — it floods as you hunt the Sunblade.
    // The rising water IS this level — so it's tuned to be PRESENT, not a late
    // surprise. At the old pacing (start 24 / every 11) a run finished around
    // turn 43 and saw barely 2 of 7 steps; starting at 14 and rising every 8
    // for 9 steps spans the whole hunt, so the flood is the pressure you plan
    // around rather than a coda. Paired with a thinner garrison (below): the
    // threat here should be the water, not the crowd.
    flood: { startTurn: 14, interval: 8, maxSteps: 9 },
    // grown to carry three regions (catacombs / fungal hollow / underworks)
    // without crowding — it was the tightest map in the game at 54×34
    mapWidth: 60,
    mapHeight: 38,
    generator: "digger",
    // thinned so the WATER is the antagonist here, not the horde (the crypt
    // was the busiest level in the game; the flood was getting drowned out)
    monsterBudget: 12,
    spawnTable: [
      { monsterId: "ghoul", weight: 5 },
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "wraith", weight: 3 },
    ],
    turnLimit: 470,
    itemDropCount: 3,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_gheal", weight: 2 },
      { itemId: "p_detect", weight: 2 },
      { itemId: "i_lantern", weight: 1 },
    ],
    coinRichness: 1.5,
    baseLightRadius: 4,
    trapCount: 8,
    forageCount: 4, // a little relief for the longer hunt (→ ~2 after forageScale)
    oilCount: 10,
    crackedWallCount: 3,
    doorCount: 2,
    eliteChance: 0.18,
    altarCount: 1,
    loreCount: 2, // the Sunblade's rifled tomb, its keeper's vow
    goal: { type: "findItem", questTag: "sunblade" },
    narration:
      "Your hand closes on the Sunblade and warmth floods your arm for the first time in days. Behind you the black water closes over the tombs for good. There is no way but up — out onto the ramparts, open to a thundering sky, and to whatever wheels across it.",
    shopTier: 7,
  },
  {
    id: "ramparts",
    title: "The Ramparts",
    biome: "castle",
    palette: { wall: "#4a5a72", floor: "#232a38", accent: "#a9e0ff" },
    // exposed to the dead sky — a black storm drives rain and lightning across
    // the open battlements as you hold the line
    weather: "storm",
    // a wind-frozen stretch of battlement — glazed with treacherous ice
    subBiomes: [
      {
        biome: "mountain",
        palette: { wall: "#42566e", floor: "#1e2836", accent: "#bfe8ff" },
        scale: 0.16,
        threshold: 0.24,
        hazards: [{ type: "ice", density: 0.22 }],
      },
    ],
    // a long, exposed wall-walk (the void beyond the parapet, towers to hold in)
    mapWidth: 84,
    mapHeight: 34,
    generator: "rampart",
    monsterBudget: 14,
    spawnTable: [
      { monsterId: "wraith", weight: 4 },
      { monsterId: "gargoyle", weight: 3 },
      { monsterId: "skeleton", weight: 3 },
    ],
    turnLimit: 260,
    itemDropCount: 4,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_gheal", weight: 2 },
      { itemId: "p_bomb", weight: 1 },
    ],
    coinRichness: 1.6,
    baseLightRadius: 6,
    trapCount: 2,
    forageCount: 3,
    eliteChance: 0.2,
    altarCount: 1,
    loreCount: 1, // a besieger's helm on the wall-walk
    ambient: [{ monsterId: "raven", count: 3 }], // carrion ravens wheel over the wall
    goal: { type: "survive", turns: 50 },
    narration:
      "You hold the ramparts until the assault breaks and the wind finally dies to nothing. A single black door stands open ahead: the antechamber of the throne, a long gallery of stone figures facing the aisle. Malachar's Herald waits at the far end, wreathed in cold fire — and not every one of those statues is stone.",
    shopTier: 8,
  },
  {
    id: "antechamber",
    title: "The Dusk Antechamber",
    biome: "castle",
    palette: { wall: "#7a5c4a", floor: "#33281f", accent: "#ffd24d" },
    // a sealed reliquary — a shut door, a last cache before the throne
    secretVault: {
      gate: "door",
      loot: [{ itemId: "p_gheal" }, { itemId: "p_bomb" }, { itemId: "c_gold" }],
    },
    // a grand processional STATUE GALLERY — a colonnaded promenade lined with
    // gargoyle "statues" (guardChase: still as stone until you draw near, then
    // they wake and shove); side aisles behind the pillars to flank/break LOS
    lightingBeat: "dusk", // dread deepens as the Herald falls — darkest before the dawn
    mapWidth: 66,
    mapHeight: 40,
    generator: "gallery",
    monsterBudget: 14,
    spawnTable: [
      { monsterId: "gargoyle", weight: 3 }, // the gallery's statues, come alive
      { monsterId: "wraith", weight: 2 },
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "ghoul", weight: 4 },
    ],
    turnLimit: 540,
    itemDropCount: 6,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_gheal", weight: 2 },
      { itemId: "p_bomb", weight: 1 },
    ],
    coinRichness: 1.8,
    baseLightRadius: 5,
    trapCount: 3,
    crackedWallCount: 3,
    doorCount: 2,
    forageCount: 1,
    eliteChance: 0.12,
    loreCount: 1, // a last fragment before the throne
    goal: { type: "killTarget", monsterId: "herald" },
    narration:
      "The Herald falls to ash and the black door yields. Beyond, a stair of black marble climbs to the Throne of Dusk. Malachar is waiting. End this.",
    shopTier: 9,
  },
  {
    id: "throne_of_dusk",
    title: "The Throne of Dusk",
    biome: "throne",
    palette: { wall: "#74494a", floor: "#3a2b2b", accent: "#ffd700" },
    lightingBeat: "dawn", // the sky rekindles as Malachar falls — the quest's payoff
    mapWidth: 44,
    mapHeight: 28,
    generator: "digger",
    monsterBudget: 11,
    spawnTable: [
      { monsterId: "wraith", weight: 5 },
      { monsterId: "skeleton", weight: 4 },
    ],
    turnLimit: 310,
    itemDropCount: 3,
    dropTable: [
      { itemId: "c_gold", weight: 5 },
      { itemId: "p_gheal", weight: 3 },
    ],
    coinRichness: 2.0,
    baseLightRadius: 5,
    trapCount: 2,
    doorCount: 2,
    loreCount: 1, // the words at the base of the throne
    goal: { type: "killTarget", monsterId: "lich" },
    // Final level: this narration is unused for transition (the Victory screen
    // shows VICTORY.body instead), but kept for completeness.
    narration: "The last of the dark drains from the hall.",
    shopTier: null,
  },
];

export const LEVEL_COUNT = LEVELS.length;
