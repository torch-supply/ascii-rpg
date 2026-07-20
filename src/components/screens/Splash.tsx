"use client";

import { gameStore, useGameStore, DEV } from "@/store/gameStore";
import { EMBER_ART, DAWN_ART, G_EMBER, G_DAWN_TITLE, SUBTITLE } from "@/content/ascii";
import { LEVELS } from "@/content/levels";
import { MenuButton } from "@/components/ui/MenuButton";
import { AsciiArt } from "@/components/ui/AsciiArt";
import { AccentDivider } from "@/components/ui/AccentDivider";
import { Embers } from "@/components/ui/Embers";

export default function Splash() {
  const hasSave = useGameStore((s) => s.hasSave);
  const saveInfo = useGameStore((s) => s.saveInfo);
  const startNew = () => {
    if (
      hasSave &&
      !window.confirm("Start a new game? This erases your saved run.")
    ) {
      return;
    }
    gameStore.getState().newGame();
  };

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-7 overflow-auto bg-ink px-6 py-10 text-center">
      {/* hero: the wordmark over a soft ember glow + drifting sparks, capped by
         the same ◈ divider the rest of the game uses */}
      <div className="narr-rise relative flex flex-col items-center gap-1 px-6 pt-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background:
              "radial-gradient(58% 55% at 50% 40%, rgba(255,140,45,0.16), transparent 70%)",
          }}
        />
        <Embers />
        <div className="ember-flicker relative z-10 flex flex-col items-center gap-1">
          <AsciiArt art={EMBER_ART} gradient={G_EMBER} shimmer className="text-[11px] sm:text-base" />
          <div className="text-sm italic text-[#ff8c00] sm:text-base">of</div>
          <AsciiArt
            art={DAWN_ART}
            gradient={G_DAWN_TITLE}
            shimmer
            className="-mt-[18px] text-[11px] sm:text-base"
          />
        </div>
        <div className="relative z-10 mt-3 text-[11px] tracking-[0.4em] text-dim sm:text-xs">
          {SUBTITLE}
        </div>
        <AccentDivider accent="#ffb347" className="relative z-10 mt-4" />
      </div>

      <p
        className="narr-rise max-w-md text-balance text-sm leading-relaxed text-dim"
        style={{ animationDelay: "200ms" }}
      >
        Escape the pit. Cross the cursed land. Recover the Sunblade. End the
        Lich-King Malachar — and rekindle the dawn.
      </p>

      <div
        className="narr-rise flex flex-col items-center gap-3"
        style={{ animationDelay: "340ms" }}
      >
        {hasSave && saveInfo && (
          <MenuButton accent onClick={() => gameStore.getState().resumeGame()}>
            ▸ Resume
            <span className="ml-1 text-xs opacity-80">
              — Level {saveInfo.level + 1}: {saveInfo.title} · turn{" "}
              {saveInfo.turn}
            </span>
          </MenuButton>
        )}

        <MenuButton onClick={startNew}>
          ▸ New Game
          {hasSave && (
            <span className="ml-1 text-xs text-dim">(overwrites save)</span>
          )}
        </MenuButton>
      </div>

      {DEV && (
        <div
          className="narr-rise pointer-events-auto flex flex-col items-center gap-1.5 border border-edge/60 px-4 py-3"
          style={{ animationDelay: "440ms" }}
        >
          <div className="text-[10px] uppercase tracking-[0.3em] text-edge">
            dev · jump to level (kitted-out)
          </div>
          <div className="flex max-w-[85vw] flex-wrap justify-center gap-1">
            {LEVELS.map((lvl, i) => (
              <button
                key={lvl.id}
                title={lvl.title}
                onClick={() => gameStore.getState().debugJumpTo(i)}
                className="border border-edge px-2 py-1 text-[11px] text-dim transition-colors hover:border-gold hover:text-gold"
              >
                {i + 1}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-edge">
            in play: press <span className="text-dim">&gt;</span> to skip to the
            next level
          </div>
        </div>
      )}

      <p
        className="narr-rise max-w-md text-balance text-xs text-dim"
        style={{ animationDelay: "520ms" }}
      >
        v1 · {LEVELS.length} levels · move with arrows or wasd · bump to attack ·
        find the way, then live to tell it
      </p>
    </div>
  );
}
