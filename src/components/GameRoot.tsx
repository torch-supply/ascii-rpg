"use client";

import { useEffect } from "react";
import { gameStore, useGameStore, type GameStore } from "@/store/gameStore";
import { KeyboardInput } from "@/game/input/KeyboardInput";
import { LEVELS } from "@/content/levels";
import { MONSTERS } from "@/content/monsters";
import { classDef } from "@/content/classes";
import { idx } from "@/game/core/grid";
import {
  playMusic,
  stopMusic,
  setMusicIntensity,
  setMusicExposure,
  setMusicWarmth,
} from "@/lib/music";
import { resumeAudio } from "@/lib/sound";

import GameCanvas from "@/components/GameCanvas";
import {
  HudBar,
  HudFooter,
  BossBar,
  EliteBars,
  LevelIntro,
} from "@/components/hud/Hud";
import CharacterPanel from "@/components/hud/CharacterPanel";
import LogRail from "@/components/hud/LogRail";
import { BG, MARK } from "@/components/hud/palette";
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
  // actively hunted: monsters in the chase state raise the heat — ordinary combat
  // now moves the music, not just a boss/low-HP (1 → 0.2 … 3+ → 0.6)
  const hunters = g.monsters.filter(
    (m) => m.state === "chase" && !MONSTERS[m.defId].isBoss,
  ).length;
  if (hunters > 0) x = Math.max(x, Math.min(0.6, 0.2 + (hunters - 1) * 0.18));
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

/** Exposure (0–1) for the music's "held breath": full (1) normally, but drops
 * when you can SEE a threat that hasn't noticed you yet (a chaser-type monster
 * idle + in view, none actively hunting) — creeping past danger, the melody
 * thins to just drone + wind. The instant one wakes (enters chase) it blooms. */
function musicExposure(s: GameStore): number {
  if (s.mode !== "playing" || !s.game) return 1;
  const g = s.game;
  const w = g.map.width;
  const vis = new Set(g.visible);
  let hunters = 0;
  let lurkers = 0;
  for (const m of g.monsters) {
    const def = MONSTERS[m.defId];
    if (def.isBoss) continue;
    if (m.state === "chase") hunters++;
    else if (
      def.behavior !== "wander" &&
      def.behavior !== "erratic" &&
      def.behavior !== "ambient" &&
      vis.has(idx(m.x, m.y, w))
    )
      lurkers++; // a real threat, seen but still asleep
  }
  if (hunters > 0) return 1; // spotted → full/blooming
  return lurkers > 0 ? 0.25 : 1; // held breath vs. open exploration
}

/** Warmth (−1…+1) mirrors the dawn/dusk lighting beats so the score shifts with
 * them: the Throne warms toward major as Malachar's HP drains (+), the
 * Antechamber cools as you close on the Herald (−, distance-keyed). */
function musicWarmth(s: GameStore): number {
  if (s.mode !== "playing" || !s.game) return 0;
  const g = s.game;
  const beat = LEVELS[g.currentLevel].lightingBeat;
  if (!beat) return 0;
  const boss = g.monsters.find((m) => MONSTERS[m.defId].isBoss);
  if (!boss) return 0;
  if (beat === "dawn")
    return 1 - Math.max(0, boss.hp) / MONSTERS[boss.defId].maxHp;
  const start = g.entryPlayer ?? g.player;
  const full = Math.abs(start.x - boss.x) + Math.abs(start.y - boss.y);
  const cur = Math.abs(g.player.x - boss.x) + Math.abs(g.player.y - boss.y);
  return full > 0 ? -Math.max(0, Math.min(1, 1 - cur / full)) : 0;
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
      setMusicExposure(musicExposure(s)); // held-breath when creeping past threats
      setMusicWarmth(musicWarmth(s)); // dawn/dusk harmonic tilt (mirrors the lighting)
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
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: BG.shell }}
    >
      {showCanvas && (
        // The shell gutter: 8px padding + a 7px gap between four framed panels,
        // over a background one step darker than the map's #0d0d0d so the panels
        // read as separate surfaces rather than one continuous field.
        <div
          className="flex h-full w-full flex-col overflow-hidden"
          style={{
            padding: 8,
            gap: 7,
            border: `1px solid ${MARK.shellBorder}`,
          }}
        >
          <HudBar />
          {/* The map fills only this region, so it always fits the viewport.
              Both rails are SIBLINGS rather than overlays: they must take real
              width so the canvas's ResizeObserver narrows the viewport instead
              of the panels covering live map. */}
          <div
            className="flex min-h-0 flex-1 overflow-hidden"
            style={{ gap: 7 }}
          >
            <LogRail />
            <div
              className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
              style={{
                border: `1px solid ${MARK.mapBorder}`,
                background: BG.map,
              }}
            >
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
            <CharacterPanel />
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
