// ─────────────────────────────────────────────────────────────────────────
// Environmental storytelling — short lore fragments you stumble on by exploring
// (bump/step a prop → read a modal). No cost, no boon: the payoff is STORY. Each
// biome has a small pool; the generator (`placeLore`) drops `LevelConfig.loreCount`
// props off the main path and assigns distinct entries from the level's pool.
// They deepen the Ember-of-Dawn / Malachar arc without gating anything on them.
// ─────────────────────────────────────────────────────────────────────────
import type { Biome, LoreKind } from "@/game/core/types";

export interface LoreEntry {
  kind: LoreKind;
  title: string;
  text: string;
}

// Keyed by biome. A level pulls from its own biome's pool (sub-biomes don't
// matter — the props sit anywhere on the level). Falls back to `dungeon`.
export const LORE_POOLS: Record<Biome, LoreEntry[]> = {
  dungeon: [
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
      text: "A warden's notice, ink run with rain: BY ORDER — none to enter the Blackwood after dusk. The wood remembers the day the sky went out, and it has not forgiven the living for surviving it.",
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
      text: "Bones tangled in the reeds, a pilgrim's medallion at the throat: the broken Ember, worn as a vow. They came to cross the Mire toward the castle. The Mire kept them.",
    },
    {
      kind: "inscription",
      title: "Cut into a leaning post",
      text: "SHRINE — 200 paces. Below, in a shakier hand: there is no shrine. i have walked 2000 paces. the water moves it. do not trust the dry ground.",
    },
  ],
  mountain: [
    {
      kind: "inscription",
      title: "The border-watch log",
      text: 'Frozen to a cairn: "…the bridge-troll, Gorm, will not be reasoned with nor bribed. He was set to guard the pass by Malachar himself. We turn back. May the Dawn forgive our retreat."',
    },
    {
      kind: "remains",
      title: "A frozen climber",
      text: "A body sits cross-legged in the ice, perfectly preserved, facing the summit as if resting. In its lap, a map of the Frostspine — and every route to the castle scratched out but one.",
    },
  ],
  castle: [
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
      text: '"HERE LIES THE LIGHT-BEARER, WHO CARRIED THE SUNBLADE." The tomb is broken open from the inside. The blade is not here — but a fresh drag-mark leads down, toward the rising water.',
    },
    {
      kind: "remains",
      title: "A reliquary's keeper",
      text: 'A robed skeleton clutches an empty scabbard sized for a great sword. Etched inside: "Only the Sunblade wounds him. Guard it past my death. Guard it past yours." The keeper kept faith to the last.',
    },
    {
      kind: "inscription",
      title: "Carved above the waterline",
      text: '"When the crypt drowns, the dead rise to breathe." The stone is wet to the touch. The water is higher than it was a moment ago.',
    },
  ],
  throne: [
    {
      kind: "inscription",
      title: "The base of the throne",
      text: 'Beneath a hundred years of soot, the old words are still legible: "THE DAWN IS NOT KEPT. THE DAWN IS KINDLED." Malachar sits above them, and has never once looked down.',
    },
  ],
  cavern: [
    {
      kind: "remains",
      title: "A prospector's lamp",
      text: "A cold lantern beside a pick and a scatter of bones. The prospector chased the glowing fungus deeper and deeper, mistaking its light for a way out. The glow is not the sun. It was never the sun.",
    },
  ],
};

export function loreForBiome(biome: Biome): LoreEntry[] {
  return LORE_POOLS[biome] ?? LORE_POOLS.dungeon;
}
