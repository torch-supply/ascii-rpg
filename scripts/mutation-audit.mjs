// Mutation-audit harness — a TEST OF THE TESTS. Neutralizes a real formula term
// or config dial in the game source, runs all three suites, and restores the file.
// A mutation that SURVIVES every suite is either a coverage hole or an equivalent
// mutant (judged by hand — see CLAUDE.md for the four known-equivalent ones).
//
// Run with: node scripts/mutation-audit.mjs      (~2 min; not part of test:all)
//
// Add a row whenever you add a tuning dial or a formula term. Two lessons this
// harness taught, both worth remembering when reading a survivor:
//   • An assertion written RELATIVE to the constant it means to pin passes when
//     that constant is zeroed. Pair it with an absolute anchor.
//   • A survivor can appear because the BOT got stronger, not because a test
//     changed — improving verify-playthrough's bot silently deleted coverage of
//     `minSpawnDistanceFromPlayer`, which is why that moved into verify-core.
//
// `find` strings are matched LITERALLY against the file, so a Prettier reflow can
// silently turn a mutation into a no-op. The runner reports those as PATCH-MISSED
// rather than counting them as caught — never ignore that line.
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const F = {
  combat: "src/game/core/combat.ts",
  goals: "src/game/core/goals.ts",
  grid: "src/game/core/grid.ts",
  status: "src/game/core/status.ts",
  config: "src/content/config.ts",
  gen: "src/game/core/map/generate.ts",
  act: "src/game/core/actions/index.ts",
  inv: "src/game/core/inventory.ts",
  state: "src/game/core/state.ts",
  altar: "src/game/core/altar.ts",
  light: "src/render/lighting.ts",
  store: "src/store/gameStore.ts",
};

