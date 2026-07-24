"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { MUTATORS, mutatorScoreMult } from "@/content/mutators";
import { MenuButton } from "@/components/ui/MenuButton";
import { AccentDivider } from "@/components/ui/AccentDivider";
import { AsciiField } from "@/components/ui/AsciiField";
import { BoxFrame } from "@/components/ui/BoxFrame";

/**
 * "Choose your trials" — the run-modifier picker, between class select and the
 * run. Toggle any subset of mutators (each raises the score); Begin starts the
 * run, Back returns to class select. Number keys 1–N toggle, Enter begins, Esc
 * backs out (routed in the store's handleCommand).
 */
export default function MutatorSelect() {
  const selected = useGameStore((s) => s.selectedMutators);
  const mult = mutatorScoreMult(selected);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-auto bg-ink px-6 py-10 text-center">
      <AsciiField mode="abstract" biome="pit" bottom intensity={0.24} />
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

      <BoxFrame
        accent="#ffb347"
        chip="#0c0c0e"
        className="narr-rise z-10 flex w-[min(92vw,42rem)] flex-col items-center gap-6"
        style={{ background: "rgba(9,9,12,0.5)", padding: "44px 52px" }}
      >
        <div className="flex flex-col items-center gap-4">
          <h2
            className="m-0 text-2xl font-semibold uppercase tracking-[0.3em] text-gold"
            style={{ textIndent: "0.3em" }}
          >
            Choose Your Trials
          </h2>
          <AccentDivider accent="#ffb347" />
          <p className="m-0 max-w-md text-balance text-[13px] leading-relaxed text-dim">
            Optional challenges that reshape the whole run — each raises your
            final score. Take as many as you dare, or none at all.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2.5">
          {MUTATORS.map((m, i) => {
            const on = selected.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => gameStore.getState().toggleMutator(m.id)}
                className={`pointer-events-auto flex w-full items-baseline gap-3 border px-4 py-2.5 text-left transition-colors ${
                  on
                    ? "border-gold bg-gold/10"
                    : "border-[#2c2c36] bg-[#0c0c10] hover:border-gold/60"
                }`}
              >
                <span className="text-magic">[{i + 1}]</span>
                <span className={`shrink-0 ${on ? "text-gold" : "text-edge"}`}>
                  {on ? "◉" : "○"}
                </span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className={on ? "text-gold" : "text-fg"}>{m.name}</span>
                  <span className="text-[11px] text-[#6f7078]">
                    — {m.blurb}
                  </span>
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-[#6f7078]">
                  +{Math.round(m.scoreMult * 100)}%
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-baseline gap-2 text-sm">
          <span className="text-dim">Score multiplier</span>
          <span className="text-gold">×{mult.toFixed(2)}</span>
        </div>

        <div className="flex flex-col items-center gap-3">
          <MenuButton
            accent
            autoFocus
            onClick={() => gameStore.getState().beginRun()}
          >
            ▸ Begin
            {selected.length > 0 && (
              <span className="ml-1 text-xs text-gold/80">
                — {selected.length} trial{selected.length > 1 ? "s" : ""}
              </span>
            )}
            <span className="ml-1 text-xs opacity-70">(Enter)</span>
          </MenuButton>
          <MenuButton
            onClick={() => gameStore.getState().setMode("classSelect")}
          >
            ◂ Back <span className="ml-1 text-xs text-dim">(Esc)</span>
          </MenuButton>
        </div>
      </BoxFrame>
    </div>
  );
}
