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
    // a raw cavern breaks out of the dug cellblock — a natural tunnel contrast
    subBiomes: [
      {
        biome: "dungeon",
        palette: { wall: "#5a4d42", floor: "#2b241d", accent: "#c9a87a" },
        layout: "cellular",
        size: 0.4,
        hazards: [],
      },
    ],
    // a neighboring cell — a shut door to open, a little relief inside
    secretVault: {
      gate: "door",
      loot: [{ itemId: "p_heal" }, { itemId: "c_gold" }],
    },
    mapWidth: 40,
    mapHeight: 24,
    generator: "digger",
    monsterBudget: 6,
    spawnTable: [
      { monsterId: "rat", weight: 6 },
      { monsterId: "bat", weight: 4 },
    ],
    turnLimit: 420,
    itemDropCount: 4,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 3 },
      { itemId: "w_short", weight: 2 },
      { itemId: "i_torch", weight: 1 },
    ],
    coinRichness: 1.15,
    baseLightRadius: 8,
    trapCount: 3,
    doorCount: 2,
    forageCount: 3,
    goal: { type: "reachLocation" },
    narration:
      "You haul yourself out of the pit into cold night air. No stars — only a black wall of trees ahead, whispering. The Blackwood. Somewhere in it lies the path the dead don't want you to find.",
    shopTier: 1,
  },
  {
    id: "blackwood",
    title: "The Blackwood",
    biome: "forest",
    palette: { wall: "#3f7a45", floor: "#2f4326", accent: "#7fdfff" },
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
    // a freestanding woodsman's hut in a clearing — walls, a shut door, loot in
    structure: {
      loot: [{ itemId: "p_gheal" }, { itemId: "c_gold" }],
    },
    mapWidth: 48,
    mapHeight: 30,
    generator: "cellular",
    monsterBudget: 9,
    spawnTable: [
      { monsterId: "rat", weight: 3 },
      { monsterId: "bat", weight: 4 },
      { monsterId: "goblin", weight: 4 },
      { monsterId: "spider", weight: 3 },
    ],
    turnLimit: 380,
    itemDropCount: 4,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 3 },
      { itemId: "a_leather", weight: 2 },
    ],
    coinRichness: 1.15,
    baseLightRadius: 6,
    trapCount: 2,
    waterCount: 10,
    forageCount: 6,
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
    // a firmer, grassy hummock — a dry rest-island amid the black water
    subBiomes: [
      {
        biome: "forest",
        palette: { wall: "#5aa85f", floor: "#3e5a30", accent: "#d8f0a0" },
        scale: 0.15,
        threshold: 0.26,
        hazards: [],
      },
    ],
    // a half-sunken wayshrine of the old dawn-faith — mossy stone, offerings in
    structure: {
      palette: { wall: "#6f7a5c", floor: "#33382a", accent: "#a9c07a" },
      loot: [{ itemId: "p_detect" }, { itemId: "p_gheal" }],
    },
    mapWidth: 50,
    mapHeight: 30,
    generator: "cellular",
    monsterBudget: 10,
    spawnTable: [
      { monsterId: "spider", weight: 4 },
      { monsterId: "imp", weight: 2 },
      { monsterId: "goblin", weight: 3 },
    ],
    turnLimit: 350,
    itemDropCount: 4,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 3 },
      { itemId: "p_detect", weight: 1 },
      { itemId: "i_torch", weight: 1 },
    ],
    coinRichness: 1.15,
    baseLightRadius: 6,
    trapCount: 3,
    forageCount: 6,
    waterCount: 46,
    oilCount: 16,
    eliteChance: 0.1,
    altarCount: 1,
    goal: { type: "reachLocation" },
    narration:
      "You drag onto the last stone of the causeway, mud to the knee, and the air turns suddenly cold and clean. Ahead the ground climbs into ice and bare rock — the Frostspine Pass — and something enormous is breathing on the wind.",
    shopTier: 3,
  },
  {
    id: "frostspine_pass",
    title: "The Frostspine Pass",
    biome: "mountain",
    palette: { wall: "#7d8ea0", floor: "#40454f", accent: "#a9e0ff" },
    // a sheltered ice grotto — a frozen pocket (Rimewalk/Levitation country)
    subBiomes: [
      {
        biome: "mountain",
        palette: { wall: "#5a6b7a", floor: "#2c343d", accent: "#bfe8ff" },
        scale: 0.15,
        threshold: 0.22,
        hazards: [{ type: "ice", density: 0.3 }],
      },
    ],
    // a ruined border watchpost — the realm's last outpost before Blackhall
    structure: {
      palette: { wall: "#8792a0", floor: "#3a4048", accent: "#c6d6e6" },
      loot: [{ itemId: "a_chain" }, { itemId: "c_gold" }],
    },
    mapWidth: 52,
    mapHeight: 32,
    generator: "cellular",
    monsterBudget: 12,
    spawnTable: [
      { monsterId: "goblin", weight: 5 },
      { monsterId: "skeleton", weight: 5 },
    ],
    turnLimit: 320,
    itemDropCount: 3,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 2 },
      { itemId: "w_axe", weight: 1 },
    ],
    coinRichness: 1.25,
    baseLightRadius: 5,
    trapCount: 3,
    waterCount: 18,
    forageCount: 5,
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
    mapWidth: 52,
    mapHeight: 32,
    generator: "digger",
    monsterBudget: 13,
    spawnTable: [
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "ghoul", weight: 4 },
      { monsterId: "gargoyle", weight: 2 },
      { monsterId: "gate_captain", weight: 1 },
    ],
    turnLimit: 360,
    itemDropCount: 4,
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
    // a bone-walled catacomb maze fills one wing of the crypt (structural contrast)
    subBiomes: [
      {
        biome: "crypt",
        palette: { wall: "#585044", floor: "#1c1c17", accent: "#9fe0b0" },
        layout: "maze",
        size: 0.36,
      },
    ],
    // the sunken crypt lives up to its name — it floods as you hunt the Sunblade
    flood: { startTurn: 18, interval: 5, maxSteps: 16 },
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
      "Your hand closes on the Sunblade and warmth floods your arm for the first time in days. There is no way up but the ramparts — open to the dead sky, and to whatever wheels across it.",
    shopTier: 7,
  },
  {
    id: "ramparts",
    title: "The Ramparts",
    biome: "castle",
    palette: { wall: "#4a5a72", floor: "#232a38", accent: "#a9e0ff" },
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
    mapWidth: 48,
    mapHeight: 30,
    generator: "digger",
    monsterBudget: 13,
    spawnTable: [
      { monsterId: "wraith", weight: 4 },
      { monsterId: "skeleton", weight: 3 },
      { monsterId: "ghoul", weight: 3 },
    ],
    turnLimit: 350,
    itemDropCount: 4,
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