// [label, file, find, replace]
const MUTATIONS = [
  // ── combat formulas ──
  [
    "min-1 player damage floor removed",
    F.combat,
    "  return Math.max(\n    1,\n    player.weaponPower",
    "  return Math.max(\n    0,\n    player.weaponPower",
  ],
  [
    "Might bonus ignored",
    F.combat,
    "player.weaponPower + player.weaponBonus + might - target.armor",
    "player.weaponPower + player.weaponBonus - target.armor",
  ],
  [
    "Ward no longer halves damage",
    F.combat,
    "return (player.effects.ward ?? 0) > 0 ? Math.max(1, Math.ceil(dmg / 2)) : dmg;",
    "return dmg;",
  ],
  [
    "class damageReduction ignored",
    F.combat,
    "const dr = classDef(player.classId).damageReduction ?? 0;",
    "const dr = 0;",
  ],
  [
    "monster armorPierce ignored",
    F.combat,
    "player.armorReduction - (attacker.armorPierce ?? 0)",
    "player.armorReduction - 0",
  ],
  [
    "monster attack skips mitigate()",
    F.combat,
    "  return mitigate(player, base);",
    "  return base;",
  ],
  [
    "min-1 monster damage floor removed",
    F.combat,
    "const base = Math.max(1, attacker.dmg + dmgBonus - effectiveArmor);",
    "const base = attacker.dmg + dmgBonus - effectiveArmor;",
  ],

  // ── goals ──
  [
    "collectX completes on the FIRST pickup",
    F.goals,
    '    case "collectX":\n      return (state.questProgress[goal.questTag] ?? 0) >= goal.count;',
    '    case "collectX":\n      return (state.questProgress[goal.questTag] ?? 0) >= 1;',
  ],
  [
    "findItem completes instantly (>= 0)",
    F.goals,
    '    case "findItem":\n      return (state.questProgress[goal.questTag] ?? 0) >= 1;',
    '    case "findItem":\n      return (state.questProgress[goal.questTag] ?? 0) >= 0;',
  ],
  [
    "killTarget never completes",
    F.goals,
    "      return !state.monsters.some((m) => m.isGoalTarget);",
    "      return false;",
  ],
  [
    "survive completes immediately",
    F.goals,
    '    case "survive":\n      return state.turnCount >= goal.turns;',
    '    case "survive":\n      return state.turnCount >= 0;',
  ],
  [
    "par bonus paid on survive levels too",
    F.goals,
    '  if (config.goal.type === "survive") return 0;',
    "  if (false) return 0;",
  ],
  [
    "par bonus unclamped (negative/over-1 allowed)",
    F.goals,
    "    Math.min(1, (config.turnLimit - turnCount) / config.turnLimit),",
    "    (config.turnLimit - turnCount) / config.turnLimit,",
  ],

  // ── grid / FOV ──
  [
    "water is walkable",
    F.grid,
    '  return (\n    t === "floor" ||',
    '  return (\n    t === "water" ||\n    t === "floor" ||',
  ],
  [
    "chasm is walkable",
    F.grid,
    '  return (\n    t === "floor" ||',
    '  return (\n    t === "chasm" ||\n    t === "floor" ||',
  ],
  [
    "shut door no longer blocks sight",
    F.grid,
    'return t !== "wall" && t !== "crackedWall" && t !== "door";',
    'return t !== "wall" && t !== "crackedWall";',
  ],
  [
    "walls are transparent (total FOV leak)",
    F.grid,
    'return t !== "wall" && t !== "crackedWall" && t !== "door";',
    'return t !== "crackedWall" && t !== "door";',
  ],
  ["bramble no longer walkable", F.grid, '    t === "bramble" ||', ""],

  // ── status ──
  ["poison deals no damage", F.status, "dmgPerTurn: 2,", "dmgPerTurn: 0,"],
  ["bleed deals no damage", F.status, "dmgPerTurn: 3,", "dmgPerTurn: 0,"],
  ["burn deals no damage", F.status, "dmgPerTurn: 4,", "dmgPerTurn: 0,"],
  [
    "Antidote cures nothing",
    F.status,
    'export const DAMAGING_STATUS: StatusKind[] = ["poison", "bleed", "burn"];',
    "export const DAMAGING_STATUS: StatusKind[] = [];",
  ],
  [
    "status refresh overwrites instead of taking the longer timer",
    F.status,
    "effects[kind] = Math.max(effects[kind] ?? 0, duration);",
    "effects[kind] = duration;",
  ],

  // ── generator guarantees ──
  [
    "ensureTrapsAvoidable disabled",
    F.gen,
    "  ensureTrapsAvoidable(map, playerStart);",
    "  // ensureTrapsAvoidable(map, playerStart);",
  ],
  [
    "sealUnreachable disabled",
    F.gen,
    "  sealUnreachable(map, playerStart);",
    "  // sealUnreachable(map, playerStart);",
  ],
  [
    "lootScale not applied (loot inflation)",
    F.gen,
    "const dropCount = Math.round(config.itemDropCount * CONFIG.lootScale);",
    "const dropCount = config.itemDropCount;",
  ],
  [
    "forageScale not applied",
    F.gen,
    "const count = Math.round((config.forageCount ?? 0) * CONFIG.forageScale);",
    "const count = config.forageCount ?? 0;",
  ],

  // ── global tuning dials ──
  [
    "sneak multiplier neutralized",
    F.config,
    "sneakMultiplier: 2,",
    "sneakMultiplier: 1,",
  ],
  [
    "cracked walls break in one bump",
    F.config,
    "crackedWallToughness: 4,",
    "crackedWallToughness: 1,",
  ],
  ["traps deal no damage", F.config, "trapDamage: 6,", "trapDamage: 0,"],
  [
    "monsters never lose interest",
    F.config,
    "loseInterestTurns: 6,",
    "loseInterestTurns: 9999,",
  ],
  [
    "Shadowcloak stops hiding you",
    F.config,
    "shadowSightRadius: 2,",
    "shadowSightRadius: 99,",
  ],
  [
    "spore haze no longer poisons",
    F.config,
    "poisonDuration: 4,",
    "poisonDuration: 0,",
  ],
  [
    "bramble no longer bleeds",
    F.config,
    "brambleBleedDuration: 3,",
    "brambleBleedDuration: 0,",
  ],
  [
    "volatile elites don't explode",
    F.config,
    "eliteExplodeDamage: 6,",
    "eliteExplodeDamage: 0,",
  ],
  ["Blink teleports nowhere", F.config, "blinkRange: 5,", "blinkRange: 0,"],
  ["Might potion does nothing", F.config, "mightBonus: 4,", "mightBonus: 0,"],
  ["par bonus always zero", F.config, "parBonusMax: 120,", "parBonusMax: 0,"],
  [
    "monsters can spawn on top of the player",
    F.config,
    "minSpawnDistanceFromPlayer: 6,",
    "minSpawnDistanceFromPlayer: 0,",
  ],
  [
    "torch fuel effectively infinite",
    F.config,
    "torchFuel: 150,",
    "torchFuel: 999999,",
  ],
  ["firebomb throw range 0", F.config, "throwRange: 7,", "throwRange: 0,"],
  ["decals never recorded", F.config, "maxDecals: 220,", "maxDecals: 0,"],
  [
    "shop pays nothing when selling",
    F.config,
    "sellRate: 0.4,",
    "sellRate: 0,",
  ],
  [
    "coin piles worthless",
    F.config,
    "coinPile: { min: 3, max: 9 },",
    "coinPile: { min: 0, max: 0 },",
  ],
  ["siege waves never spawn", F.config, "waveEvery: 3,", "waveEvery: 999999,"],
  ["siege cap of 1", F.config, "cap: 19,", "cap: 1,"],

  // ── generate.ts internals — 1,992 lines that had only 4 mutations. The soak
  // checks its OUTPUT guarantees; these probe the placement rules themselves.

  // journey shape: where the quest reward / boss lands
  [
    "quest items lose their open-ground preference (land in corridors)",
    F.gen,
    "  return best && best.open >= 3 ? best.i : strictFarthest;",
    "  return strictFarthest;",
  ],
  [
    "FAR_SLACK 0 — no shape/distance tradeoff at the far end",
    F.gen,
    "const FAR_SLACK = 6; // tiles of distance we'll trade for a better-shaped spot",
    "const FAR_SLACK = 0; // tiles of distance we'll trade for a better-shaped spot",
  ],
  [
    "pickCell ignores its filter (spawn rules bypassed)",
    F.gen,
    "  if (cands.length === 0) {\n    const relaxed = floors.filter((i) => !occupied.has(i));",
    "  if (true) {\n    const relaxed = floors.filter((i) => !occupied.has(i));",
  ],

  // traps
  [
    "a trap may sit right beside the player's start",
    F.gen,
    "    if (manhattan(x, y, playerStart.x, playerStart.y) <= 1) continue;",
    "    if (false) continue;",
  ],
  [
    "traps no longer require a bypass (forced tolls)",
    F.gen,
    "    if (openOrthoCount(tiles, w, i) < 3) continue; // must have a way around it",
    "    if (false) continue; // must have a way around it",
  ],
  [
    "openOrthoCount always reports wide-open (chokepoint blindness)",
    F.gen,
    "  if (x < w - 1 && TRAP_OPEN.includes(tiles[i + 1])) n++;\n  return n;",
    "  if (x < w - 1 && TRAP_OPEN.includes(tiles[i + 1])) n++;\n  return 4;",
  ],

  // spore vents
  [
    "spore vents may cluster (clouds merge into one lethal fog)",
    F.gen,
    "    if (tooClose) continue;",
    "    if (false) continue;",
  ],
  [
    "SPORE_VENT_GAP 0",
    F.gen,
    "const SPORE_VENT_GAP = 5;",
    "const SPORE_VENT_GAP = 0;",
  ],

  // forage
  [
    "forage may spawn on the player's doorstep",
    F.gen,
    "      if (manhattan(x, y, playerStart.x, playerStart.y) <= 2) continue; // not on the doorstep\n      (openOrthoCount(tiles, w, i) <= 2 ? nooks : rest).push(i);",
    "      (openOrthoCount(tiles, w, i) <= 2 ? nooks : rest).push(i);",
  ],
  [
    "forage prefers the beeline over nooks",
    F.gen,
    "  const pool = [...shuffle(nooks), ...shuffle(rest)]; // nooks first (off the path)",
    "  const pool = [...shuffle(rest), ...shuffle(nooks)]; // nooks first (off the path)",
  ],

  // lore
  [
    "lore props prefer the beeline over nooks",
    F.gen,
    "  const cells = [...nooks, ...rest];",
    "  const cells = [...rest, ...nooks];",
  ],
  [
    "lore fragments may repeat within a level",
    F.gen,
    "    const fresh = pool.filter((e) => !usedTitles.has(e.title));",
    "    const fresh = pool;",
  ],

  // cracked walls / doors
  [
    "cracked walls no longer need to separate two spaces",
    F.gen,
    "      if (lr || ud) cands.push(i);",
    "      cands.push(i);",
  ],
  [
    "doors no longer need a 1-wide chokepoint",
    F.gen,
    "      if (horiz || vert) cands.push(i);",
    "      cands.push(i);",
  ],
  [
    "doors are generated SHUT (connectivity/pathing changed)",
    F.gen,
    '    tiles[cands[n]] = "doorOpen";\n    occupied.add(cands[n]);',
    '    tiles[cands[n]] = "door";\n    occupied.add(cands[n]);',
  ],
  [
    "a door may sit on the player's doorstep",
    F.gen,
    "      if (manhattan(x, y, playerStart.x, playerStart.y) <= 2) continue; // not on the doorstep\n      const horiz =",
    "      const horiz =",
  ],

  // flood plan
  [
    "the flood's dry spine is not protected",
    F.gen,
    "    if (protectedSet.has(i)) continue;",
    "    if (false) continue;",
  ],
  [
    "the dry spine is no longer dilated by one tile",
    F.gen,
    "      if (ni >= 0 && ni < map.tiles.length) protectedSet.add(ni);",
    "      if (false) protectedSet.add(ni);",
  ],
  [
    "open doors no longer conduct the flood",
    F.gen,
    '    if (t === "floor" || t === "doorOpen") floodable.push(i);',
    '    if (t === "floor") floodable.push(i);',
  ],
  [
    "flood seeds all cluster at the near end (one distant tide)",
    F.gen,
    "    seedSet.add(byDist[Math.floor(((k + 0.5) / seedCount) * byDist.length)]);",
    "    seedSet.add(byDist[k]);",
  ],

  // secret vault
  [
    "vault enclosure ignores diagonals (see-through corner)",
    F.gen,
    "        [-1, -1],\n        [1, -1],\n        [-1, 1],\n        [1, 1],\n      ];",
    "      ];",
  ],
  [
    "vault room shrinks to 1 tile deep",
    F.gen,
    "      for (let s = 0; s < 3 && ok; s++) {",
    "      for (let s = 0; s < 1 && ok; s++) {",
  ],

  // elite rolls at generation
  [
    "no monster ever rolls elite at generation",
    F.gen,
    "    if (!def.isBoss && eliteChance > 0 && mapInt(1, 100) <= eliteChance * 100) {",
    "    if (false) {",
  ],

  // ── actions/index.ts — the game's heart: AI, ticks, kills, hazards ──
  // (2365 lines, and the first audit pass reached it only indirectly through
  // config dials. These target the behavior directly.)

  // player attack resolution
  [
    "sneak bonus never applied",
    F.act,
    "  if (sneak)\n    dmg = Math.round(dmg * (cls.sneakMultiplier ?? CONFIG.sneakMultiplier));",
    "  if (false)\n    dmg = Math.round(dmg * (cls.sneakMultiplier ?? CONFIG.sneakMultiplier));",
  ],
  [
    "elite brute's armor bonus ignored",
    F.act,
    "  if (em) dmg = Math.max(1, dmg - em.armorBonus); // brutes shrug off blows",
    "  if (em) dmg = Math.max(1, dmg); // brutes shrug off blows",
  ],
  [
    "class crit never fires",
    F.act,
    "  const crit = (cls.critChance ?? 0) > 0 && rng.chance(cls.critChance!);",
    "  const crit = false;",
  ],
  [
    "striking a monster no longer alerts it",
    F.act,
    'if (canAlert) target.state = "chase"; // the blow alerts it',
    'if (false) target.state = "chase"; // the blow alerts it',
  ],
  [
    "weapon on-hit effects (Frostbrand chill) never apply",
    F.act,
    "    tryAfflict(\n      target.effects,\n      ITEMS[state.player.weaponId].onHit,",
    "    tryAfflict(\n      target.effects,\n      undefined,",
  ],

  // kill rewards
  [
    "elite coin reward not doubled",
    F.act,
    "  const coin = em ? def.coinReward * 2 : def.coinReward;",
    "  const coin = def.coinReward;",
  ],
  [
    "level kill counter never increments",
    F.act,
    "  state.levelKills += 1;",
    "  state.levelKills += 0;",
  ],
  [
    "monster loot never drops",
    F.act,
    "  dropLoot(state, m.x, m.y, def, rng, events, em != null);",
    "  // dropLoot(state, m.x, m.y, def, rng, events, em != null);",
  ],
  [
    "volatile elite never explodes on death",
    F.act,
    "  if (em?.explodes) explodeOnDeath(state, m, events);",
    "  // if (em?.explodes) explodeOnDeath(state, m, events);",
  ],
  [
    "blood decals never stamped",
    F.act,
    '  addDecal(state, idx(m.x, m.y, state.map.width), "blood"); // a lasting stain',
    '  // addDecal(state, idx(m.x, m.y, state.map.width), "blood");',
  ],

  // monster attack resolution
  [
    "monster melee deals no damage",
    F.act,
    '  state.player.hp -= dmg;\n  events.push({ kind: "hit", x: state.player.x, y: state.player.y });',
    '  events.push({ kind: "hit", x: state.player.x, y: state.player.y });',
  ],
  [
    "monsters never inflict their status effect",
    F.act,
    '    tryAfflict(state.player.effects, def.inflicts, rng, "You", events);',
    '    tryAfflict(state.player.effects, undefined, rng, "You", events);',
  ],
  [
    "being shoved into a chasm is survivable",
    F.act,
    "        p.hp = 0; // shoved off the edge → a fall (handled as a death upstream)",
    "        p.hp = Math.max(1, p.hp);",
  ],
  [
    "levitation no longer saves you from a shove over the void",
    F.act,
    "      if ((p.effects.levitate ?? 0) > 0) {\n        p.x = tx;",
    "      if (false) {\n        p.x = tx;",
  ],

  // weapon knockback
  [
    "shoving a monster into water/chasm no longer kills it",
    F.act,
    '    if (shoveTile === "water" || shoveTile === "chasm") {',
    "    if (false) {",
  ],
  [
    "knockback no longer smashes a cracked wall",
    F.act,
    '    if (tileAt(state.map, nx, ny) === "crackedWall") {',
    "    if (false) {",
  ],
  [
    "knockback shoves monsters through solid walls",
    F.act,
    "    if (!isWalkable(state.map, nx, ny)) return; // slams into a solid wall",
    "    if (false) return; // slams into a solid wall",
  ],

  // detection / stealth
  [
    "detection ignores the player's light radius (stealth dead)",
    F.act,
    "  const detectRange = Math.min(\n    def.sightRadius,\n    p.lightRadius,",
    "  const detectRange = Math.min(\n    def.sightRadius,\n    Infinity,",
  ],
  [
    "Shadowcloak no longer shrinks detection",
    F.act,
    "    (p.effects.shadow ?? 0) > 0 ? CONFIG.shadowSightRadius : Infinity,",
    "    Infinity,",
  ],
  [
    "monsters never lose interest (lostTurns frozen)",
    F.act,
    "    m.lostTurns = (m.lostTurns ?? 0) + 1;",
    "    m.lostTurns = 0;",
  ],
  [
    "bosses lose interest like everything else",
    F.act,
    '  } else if (m.state === "chase" && !def.isBoss) {',
    '  } else if (m.state === "chase") {',
  ],
  [
    "monsters home on your true position instead of last-seen",
    F.act,
    "    canDetect || def.isBoss || !m.lastSeen ? { x: p.x, y: p.y } : m.lastSeen;",
    "    { x: p.x, y: p.y };",
  ],

  // behaviors
  [
    "chilled monsters act anyway (freeze does nothing)",
    F.act,
    "  if ((m.effects?.chill ?? 0) > 0) return;",
    "  if (false) return;",
  ],
  [
    "slowChase shamblers act every turn",
    F.act,
    "      if (state.turnCount % 2 === 1) return;",
    "      if (false) return;",
  ],
  [
    "ranged attackers never reload (fire every turn)",
    F.act,
    "      } else if ((m.cooldown ?? 0) > 0) {",
    "      } else if (false) {",
  ],
  [
    "ambient wildlife uses hostile AI",
    F.act,
    '    case "ambient":\n      driftAmbient(state, m, def, rng);\n      return;',
    '    case "ambient":\n      chaseStep(state, m, def, events, rng, target);\n      return;',
  ],

  // status ticks
  [
    "damage-over-time ticks for 0",
    F.act,
    "    const dmg = STATUS[k].dmgPerTurn;\n    if (dmg <= 0) continue;\n    p.hp -= dmg;",
    "    const dmg = STATUS[k].dmgPerTurn;\n    if (dmg <= 0) continue;\n    p.hp -= 0;",
  ],
  [
    "Emberstep no longer wards off burn",
    F.act,
    '    if (k === "burn" && (e.emberstep ?? 0) > 0) continue; // ember-proof: fire doesn\'t bite',
    "    if (false) continue;",
  ],
  ["timed effects never expire", F.act, "    e[k] -= 1;", "    e[k] -= 0;"],
  [
    "a lapsed levitation leaves you stranded over water",
    F.act,
    "        landFromLevitation(state, events); // don't leave you stranded over water",
    "        // landFromLevitation(state, events);",
  ],

  // the lich
  [
    "lich never leaves phase 0",
    F.act,
    "  const frac = m.hp / def.maxHp;\n  if (frac > 2 / 3) return 0;",
    "  const frac = m.hp / def.maxHp;\n  if (true) return 0;",
  ],
  [
    "the barrage never actually strikes the player",
    F.act,
    "    if (t === pIdx) struck = true;",
    "    if (false) struck = true;",
  ],

  // ── inventory.ts — equip/acquire semantics (swap, never discard) ──
  [
    "equipping a weapon DISCARDS the old one instead of stowing it",
    F.inv,
    "  if (p.weaponId) addToBag(p, p.weaponId); // keep the old one",
    "  if (false) addToBag(p, p.weaponId); // keep the old one",
  ],
  [
    "equipping duplicates the weapon (never leaves the bag)",
    F.inv,
    "  removeOneFromBag(p, defId); // the newly-wielded one leaves the bag\n  p.weaponId = defId;",
    "  p.weaponId = defId;",
  ],
  [
    "equipping armor DISCARDS the old set",
    F.inv,
    "  if (p.armorId) addToBag(p, p.armorId);",
    "  if (false) addToBag(p, p.armorId);",
  ],
  [
    "picking up a WORSE weapon auto-equips it",
    F.inv,
    "      if ((def.power ?? 0) > p.weaponPower) equipWeapon(p, defId);",
    "      if (true) equipWeapon(p, defId);",
  ],
  [
    "stackable items no longer stack",
    F.inv,
    "  if (def.stackable) {",
    "  if (false) {",
  ],
  [
    "an ammo bundle yields a single arrow",
    F.inv,
    "      addToBag(p, defId, def.value ?? 1); // `value` = arrows per bundle",
    "      addToBag(p, defId, 1);",
  ],
  [
    "a plain torch downgrades a lantern",
    F.inv,
    "      if ((def.lightBonus ?? 0) > curBonus) p.torchId = defId;",
    "      p.torchId = defId;",
  ],
  [
    "torch fuel REPLACES instead of accumulating",
    F.inv,
    "      p.torchFuel = (p.torchFuel ?? 0) + (def.fuel ?? CONFIG.torchFuel);",
    "      p.torchFuel = def.fuel ?? CONFIG.torchFuel;",
  ],

  // ── state.ts ──
  [
    "light radius ignores the torch bonus",
    F.state,
    "  p.lightRadius = p.baseLightRadius + torchBonus;",
    "  p.lightRadius = p.baseLightRadius;",
  ],
  [
    "a fuel-less torch still counts as lit",
    F.state,
    "  const lit = p.hasTorch && p.torchFuel > 0;",
    "  const lit = p.hasTorch;",
  ],
  [
    "clonePlayer shares the bag/effects by reference (aliasing)",
    F.state,
    "  return { ...p, bag: p.bag.map((b) => ({ ...b })), effects: { ...p.effects } };",
    "  return { ...p, bag: p.bag, effects: p.effects };",
  ],
  [
    "beginLevel's entry snapshot aliases the live player",
    F.state,
    "    entryPlayer: clonePlayer(p),",
    "    entryPlayer: p,",
  ],

  // ── altar.ts — a bargain must cost something ──
  [
    "a spent altar can be used again",
    F.altar,
    "  if (altar.used) return null;",
    "  if (false) return null;",
  ],
  [
    "altars grant their boon without checking affordability",
    F.altar,
    "  if (!canAffordAltar(state, altar.kind).ok) return null;",
    "  if (false) return null;",
  ],
  [
    "the vigor altar's gold cost is free",
    F.altar,
    "      p.coins -= 40;",
    "      p.coins -= 0;",
  ],
  [
    "the warblood altar costs no maxHP",
    F.altar,
    "      p.maxHp -= 6;",
    "      p.maxHp -= 0;",
  ],
  [
    "the hoard altar costs no blood",
    F.altar,
    "      p.hp -= 8;",
    "      p.hp -= 0;",
  ],

  // ── lighting.ts — the dawn/dusk set-piece beat ──
  [
    "the dawn beat no longer warms the ambient",
    F.light,
    "          Math.min(255, c[0] + 122 * g), // warm gold + brighten toward",
    "          Math.min(255, c[0]), // warm gold + brighten toward",
  ],
  [
    "the dusk beat no longer dims",
    F.light,
    "          const k = 1 - 0.5 * g; // dim toward 50% as you near the gate",
    "          const k = 1; // dim toward 50% as you near the gate",
  ],

  // ── gameStore.ts — run/shop orchestration (only test:store can catch these) ──
  [
    "the shop sells without checking your purse",
    F.store,
    "      if (game.player.coins < entry.price) return;",
    "      if (false) return;",
  ],
  [
    "the shop ignores per-item purchase caps",
    F.store,
    "      if (entry.maxQty != null && bought >= entry.maxQty) return;",
    "      if (false) return;",
  ],
  [
    "buying doesn't deduct the price",
    F.store,
    "      game.player.coins -= entry.price;",
    "      game.player.coins -= 0;",
  ],
  [
    "selling pays nothing",
    F.store,
    "      game.player.coins += price;",
    "      game.player.coins += 0;",
  ],
  [
    "selling doesn't remove the item from the bag",
    F.store,
    "      entry.count -= 1;",
    "      entry.count -= 0;",
  ],
  [
    "dying costs no life",
    F.store,
    "    game.player.lives -= 1;",
    "    game.player.lives -= 0;",
  ],
  [
    "running out of lives never ends the run",
    F.store,
    "    if (game.player.lives <= 0) {",
    "    if (false) {",
  ],
  [
    "clearing the final level never triggers victory",
    F.store,
    "    if (isLast) {\n      clearSave();",
    "    if (false) {\n      clearSave();",
  ],
  [
    "the par bonus is never accrued on a clear",
    F.store,
    "    game.player.parBonus =\n      (game.player.parBonus ?? 0) +\n      levelParBonus(LEVELS[game.currentLevel], game.turnCount);",
    "    game.player.parBonus = game.player.parBonus ?? 0;",
  ],
];

