import type { LogKind } from "./logStyle";

/**
 * Real message lines, each with the colour category it must land in.
 *
 * Taken from the templates in `actions/index.ts` / `status.ts` with the
 * interpolations filled in — never invented prose, because `classifyLog` is a
 * heuristic OVER THIS TEXT and a made-up sample proves nothing. One list, read
 * by both core test [64] (which asserts every line) and the `/style` gallery
 * (which paints every line on the real rail): the gallery used to keep its own
 * 7-line excerpt, and the kill lines it didn't show were the ones miscoloured.
 *
 * Reword a message and its entry here should move with it.
 */
export const LOG_CORPUS: readonly (readonly [string, LogKind])[] = [
  // your own blows — numbers, but you are the subject
  ["You strike the Skeleton for 8 (4 left).", "attack"],
  ["Critical! You strike the Goblin for 14 (2 left).", "attack"],
  ["Sneak attack! You hit the Skeleton for 12 (0 left).", "attack"],
  ["Out of arrows — you jab the Goblin for 1.", "attack"],
  ["You smash the Goblin clean through a cracked wall!", "attack"],
  ["You hack at the cracked wall. (2 more)", "attack"],
  // deaths — every path into `awardKill` words its own line
  ["You slay the Skeleton.", "kill"],
  ["A silent kill — the Skeleton never woke.", "kill"],
  ["A critical blow fells the Goblin!", "kill"],
  ["You hurl the Goblin into the depths!", "kill"],
  ["You batter down the Skeleton with your bow.", "kill"],
  ["The Firebomb bursts into flame! 2 slain.", "kill"],
  ["The Goblin succumbs.", "kill"],
  // harm — you are the object
  ["The Skeleton hits you for 2.", "harm"],
  ["The Bog Imp hurls a bolt for 3.", "harm"],
  ["Dark fire crashes down on you for 12!", "harm"],
  ["A hidden spike trap! You take 4 damage.", "harm"],
  ["The volatile creature bursts apart — the blast catches you!", "harm"],
  ["You choke on a lungful of spores!", "harm"],
  ["Thorns rake you — you're bleeding.", "harm"],
  ["The Gargoyle Sentinel hurls you off the edge into the void!", "harm"],
  ["The Gargoyle Sentinel throws you back.", "harm"],
  ["The Gargoyle Sentinel looms — the void yawns at your back!", "harm"],
  ["You are poisoned!", "harm"],
  ["You catch fire!", "harm"],
  // …but the SAME status template aimed at a monster is not harm to you
  ["The Skeleton is poisoned!", "neutral"],
  // healed / warded
  ["You drink the Healing Potion. (+10 hp)", "good"],
  ["You gather wild growth — +1 HP.", "good"],
  ["A shimmer of warding wraps you. (6 turns)", "good"],
  // loot
  ["You pick up 6 gold.", "gain"],
  ["You pick up a Healing Potion.", "gain"],
  ["You recover a Sunblade.", "gain"],
  ["You gather 12 Arrows.", "gain"],
  // ordinary chatter
  ["You take up the War Axe, setting down the Frostbrand.", "neutral"],
  ["You shove the door open.", "neutral"],
  // wildlife scattered by a blow is NOT a kill (`awardKill` refuses ambients),
  // a bomb that kills nothing is not one either, and a boss bracing at a brink
  // is not harm — all must stay neutral
  ["The Carrion Raven scatters.", "neutral"],
  ["The Will-o'-Wisp gutters out at your touch.", "neutral"],
  ["The Firebomb bursts into flame!", "neutral"],
  ["The Gate Warden braces at the brink and will not fall!", "neutral"],
  ["The Skeleton drops a Healing Potion.", "neutral"],
  ["Your torch gutters out. The dark closes back in.", "neutral"],
  ["The water rises higher.", "neutral"],
];
