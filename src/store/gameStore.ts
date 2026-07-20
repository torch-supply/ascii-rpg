import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import type { GameState, PlayerAction, AltarInstance, TurnResult } from "@/game/core/types";
import { Rng } from "@/game/core/rng";
import { resolveTurn } from "@/game/core/actions";
import { applyAltar } from "@/game/core/altar";
import { beginLevel, createPlayer, clonePlayer } from "@/game/core/state";
import { giveItem } from "@/game/core/inventory";
import { LEVELS } from "@/content/levels";
import { CONFIG } from "@/content/config";
import { ITEMS, SHOP_TIERS, sellPrice, type ShopEntry } from "@/content/items";
import { MONSTERS } from "@/content/monsters";
import { OPENING, BIOME_GRADIENT } from "@/content/ascii";
import { gameplaySeed } from "@/lib/hash";
import { emitEffects } from "@/lib/effectBus";
import { initSound, isSoundOn, setSoundOn, playSfx } from "@/lib/sound";
import type { InputCommand } from "@/game/input/keymap";
import { serialize } from "@/save/serialize";
import {
  writeSave,
  readSave,
  clearSave,
  peekSaveInfo,
  type SaveInfo,
} from "@/save/storage";

export type UIMode =
  | "splash"
  | "playing"
  | "paused"
  | "inventory"
  | "help"
  | "narration"
  | "shop"
  | "targeting"
  | "altar"
  | "gameover"
  | "victory";

export interface TargetingData {
  /** "firebomb" throws the potion `defId`; "ranged" fires the equipped bow */
  kind: "firebomb" | "ranged";
  defId: string;
  x: number;
  y: number;
  range: number;
}

export interface RunResult {
  kills: number;
  turns: number;
  gold: number;
  timeMs: number;
  victory: boolean;
}

export interface NarrationData {
  title: string;
  body: string;
  artGradient?: string;
  /** chapter accent (divider + flat-title fallback) — biome palette accent */
  accent?: string;
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
  /** stats captured when a run ends (shown on victory / game-over) */
  runResult: RunResult | null;
  /** global SFX toggle (persisted across sessions) */
  soundOn: boolean;

  // lifecycle
  init: () => void;
  newGame: (seed?: string) => void;
  resumeGame: () => void;
  quitToTitle: () => void;

  // shop
  buyShopEntry: (entry: ShopEntry) => void;
  sellBagItem: (defId: string) => void;
  leaveShop: () => void;

  // cursor targeting (firebomb throw + ranged fire share the cursor)
  beginTargeting: (defId: string) => void;
  beginRangedTargeting: () => void;
  moveCursor: (dx: number, dy: number) => void;
  confirmTarget: () => void;
  cancelTarget: () => void;

  // altar / shrine interaction
  acceptAltar: () => void;
  declineAltar: () => void;

  // the turn-based LoopDriver entry point (the seam)
  submitAction: (action: PlayerAction) => void;

  // dev tooling (only reachable from dev-gated UI/keys)
  debugJumpTo: (levelIndex: number) => void;
  debugSkipLevel: () => void;

  // input + ui
  handleCommand: (cmd: InputCommand) => void;
  setMode: (mode: UIMode) => void;
  toggleSound: () => void;
  continueNarration: () => void;
  useBagSlot: (n: number) => void;

  // persistence
  persist: () => void;
}

// Accumulated wall-clock play time for the current run (ms). Persisted in the
// save so it totals across sessions; lives here (not in GameState) so a
// death-restart's entry snapshot never rewinds it. `sessionStartMs` marks when
// the current session's timing began (New Game / Resume).
let runPlayMs = 0;
let sessionStartMs = 0;

