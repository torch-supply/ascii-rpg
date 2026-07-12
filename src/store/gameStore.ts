import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import type { GameState, PlayerAction } from "@/game/core/types";
import { Rng } from "@/game/core/rng";
import { resolveTurn } from "@/game/core/actions";
import { beginLevel, createPlayer, clonePlayer } from "@/game/core/state";
import { giveItem } from "@/game/core/inventory";
import { LEVELS } from "@/content/levels";
import { CONFIG } from "@/content/config";
import { ITEMS, SHOP_TIERS, type ShopEntry } from "@/content/items";
import { OPENING, BIOME_SCENE } from "@/content/ascii";
import { gameplaySeed } from "@/lib/hash";
import { emitEffects } from "@/lib/effectBus";
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
  | "gameover"
  | "victory";

export interface TargetingData {
  defId: string;
  x: number;
  y: number;
  range: number;
}

export interface NarrationData {
  title: string;
  body: string;
  art: string;
  artGradient?: string;
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
  /** active firebomb targeting cursor (null unless mode === "targeting") */
  targeting: TargetingData | null;

  // lifecycle
  init: () => void;
  newGame: (seed?: string) => void;
  resumeGame: () => void;
  quitToTitle: () => void;

  // shop
  buyShopEntry: (entry: ShopEntry) => void;
  leaveShop: () => void;

  // firebomb targeting
  beginTargeting: (defId: string) => void;
  moveCursor: (dx: number, dy: number) => void;
  confirmTarget: () => void;
  cancelTarget: () => void;

  // the turn-based LoopDriver entry point (the seam)
  submitAction: (action: PlayerAction) => void;

  // input + ui
  handleCommand: (cmd: InputCommand) => void;
  setMode: (mode: UIMode) => void;
  continueNarration: () => void;
  useBagSlot: (n: number) => void;

  // persistence
  persist: () => void;
}

export const gameStore = createStore<GameStore>((set, get) => {
  // Commit mutated game state with a fresh top-level identity so subscribers
  // (React HUD + canvas renderer) re-read it.
  const commit = () => set({ game: { ...get().game! } });

  const persist = () => {
    const s = get();
    if (!s.game || !s.rng) return;
    writeSave(serialize(s.game, s.rng));
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
    if (isLast) {
      clearSave();
      set({ game: { ...game }, mode: "victory", hasSave: false, saveInfo: null });
      return;
    }
    const nextIdx = game.currentLevel + 1;
    set({
      game: { ...game },
      mode: "narration",
      narration: {
        title: `${LEVELS[game.currentLevel].title} — cleared`,
        body: LEVELS[game.currentLevel].narration,
        art: BIOME_SCENE[LEVELS[nextIdx].biome].art,
        artGradient: BIOME_SCENE[LEVELS[nextIdx].biome].gradient,
        onContinue: "nextLevel",
        buttonLabel: `Onward — ${LEVELS[nextIdx].title}`,
      },
    });
  };

  const handleDeath = () => {
    const game = get().game!;
    game.player.lives -= 1;
    if (game.player.lives <= 0) {
      clearSave();
      set({
        game: { ...game },
        mode: "gameover",
        hasSave: false,
        saveInfo: null,
      });
      return;
    }
    set({
      game: { ...game },
      mode: "narration",
      narration: {
        title: "You Fall",
        body: `Darkness swallows you.\n\nBut the quest is not yet ended. You draw breath, and rise once more.\n\nLives remaining: ${game.player.lives}`,
        art: "",
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

    init: () => {
      const info = peekSaveInfo();
      set({ hasSave: !!info, saveInfo: info });
    },

    newGame: (seed?: string) => {
      const masterSeed =
        seed && seed.trim()
          ? seed.trim()
          : String(Math.floor(Math.random() * 1e9));
      const player = createPlayer();
      const rng = new Rng(gameplaySeed(masterSeed));
      const game = beginLevel(masterSeed, 0, player);
      set({
        game,
        rng,
        mode: "narration",
        narration: {
          title: OPENING.title,
          body: OPENING.body,
          art: OPENING.scene.art,
          artGradient: OPENING.scene.gradient,
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
      persist();
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
      set({
        game: { ...game },
        shopPurchases: { ...shopPurchases, [entry.itemId]: bought + 1 },
      });
      persist();
    },

    leaveShop: () => {
      const game = get().game!;
      const player = clonePlayer(game.player);
      const ng = beginLevel(game.masterSeed, game.currentLevel + 1, player);
      set({ game: ng, mode: "playing", shopPurchases: {} });
      persist();
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
        targeting: { defId, x: cx, y: cy, range: CONFIG.throwRange },
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
      const { defId, x, y } = targeting;
      set({ mode: "playing", targeting: null });
      get().submitAction({ type: "throwAt", defId, x, y });
    },

    cancelTarget: () => set({ mode: "playing", targeting: null }),

    setMode: (mode: UIMode) => set({ mode }),

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
        if (mode === "playing" || mode === "inventory") get().useBagSlot(cmd.n);
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
          if (mode === "playing") set({ mode: "paused" });
          else if (mode === "targeting") get().cancelTarget();
          else if (mode === "paused" || mode === "inventory" || mode === "help")
            set({ mode: "playing" });
          break;
        case "inventory":
          if (mode === "playing") set({ mode: "inventory" });
          else if (mode === "inventory") set({ mode: "playing" });
          break;
        case "help":
          if (mode === "playing") set({ mode: "help" });
          else if (mode === "help") set({ mode: "playing" });
          break;
        case "confirm":
          if (mode === "narration") get().continueNarration();
          else if (mode === "shop") get().leaveShop();
          else if (mode === "targeting") get().confirmTarget();
          else if (mode === "gameover" || mode === "victory")
            get().quitToTitle();
          else if (mode === "paused" || mode === "inventory" || mode === "help")
            set({ mode: "playing" });
          break;
        case "cancel":
          if (mode === "targeting") get().cancelTarget();
          else if (mode === "paused" || mode === "inventory" || mode === "help")
            set({ mode: "playing" });
          break;
      }
    },
  };
});

export function useGameStore<T>(selector: (s: GameStore) => T): T {
  return useStore(gameStore, selector);
}
