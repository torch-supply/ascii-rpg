// ─────────────────────────────────────────────────────────────────────────
// Environmental storytelling — short lore fragments you stumble on by exploring
// (bump/step a prop → read a modal). No cost, no boon: the payoff is STORY. Each
// biome has a small pool; the generator (`placeLore`) drops `LevelConfig.loreCount`
// props off the main path and assigns distinct entries from the level's pool.
// They deepen the Ember-of-Dawn / Malachar arc without gating anything on them.
// ─────────────────────────────────────────────────────────────────────────
import type { Biome, LoreKind, StatusKind } from "@/game/core/types";

export interface LoreEntry {
  kind: LoreKind;
  title: string;
  text: string;
  /**
   * Restrict this fragment to these level ids. Omit for "anywhere its biome is".
   *
   * A pool is keyed by BIOME, on the principle that a fragment should speak for
   * where it lies. That holds until one biome turns up in two different PLACES,
   * which is what happened when the Great Hall gained a `crypt` undercroft and
   * an `ashen` collapsed nave: every `crypt` fragment had been written for the
   * Sunken Crypt and narrated a flood ("toward the rising water", "when the
   * crypt drowns") in a dry cellar two levels early, one of them naming the
   * Sunblade before the game introduces it; both `ashen` fragments described the
   * siege outside the gate — a slagged ram, burned fields — while sitting inside
   * a cathedral. The undercroft and the tomb share a biome and are not the same
   * place, and neither are the burned approach and a hole in a roof.
   *
   * So: a fragment tied to a specific place declares it, and the genuinely
   * biome-general ones stay unrestricted and serve both.
   */
  levels?: string[];
  /**
   * A MECHANICAL claim this fragment makes, declared so a test can hold it true.
   *
   * Lore that tells you how to fight something is only worth reading if it is
   * right — and prose drifts silently. A fragment saying "frost cannot touch
   * it" stays true exactly as long as `MonsterDef.resist` says so; change that
   * dial and the game starts lying to the player forever, with nothing to catch
   * it. Declaring the claim makes it checkable (test `[75]`), and also pins the
   * fragment somewhere the knowledge is USABLE — a warning about the troll is
   * worthless on a level the troll never appears on.
   *
   * Clues are an ADVANTAGE, never a gate: props are drawn at random from a pool
   * larger than `loreCount`, so a given fragment reaches you on 22-89% of runs
   * depending on the level. Nothing may require one.
   */
  claims?: {
    /** a monster the fragment gives advice about */
    monsterId?: string;
    /** the status it says the monster shrugs off — must match `resist` < 1 */
    resists?: StatusKind;
    /**
     * The fragment says this level hides a VAULT. Deliberately not directional:
     * the vault's position is generated per seed, so "behind the north wall"
     * would be wrong most of the time. What IS stable is authored — the kind of
     * gate, which is the actionable part (bashing through a cracked wall and
     * hunting a shut door are different searches), and whether something is
     * sealed in with the hoard.
     */
    vault?: { gate: "door" | "crackedWall"; guarded?: boolean };
  };
}

