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
        // A destination, not an arrival: the glowcap hollows are the thing you
        // navigate toward, and they are SELF-LIT while the pit proper is dark.
        // Starting in one (50% of seeds) both spoiled the discovery and inverted
        // the lesson level 1 exists to teach — that your torch is your sight.
        noStart: true,
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
    sconces: 3, // a forgotten pit — the glowcaps light it, not the gaolers
    generator: "digger",
    monsterBudget: 8,
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
        // the thorns SNAG (a bleed on entry) — waking in them is a hazard you
        // never chose. The bog and the glade are both fine arrivals; this is the
        // only Blackwood region that isn't.
        noStart: true,
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
    // GARRISONS CAME DOWN ~20% GAME-WIDE, and elite chances went up to match:
    // fewer bodies, more of them worth fearing, so a level is more exploration
    // than corridor-clearing. The Ramparts is the ONE level left alone — it is a
    // survive level where `siege.cap` is the real governor and ring-spawned
    // reinforcements arrive already chasing, so a smaller garrison makes it
    // HARDER, not easier (measured: 14→11 dropped the bot 33%→17%).
    monsterBudget: 15,
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
    // Explicitly none. Every eligible wall on this level belonged to a
    // FREESTANDING structure, so the whole budget used to hang burning brackets
    // on hut walls: no tended flame in the woods — the hamlet is abandoned. Daylight
    // through the canopy (`SKYLIGHT.forest`) is what you see by here.
    sconces: 0,
    eliteChance: 0.08,
    baseLightRadius: 6,
    trapCount: 4,
    waterCount: 22,
    forageCount: 14,
    loreCount: 2, // the fall of the woodcutters' hamlet
    ambient: [{ monsterId: "wisp", count: 3 }], // pale lights drifting in the cursed wood
    goal: { type: "collectX", questTag: "moonstone", count: 3 },
    narration:
      "The three shards flare as one, and a silver thread pulls you downward — toward a reek of rot and black standing water. The Mire. Somewhere out in the reeds a soft light is burning that has nothing to do with fire, and further out, half-drowned, stands the roofline of the temple the pilgrim road was built to reach. The way onward runs through the water, or it does not run at all.",
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
        // GROWN, not built. A bare `maze` wing is a rectilinear lattice, which
        // made the bog's one natural feature the only thing on the level
        // generated as architecture — beside a temple and wayshrines whose
        // straight walls are the point. `organic` doubles the lattice and erodes
        // it into ragged reed banks with wandering channels.
        organic: true,
        // A labyrinth is somewhere you go INTO. Arriving already lost inside
        // the reeds (18% of seeds) reads as disorientation, not as a bog you
        // wade into — and it's unreachable by a biome blocklist, since the wing
        // is `marsh` like the base.
        noStart: true,
      },
      // a fungal grove — luminous caps growing out of the rot. Beautiful and
      // poisonous: the glow draws you in, the bog's spore vents do the rest.
      {
        biome: "grove",
        palette: { wall: "#6d4f7a", floor: "#241f2b", accent: "#c8f06a" },
        scale: 0.13,
        threshold: 0.1,
        hazards: [{ type: "glowcap", density: 0.18, clumps: 3 }],
        // the grove's whole trick is that the glow draws you in from OUTSIDE;
        // starting inside it skips the lure, and its spore vents can poison you
        // on the first turn
        noStart: true,
      },
      {
        // THE DROWNED TEMPLE — the Great Hall's cathedral generator sunk into a
        // bog: a colonnaded nave with side chapels, half-flooded. Reusing
        // `hall` here is the point; the same structure reads completely
        // differently in a marsh than it does in Blackhall.
        biome: "sanctum",
        palette: { wall: "#5d6f68", floor: "#232e2b", accent: "#8fd0b4" },
        layout: "hall",
        size: 0.44, // a nave wants room; smaller wings get severed more often

        hazards: [{ type: "water", density: 0.14, clumps: 4 }],
        // THE PILGRIMAGE: the exit is inside the temple, so the level is a journey
        // TO somewhere rather than to wherever the bog happened to trail off.
        // The lore was already "drowned pilgrims, a liar's signpost" — this makes
        // the thing they were walking towards real.
        goalHere: true,
        // …and never BEGIN here. Measured at 23%: you'd spawn inside the temple
        // with the exit also inside it, so a pilgrimage could be finished in a
        // few steps. Both ends of the journey in one region is the worst version
        // of this bug, which is why the pair is always worth checking together.
        noStart: true,
      },
    ],
    // a half-sunken wayshrine of the old dawn-faith — a lone ruin, offerings in
    // A PILGRIM ROAD, not one shrine. `structures[]` re-scans for its own
    // clearing per entry, so four small wayshrines scatter across the bog as
    // waymarkers toward the temple — and the lore's "liar's signpost" finally
    // has something to lie about.
    structures: [
      {
        palette: { wall: "#6f7a5c", floor: "#33382a", accent: "#a9c07a" },
        loot: [{ itemId: "p_detect" }, { itemId: "p_gheal" }],
      },
      {
        size: { w: 5, h: 5 },
        palette: { wall: "#6f7a5c", floor: "#33382a", accent: "#a9c07a" },
        loot: [{ itemId: "c_gold" }],
      },
      {
        size: { w: 5, h: 5 },
        palette: { wall: "#6f7a5c", floor: "#33382a", accent: "#a9c07a" },
        loot: [{ itemId: "p_heal" }],
      },
      {
        size: { w: 6, h: 5 },
        palette: { wall: "#6f7a5c", floor: "#33382a", accent: "#a9c07a" },
        loot: [{ itemId: "c_gold" }, { itemId: "p_antidote" }],
      },
    ],
    // a big, sprawling wetland — water channels, reed maze, and dry hummocks
    mapWidth: 84,
    mapHeight: 54,
    generator: "cellular",
    monsterBudget: 15,
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
    // Explicitly none. Every eligible wall on this level belonged to a
    // FREESTANDING structure, so the whole budget used to hang burning brackets
    // on hut walls: the wayshrines are ruins and the bog has nothing to burn; open sky
    // over the reeds (`SKYLIGHT.marsh`) is the light on this level.
    sconces: 0,
    baseLightRadius: 6,
    trapCount: 4,
    forageCount: 14,
    waterCount: 64,
    oilCount: 16,
    sporeVentCount: 7, // fumaroles seeping poison haze across the rotting bog
    eliteChance: 0.15,
    altarCount: 1,
    loreCount: 4, // drowned pilgrims, a liar's signpost, and the temple itself
    ambient: [{ monsterId: "marsh_frog", count: 3 }], // frogs plop away in the bog
    goal: { type: "reachLocation" },
    narration:
      "You leave the temple by its drowned back stair, mud to the knee, and the air turns suddenly cold and clean. Ahead the ground climbs into a warren of ice-choked caves and black crevasses — the Frostspine Pass — and something enormous is breathing on the wind.",
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
    monsterBudget: 13,
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
    // Explicitly none. Every eligible wall on this level belonged to a
    // FREESTANDING structure, so the whole budget used to hang burning brackets
    // on hut walls: the watchpost was abandoned long ago; snow throwing back the
    // daylight (`SKYLIGHT.mountain`) is the only light in the pass.
    sconces: 0,
    baseLightRadius: 5,
    trapCount: 4,
    // crevasses: frozen tarns (water — Rimewalk can bridge) AND bottomless
    // chasms (only Levitation crosses) — the pass choked with both
    waterCount: 18,
    chasmCount: 28,
    forageCount: 8,
    eliteChance: 0.18,
    loreCount: 2, // the border-watch's retreat, a frozen climber
    ambient: [{ monsterId: "snow_hare", count: 2 }], // a hare bolts across the snow
    goal: { type: "killTarget", monsterId: "frost_troll" },
    narration:
      "Gorm topples off the bridge into the white below, and the way is open. Across the chasm the gates of Blackhall Castle loom — iron and old bone — and between you and them lies the castle's burial ground: rank on rank of markers under an open grey sky, and past its wall the ash-fields where the siege starved and nothing has grown since. The Warden who holds that gate has already seen you.",
    shopTier: 4,
  },
  {
    id: "iron_gate",
    title: "The Iron Gate",
    // THE THRESHOLD LEVEL: the base is now the OUTSIDE — Blackhall's burial
    // ground under an open sky — and the gatehouse is carved into it as a
    // `rogue` wing. You cross the graves, pass the chapel, and go in.
    //
    // Flipping the base also follows the documented lesson that a tight base
    // generator starves a COMBAT level of kiting room: `rogue` runs 13-27% floor,
    // and this level's goal is to fight across the map to the Warden. A forgiving
    // cellular base with a structural wing is the recommended shape.
    biome: "graveyard",
    palette: { wall: "#5c6068", floor: "#22252b", accent: "#9aa3b4" },
    // You always begin OUTSIDE the walls — on the graves or the burned siege
    // ground, either reads as an approach. Never inside the gatehouse: crossing
    // into it is the whole point of the level.
    subBiomes: [
      {
        // the gatehouse itself — a grid of connected guard chambers, and the one
        // part of Blackhall still garrisoned (hence every sconce on the level)
        biome: "castle",
        palette: { wall: "#6a5c6e", floor: "#2e2833", accent: "#d24a4a" },
        layout: "rogue",
        // The Gate Warden HOLDS THE GATE, so the fight belongs in the gatehouse.
        // Placed at the farthest cell of the whole map it stood out on the open
        // graves on 60% of seeds, which reads as the boss having wandered off
        // the thing it is named for — and wastes the one built interior on the
        // level. Paired with `noStart` below: you begin outside the walls and
        // fight your way in, which is the level.
        goalHere: true,
        // Never begin INSIDE the walls — 12% of seeds did, and the gatehouse is
        // the one place this level exists to make you fight your way to. The
        // `ashen` siege ground deliberately stays allowed: on the graves or out
        // on the burned ground both read as arriving from outside.
        noStart: true,
        size: 0.46,
        hazards: [],
      },
      {
        // an ash-choked, scorched expanse — the siege burned this approach to
        // the gate to nothing; falling ash, ember glow, pooled pitch (oil) to fire
        biome: "ashen",
        palette: { wall: "#3a332e", floor: "#241f1c", accent: "#ff7a2a" },
        threshold: 0.12,
        hazards: [{ type: "oil", density: 0.3 }],
      },
    ],
    // A chapel on the approach — the one building outside the walls, its door
    // shut. `structures[]` stamps a real interior into open ground, so the level
    // has THREE kinds of space: graves under sky, a small sealed room, and the
    // gatehouse warren beyond.
    structures: [
      {
        size: { w: 9, h: 7 },
        loot: [{ itemId: "p_gheal" }, { itemId: "c_gold" }],
        palette: { wall: "#6e6a5c", floor: "#2b2a24", accent: "#c9a227" },
      },
    ],
    // Grown from 66x42 for the extra ground: the graves need room to read as a
    // field rather than a strip, and the gatehouse wing eats ~46% of the map.
    // The garrison's stores, walled up when the siege closed in. A CRACKED WALL
    // rather than a door: this level is a fight your way in, and blasting or
    // bashing through is the same verb as the rest of it.
    secretVault: {
      gate: "crackedWall",
      loot: [{ itemId: "p_gheal" }, { itemId: "p_bomb" }, { itemId: "c_gold" }],
    },
    mapWidth: 84,
    mapHeight: 50,
    sconces: 16, // GARRISONED and still held — and now only in the gatehouse wing
    generator: "cellular", // open, broken ground outside the walls
    // the old budget (18) was high because a CULL goal needs density; now that
    // you must cross the whole gatehouse to the warden, the garrison is thinner
    monsterBudget: 11,
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
    turnLimit: 760, // par scales with the traverse (score target only)
    itemDropCount: 9, // scaled with the 1.5x area — loot per tile held constant
    dropTable: [
      { itemId: "i_torch", weight: 1 },
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_heal", weight: 2 },
      { itemId: "p_bomb", weight: 1 },
    ],
    coinRichness: 1.3,
    baseLightRadius: 5,
    trapCount: 7,
    crackedWallCount: 4,
    doorCount: 3,
    // Raised well past a proportional scale (6 -> 12). The level grew 52% and the
    // bot's walk grew 56% (305 -> 477 tiles), and deaths moved LATER (turn 84 ->
    // 106) — the signature of attrition over distance rather than a difficulty
    // spike. On a long traverse it's healing per tile walked that has to hold,
    // not monsters per tile. The graveyard also gives the motes somewhere to be.
    forageCount: 12,
    eliteChance: 0.22,
    altarCount: 1,
    loreCount: 3, // the surrender in gilt, plus what the graves say
    goal: { type: "killTarget", monsterId: "gate_captain" },
    narration:
      "The Gate Warden falls, and the portcullis grinds upward on rusted chains. Beyond spreads the great hall of Blackhall — cold, vast, and thick with the castle's restless dead. Far down the nave one bay of the roof has fallen in, and grey daylight stands in the gap like a pillar. Somewhere beneath the flagstones a stair goes down, and the air that comes up it smells of graves.",
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
    // TWO REGIONS, no extra size. The hall was the sparsest level in the game
    // (1.11 POIs per 100 walkable tiles) because `genHall` floored 74% of the
    // map; tightening the chapels took that to 52% and the density to 1.57
    // without adding a single threat. What it still lacked was VARIETY — it was
    // the only level in the back half with no sub-biome at all.
    subBiomes: [
      {
        // THE ROOF FELL IN. Ash drifts down through the gap and there is sky
        // above you — an outdoor patch in the middle of a cathedral, and with
        // per-region skylight it reads as the one bright place in Blackhall.
        biome: "ashen",
        // you arrive through the gate into the nave, under a roof — not already
        // standing in the one bay where it has fallen in
        noStart: true,
        palette: { wall: "#4a423a", floor: "#2b2620", accent: "#ff9d4a" },
        threshold: 0.1, // a real breach, not a skylight
        hazards: [], // a hole in a roof, not a pitch fire — no oil here
      },
      {
        // THE UNDERCROFT — a warren under the chancel, and the first sight of
        // what Blackhall keeps below. Foreshadows the Sunken Crypt two levels on.
        biome: "crypt",
        // the undercroft is the level's first sight of what Blackhall keeps
        // underground. Beginning down there (11% of seeds) spends that reveal
        // before the cathedral above has been seen at all.
        noStart: true,
        palette: { wall: "#5a6356", floor: "#232a26", accent: "#9fb08a" },
        layout: "rogue",
        size: 0.34,
        hazards: [],
      },
    ],
    mapWidth: 72,
    mapHeight: 46,
    sconces: 10, // a cathedral nave, lit for ritual — but the rituals stopped
    generator: "hall", // a grand cathedral nave + flanking chambers
    // the hall is the most OPEN map in the game (~77% floor), so a budget tuned
    // for a normal map leaves it hollow — this is the "thick with the castle's
    // restless dead" hall, and the long walk should meet something
    // Tightening the chapels cut walkable area 2442 -> ~1250, which doubled
    // monster density without changing the count — the mirror of growing a map
    // and leaving its population alone. Measured at 40 seeds: 20 monsters gave
    // 40%, 16 gave 68%. A straight area-proportional cut (to ~10) reads at 80%+
    // and makes a cathedral full of the dead feel empty; the traverse got
    // shorter too, so pressure per journey isn't purely a function of area.
    monsterBudget: 13,
    spawnTable: [
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "zombie", weight: 3 },
      { monsterId: "ghoul", weight: 4 },
      { monsterId: "wraith", weight: 2 },
    ],
    turnLimit: 460, // a tighter hall is a shorter traverse (score target only)
    itemDropCount: 9,
    dropTable: [
      { itemId: "i_torch", weight: 1 },
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
    eliteChance: 0.22,
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
        // you descend into the crypt from the hall above; waking already deep in
        // the bone catacombs (27% of seeds) skips that descent — and, like the
        // Mire's reeds, it is `crypt` like the base, so no biome blocklist could
        // have said so
        noStart: true,
        size: 0.36,
      },
      // bioluminescent fungi have colonized a damp hollow — glowing islands that
      // stay dry+lit as the flood rises around them (the crypt's dark makes them
      // blaze); cool wet cave rock, distinct from the Pit's warm grotto
      {
        biome: "cavern",
        // the glowcap islands are the dry, lit REFUGE you find as the water
        // rises — being handed it at spawn is the opposite of that
        noStart: true,
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
        // the underworks are WHERE THE FLOOD COMES FROM. Starting in the flooded
        // channels of a flooding level is backwards both ways: narratively you
        // arrive from the castle above, and mechanically it's the wettest ground
        // on the map.
        noStart: true,
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
    sconces: 2, // a tomb, and drowning; the fungal hollows are the only light
    generator: "digger",
    // thinned so the WATER is the antagonist here, not the horde (the crypt
    // was the busiest level in the game; the flood was getting drowned out)
    monsterBudget: 10,
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
    eliteChance: 0.25,
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
    // A tower storeroom. Gated by a DOOR, not a cracked wall, and that is the
    // whole design: this is the one level with a real clock, so breaking in has
    // to cost a turn or two rather than four melee bumps while waves close on
    // you. It was also the level with almost nothing hidden on it — 3% of its
    // loot was anywhere but open ground.
    secretVault: {
      gate: "door",
      loot: [{ itemId: "p_gheal" }, { itemId: "p_ward" }, { itemId: "c_gold" }],
    },
    // An exposed wall-walk under a thundering sky — but its biome is `castle`,
    // which is a sealed interior everywhere else, so it inherited 3 tiles of
    // unaided sight while its own icy stretch (a `mountain` sub-region) gave 11:
    // a four-fold jump between adjacent tiles of the same battlement. 4 is a
    // stormy NIGHT sky: dim enough that a torch still buys +44 tiles on the one
    // level with real fuel pressure, open enough that the wall stops reading as
    // a corridor. It caps the ice too — snow throws daylight back only if there
    // is daylight.
    skylight: 4,
    mapWidth: 84,
    mapHeight: 34,
    // Deliberately sparse. Seven braziers plus a lantern lit most of an open
    // wall-walk (323 tiles — the brightest reading in the game), which undercuts
    // the one level whose whole tension is sightline along the wall. Three reads
    // as waypoints in the storm rather than floodlighting the battlement.
    sconces: 3,
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
      { itemId: "i_torch", weight: 1 },
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
      "You hold the ramparts until the assault breaks and the wind finally dies to nothing. A single black door stands open ahead: the antechamber of the throne, a long gallery of stone figures facing the aisle. Black marble has crept back out of the throne room and into its floor. Malachar's Herald waits at the far end, wreathed in cold fire — and not every one of those statues is stone.",
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
    // Black marble veining up through the gallery floor: the throne's own stone
    // spreading BACKWARDS into the antechamber, its embers drifting over those
    // cells (`throne` carries the rising-ember atmosphere, gated per region). It
    // was the last level in the game with no sub-biome at all — one uniform
    // castle palette end to end. Cosmetic only: `hazards: []` overrides the
    // throne default (oil at 0.3 density), which would strew pitch across a
    // ceremonial hall.
    subBiomes: [
      {
        biome: "throne",
        // the marble spreads backwards FROM the throne, so it should read as a
        // gradient you walk into; arriving already on it contradicts that
        noStart: true,
        palette: { wall: "#74494a", floor: "#3a2b2b", accent: "#ffd700" },
        scale: 0.1,
        threshold: 0.16,
        hazards: [],
      },
    ],
    // a grand processional STATUE GALLERY — a colonnaded promenade lined with
    // gargoyle "statues" (guardChase: still as stone until you draw near, then
    // they wake and shove); side aisles behind the pillars to flank/break LOS
    lightingBeat: "dusk", // dread deepens as the Herald falls — darkest before the dawn
    mapWidth: 66,
    mapHeight: 40,
    sconces: 5, // the processional lights are failing as the dusk deepens
    generator: "gallery",
    // Counts are set against the gallery's WALKABLE area, which grew ~16% when
    // the narthex/apse and flanking chambers claimed the dead rock — a bigger
    // map at fixed counts is the same incomplete edit as a smaller one, just in
    // the easy direction. `monsterBudget` deliberately did NOT move: measured at
    // 40 seeds, the old and new geometry both read 35%, so the extra floor cost
    // the garrison nothing (the rooms are off the spine — the bot never enters
    // most of them). 35% is the lowest non-boss win-rate in the game and is a
    // question for the balance pass, not for the layout.
    monsterBudget: 12,
    spawnTable: [
      { monsterId: "gargoyle", weight: 3 }, // the gallery's statues, come alive
      { monsterId: "wraith", weight: 2 },
      { monsterId: "skeleton", weight: 4 },
      { monsterId: "ghoul", weight: 4 },
    ],
    turnLimit: 540,
    itemDropCount: 7,
    dropTable: [
      { itemId: "i_torch", weight: 1 },
      { itemId: "c_gold", weight: 6 },
      { itemId: "p_gheal", weight: 2 },
      { itemId: "p_bomb", weight: 1 },
    ],
    coinRichness: 1.8,
    baseLightRadius: 5,
    trapCount: 3,
    crackedWallCount: 4,
    doorCount: 2,
    forageCount: 2,
    eliteChance: 0.2,
    // 2, not 1. At 1251 walkable tiles this was the sparsest level in the game
    // for lore by a wide margin (0.8 per 1000 tiles against a 1.3-4.9 range),
    // and one fragment would now be spent entirely on the reliquary hint —
    // leaving no room for the marble and the statues, which are the level.
    loreCount: 2, // a last pair of fragments before the throne
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
    sconces: 0, // nothing here is tended. Malachar is the only light
    generator: "digger",
    monsterBudget: 9,
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
