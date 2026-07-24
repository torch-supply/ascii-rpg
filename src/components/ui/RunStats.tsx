"use client";

import { useEffect, useState } from "react";
import { useGameStore } from "@/store/gameStore";
import { mutatorById, mutatorScoreMult } from "@/content/mutators";

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Eased 0→1 progress over `duration`, run once when `active`. Jumps straight
 * to 1 when inactive or under prefers-reduced-motion. */
function useCountProgress(active: boolean, duration = 1000): number {
  const [t, setT] = useState(active ? 0 : 1);
  useEffect(() => {
    if (!active) {
      setT(1);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setT(1);
      return;
    }
    let raf = 0;
    let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      setT(1 - Math.pow(1 - p, 3)); // ease-out cubic
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, duration]);
  return t;
}

export function RunStats({ animate = false }: { animate?: boolean }) {
  const r = useGameStore((s) => s.runResult);
  const t = useCountProgress(animate);
  if (!r) return null;

  const ids = r.mutators ?? [];
  const mult = mutatorScoreMult(ids); // 1.0 with no trials
  const score = Math.round((r.gold + r.kills * 10 + (r.victory ? 500 : 0)) * mult);
  const cu = (n: number) => Math.round(n * t); // count-up toward the final value
  const rows: [string, string, boolean?][] = [
    ["Score", String(cu(score)), true],
    ["Foes slain", String(cu(r.kills))],
    ["Gold gathered", String(cu(r.gold))],
    ["Turns taken", String(cu(r.turns))],
    ["Time", fmtTime(r.timeMs * t)],
  ];
  const trials = ids.map((id) => mutatorById(id)?.name).filter(Boolean) as string[];

  return (
    <div className="flex w-64 max-w-[85vw] flex-col gap-1 border border-edge bg-panel/60 px-6 py-3 text-sm">
      {rows.map(([k, v, gold]) => (
        <div key={k} className="flex items-baseline justify-between gap-8">
          <span className="text-dim">
            {k}
            {k === "Score" && mult > 1 && (
              <span className="text-magic"> ×{mult.toFixed(2)}</span>
            )}
          </span>
          <span className={gold ? "text-gold" : "text-fg"}>{v}</span>
        </div>
      ))}
      {trials.length > 0 && (
        <div className="mt-1 border-t border-edge pt-1.5 text-[11px] leading-snug text-dim">
          <span className="text-[#6f7078]">Trials: </span>
          <span className="text-magic">{trials.join(" · ")}</span>
        </div>
      )}
    </div>
  );
}