const suites = ["test:core", "test:play", "test:store"];

// A mutation is applied by REWRITING a real source file, so an interrupted run
// would otherwise leave that mutation sitting in the working tree — silently breaking
// the suites, or worse, silently NOT breaking them: a kill once stranded an
// equivalent mutant, which every suite happily passed with the corruption in place.
//
// In-process signal handlers are NOT sufficient here: `execSync` blocks the event
// loop for the whole duration of a suite, so a SIGTERM arriving mid-run can kill the
// process before any handler gets to execute (verified — it did). So journal the
// pristine contents to disk BEFORE mutating and recover on the next start. That
// survives SIGKILL, a crash, and a closed terminal alike.
const LOCK = join(tmpdir(), "ember-mutation-audit.lock");
// Two concurrent audits mutate the SAME source files and corrupt each other — one
// restores a file the other just mutated, and a mutation ends up stranded in the
// working tree. (Learned by doing it: a SIGTERM does NOT kill this process while a
// handler is registered — Node defers it until `execSync` returns — so a run I
// believed dead kept going while a second one started.) Refuse to start twice.
if (existsSync(LOCK)) {
  const pid = readFileSync(LOCK, "utf8").trim();
  let alive = false;
  try {
    process.kill(Number(pid), 0);
    alive = true;
  } catch {
    alive = false;
  }
  if (alive) {
    console.error(
      `A mutation audit is already running (pid ${pid}). Two audits would corrupt\n` +
        `each other's source edits. Wait for it, or: kill ${pid} && rm ${LOCK}`,
    );
    process.exit(2);
  }
  console.log(`[clearing a stale lock from dead pid ${pid}]`);
  rmSync(LOCK, { force: true });
}
writeFileSync(LOCK, String(process.pid));
const releaseLock = () => rmSync(LOCK, { force: true });
process.on("exit", releaseLock);

