import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import type {
  GameState,
  PlayerAction,
  AltarInstance,
  LoreInstance,
  ItemInstance,
  TurnResult,
  Biome,
} from "@/game/core/types";
import { Rng } from "@/game/core/rng";
import { resolveTurn, takeGearAt, logMessage } from "@/game/core/actions";
import { applyAltar } from "@/game/core/altar";
import { beginLevel, createPlayer, clonePlayer } from "@/game/core/state";
import { levelParBonus } from "@/game/core/goals";
import { giveItem } from "@/game/core/inventory";
import { bagEntryForSlot, syncBagSlots } from "@/game/core/hotbar";
import { LEVELS } from "@/content/levels";
import { CONFIG } from "@/content/config";
import { ITEMS, SHOP_TIERS, sellPrice, type ShopEntry } from "@/content/items";
import { MONSTERS } from "@/content/monsters";
import { CLASS_LIST, classDef } from "@/content/classes";
import { MUTATORS, applyPlayerMutators } from "@/content/mutators";
import { OPENING, BIOME_GRADIENT } from "@/content/ascii";
import { gameplaySeed } from "@/lib/hash";
import { emitEffects } from "@/lib/effectBus";
import { initSound, isSoundOn, setSoundOn, playSfx } from "@/lib/sound";
import { playSting } from "@/lib/music";
import type { InputCommand } from "@/game/input/keymap";
import { serialize } from "@/save/serialize";
import {
  writeSave,
  readSave,
  clearSave,
  peekSaveInfo,
  type SaveInfo,
} from "@/save/storage";
import { DEV } from "@/lib/env"; // dev-only tooling gate

export type UIMode =
  | "splash"
  | "classSelect"
  | "mutators"
  | "playing"
  | "paused"
  | "inventory"
  | "help"
  | "narration"
  | "shop"
  | "targeting"
  | "altar"
  | "lore"
  | "gear"
  | "gameover"
  | "victory";

/**
 * Which modes are drawn OVER the live map (the canvas + HUD stay mounted) and
 * which replace it with a full screen. `GameRoot` mounts the map from this, and
 * `saveOnExit` only saves from a map mode.
 *
 * A `Record` rather than a `Set` on purpose: adding a mode to `UIMode` without
 * classifying it here is a compile error. As a hand-kept Set in `GameRoot` it
 * silently missed `"gear"`, so stepping onto any weapon or armour unmounted the
 * renderer and HUD — the translucent prompt showed over black — and rebuilt
 * them from scratch on close.
 */
export const MODE_OVER_MAP: Record<UIMode, boolean> = {
  splash: false,
  classSelect: false,
  mutators: false,
  playing: true,
  paused: true,
  inventory: true,
  help: true,
  narration: false,
  shop: false,
  targeting: true,
  altar: true,
  lore: true,
  gear: true,
  gameover: false,
  victory: false,
};

export interface TargetingData {
  /** "firebomb" throws the potion `defId`; "ranged" fires the equipped bow;
   * "blink" teleports the player to the chosen tile (Phial of Blinking);
   * "ability" aims a directional class ability (fires on the next move key) */
  kind: "firebomb" | "ranged" | "blink" | "ability";
  defId: string;
  x: number;
  y: number;
  range: number;
}

export interface RunResult {
  kills: number;
  turns: number;
  gold: number;
  parBonus: number; // accumulated par-time efficiency bonus (score)
  timeMs: number;
  victory: boolean;
  mutators: string[]; // active run modifiers (for score multiplier + display)
}

export interface NarrationData {
  title: string;
  body: string;
  artGradient?: string;
  /** chapter accent (divider + flat-title fallback) — biome palette accent */
  accent?: string;
  /** biome for the narration's scene ASCII-field background */
  biome?: Biome;
  onContinue: "beginPlay" | "nextLevel" | "restartLevel" | "victory";
  buttonLabel: string;
}

export interface GameStore {
  mode: UIMode;
  game: GameState | null;
  rng: Rng | null;
  hasSave: boolean;
  saveInfo: SaveInfo | null;
  narration: NarrationData | null;
  /** how many of each item bought during the current shop visit */
  shopPurchases: Record<string, number>;
  /** active targeting cursor (null unless mode === "targeting") */
  targeting: TargetingData | null;
  /** the shrine being contemplated (null unless mode === "altar") */
  activeAltar: AltarInstance | null;
  /** the lore prop being read (null unless mode === "lore") */
  activeLore: LoreInstance | null;
  /** the weapon/armour being weighed up (null unless mode === "gear") */
  activeGear: ItemInstance | null;
  /**
   * Bumped on every death. PRESENTATION ONLY — the mode transition stays
   * synchronous (store tests `[S6]`/`[S7]` assert it on the lethal turn, and the
   * LoopDriver shouldn't grow timing), so this is just a signal the view layer
   * can watch to hold a freeze-frame before the card appears.
   */
  deathFlash: number;
  /** stats captured when a run ends (shown on victory / game-over) */
  runResult: RunResult | null;
  /** global SFX toggle (persisted across sessions) */
  soundOn: boolean;

