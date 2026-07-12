"use client";

import { useEffect } from "react";
import { gameStore, useGameStore } from "@/store/gameStore";
import { KeyboardInput } from "@/game/input/KeyboardInput";

import GameCanvas from "@/components/GameCanvas";
import Hud from "@/components/hud/Hud";
import Splash from "@/components/screens/Splash";
import Narration from "@/components/screens/Narration";
import GameOver from "@/components/screens/GameOver";
import Victory from "@/components/screens/Victory";
import PauseModal from "@/components/overlays/PauseModal";
import HelpModal from "@/components/overlays/HelpModal";
import InventoryModal from "@/components/overlays/InventoryModal";

const CANVAS_MODES = new Set(["playing", "paused", "inventory", "help"]);

export default function GameRoot() {
  const mode = useGameStore((s) => s.mode);

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

    return () => {
      input.detach();
      window.removeEventListener("beforeunload", saveOnExit);
      document.removeEventListener("visibilitychange", saveOnExit);
    };
  }, []);

  const showCanvas = CANVAS_MODES.has(mode);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink">
      {showCanvas && (
        <>
          <GameCanvas />
          <Hud />
        </>
      )}

      {mode === "splash" && <Splash />}
      {mode === "narration" && <Narration />}
      {mode === "gameover" && <GameOver />}
      {mode === "victory" && <Victory />}
      {mode === "paused" && <PauseModal />}
      {mode === "inventory" && <InventoryModal />}
      {mode === "help" && <HelpModal />}
    </div>
  );
}
