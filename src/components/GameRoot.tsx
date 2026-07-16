"use client";

import { useEffect } from "react";
import { gameStore, useGameStore, type GameStore } from "@/store/gameStore";
import { KeyboardInput } from "@/game/input/KeyboardInput";
import { LEVELS } from "@/content/levels";
import { playMusic, stopMusic } from "@/lib/music";

import GameCanvas from "@/components/GameCanvas";
import { HudBar, HudFooter, BossBar, EliteBars, LevelIntro } from "@/components/hud/Hud";
import Splash from "@/components/screens/Splash";
import Narration from "@/components/screens/Narration";
import Shop from "@/components/screens/Shop";
import GameOver from "@/components/screens/GameOver";
import Victory from "@/components/screens/Victory";
import PauseModal from "@/components/overlays/PauseModal";
import HelpModal from "@/components/overlays/HelpModal";
import InventoryModal from "@/components/overlays/InventoryModal";
import AltarModal from "@/components/overlays/AltarModal";

const CANVAS_MODES = new Set([
  "playing",
  "paused",
  "inventory",
  "help",
  "targeting",
  "altar",
]);

export default function GameRoot() {
  const mode = useGameStore((s) => s.mode);
  const targetingKind = useGameStore((s) => s.targeting?.kind ?? null);

  useEffect(() => {
    // detect an existing save (client-only — safe in an effect)
    gameStore.getState().init();

    const input = new KeyboardInput((cmd) =>
      gameStore.getState().handleCommand(cmd)
    );
    input.attach();

    const saveOnExit = () => {
      const s = gameStore.getState();
      if (CANVAS_MODES.has(s.mode)) s.persist();
    };
    window.addEventListener("beforeunload", saveOnExit);
    document.addEventListener("visibilitychange", saveOnExit);

    // background music: pick a track from mode + biome (+ the sound toggle).
    // playMusic keeps continuity — the same track flows across narration →
    // playing → pause/inventory without restarting.
    const syncMusic = (s: GameStore) => {
      if (!s.soundOn) return void stopMusic();
      if (s.mode === "shop") return void playMusic("shop");
      if (s.mode === "gameover") return void playMusic("death");
      if (s.mode === "victory") return void playMusic("victory");
      if (s.mode === "splash") return void stopMusic();
      const biome = s.game ? LEVELS[s.game.currentLevel].biome : null;
      if (biome) playMusic(`level:${biome}`, biome);
      else stopMusic();
    };
    const unsubMusic = gameStore.subscribe(syncMusic);
    syncMusic(gameStore.getState());

    return () => {
      input.detach();
      window.removeEventListener("beforeunload", saveOnExit);
      document.removeEventListener("visibilitychange", saveOnExit);
      unsubMusic();
      stopMusic();
    };
  }, []);

  const showCanvas = CANVAS_MODES.has(mode);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink">
      {showCanvas && (
        <div className="flex h-full w-full flex-col overflow-hidden">
          <HudBar />
          {/* the map fills only this region, so it always fits the viewport */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <GameCanvas />
            {mode !== "targeting" && <BossBar />}
            {mode !== "targeting" && <EliteBars />}
            <LevelIntro />
            {mode === "targeting" && (
              <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
                <span className="border border-gold/50 bg-panel/90 px-3 py-1 text-xs text-gold">
                  {targetingKind === "ranged"
                    ? "Take aim — move cursor · Enter to loose an arrow · Esc to cancel"
                    : "Aim the firebomb — move cursor · Enter to throw · Esc to cancel"}
                </span>
              </div>
            )}
          </div>
          <HudFooter />
        </div>
      )}

      {mode === "splash" && <Splash />}
      {mode === "narration" && <Narration />}
      {mode === "shop" && <Shop />}
      {mode === "gameover" && <GameOver />}
      {mode === "victory" && <Victory />}
      {mode === "paused" && <PauseModal />}
      {mode === "inventory" && <InventoryModal />}
      {mode === "help" && <HelpModal />}
      {mode === "altar" && <AltarModal />}
    </div>
  );
}
