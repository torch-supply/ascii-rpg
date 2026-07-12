import type { LevelConfig } from "@/game/core/types";

// ─────────────────────────────────────────────────────────────────────────
// THE LEVEL SPINE. Everything about the game's flow is driven by this ordered
// array. To add/remove a level, edit ONLY this file — the number of levels
// appears nowhere in engine code. The last element automatically ends the run
// (victory), because the loop checks `currentLevel < LEVELS.length`.
// ─────────────────────────────────────────────────────────────────────────
export const LEVELS: LevelConfig[] = [
  {
    id: "dungeon_depths",
    title: "The Dungeon Depths",
    biome: "dungeon",
    palette: { wall: "#6b6b7c", floor: "#3b3b46", accent: "#ffe14d" },
    mapWidth: 40,
    mapHeight: 24,
    generator: "digger",
    monsterBudget: 6,
    spawnTable: [
      { monsterId: "rat", weight: 6 },
      { monsterId: "bat", weight: 4 },
    ],
    turnLimit: 400,
    itemDropCount: 4,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 3 },
      { itemId: "w_short", weight: 2 },
      { itemId: "i_torch", weight: 1 },
    ],
    coinRichness: 1.0,
    baseLightRadius: 8,
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
    mapWidth: 48,
    mapHeight: 30,
    generator: "cellular",
    monsterBudget: 9,
    spawnTable: [
      { monsterId: "rat", weight: 3 },
      { monsterId: "bat", weight: 4 },
      { monsterId: "goblin", weight: 4 },
    ],
    turnLimit: 360,
    itemDropCount: 4,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 3 },
      { itemId: "a_leather", weight: 2 },
    ],
    coinRichness: 1.0,
    baseLightRadius: 6,
    goal: { type: "collectX", questTag: "moonstone", count: 3 },
    narration:
      "The three shards flare together and a silver trail cuts through the trees, climbing. Ahead the ground turns to ice and bare rock. The Frostspine Pass — and something enormous breathing on the wind.",
    shopTier: 2,
  },
  {
    id: "frostspine_pass",
    title: "The Frostspine Pass",
    biome: "mountain",
    palette: { wall: "#7d8ea0", floor: "#40454f", accent: "#a9e0ff" },
    mapWidth: 52,
    mapHeight: 32,
    generator: "cellular",
    monsterBudget: 11,
    spawnTable: [
      { monsterId: "goblin", weight: 5 },
      { monsterId: "skeleton", weight: 5 },
    ],
    turnLimit: 300,
    itemDropCount: 3,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 2 },
      { itemId: "w_axe", weight: 1 },
    ],
    coinRichness: 1.25,
    baseLightRadius: 5,
    goal: { type: "killTarget", monsterId: "frost_troll" },
    narration:
      "Gorm topples off the bridge into the white below. The way is open. Across the chasm, Blackhall Castle claws at the sky, its windows lit with dead-blue fire. Your blade won't be enough in there.",
    shopTier: 3,
  },
  {
    id: "blackhall_castle",
    title: "Blackhall Castle & Crypt",
    biome: "castle",
    palette: { wall: "#5c4b70", floor: "#342d40", accent: "#c04cff" },
    mapWidth: 56,
    mapHeight: 36,
    generator: "digger",
    monsterBudget: 14,
    spawnTable: [
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "zombie", weight: 4 },
      { monsterId: "wraith", weight: 3 },
    ],
    turnLimit: 280,
    itemDropCount: 3,
    dropTable: [
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_gheal", weight: 2 },
      { itemId: "a_chain", weight: 1 },
    ],
    coinRichness: 1.5,
    baseLightRadius: 4,
    goal: { type: "findItem", questTag: "sunblade" },
    narration:
      "Your hand closes on the Sunblade and warmth floods your arm for the first time in days. The crypt door groans open toward a stair of black marble, rising to a throne. Malachar is waiting. End this.",
    shopTier: 4,
  },
  {
    id: "throne_of_dusk",
    title: "The Throne of Dusk",
    biome: "throne",
    palette: { wall: "#74494a", floor: "#3a2b2b", accent: "#ffd700" },
    mapWidth: 44,
    mapHeight: 28,
    generator: "digger",
    monsterBudget: 9,
    spawnTable: [
      { monsterId: "wraith", weight: 5 },
      { monsterId: "skeleton", weight: 4 },
    ],
    turnLimit: 240,
    itemDropCount: 2,
    dropTable: [
      { itemId: "c_gold", weight: 5 },
      { itemId: "p_gheal", weight: 3 },
    ],
    coinRichness: 2.0,
    baseLightRadius: 5,
    goal: { type: "killTarget", monsterId: "lich" },
    // Final level: narration here is unused for transition (victory screen
    // shows VICTORY_NARRATION instead), but kept for completeness.
    narration: "The last of the dark drains from the hall.",
    shopTier: null,
  },
];

export const LEVEL_COUNT = LEVELS.length;
