"use client";

import { useGameStore } from "@/store/gameStore";

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function RunStats() {
  const r = useGameStore((s) => s.runResult);
  if (!r) return null;

  const score = r.gold + r.kills * 10 + (r.victory ? 500 : 0);
  const rows: [string, string, boolean?][] = [
    ["Score", String(score), true],
    ["Foes slain", String(r.kills)],
    ["Gold gathered", String(r.gold)],
    ["Turns taken", String(r.turns)],
    ["Time", fmtTime(r.timeMs)],
  ];

  return (
    <div className="flex w-64 max-w-[85vw] flex-col gap-1 border border-edge bg-panel/60 px-6 py-3 text-sm">
      {rows.map(([k, v, gold]) => (
        <div key={k} className="flex items-baseline justify-between gap-8">
          <span className="text-dim">{k}</span>
          <span className={gold ? "text-gold" : "text-fg"}>{v}</span>
        </div>
      ))}
    </div>
  );
}