const JOURNAL = join(tmpdir(), "ember-mutation-audit-recovery.json");
function recoverFromJournal() {
  if (!existsSync(JOURNAL)) return;
  try {
    const { path, original } = JSON.parse(readFileSync(JOURNAL, "utf8"));
    writeFileSync(path, original);
    console.log(`[recovered ${path} from an interrupted previous run]`);
  } catch {
    console.log(
      `[WARNING: ${JOURNAL} is unreadable — check 'git status' by hand]`,
    );
  }
  rmSync(JOURNAL, { force: true });
}
recoverFromJournal();

// best-effort immediate cleanup too, for the cases where a handler CAN run
let inFlight = null;
const restoreInFlight = () => {
  if (!inFlight) return;
  writeFileSync(inFlight.path, inFlight.original);
  rmSync(JOURNAL, { force: true });
  inFlight = null;
};
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(sig, () => {
    restoreInFlight();
    releaseLock();
    process.exit(130);
  });
const results = [];
let missed = 0;

for (const [label, file, find, replace] of MUTATIONS) {
  const path = `${ROOT}/${file}`;
  const orig = readFileSync(path, "utf8");
  if (!orig.includes(find)) {
    console.log(`MISSED  ${label}  (pattern not found in ${file})`);
    missed++;
    results.push({ label, caughtBy: "PATCH-MISSED" });
    continue;
  }
  inFlight = { path, original: orig };
  writeFileSync(JOURNAL, JSON.stringify({ path, original: orig }));
  writeFileSync(path, orig.replace(find, replace));
  let caughtBy = null;
  try {
    for (const s of suites) {
      try {
        execSync(`npm run ${s} --silent`, {
          cwd: ROOT,
          stdio: "pipe",
          timeout: 300000,
        });
      } catch {
        caughtBy = s;
        break;
      }
    }
  } finally {
    writeFileSync(path, orig);
    rmSync(JOURNAL, { force: true });
    inFlight = null;
  }
  const tag = caughtBy ?? "*** SURVIVED ***";
  console.log(`${caughtBy ? "caught " : "SURVIVE"} ${label}  →  ${tag}`);
  results.push({ label, caughtBy: caughtBy ?? null });
}

console.log("\n──────── SUMMARY ────────");
const surv = results.filter((r) => r.caughtBy === null);
console.log(
  `${results.length} mutations · ${surv.length} survived · ${missed} patch-missed`,
);
for (const r of surv) console.log(`  SURVIVED: ${r.label}`);
