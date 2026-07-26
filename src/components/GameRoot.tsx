"use client";

import { useEffect } from "react";
import { gameStore, useGameStore, type GameStore } from "@/store/gameStore";
import { KeyboardInput } from "@/game/input/KeyboardInput";
import { LEVELS } from "@/content/levels";
import { MONSTERS } from "@/content/monsters";
import { classDef } from "@/content/classes";
import { idx } from "@/game/core/grid";
import { playMusic, stopMusic, setMusicIntensity } from "@/lib/music";
import { resumeAudio } from "@/lib/sound";

import GameCanvas from "@/components/GameCanvas";
import {
  HudBar,
  HudFooter,
  BossBar,
  EliteBars,
  LevelIntro,
} from "@/components/hud/Hud";
import Splash from "@/components/screens/Splash";
import ClassSelect from "@/components/screens/ClassSelect";
import MutatorSelect from "@/components/screens/MutatorSelect";
import Narration from "@/components/screens/Narration";
import Shop from "@/components/screens/Shop";
import GameOver from "@/components/screens/GameOver";
import Victory from "@/components/screens/Victory";
import PauseModal from "@/components/overlays/PauseModal";
import HelpModal from "@/components/overlays/HelpModal";
import InventoryModal from "@/components/overlays/InventoryModal";
import AltarModal from "@/components/overlays/AltarModal";
import LoreModal from "@/components/overlays/LoreModal";

const CANVAS_MODES = new Set([
  "playing",
  "paused",
  "inventory",
  "help",
  "targeting",
  "altar",
  "lore",
]);

/** Danger level (0–1) fed to the adaptive music: 0 anywhere but active play,
 * rising with low HP, a boss in view, and the survive-siege progress. */
function dangerIntensity(s: GameStore): number {
  if (s.mode !== "playing" || !s.game) return 0;
  const g = s.game;
  const p = g.player;
  let x = 0;
  const hpFrac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  if (hpFrac < 0.34) x = Math.max(x, 0.45 + (0.34 - hpFrac) * 1.6); // dread as HP bleeds out
  const w = g.map.width;
  if (
    g.monsters.some(
      (m) => MONSTERS[m.defId].isBoss && g.visible.includes(idx(m.x, m.y, w)),
    )
  )
    x = Math.max(x, 0.85); // a boss is watching
  const goal = LEVELS[g.currentLevel].goal;
  if (goal.type === "survive")
    x = Math.max(
      x,
      0.35 + 0.5 * Math.min(1, g.turnCount / (goal as { turns: number }).turns),
    );
  return Math.min(1, x);
}

export default function GameRoot() {
  const mode = useGameStore((s) => s.mode);
  const targetingKind = useGameStore((s) => s.targeting?.kind ?? null);
  const abilityName = useGameStore(
    (s) =>
      (s.game ? classDef(s.game.player.classId).ability?.name : null) ??
      "Ability",
  );

  useEffect(() => {
    // detect an existing save (client-only — safe in an effect)
    gameStore.getState().init();

    const input = new KeyboardInput((cmd) =>
      gameStore.getState().handleCommand(cmd),
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
      setMusicIntensity(dangerIntensity(s)); // adaptive: bed reacts to danger
      if (s.mode === "shop") return void playMusic("shop");
      if (s.mode === "gameover") return void playMusic("death");
      if (s.mode === "victory") return void playMusic("victory");
      if (
        s.mode === "splash" ||
        s.mode === "classSelect" ||
        s.mode === "mutators"
      )
        return void playMusic("title");
      const biome = s.game ? LEVELS[s.game.currentLevel].biome : null;
      if (biome) playMusic(`level:${biome}`, biome);
      else stopMusic();
    };
    const unsubMusic = gameStore.subscribe(syncMusic);
    syncMusic(gameStore.getState());

    // Browsers keep the audio context suspended until a user gesture, so the
    // title theme (queued on the splash at load) can't sound on its own. Resume
    // it on the first click/keypress, then this listener is done.
    const unlockAudio = () => {
      resumeAudio();
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    return () => {
      input.detach();
      window.removeEventListener("beforeunload", saveOnExit);
      document.removeEventListener("visibilitychange", saveOnExit);
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
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
                  {targetingKind === "ability"
                    ? `${abilityName} — press a direction · Esc to cancel`
                    : targetingKind === "ranged"
                      ? "Take aim — move cursor · Enter to loose an arrow · Esc to cancel"
                      : targetingKind === "blink"
                        ? "Choose where to blink — move cursor · Enter to teleport · Esc to cancel"
                        : "Aim the firebomb — move cursor · Enter to throw · Esc to cancel"}
                </span>
              </div>
            )}
          </div>
          <HudFooter />
        </div>
      )}

      {mode === "splash" && <Splash />}
      {mode === "classSelect" && <ClassSelect />}
      {mode === "mutators" && <MutatorSelect />}
      {mode === "narration" && <Narration />}
      {mode === "shop" && <Shop />}
      {mode === "gameover" && <GameOver />}
      {mode === "victory" && <Victory />}
      {mode === "paused" && <PauseModal />}
      {mode === "inventory" && <InventoryModal />}
      {mode === "help" && <HelpModal />}
      {mode === "altar" && <AltarModal />}
      {mode === "lore" && <LoreModal />}
    </div>
  );
}