  // lifecycle
  init: () => void;
  newGame: (classId: string, seed?: string, mutators?: string[]) => void;
  chooseClass: (classId: string) => void;
  /** class chosen, awaiting the trial (mutator) picker */
  pendingClassId: string;
  /** mutators toggled on the trial-select screen (before the run starts) */
  selectedMutators: string[];
  toggleMutator: (id: string) => void;
  beginRun: () => void;
  resumeGame: () => void;
  quitToTitle: () => void;

  // shop
  buyShopEntry: (entry: ShopEntry) => void;
  sellBagItem: (defId: string) => void;
  leaveShop: () => void;

  // cursor targeting (firebomb throw + ranged fire share the cursor)
  beginTargeting: (defId: string) => void;
  beginRangedTargeting: () => void;
  beginBlinkTargeting: (defId: string) => void;
  /** trigger the class active ability ([q]); directional ones open a quick aim */
  triggerAbility: () => void;
  moveCursor: (dx: number, dy: number) => void;
  confirmTarget: () => void;
  cancelTarget: () => void;

  // altar / shrine interaction
  acceptAltar: () => void;
  declineAltar: () => void;
  takeGear: () => void;
  leaveGear: () => void;

  // lore prop interaction (read + dismiss)
  closeLore: () => void;

  // the turn-based LoopDriver entry point (the seam)
  submitAction: (action: PlayerAction) => void;

  // dev tooling (only reachable from dev-gated UI/keys)
  debugJumpTo: (levelIndex: number) => void;
  debugSkipLevel: () => void;

  // input + ui
  handleCommand: (cmd: InputCommand) => void;
  setMode: (mode: UIMode) => void;
  /** Open the help sheet from play or from the pause menu, and remember which. */
  openHelp: () => void;
  /** Close it back to wherever it was opened from. */
  closeHelp: () => void;
  toggleSound: () => void;
  continueNarration: () => void;
  useBagSlot: (n: number) => void;
  /** Use a bag item BY ID — the only route to an entry with no hotbar slot. */
  useBagItem: (defId: string) => void;

  // persistence
  persist: () => void;
}

// Accumulated wall-clock play time for the current run (ms). Persisted in the
// save so it totals across sessions; lives here (not in GameState) so a
// death-restart's entry snapshot never rewinds it. `sessionStartMs` marks when
// the current session's timing began (New Game / Resume).
let runPlayMs = 0;
let sessionStartMs = 0;

// Briefly ignore "advance past this screen" actions right after a screen
// appears, so the SAME keypress that (e.g.) threw a firebomb and cleared the
// level can't also skip the level-cleared card straight into the shop. Guards
// both the keyboard path and native focused-button activation, since both route
// through the store actions below.
let inputSettleUntil = 0;

// Where the help sheet returns to when closed (see `openHelp`).
let helpReturn: "playing" | "paused" = "playing";
function armInputSettle(ms = 250) {
  inputSettleUntil = Date.now() + ms;
}

/**
 * How long the world holds, drained, before the death card appears (the view
 * side lives in `GameRoot`, which also feeds it to the CSS as `--death-ms`).
 * Lives here so the store's input guard and the freeze are ONE number: on the
 * LAST life the guard spans the whole freeze, because advancing from game over
 * quits to the title — an Enter mashed during the freeze used to skip the run
 * summary before it was ever drawn, and it can't be brought back.
 */
export const DEATH_FREEZE_MS = 1300;
function inputSettling(): boolean {
  return Date.now() < inputSettleUntil;
}

/** Roll the current session's elapsed time into the accumulated total. */
function flushPlaytime() {
  const now = Date.now();
  runPlayMs += Math.max(0, now - sessionStartMs);
  sessionStartMs = now;
}

/** Turn a turn's cosmetic events into (at most a couple of) SFX cues. Taking
 * damage always announces itself; you only hear your own hit on a clean blow. */
function playTurnSfx(events: TurnResult["events"]) {
  const has = (k: string) => events.some((e) => e.kind === k);
  const tookDmg = events.some((e) => e.kind === "damage" && e.toPlayer);
  const dealtDmg = events.some((e) => e.kind === "damage" && !e.toPlayer);
  if (has("coin")) playSfx("coin");
  if (has("pickup")) playSfx("pickup");
  if (has("quaff") || has("heal")) playSfx("quaff"); // heal = foraged bite
  if (has("shoot")) playSfx("shoot");
  if (has("thud")) playSfx("thud");
  if (has("crumble")) playSfx("crumble");
  if (has("door")) playSfx("door");
  if (has("blast")) playSfx("blast");
  // a trap's snap stands in for the generic hurt on that turn
  if (has("trap")) playSfx("trap");
  else if (tookDmg) playSfx("hurt");
  else if (dealtDmg && !has("blast")) playSfx("hit");
  if (has("step")) playSfx("step");
}

