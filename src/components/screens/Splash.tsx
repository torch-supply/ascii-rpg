"use client";

import { AccentDivider } from "@/components/ui/AccentDivider";
import { AsciiField } from "@/components/ui/AsciiField";
import { BoxFrame } from "@/components/ui/BoxFrame";
import { MenuButton } from "@/components/ui/MenuButton";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { G_DAWN_TITLE, G_EMBER, SUBTITLE } from "@/content/ascii";
import { LEVELS } from "@/content/levels";
import { gameStore, useGameStore } from "@/store/gameStore";
import { DEV } from "@/lib/env";

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
    gameStore.getState().setMode("classSelect");
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-auto bg-ink px-6 py-10">
      {/* procedural ember ASCII field — denser toward the floor, with rising sparks */}
      <AsciiField mode="abstract" biome="pit" bottom intensity={0.24} />
      {/* warm hearth-light over the field + a vignette that pulls focus to center */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(52% 48% at 50% 38%, rgba(255,140,45,0.08), transparent 66%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 54%, rgba(0,0,0,0.6) 100%)",
        }}
      />

      <SoundToggle className="absolute right-4 top-4 z-30" />

      <BoxFrame
        accent="#ffb347"
        chip="#0c0c0e"
        className="narr-rise z-10 flex flex-col items-center gap-6 text-center"
        style={{ background: "rgba(9,9,12,0.5)", padding: "48px 62px" }}
      >
        {/* 2a — gradient-caps wordmark, consistent with every other screen title */}
        <div className="ember-flicker flex flex-col items-center gap-0">
          <h1
            className="m-0 text-5xl font-semibold uppercase leading-none tracking-[0.12em] sm:text-6xl"
            style={{
              textIndent: "0.12em",
              backgroundImage: G_EMBER,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "transparent",
            }}
          >
            Ember
          </h1>
          <div className="my-0.5 text-base italic text-[#ff8c00]">of</div>
          <h1
            className="m-0 text-5xl font-semibold uppercase leading-none tracking-[0.12em] sm:text-6xl"
            style={{
              textIndent: "0.12em",
              backgroundImage: G_DAWN_TITLE,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "transparent",
            }}
          >
            Dawn
          </h1>
        </div>

        <div className="text-[11px] tracking-[0.4em] text-dim sm:text-xs">
          {SUBTITLE}
        </div>
        <AccentDivider accent="#ffb347" />

        <p className="max-w-sm text-balance text-sm leading-relaxed text-dim">
          Escape the pit. Cross the cursed land. Recover the Sunblade. End
          Malachar the Lich-King — and rekindle the dawn.
        </p>

        <div className="flex flex-col items-center gap-3">
          {hasSave && saveInfo && (
            <MenuButton
              accent
              autoFocus
              onClick={() => gameStore.getState().resumeGame()}
            >
              ▸ Resume
              <span className="ml-1 text-xs opacity-80">
                — Level {saveInfo.level + 1}: {saveInfo.title} · turn{" "}
                {saveInfo.turn}
              </span>
            </MenuButton>
          )}
          <MenuButton autoFocus={!hasSave} onClick={startNew}>
            ▸ New Game
            {hasSave && (
              <span className="ml-1 text-xs text-dim">(overwrites save)</span>
            )}
          </MenuButton>
        </div>

        {DEV && (
          <div className="pointer-events-auto flex flex-col items-center gap-1.5 border border-edge/60 px-4 py-3">
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
              in play: press <span className="text-dim">&gt;</span> to skip to
              the next level
            </div>
          </div>
        )}

        <p className="max-w-sm text-balance text-xs text-dim">
          v1 · {LEVELS.length} levels · move with arrows or wasd · bump to
          attack · find the way, then live to tell it
        </p>

        <a
          href="https://github.com/torch-supply/ascii-rpg"
          target="_blank"
          rel="noopener noreferrer"
          className="-mt-3 text-[11px] tracking-[0.2em] text-dim transition-colors hover:text-gold focus-visible:text-gold"
        >
          source on github ↗
        </a>
      </BoxFrame>
    </div>
  );
}