// Dev-only tooling is dead-code-eliminated from the production/static build.
export const DEV = process.env.NODE_ENV !== "production";

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
  if (has("quaff")) playSfx("quaff");
  if (has("shoot")) playSfx("shoot");
  if (has("thud")) playSfx("thud");
  if (has("crumble")) playSfx("crumble");
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
      timeMs: runPlayMs,
      victory,
    };
  };
  // Commit mutated game state with a fresh top-level identity so subscribers
  // (React HUD + canvas renderer) re-read it.
  const commit = () => set({ game: { ...get().game! } });

  const persist = () => {
    const s = get();
    if (!s.game || !s.rng) return;
    flushPlaytime();
    writeSave(serialize(s.game, s.rng, runPlayMs));
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
    const isLast = game.currentLevel >= LEVELS.length - 1;
    // on the final level the victory music is the payoff — skip the level-clear jingle
    if (!isLast) playSfx("levelClear");
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
    const nextIdx = game.currentLevel + 1;
    set({
      game: { ...game },
      mode: "narration",
      narration: {
        title: `${LEVELS[game.currentLevel].title} — cleared`,
        body: LEVELS[game.currentLevel].narration,
        artGradient: BIOME_GRADIENT[LEVELS[nextIdx].biome],
        accent: LEVELS[nextIdx].palette.accent,
        onContinue: "nextLevel",
        buttonLabel: `Onward — ${LEVELS[nextIdx].title}`,
      },
    });
  };

  const handleDeath = () => {
    const game = get().game!;
    playSfx("death");
    game.player.lives -= 1;
    if (game.player.lives <= 0) {
      clearSave();
      set({
        game: { ...game },
        mode: "gameover",
        hasSave: false,
        saveInfo: null,
        runResult: makeRunResult(game, false),
      });
      return;
    }
    set({
      game: { ...game },
      mode: "narration",
      narration: {
        title: "You Fall",
        body: `Darkness swallows you.\n\nBut the quest is not yet ended. You draw breath, and rise once more.\n\nLives remaining: ${game.player.lives}`,
        accent: "#ff5a5a",
        onContinue: "restartLevel",
        buttonLabel: "Rise",
      },
    });
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
    runResult: null,
    soundOn: true,

    init: () => {
      initSound(); // load the persisted SFX preference (client-only)
      const info = peekSaveInfo();
      set({ hasSave: !!info, saveInfo: info, soundOn: isSoundOn() });
    },

    newGame: (seed?: string) => {
      const masterSeed =
        seed && seed.trim()
          ? seed.trim()
          : String(Math.floor(Math.random() * 1e9));
      const player = createPlayer();
      const rng = new Rng(gameplaySeed(masterSeed));
      const game = beginLevel(masterSeed, 0, player);
      runPlayMs = 0;
      sessionStartMs = Date.now();
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
          onContinue: "beginPlay",
          buttonLabel: "Descend into the pit",
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
      set({ game: save.game, rng, mode: "playing", narration: null });
    },

    quitToTitle: () => {
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
        (a) => !a.used && a.x === game.player.x && a.y === game.player.y
      );
      if (altar) set({ mode: "altar", activeAltar: altar });
    },

    continueNarration: () => {
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
            set({ mode: "shop", narration: null, shopPurchases: {} });
          } else {
            const player = clonePlayer(game!.player);
            const ng = beginLevel(game!.masterSeed, completed + 1, player);
            set({ game: ng, mode: "playing", narration: null });
            persist();
          }
          break;
        }
        case "restartLevel": {
          const player = clonePlayer(game!.entryPlayer);
          player.lives = game!.player.lives; // keep the decremented life count
          const ng = beginLevel(game!.masterSeed, game!.currentLevel, player);
          set({ game: ng, mode: "playing", narration: null });
          persist();
          break;
        }
        case "victory":
          clearSave();
          set({ mode: "victory", narration: null, hasSave: false, saveInfo: null });
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
      giveItem(game.player, entry.itemId);
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
      const game = get().game!;
      const player = clonePlayer(game.player);
      const ng = beginLevel(game.masterSeed, game.currentLevel + 1, player);
      set({ game: ng, mode: "playing", shopPurchases: {} });
      persist();
    },

    // ── dev tooling ──
    debugJumpTo: (levelIndex: number) => {
      const masterSeed = String(Math.floor(Math.random() * 1e9));
      const player = createPlayer();
      // give a loadout roughly matching where you'd be by this level
      const w =
        levelIndex >= 7 ? "w_sun" : levelIndex >= 5 ? "w_ench" : levelIndex >= 3 ? "w_axe" : "w_short";
      const a =
        levelIndex >= 7 ? "a_plate" : levelIndex >= 5 ? "a_scale" : levelIndex >= 3 ? "a_chain" : "a_leather";
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
      const ng = beginLevel(game.masterSeed, next, clonePlayer(game.player));
      set({ game: ng, mode: "playing", narration: null });
    },

    useBagSlot: (n: number) => {
      const { game, mode } = get();
      if (!game) return;
      const entry = game.player.bag[n - 1];
      if (!entry) return;
      const def = ITEMS[entry.defId];
      if (mode === "inventory") set({ mode: "playing" });
      if (def.category === "potion") {
        if (def.effect === "bomb") get().beginTargeting(entry.defId);
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
        targeting: { kind: "firebomb", defId, x: cx, y: cy, range: CONFIG.throwRange },
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

    moveCursor: (dx: number, dy: number) => {
      const { targeting, game } = get();
      if (!targeting || !game) return;
      const nx = Math.max(0, Math.min(game.map.width - 1, targeting.x + dx));
      const ny = Math.max(0, Math.min(game.map.height - 1, targeting.y + dy));
      const d = Math.max(
        Math.abs(game.player.x - nx),
        Math.abs(game.player.y - ny)
      );
      if (d > targeting.range) return; // stay within throwing distance
      set({ targeting: { ...targeting, x: nx, y: ny } });
    },

    confirmTarget: () => {
      const { targeting } = get();
      if (!targeting) return;
      const { kind, defId, x, y } = targeting;
      set({ mode: "playing", targeting: null });
      if (kind === "ranged") get().submitAction({ type: "shootAt", x, y });
      else get().submitAction({ type: "throwAt", defId, x, y });
    },

    cancelTarget: () => set({ mode: "playing", targeting: null }),

    acceptAltar: () => {
      const { game, activeAltar } = get();
      if (!game || !activeAltar) return;
      const result = applyAltar(game, activeAltar); // pays cost + grants boon in-place
      if (result == null) return; // can't afford — keep the modal open
      playSfx("altar");
      set({ game: { ...game }, mode: "playing", activeAltar: null });
      persist();
    },

    declineAltar: () => set({ mode: "playing", activeAltar: null }),

    setMode: (mode: UIMode) => set({ mode }),

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
        else if (mode === "targeting" && cmd.action.type === "move")
          get().moveCursor(cmd.action.dx, cmd.action.dy);
        return;
      }
      if (cmd.kind === "bagSlot") {
        // Bag hotkeys only act with the inventory screen open — prevents
        // fat-fingering a potion/equip mid-move during play.
        if (mode === "inventory") get().useBagSlot(cmd.n);
        else if (mode === "shop") {
          const g = get().game;
          const tier = g ? LEVELS[g.currentLevel].shopTier : null;
          const entry =
            tier != null ? SHOP_TIERS[tier]?.[cmd.n - 1] : undefined;
          if (entry) get().buyShopEntry(entry);
        }
        return;
      }
      // cmd.kind === "ui"
      switch (cmd.cmd) {
        case "pause":
          if (mode === "playing") {
            playSfx("uiSelect");
            set({ mode: "paused" });
          } else if (mode === "targeting") {
            playSfx("uiBack");
            get().cancelTarget();
          } else if (mode === "altar") {
            playSfx("uiBack");
            get().declineAltar();
          } else if (mode === "paused" || mode === "inventory" || mode === "help") {
            playSfx("uiBack");
            set({ mode: "playing" });
          }
          break;
        case "fire":
          if (mode === "playing") get().beginRangedTargeting();
          else if (mode === "targeting") get().confirmTarget();
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
            set({ mode: "help" });
          } else if (mode === "help") {
            playSfx("uiBack");
            set({ mode: "playing" });
          }
          break;
        case "confirm":
          if (mode === "narration") {
            playSfx("uiSelect");
            get().continueNarration();
          } else if (mode === "shop") {
            playSfx("uiSelect");
            get().leaveShop();
          } else if (mode === "targeting") {
            get().confirmTarget(); // its own shoot/blast SFX
          } else if (mode === "altar") {
            get().acceptAltar(); // its own chime
          } else if (mode === "gameover" || mode === "victory") {
            playSfx("uiSelect");
            get().quitToTitle();
          } else if (mode === "paused" || mode === "inventory" || mode === "help") {
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
          } else if (mode === "paused" || mode === "inventory" || mode === "help") {
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