// Boss sting: play once when a boss first enters view, tracked per level.
let bossStingLevel = -1;
let bossStingSeen = new Set<string>();
function playBossSting(game: GameState) {
  if (game.currentLevel !== bossStingLevel) {
    bossStingLevel = game.currentLevel;
    bossStingSeen = new Set();
  }
  const w = game.map.width;
  const visible = new Set(game.visible);
  for (const m of game.monsters) {
    if (!MONSTERS[m.defId].isBoss) continue;
    if (bossStingSeen.has(m.id)) continue;
    if (visible.has(m.y * w + m.x)) {
      bossStingSeen.add(m.id);
      playSfx("boss");
    }
  }
}

export const gameStore = createStore<GameStore>((set, get) => {
  const makeRunResult = (game: GameState, victory: boolean): RunResult => {
    flushPlaytime();
    return {
      kills: game.player.kills,
      turns: game.player.totalTurns,
      gold: game.player.goldEarned,
      parBonus: game.player.parBonus ?? 0,
      timeMs: runPlayMs,
      victory,
      mutators: game.mutators ?? [],
    };
  };
  // Commit mutated game state with a fresh top-level identity so subscribers
  // (React HUD + canvas renderer) re-read it.
  const commit = () => set({ game: { ...get().game! } });

  /** The level as it will be replayed after a death with lives left: rebuilt
   * from the entry snapshot, keeping the run facts (lives, the lore journal).
   * Pure in the game state, so the death SAVE and the "Rise" button produce the
   * same level. */
  const restartedLevel = (game: GameState): GameState => {
    const player = clonePlayer(game.entryPlayer);
    player.lives = game.player.lives; // keep the decremented life count
    // The journal is a record of what you READ, not of what you survived,
    // and the level regenerates on restart — so a fragment found in the
    // failed attempt would be unrecoverable for the rest of the run.
    // Carried forward for the same reason `lives` is: it is a RUN fact.
    player.loreSeen = [...game.player.loreSeen];
    return beginLevel(
      game.masterSeed,
      game.currentLevel,
      player,
      game.mutators,
    );
  };

  /** The level-cleared card, shown after a clear and again on resuming a save
   * taken on it. */
  const clearedNarration = (game: GameState): NarrationData => {
    const nextIdx = game.currentLevel + 1;
    return {
      title: `${LEVELS[game.currentLevel].title}\ncleared`,
      body: LEVELS[game.currentLevel].narration,
      artGradient: BIOME_GRADIENT[LEVELS[nextIdx].biome],
      accent: LEVELS[nextIdx].palette.accent,
      biome: LEVELS[nextIdx].biome,
      onContinue: "nextLevel",
      buttonLabel: `Onward — ${LEVELS[nextIdx].title}`,
    };
  };

  /**
   * Save the run. The PHASE is read off the current mode rather than passed in,
   * so every call site saves the right thing by construction — the bug this
   * replaces was two sites that never saved at all (a death with lives left,
   * so reloading on "You Fall" undid it) and a save with no phase (so reloading
   * at the shop resumed INTO the cleared level and cleared it again).
   */
  const persist = () => {
    const s = get();
    if (!s.game || !s.rng) return;
    flushPlaytime();
    if (s.mode === "shop") {
      writeSave(serialize(s.game, s.rng, runPlayMs, "shop", s.shopPurchases));
    } else if (s.narration?.onContinue === "nextLevel") {
      writeSave(serialize(s.game, s.rng, runPlayMs, "cleared"));
    } else if (s.narration?.onContinue === "restartLevel") {
      // Dying spends the life NOW: save the level you will rise into, so
      // quitting on the card can't hand the life back.
      writeSave(serialize(restartedLevel(s.game), s.rng, runPlayMs));
    } else {
      writeSave(serialize(s.game, s.rng, runPlayMs));
    }
    set({
      hasSave: true,
      saveInfo: {
        level: s.game.currentLevel,
        turn: s.game.turnCount,
        title: LEVELS[s.game.currentLevel]?.title ?? "",
      },
    });
  };

  const handleLevelComplete = () => {
    const game = get().game!;
    // Par-for-score: reward clearing this level under its turn "par" (no effect
    // on survive levels). Accrued once here, at the moment of the clear.
    game.player.parBonus =
      (game.player.parBonus ?? 0) +
      levelParBonus(LEVELS[game.currentLevel], game.turnCount);
    armInputSettle(); // don't let the clearing keypress skip the cleared card
    const isLast = game.currentLevel >= LEVELS.length - 1;
    // on the final level the victory music is the payoff — skip the level-clear jingle
    if (!isLast) {
      playSfx("levelClear");
      playSting("clear"); // a brief in-key cadence over the music
    }
    if (isLast) {
      clearSave();
      set({
        game: { ...game },
        mode: "victory",
        hasSave: false,
        saveInfo: null,
        runResult: makeRunResult(game, true),
      });
      return;
    }
    set({
      game: { ...game },
      mode: "narration",
      narration: clearedNarration(game),
    });
    persist(); // as `cleared`: resuming returns here, never back into the level
  };

  const handleDeath = () => {
    const game = get().game!;
    armInputSettle(); // the killing keypress mustn't skip the death/game-over card
    playSfx("death");
    // Overkill leaves HP negative — the core subtracts damage without a floor,
    // since only the `<= 0` test matters to it. Clamp HERE, at the moment death
    // is acknowledged: "-3 / 26" is not a state the player should ever read, and
    // the death freeze-frame now holds that readout on screen for 1.3s. Fixing
    // it at the source rather than in the HUD, because the header was already
    // papering over it with `Math.max(0, …)` in two other places.
    game.player.hp = Math.max(0, game.player.hp);
    game.player.lives -= 1;
    if (game.player.lives <= 0) {
      armInputSettle(DEATH_FREEZE_MS); // the run summary can't be skipped unseen
      clearSave();
      set({
        game: { ...game },
        mode: "gameover",
        hasSave: false,
        saveInfo: null,
        runResult: makeRunResult(game, false),
        deathFlash: get().deathFlash + 1,
      });
      return;
    }
    set({
      game: { ...game },
      mode: "narration",
      deathFlash: get().deathFlash + 1,
      narration: {
        title: "You Fall",
        body: `Darkness swallows you.\n\nBut the quest is not yet ended. You draw breath, and rise once more.\n\nLives remaining: ${game.player.lives}`,
        accent: "#ff5a5a",
        biome: LEVELS[game.currentLevel].biome,
        onContinue: "restartLevel",
        buttonLabel: "Rise",
      },
    });
    persist(); // saves the restarted level — the life is spent either way
  };

  return {
    mode: "splash",
    game: null,
    rng: null,
    hasSave: false,
    saveInfo: null,
    narration: null,
    shopPurchases: {},
    targeting: null,
    activeAltar: null,
    activeLore: null,
    activeGear: null,
    runResult: null,
    deathFlash: 0,
    soundOn: true,
    pendingClassId: "warrior",
    selectedMutators: [],

    init: () => {
      initSound(); // load the persisted SFX preference (client-only)
      const info = peekSaveInfo();
      set({ hasSave: !!info, saveInfo: info, soundOn: isSoundOn() });
    },

    // picking a class advances to the trial (mutator) select, not straight in
    chooseClass: (classId: string) =>
      set({ pendingClassId: classId, selectedMutators: [], mode: "mutators" }),

    toggleMutator: (id: string) => {
      const cur = get().selectedMutators;
      set({
        selectedMutators: cur.includes(id)
          ? cur.filter((m) => m !== id)
          : [...cur, id],
      });
    },

    beginRun: () =>
      get().newGame(
        get().pendingClassId || "warrior",
        undefined,
        get().selectedMutators,
      ),

    newGame: (classId: string, seed?: string, mutators: string[] = []) => {
      const masterSeed =
        seed && seed.trim()
          ? seed.trim()
          : String(Math.floor(Math.random() * 1e9));
      const player = createPlayer(classId);
      applyPlayerMutators(player, mutators); // one-time run-start tweaks (e.g. Glass)
      const rng = new Rng(gameplaySeed(masterSeed));
      const game = beginLevel(masterSeed, 0, player, mutators);
      runPlayMs = 0;
      sessionStartMs = Date.now();
      armInputSettle(); // the class-pick keypress mustn't skip the opening card
      set({
        game,
        rng,
        mode: "narration",
        runResult: null,
        narration: {
          title: OPENING.title,
          body: OPENING.body,
          artGradient: OPENING.gradient,
          accent: LEVELS[0].palette.accent,
          biome: LEVELS[0].biome,
          onContinue: "beginPlay",
          buttonLabel: "Wake",
        },
      });
    },

    resumeGame: () => {
      const save = readSave();
      if (!save) {
        set({ mode: "splash", hasSave: false, saveInfo: null });
        return;
      }
      const rng = new Rng(0, save.gameplayRngState);
      runPlayMs = save.playMs ?? 0;
      sessionStartMs = Date.now();
      const game = save.game;
      switch (save.phase) {
        case "cleared":
          set({
            game,
            rng,
            mode: "narration",
            narration: clearedNarration(game),
          });
          break;
        case "shop":
          set({
            game,
            rng,
            mode: "shop",
            narration: null,
            shopPurchases: save.shopPurchases,
          });
          break;
        default:
          set({ game, rng, mode: "playing", narration: null });
      }
    },

    quitToTitle: () => {
      if (inputSettling()) return; // ignore a keypress carried in from the last screen
      const info = peekSaveInfo();
      set({
        mode: "splash",
        game: null,
        rng: null,
        narration: null,
        hasSave: !!info,
        saveInfo: info,
        runResult: null,
      });
    },

    submitAction: (action: PlayerAction) => {
      const { mode, game, rng } = get();
      if (mode !== "playing" || !game || !rng) return;

      const res = resolveTurn(game, action, rng);
      if (!res.tookTurn) {
        commit(); // no turn spent, but state (bag/equip) may have changed
        return;
      }
      if (res.goalComplete) {
        handleLevelComplete();
        return;
      }
      if (res.playerDied) {
        handleDeath();
        return;
      }
      commit();
      emitEffects(res.events); // cosmetic hit/projectile animations
      playTurnSfx(res.events); // SFX cues off the same events
      playBossSting(game); // ominous sting when a boss first comes into view
      persist();
      // Stepping onto an unspent shrine offers its bargain — AFTER the move
      // resolves, so an altar never blocks a route (decline = walk on past it).
      const altar = game.altars.find(
        (a) => !a.used && a.x === game.player.x && a.y === game.player.y,
      );
      if (altar) {
        set({ mode: "altar", activeAltar: altar });
        return;
      }
      // Stepping onto an unread lore prop opens it (and marks it read so it
      // won't reopen) — same "read + walk on" flow as an altar's decline.
      const lore = game.lore?.find(
        (l) => !l.read && l.x === game.player.x && l.y === game.player.y,
      );
      if (lore) {
        lore.read = true;
        // Record it in the run-long journal (the Lore tab). Titles only, and
        // deduped: `GameState.lore` is per-level, so this is the only thing
        // that survives to let you read a fragment back later.
        if (!game.player.loreSeen.includes(lore.title))
          game.player.loreSeen.push(lore.title);
        playSting("lore"); // a wistful fragment of the Ember motif
        set({ game: { ...game }, mode: "lore", activeLore: lore });
        persist();
        return;
      }
      // Stepping onto a weapon or suit of armour weighs it against what you
      // carry — same "offer AFTER the move resolves" flow as an altar, so gear
      // never blocks a route and declining just walks you over it. Only
      // non-quest gear reaches here: the core takes quest gear automatically
      // (the Sunblade IS an objective, so it must not be declinable).
      const gear = game.items.find(
        (i) =>
          i.x === game.player.x &&
          i.y === game.player.y &&
          (ITEMS[i.defId].category === "weapon" ||
            ITEMS[i.defId].category === "armor"),
      );
      if (gear) set({ mode: "gear", activeGear: gear });
    },

    continueNarration: () => {
      if (inputSettling()) return; // ignore a keypress carried in from the last screen
      const { narration, game } = get();
      if (!narration) return;
      switch (narration.onContinue) {
        case "beginPlay":
          set({ mode: "playing", narration: null });
          persist();
          break;
        case "nextLevel": {
          const completed = game!.currentLevel;
          const tier = LEVELS[completed].shopTier;
          if (tier != null && SHOP_TIERS[tier]) {
            // Visit the shop before the next level loads. Keep the current
            // game state (for coins/gear) until the player leaves the shop.
            armInputSettle(); // and don't let the same key bounce out of the shop
            set({ mode: "shop", narration: null, shopPurchases: {} });
            persist();
          } else {
            const player = clonePlayer(game!.player);
            const ng = beginLevel(
              game!.masterSeed,
              completed + 1,
              player,
              game!.mutators,
            );
            set({ game: ng, mode: "playing", narration: null });
            persist();
          }
          break;
        }
        case "restartLevel": {
          const ng = restartedLevel(game!);
          set({ game: ng, mode: "playing", narration: null });
          persist();
          break;
        }
        case "victory":
          clearSave();
          set({
            mode: "victory",
            narration: null,
            hasSave: false,
            saveInfo: null,
          });
          break;
      }
    },

    buyShopEntry: (entry: ShopEntry) => {
      const { game, shopPurchases } = get();
      if (!game) return;
      const bought = shopPurchases[entry.itemId] ?? 0;
      if (entry.maxQty != null && bought >= entry.maxQty) return;
      if (game.player.coins < entry.price) return;
      game.player.coins -= entry.price;
      // Buying gear puts it straight on; the piece it replaces is TRADED IN at
      // the counter rather than vanishing, which is the shop-side answer to
      // "one weapon, one armour" — there is no floor to drop it on here.
      const displaced = giveItem(game.player, entry.itemId);
      if (displaced) game.player.coins += sellPrice(ITEMS[displaced]);
      playSfx("coin"); // gold changing hands
      set({
        game: { ...game },
        shopPurchases: { ...shopPurchases, [entry.itemId]: bought + 1 },
      });
      persist();
    },

    sellBagItem: (defId: string) => {
      const { game } = get();
      if (!game) return;
      const entry = game.player.bag.find((b) => b.defId === defId);
      if (!entry) return;
      const price = sellPrice(ITEMS[defId]);
      if (price <= 0) return; // not a sellable category
      entry.count -= 1;
      if (entry.count <= 0)
        game.player.bag = game.player.bag.filter((b) => b !== entry);
      game.player.coins += price;
      game.player.goldEarned += price; // selling still counts toward run gold
      playSfx("coin");
      set({ game: { ...game } });
      persist();
    },

    leaveShop: () => {
      if (inputSettling()) return; // ignore a keypress carried in from the last screen
      const game = get().game!;
      const player = clonePlayer(game.player);
      const ng = beginLevel(
        game.masterSeed,
        game.currentLevel + 1,
        player,
        game.mutators,
      );
      set({ game: ng, mode: "playing", shopPurchases: {} });
      persist();
    },

    // ── dev tooling ──
    debugJumpTo: (levelIndex: number) => {
      const masterSeed = String(Math.floor(Math.random() * 1e9));
      const player = createPlayer();
      // give a loadout roughly matching where you'd be by this level
      const w =
        levelIndex >= 7
          ? "w_sun"
          : levelIndex >= 5
            ? "w_ench"
            : levelIndex >= 3
              ? "w_axe"
              : "w_short";
      const a =
        levelIndex >= 7
          ? "a_plate"
          : levelIndex >= 5
            ? "a_scale"
            : levelIndex >= 3
              ? "a_chain"
              : "a_leather";
      player.weaponId = w;
      player.weaponPower = ITEMS[w].power ?? 0;
      player.armorId = a;
      player.armorReduction = ITEMS[a].reduction ?? 0;
      player.coins = 80;
      player.bag = [
        { defId: "p_heal", count: 3 },
        { defId: "p_gheal", count: 2 },
        { defId: "p_bomb", count: 2 },
        { defId: "p_ward", count: 1 },
        { defId: "p_might", count: 1 },
        { defId: "p_detect", count: 2 },
      ];
      syncBagSlots(player); // a literal bag, so it needs its slots assigned
      player.hasTorch = true;
      player.torchId = "i_lantern";
      player.torchFuel = ITEMS["i_lantern"].fuel ?? 200;
      const rng = new Rng(gameplaySeed(masterSeed));
      const game = beginLevel(masterSeed, levelIndex, player);
      runPlayMs = 0;
      sessionStartMs = Date.now();
      set({ game, rng, mode: "playing", narration: null, runResult: null });
    },

    debugSkipLevel: () => {
      const game = get().game;
      if (!game) return;
      const next = game.currentLevel + 1;
      if (next >= LEVELS.length) {
        clearSave();
        set({
          game: { ...game },
          mode: "victory",
          hasSave: false,
          saveInfo: null,
          runResult: makeRunResult(game, true),
        });
        return;
      }
      const ng = beginLevel(
        game.masterSeed,
        next,
        clonePlayer(game.player),
        game.mutators,
      );
      set({ game: ng, mode: "playing", narration: null });
    },

    useBagSlot: (n: number) => {
      const { game } = get();
      if (!game) return;
      // By stable slot, NOT by bag index: the bag compacts when a stack empties,
      // so an index-keyed hotkey silently repoints mid-fight (quaff your last
      // Healing Potion and `[1]` becomes whatever was `[2]`).
      const entry = bagEntryForSlot(game.player, n);
      if (!entry) return; // a spent slot is inert — it costs no turn
      get().useBagItem(entry.defId);
    },

    useBagItem: (defId: string) => {
      const { game, mode } = get();
      if (!game) return;
      // Keyed by defId, so it can reach a bag entry that holds NO hotbar slot.
      // There are only nine number keys and eighteen bag-eligible items, and a
      // cautious player really does carry more than nine kinds at once (the
      // staples plus the situational potions you save for the right moment).
      // The tenth used to be unusable: no key, no panel row (the panel is a
      // fixed nine), and the inventory sheet was read-only — so it showed as
      // `[—]` and you carried it to the end of the run. The sheet's rows route
      // here, which is the only surface that can address a slotless item.
      const entry = game.player.bag.find((b) => b.defId === defId);
      if (!entry) return; // nothing carried — costs no turn
      const def = ITEMS[entry.defId];
      if (mode === "inventory") set({ mode: "playing" });
      if (def.category === "potion") {
        if (def.effect === "bomb") get().beginTargeting(entry.defId);
        else if (def.effect === "blink") get().beginBlinkTargeting(entry.defId);
        else get().submitAction({ type: "useItem", defId: entry.defId });
      } else if (def.category === "weapon" || def.category === "armor") {
        get().submitAction({ type: "equip", defId: entry.defId });
      }
    },

    beginTargeting: (defId: string) => {
      const { game } = get();
      if (!game) return;
      const p = game.player;
      const w = game.map.width;
      const visible = new Set(game.visible);
      // start the cursor on the nearest visible monster in range, else on you
      let cx = p.x;
      let cy = p.y;
      let best = Infinity;
      for (const m of game.monsters) {
        if (!visible.has(m.y * w + m.x)) continue;
        const d = Math.max(Math.abs(p.x - m.x), Math.abs(p.y - m.y));
        if (d <= CONFIG.throwRange && d < best) {
          best = d;
          cx = m.x;
          cy = m.y;
        }
      }
      set({
        mode: "targeting",
        targeting: {
          kind: "firebomb",
          defId,
          x: cx,
          y: cy,
          range: CONFIG.throwRange,
        },
      });
    },

    beginBlinkTargeting: (defId: string) => {
      const { game } = get();
      if (!game) return;
      const p = game.player;
      set({
        mode: "targeting",
        targeting: {
          kind: "blink",
          defId,
          x: p.x,
          y: p.y,
          range: CONFIG.blinkRange,
        },
      });
    },

    beginRangedTargeting: () => {
      const { game } = get();
      if (!game) return;
      const p = game.player;
      const wpn = ITEMS[p.weaponId];
      if (!wpn.ranged) return; // no bow equipped
      const ammo = p.bag.find((b) => b.defId === wpn.ranged!.ammoId);
      if (!ammo || ammo.count <= 0) return; // no arrows
      const range = wpn.ranged.range;
      const w = game.map.width;
      const visible = new Set(game.visible);
      // start on the nearest visible monster within range, else on yourself
      let cx = p.x;
      let cy = p.y;
      let best = Infinity;
      for (const m of game.monsters) {
        if (!visible.has(m.y * w + m.x)) continue;
        const d = Math.max(Math.abs(p.x - m.x), Math.abs(p.y - m.y));
        if (d <= range && d < best) {
          best = d;
          cx = m.x;
          cy = m.y;
        }
      }
      set({
        mode: "targeting",
        targeting: { kind: "ranged", defId: p.weaponId, x: cx, y: cy, range },
      });
    },

    triggerAbility: () => {
      const { game, mode } = get();
      if (!game || mode !== "playing") return;
      const ab = classDef(game.player.classId).ability;
      if (!ab) return;
      if (game.player.abilityCooldown > 0) {
        playSfx("uiBack"); // a soft "not ready" nudge
        return;
      }
      if (ab.aim === "none") {
        get().submitAction({ type: "ability" });
        return;
      }
      // directional: open a quick aim — the next move key sets the direction
      const p = game.player;
      set({
        mode: "targeting",
        targeting: {
          kind: "ability",
          defId: ab.id,
          x: p.x,
          y: p.y,
          range: ab.range ?? 3,
        },
      });
      playSfx("uiSelect");
    },

    moveCursor: (dx: number, dy: number) => {
      const { targeting, game } = get();
      if (!targeting || !game) return;
      const nx = Math.max(0, Math.min(game.map.width - 1, targeting.x + dx));
      const ny = Math.max(0, Math.min(game.map.height - 1, targeting.y + dy));
      const d = Math.max(
        Math.abs(game.player.x - nx),
        Math.abs(game.player.y - ny),
      );
      if (d > targeting.range) return; // stay within throwing distance
      set({ targeting: { ...targeting, x: nx, y: ny } });
    },

    confirmTarget: () => {
      const { targeting } = get();
      if (!targeting) return;
      const { kind, defId, x, y } = targeting;
      // a directional ability fires on a MOVE key, not a tile confirm — so a bare
      // confirm here just cancels the aim.
      if (kind === "ability") {
        get().cancelTarget();
        return;
      }
      set({ mode: "playing", targeting: null });
      if (kind === "ranged") get().submitAction({ type: "shootAt", x, y });
      else if (kind === "blink")
        get().submitAction({ type: "blinkTo", defId, x, y });
      else get().submitAction({ type: "throwAt", defId, x, y });
    },

    cancelTarget: () => set({ mode: "playing", targeting: null }),

    acceptAltar: () => {
      const { game, activeAltar } = get();
      if (!game || !activeAltar) return;
      const result = applyAltar(game, activeAltar); // pays cost + grants boon in-place
      if (result == null) return; // can't afford — keep the modal open
      logMessage(game, result); // it always returned this; nothing ever read it
      playSfx("altar");
      playSting("altar"); // a cold, unresolved shimmer over the music
      set({ game: { ...game }, mode: "playing", activeAltar: null });
      persist();
    },

    declineAltar: () => set({ mode: "playing", activeAltar: null }),

    takeGear: () => {
      const { game, activeGear } = get();
      if (!game || !activeGear) return;
      takeGearAt(game, activeGear.id); // equips, and drops the displaced piece
      playSfx("pickup");
      set({ game: { ...game }, mode: "playing", activeGear: null });
      persist();
    },
    leaveGear: () => set({ mode: "playing", activeGear: null }),

    closeLore: () => set({ mode: "playing", activeLore: null }),

    setMode: (mode: UIMode) => set({ mode }),

    // Help is reachable from live play (`?`) AND from the pause menu, and
    // closing it always went to `playing` — so Pause → Help → Esc dropped you
    // straight back into the level instead of the menu you came from.
    openHelp: () => {
      const from = get().mode;
      if (from !== "playing" && from !== "paused") return;
      helpReturn = from;
      set({ mode: "help" });
    },
    closeHelp: () => {
      if (get().mode !== "help") return;
      set({ mode: helpReturn });
    },

    toggleSound: () => {
      const on = !get().soundOn;
      setSoundOn(on); // persists to localStorage
      set({ soundOn: on });
    },

    persist,

    handleCommand: (cmd: InputCommand) => {
      const { mode } = get();
      if (cmd.kind === "action") {
        if (mode === "playing") get().submitAction(cmd.action);
        else if (mode === "targeting" && cmd.action.type === "move") {
          const t = get().targeting;
          if (t?.kind === "ability") {
            // aiming a directional ability — this move key IS the direction
            set({ mode: "playing", targeting: null });
            get().submitAction({
              type: "ability",
              dx: cmd.action.dx,
              dy: cmd.action.dy,
            });
          } else get().moveCursor(cmd.action.dx, cmd.action.dy);
        }
        return;
      }
      if (cmd.kind === "bagSlot") {
        // Live during play as well as on the inventory sheet: the always-up bag
        // panel shows which item each number holds, and slots are stable, so a
        // number key is a considered press rather than a fat-finger risk.
        if (mode === "playing" || mode === "inventory") get().useBagSlot(cmd.n);
        else if (mode === "classSelect") {
          const cls = CLASS_LIST[cmd.n - 1];
          if (cls) get().chooseClass(cls.id);
        } else if (mode === "shop") {
          const g = get().game;
          const tier = g ? LEVELS[g.currentLevel].shopTier : null;
          const entry =
            tier != null ? SHOP_TIERS[tier]?.[cmd.n - 1] : undefined;
          if (entry) get().buyShopEntry(entry);
        } else if (mode === "mutators") {
          const m = MUTATORS[cmd.n - 1];
          if (m) {
            playSfx("uiSelect");
            get().toggleMutator(m.id);
          }
        }
        return;
      }
      // cmd.kind === "ui"
      switch (cmd.cmd) {
        case "pause":
          if (mode === "classSelect") {
            playSfx("uiBack");
            set({ mode: "splash" }); // back out of class select to the title
          } else if (mode === "mutators") {
            playSfx("uiBack");
            set({ mode: "classSelect" }); // back to class pick
          } else if (mode === "playing") {
            playSfx("uiSelect");
            set({ mode: "paused" });
          } else if (mode === "targeting") {
            playSfx("uiBack");
            get().cancelTarget();
          } else if (mode === "altar") {
            playSfx("uiBack");
            get().declineAltar();
          } else if (mode === "gear") {
            playSfx("uiBack");
            get().leaveGear();
          } else if (mode === "lore") {
            playSfx("uiBack");
            get().closeLore();
          } else if (mode === "paused" || mode === "inventory") {
            playSfx("uiBack");
            set({ mode: "playing" });
          } else if (mode === "help") {
            playSfx("uiBack");
            get().closeHelp();
          }
          break;
        case "fire":
          if (mode === "playing") get().beginRangedTargeting();
          else if (mode === "targeting") get().confirmTarget();
          break;
        case "ability":
          if (mode === "playing") get().triggerAbility();
          else if (mode === "targeting") get().cancelTarget(); // q again backs out of the aim
          break;
        case "inventory":
          if (mode === "playing") {
            playSfx("uiSelect");
            set({ mode: "inventory" });
          } else if (mode === "inventory") {
            playSfx("uiBack");
            set({ mode: "playing" });
          }
          break;
        case "help":
          if (mode === "playing") {
            playSfx("uiSelect");
            get().openHelp();
          } else if (mode === "help") {
            playSfx("uiBack");
            get().closeHelp();
          }
          break;
        case "confirm":
          if (mode === "splash") {
            // Enter on the title does the default action — resume a run if one
            // exists, else open class select (for when focus isn't on a button).
            playSfx("uiSelect");
            if (get().hasSave) get().resumeGame();
            else set({ mode: "classSelect" });
          } else if (mode === "mutators") {
            playSfx("uiSelect");
            get().beginRun();
          } else if (mode === "narration") {
            playSfx("uiSelect");
            get().continueNarration();
          } else if (mode === "shop") {
            playSfx("uiSelect");
            get().leaveShop();
          } else if (mode === "targeting") {
            get().confirmTarget(); // its own shoot/blast SFX
          } else if (mode === "altar") {
            get().acceptAltar(); // its own chime
          } else if (mode === "gear") {
            get().takeGear(); // its own pickup cue
          } else if (mode === "lore") {
            playSfx("uiBack");
            get().closeLore();
          } else if (mode === "gameover" || mode === "victory") {
            playSfx("uiSelect");
            get().quitToTitle();
          } else if (
            mode === "paused" ||
            mode === "inventory" ||
            mode === "help"
          ) {
            playSfx("uiBack");
            set({ mode: "playing" });
          }
          break;
        case "cancel":
          if (mode === "targeting") {
            playSfx("uiBack");
            get().cancelTarget();
          } else if (mode === "altar") {
            playSfx("uiBack");
            get().declineAltar();
          } else if (
            mode === "paused" ||
            mode === "inventory" ||
            mode === "help"
          ) {
            playSfx("uiBack");
            set({ mode: "playing" });
          }
          break;
        case "mute":
          get().toggleSound(); // global — works in any mode
          break;
        case "debugSkip":
          if (DEV && mode === "playing") get().debugSkipLevel();
          break;
      }
    },
  };
});

export function useGameStore<T>(selector: (s: GameStore) => T): T {
  return useStore(gameStore, selector);
}