// Keyed by biome, and drawn PER REGION — a prop reads from the pool of the
// region it actually sits in, not the level's base biome, so sub-region-only
// pools (grove/undercity/cavern/ashen) reach the player at all. Falls back to
// `dungeon`.
export const LORE_POOLS: Record<Biome, LoreEntry[]> = {
  dungeon: [
    {
      kind: "inscription",
      title: "Scratched low, where a man lying down could reach",
      text: "the gaolers keep their own stores behind the far door. bread, lamp oil, the good rope. it was never even locked.\n\nthey never once thought we would get out of the cells.",
      levels: ["dungeon_depths"],
      claims: { vault: { gate: "door" } },
    },
    {
      kind: "inscription",
      title: "Scratched into the stone",
      text: "day 40, or 50 — no sun to count by. the jailer stopped bringing bread. i can hear him singing to the dark now, same as the others. if you can still read this: don't sing back.",
    },
    {
      kind: "remains",
      title: "A prisoner's remains",
      text: "A skeleton slumped against the bars, one hand still gripping a rusted spoon worn to a blade's edge. Whatever it dug toward, it never reached. A scrap of cloth bears the sun-sigil of the old dawn-guard.",
    },
    {
      kind: "inscription",
      title: "Tally on the wall",
      text: "Rows of scratches, hundreds, then a single deep gouge dragged down through all of them — as if the counter finally understood no one was coming.",
    },
  ],
  forest: [
    {
      kind: "remains",
      title: "A woodcutter's pack",
      text: 'Moss has half-swallowed a rucksack: a snapped axe, a child\'s carved toy, a letter gone to pulp. Only one line survives — "…if the shards still glow, follow them and do not look back at the—"',
    },
    {
      kind: "inscription",
      title: "Nailed to a black trunk",
      text: "A warden's notice, ink run with rain: BY ORDER — none to enter the deep wood after dusk. The trees remember the day the sky went out, and they have not forgiven the living for surviving it.",
    },
    {
      kind: "remains",
      title: "A shrine to the Dawn",
      text: "A little roadside shrine, its sun-idol smashed. Someone knelt here recently — fresh candle-stubs, burned to nothing. They prayed for light in the one place light no longer comes.",
    },
  ],
  marsh: [
    {
      kind: "remains",
      title: "A pilgrim, drowned",
      text: "Bones tangled in the reeds, a pilgrim's medallion at the throat: the broken Ember, worn as a vow. They came to cross the black water toward the castle. The bog kept them.",
    },
    {
      kind: "inscription",
      title: "Cut into a leaning post",
      text: "SHRINE — 200 paces. Below, in a shakier hand: there is no shrine. i have walked 2000 paces. the water moves it. do not trust the dry ground.",
    },
    {
      kind: "remains",
      title: "A causeway marker, sunk",
      text: "A waymarker leans out of the water at the wrong angle, its carved hand pointing straight down into the bog. It pointed somewhere, once. The road it pointed along is under six feet of black water and the reeds have closed over it entirely.",
    },
  ],
  mountain: [
    {
      kind: "inscription",
      title: "A hunter's warning, cut into the cairn",
      text: "Whoever comes after: the thing on the bridge is MADE of the cold. We set a frost-edge to it and it slowed for half a heartbeat and came on anyway. Do not bring frost to a creature of ice.\n\nBring weight. Bring something that breaks bone.",
      levels: ["frostspine_pass"],
      claims: { monsterId: "frost_troll", resists: "chill" },
    },
    {
      kind: "remains",
      title: "A trapper's last cache",
      text: "Snares, a bone whistle, and a tally of pelts that stops mid-row. Scratched on the flat of a rock beside him:\n\nTHE SEAM IN THE ROCK IS THIN — I CAN HEAR IT BREATHING THROUGH. WHATEVER DEN IS BEHIND THERE, LEAVE IT WALLED.",
      levels: ["frostspine_pass"],
      claims: { vault: { gate: "crackedWall", guarded: true } },
    },
    {
      kind: "inscription",
      title: "The border-watch log",
      text: 'Frozen to a cairn: "…the bridge-troll, Gorm, will not be reasoned with nor bribed. He was set to guard the pass by Malachar himself. We turn back. May the Dawn forgive our retreat."',
    },
    {
      kind: "inscription",
      title: "Claw-marks, shoulder-high",
      text: "Four gouges raked deep into the rock, and beneath them someone has scratched a single word: DON'T. Whatever left these was not starving — it was marking a door.",
    },
    {
      kind: "remains",
      title: "A frozen climber",
      text: "A body sits cross-legged in the ice, perfectly preserved, facing the summit as if resting. In its lap, a map of the high passes — and every route to the castle scratched out but one.",
    },
  ],
  castle: [
    {
      kind: "remains",
      title: "A runner's tally, pinned by a knife",
      text: "POWDER — TOWER. BANDAGE — TOWER. OIL, SPIRITS, THE SPARE CORDS — TOWER.\n\nBeneath it, in a different and much steadier hand: then someone had better go and get it.",
      levels: ["ramparts"],
      claims: { vault: { gate: "door" } },
    },
    {
      kind: "inscription",
      title: "A verger's key-list",
      text: "Every line scored through but one: THE RELIQUARY — STILL SHUT. STILL FULL.\n\nNobody has had the nerve to work that door since the Herald took the hall, and the key is on a ring around a neck nobody wants to search.",
      levels: ["antechamber"],
      claims: { vault: { gate: "door" } },
    },
    {
      kind: "inscription",
      title: "A sacrist's inventory",
      text: "Plate, chain, the reliquary silver — each line struck through and re-entered under one heading: MOVED TO THE STRONGROOM. The last line adds, smaller:\n\nthe door holds. it was never the door we needed to worry about.",
      levels: ["great_hall"],
      claims: { vault: { gate: "door" } },
    },
    {
      kind: "inscription",
      title: "A herald's proclamation",
      text: 'Gilt letters, defaced: "…on this day King— " — the name gouged away — "…yields Blackhall to the Lich Malachar, that the realm might know a hundred years of merciful dusk." Someone has scrawled beneath it: MERCIFUL.',
    },
    {
      kind: "remains",
      title: "A guardsman at his post",
      text: "Armor rusted to the shape of a man still standing watch, halberd fused to bone. He never left his post. Perhaps he no longer could — perhaps he simply would not.",
    },
    {
      kind: "inscription",
      title: "A servant's diary page",
      text: '"They do not eat. They do not sleep. They stand in the halls at night with their eyes open, and in the morning they polish the silver as if nothing is wrong. I am the last one who still dreams. I am so tired of dreaming."',
    },
    {
      kind: "remains",
      title: "A besieger's helm",
      text: "A dented helm bearing the sun-sigil, far from any body — flung from the ramparts, perhaps. The last army to storm Blackhall came by night, torches held high. The torches are what the walls remember. The men are not.",
    },
    {
      kind: "inscription",
      title: "Chalked on a cell door",
      text: "A child's height-marks up a doorframe, years of them, then nothing. Beside the last: \"we don't grow here anymore.\" The castle folk were not all soldiers. Not all of them chose this.",
    },
  ],
  crypt: [
    {
      kind: "inscription",
      title: "An epitaph, defiled",
      levels: ["sunken_crypt"], // the drowning tomb: the flood + the Sunblade
      text: '"HERE LIES THE LIGHT-BEARER, WHO CARRIED THE SUNBLADE." The tomb is broken open from the inside. The blade is not here — but a fresh drag-mark leads down, toward the rising water.',
    },
    {
      kind: "remains",
      title: "A reliquary's keeper",
      levels: ["sunken_crypt"], // the drowning tomb: the flood + the Sunblade
      text: 'A robed skeleton clutches an empty scabbard sized for a great sword. Etched inside: "Only the Sunblade wounds him. Guard it past my death. Guard it past yours." The keeper kept faith to the last.',
    },
    {
      kind: "inscription",
      title: "Carved above the waterline",
      levels: ["sunken_crypt"], // the drowning tomb: the flood + the Sunblade
      text: '"When the crypt drowns, the dead rise to breathe." The stone is wet to the touch. The water is higher than it was a moment ago.',
    },
    {
      kind: "inscription",
      title: "The undercroft ledger",
      text: "A slate propped by the stair, ruled in a careful hand: name, house, date, INTERRED. The last forty entries share a single date. Beneath them, the same hand gone unsteady: no more room. no more room. we are laying them in the halls above.",
    },
    {
      kind: "remains",
      title: "A gravedigger, unburied",
      text: "A spade, a lantern long burned dry, and a man who sat down against the wall and did not get up. The palms of his hands are worn through to the bone. He put the castle's dead in the ground until there was no one left to put him in it.",
    },
    {
      kind: "inscription",
      title: "Stacked to the vaulting",
      text: "Skulls and long bones sorted by size and laid in courses like masonry, ten feet high, the whole length of the passage. Someone was careful. Someone counted. Cut small into the end stone: WE KEPT THEM TIDY. IT DID NOT HELP.",
    },
  ],
  throne: [
    {
      kind: "inscription",
      title: "The base of the throne",
      levels: ["throne_of_dusk"], // Malachar is sitting above it
      text: 'Beneath a hundred years of soot, the old words are still legible: "THE DAWN IS NOT KEPT. THE DAWN IS KINDLED." Malachar sits above them, and has never once looked down.',
    },
    {
      kind: "inscription",
      title: "Where the marble begins",
      text: "Black stone veins up through the flagstones here, spreading outward from the doors ahead like frost across glass. It is not mortared in. The masons' marks stop three bays short of it — they stopped cutting when the floor no longer needed them to.",
      levels: ["antechamber"],
    },
    {
      kind: "remains",
      title: "A herald's understudy",
      text: "A body in the livery of the house, face-down, one arm outstretched toward the far end of the gallery. No wound. The figures on their plinths to either side are turned very slightly inward — and you are fairly certain they were not, a moment ago.",
      levels: ["antechamber"],
    },
    {
      kind: "inscription",
      title: "The dais steps",
      text: "Seven steps, each worn hollow in the centre by a hundred years of one man's weight. He comes down them, then. He does not always sit. Scratched small into the lowest step, by someone kneeling: IT IS COLDER UP THERE.",
      levels: ["throne_of_dusk"],
    },
  ],
  cavern: [
    {
      kind: "remains",
      title: "A prospector's lamp",
      text: "A cold lantern beside a pick and a scatter of bones. The prospector chased the glowing fungus deeper and deeper, mistaking its light for a way out. The glow is not the sun. It was never the sun.",
    },
    {
      kind: "inscription",
      title: "Chalked at a fork",
      text: "Two arrows, one scratched out. Beside the survivor: FOLLOW THE COLD AIR, NOT THE LIGHT. The letters are shaky and very old, and whoever wrote them was passing on the only advice that has ever worked down here.",
    },
  ],
  grove: [
    {
      kind: "remains",
      title: "A forager, wreathed in caps",
      text: "Pale fruiting bodies have grown through a body still kneeling, basket in hand. The mushrooms of the Mire were food, once — before the sky went out and the things that grow here started growing wrong.",
    },
    {
      kind: "inscription",
      title: "Scratched on a leaning boardwalk plank",
      text: "the pretty ones are the poison. the light is bait. i have watched three men walk toward the glow and not one walked back, and i am so tired, and it is so beautiful.",
    },
  ],
  undercity: [
    {
      kind: "inscription",
      title: "A sluice-gate marker",
      text: "BLACKHALL UNDERWORKS — SLUICE VII. KEEP CLEAR WHEN THE GATES ARE DRAWN. Below, newer and deeper: nobody draws them now. Nobody is left who knows how.",
    },
    {
      kind: "remains",
      title: "A drowned sewer-warden",
      text: "Chained to his post by his own belt — deliberately, so the current couldn't take him. He stayed to shut the gates while the water rose. The crypt above floods because he failed, and the ring of keys is still on his hip, green with rot.",
    },
  ],
  sanctum: [
    {
      kind: "inscription",
      title: "The Font",
      text: "A stone basin, brim-full — not with water they poured, but with water that came. The bog has been filling it for a hundred years and it has never once overflowed.\n\nSomething down there is still drinking.",
    },
    {
      kind: "remains",
      title: "Pilgrims, Kneeling",
      text: "They are still in rows. Still facing the altar. The mud took them where they knelt and held them there, and the reeds have grown up through them in orderly lines.\n\nNone of them are facing the door.",
    },
    {
      kind: "inscription",
      title: "The Last Rite",
      text: "Cut hastily into the altar stone, over older and finer carving:\n\nTHE EMBER DOES NOT ANSWER. WE WILL WAIT ANYWAY.",
    },
  ],
  graveyard: [
    {
      kind: "inscription",
      title: "A quartermaster's chalk mark",
      text: "Half-washed from a grave-marker, in a hand that had no business here: STORES SEALED — BREACH THE COURSE, DO NOT LOOK FOR A DOOR. THERE ISN'T ONE.\n\nThey walled their own supplies in when the siege closed. Whatever is still in there has been in there a hundred years.",
      levels: ["iron_gate"],
      claims: { vault: { gate: "crackedWall" } },
    },
    {
      kind: "inscription",
      title: "A Leaning Headstone",
      text: "HERE LIE THE WARDENS OF THE GATE\nwho held it, and held it, and held it.\n\nThe last name is cut smaller than the rest, as though the mason had run out of stone — or out of time.",
    },
    {
      kind: "inscription",
      title: "A Family Plot",
      text: "Six markers in a row, five of them weathered smooth. The sixth is new: the earth over it has not yet settled, and there are no flowers, and no footprints but your own.",
    },
    {
      kind: "remains",
      title: "A Gravedigger's Spade",
      text: "The handle is worn to the shape of two hands. Beside it, a row of open graves — dug, squared, and never filled.\n\nWhoever dug them knew how many would be needed. They were not wrong. They simply never came back to finish.",
    },
    {
      kind: "inscription",
      title: "The Chapel Door",
      text: "A prayer to the Ember is carved above the lintel, and someone has struck through the last line with a chisel.\n\nWhat remains reads: KEEP THE FLAME. What was cut, you can still just make out: AND IT WILL KEEP YOU.",
    },
  ],
  ashen: [
    {
      kind: "inscription",
      title: "Scorched into the gate-stone",
      levels: ["iron_gate"], // the burned siege approach, not a fallen roof
      text: "They burned their own approach — every field, every barn, so the besiegers would find nothing. It did not matter. Malachar does not need bread. Only the ash remembers there was ever a harvest here.",
    },
    {
      kind: "remains",
      title: "A siege-engine, slagged",
      levels: ["iron_gate"], // the burned siege approach, not a fallen roof
      text: "The ribs of a great ram, fused into a run of cooled slag. Whatever fire took it was no ordinary flame — it burned green, the survivors' scratchings say, and it did not go out until there was nothing left to want.",
    },
    {
      kind: "inscription",
      title: "Under the open roof",
      text: "The vaulting came down here long ago and the sky comes down through the gap — grey, ash-choked, but daylight. Someone has swept a clean circle on the flagstones directly beneath it, and knelt in that circle often enough to wear the stone hollow.",
      levels: ["great_hall"],
    },
    {
      kind: "remains",
      title: "In the ash beneath the gap",
      text: "A body laid out with its arms crossed, facing up through the broken roof. There is no wound on it. Whoever carried it here climbed the rubble to do it, and left it looking at the only daylight left in the castle.",
      levels: ["great_hall"],
    },
  ],
};

/**
 * Every fragment, keyed by title — the lore JOURNAL's lookup.
 *
 * `GameState.lore` is per-LEVEL: a fresh `beginLevel` generates new props, so a
 * fragment you read on the Blackwood is gone by the Mire. The journal therefore
 * records only TITLES on the player (which carries across levels) and resolves
 * the prose here, rather than copying text into the save. All 44 titles are
 * distinct, and test `[0]` keeps them that way — the index would silently drop
 * a fragment otherwise.
 */
const BY_TITLE: Record<string, LoreEntry> = Object.fromEntries(
  Object.values(LORE_POOLS).flatMap((pool) =>
    pool.map((e) => [e.title, e] as const),
  ),
);
export function loreByTitle(title: string): LoreEntry | undefined {
  return BY_TITLE[title];
}

export function loreForBiome(biome: Biome, levelId?: string): LoreEntry[] {
  const pool = LORE_POOLS[biome] ?? LORE_POOLS.dungeon;
  // An unrestricted fragment fits anywhere its biome does; a restricted one
  // names the place it was written for (see `LoreEntry.levels`).
  return pool.filter(
    (e) => !e.levels || (!!levelId && e.levels.includes(levelId)),
  );
}
