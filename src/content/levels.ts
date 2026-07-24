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
        hazards: [{ type: "glowcap", density: 0.15, clumps: 3 }],
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
    goal: { type: "reachLocation" },
    narration:
      "You haul yourself out of the pit into cold night air. No stars — only a black wall of trees ahead, whispering, and the sagging roofs of a hamlet the wood has all but swallowed. The Blackwood. Somewhere past its ruins lies the path the dead don't want you to find.",
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
    goal: { type: "collectX", questTag: "moonstone", count: 3 },
    narration:
      "The three shards flare as one, and a silver thread pulls you downward — toward a reek of rot and black standing water. The Mire. Whatever the dead are guarding, the only path runs through it.",
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
    eliteChance: 0.1,
    altarCount: 1,
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
    waterCount: 44,
    forageCount: 8,
    eliteChance: 0.12,
    goal: { type: "killTarget", monsterId: "frost_troll" },
    narration:
      "Gorm topples off the bridge into the white below, and the way is open. Across the chasm the gates of Blackhall Castle loom — iron and old bone — and their wardens have already seen you.",
    shopTier: 4,
  },
  {
    id: "iron_gate",
    title: "The Iron Gate",
    biome: "castle",
    palette: { wall: "#6a5c6e", floor: "#2e2833", accent: "#d24a4a" },
    // a scorched hollow — oil-soaked floor; one firebomb turns it into an
    // inferno (an Emberstep region). Borrows the throne biome for its ember look.
    subBiomes: [
      {
        biome: "throne",
        palette: { wall: "#4a3a34", floor: "#2a221e", accent: "#ff8c3a" },
        threshold: 0.12,
        hazards: [{ type: "oil", density: 0.32 }],
      },
    ],
    // a grander gate approach — bigger halls, thick with the dead (a cull goal
    // wants density, so the horde scales with the size)
    mapWidth: 66,
    mapHeight: 42,
    generator: "rogue", // a defended gatehouse — a grid of connected chambers
    monsterBudget: 18,
    spawnTable: [
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "ghoul", weight: 4 },
      { monsterId: "gargoyle", weight: 2 },
      { monsterId: "gate_captain", weight: 1 },
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
    forageCount: 1,
    eliteChance: 0.15,
    altarCount: 1,
    goal: { type: "killCount", count: 8 },
    narration:
      "The last of the gate's wardens falls and the portcullis grinds upward on rusted chains. Beyond spreads the great hall of Blackhall — cold, vast, and thick with the castle's restless dead.",
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
    generator: "digger",
    monsterBudget: 15,
    spawnTable: [
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "zombie", weight: 3 },
      { monsterId: "ghoul", weight: 4 },
      { monsterId: "wraith", weight: 2 },
    ],
    turnLimit: 560,
    itemDropCount: 6,
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
    forageCount: 4,
    eliteChance: 0.15,
    altarCount: 3,
    goal: { type: "collectX", questTag: "sigil", count: 3 },
    narration:
      "The three dusk-sigils lock into the crypt door and it swings inward on a breath of grave-air. Down there, the last kings hid the one blade that can still cut the night: the Sunblade.",
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
    ],
    // the sunken crypt lives up to its name — it floods as you hunt the Sunblade
    flood: { startTurn: 20, interval: 10, maxSteps: 7 },
    mapWidth: 54,
    mapHeight: 34,
    generator: "digger",
    monsterBudget: 15,
    spawnTable: [
      { monsterId: "ghoul", weight: 5 },
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "wraith", weight: 3 },
    ],
    turnLimit: 380,
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
    forageCount: 2,
    oilCount: 10,
    crackedWallCount: 3,
    doorCount: 2,
    eliteChance: 0.18,
    altarCount: 1,
    goal: { type: "findItem", questTag: "sunblade" },
    narration:
      "Your hand closes on the Sunblade and warmth floods your arm for the first time in days. There is no way up but the ramparts — open to a black, thundering sky, and to whatever wheels across it.",
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
    mapWidth: 54,
    mapHeight: 32,
    generator: "digger",
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
    waterCount: 12,
    eliteChance: 0.2,
    altarCount: 1,
    goal: { type: "survive", turns: 50 },
    narration:
      "You hold the ramparts until the assault breaks and the wind finally dies to nothing. A single black door stands open ahead — the antechamber of the throne — and Malachar's Herald waits before it, wreathed in cold fire.",
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
    // a longer, grander approach to the throne — more hall to fight through
    mapWidth: 60,
    mapHeight: 40,
    generator: "digger",
    monsterBudget: 17,
    spawnTable: [
      { monsterId: "wraith", weight: 4 },
      { monsterId: "skeleton", weight: 3 },
      { monsterId: "ghoul", weight: 3 },
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
    eliteChance: 0.2,
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
    goal: { type: "killTarget", monsterId: "lich" },
    // Final level: this narration is unused for transition (the Victory screen
    // shows VICTORY.body instead), but kept for completeness.
    narration: "The last of the dark drains from the hall.",
    shopTier: null,
  },
];

export const LEVEL_COUNT = LEVELS.length;
