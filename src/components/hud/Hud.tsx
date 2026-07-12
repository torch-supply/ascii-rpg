"use client";

import { useGameStore } from "@/store/gameStore";
import { LEVELS } from "@/content/levels";
import { ITEMS } from "@/content/items";
import { goalLabel } from "@/game/core/goals";

/** Top status bar — rendered in normal flow above the canvas region. */
export function HudBar() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;

  const p = game.player;
  const level = LEVELS[game.currentLevel];
  const weapon = ITEMS[p.weaponId];
  const armor = ITEMS[p.armorId];
  const hpPct = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
  const turnPct = Math.max(0, Math.round((game.turnsLeft / level.turnLimit) * 100));
  const lowTurns = game.turnsLeft <= 40;

  return (
    <div className="z-10 shrink-0 border-b border-edge bg-panel/95 px-4 py-2 text-[13px]">
      <div className="flex items-center justify-between">
        <span className="text-dim">
          <span style={{ color: level.palette.accent }}>◈</span> Level{" "}
          {game.currentLevel + 1}/{LEVELS.length} — {level.title}
        </span>
        <span className="flex items-center gap-4">
          <span className="text-hp" title="lives">
            {"♥".repeat(Math.max(0, p.lives))}
            <span className="text-edge">{"♥".repeat(Math.max(0, 3 - p.lives))}</span>
          </span>
          <span className="text-gold">$ {p.coins}</span>
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-dim">HP</span>
          <span className="h-2 w-32 overflow-hidden rounded-sm border border-edge">
            <span
              className="block h-full"
              style={{ width: `${hpPct}%`, background: hpPct > 40 ? "#3fbf3f" : "#ff5555" }}
            />
          </span>
          <span className={hpPct > 40 ? "text-good" : "text-hp"}>
            {p.hp}/{p.maxHp}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-dim">TURNS</span>
          <span className="h-2 w-28 overflow-hidden rounded-sm border border-edge">
            <span
              className="block h-full"
              style={{ width: `${turnPct}%`, background: lowTurns ? "#ff5555" : "#7fdfff" }}
            />
          </span>
          <span className={lowTurns ? "text-hp blink" : "text-magic"}>
            {game.turnsLeft}
          </span>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between gap-4 text-dim">
        <span>
          <span className="text-fg">⚔ {weapon.name}</span>
          <span className="text-dim"> ({weapon.power})</span>
          <span className="text-fg"> · ▣ {armor.name}</span>
          <span className="text-dim"> ({armor.reduction})</span>
          {p.hasTorch && <span className="text-gold"> · ( torch</span>}
        </span>
        <span style={{ color: level.palette.accent }}>✦ {goalLabel(game)}</span>
      </div>
    </div>
  );
}

/** Message log + controls hint — overlaid on the bottom of the canvas region. */
export function HudFooter() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const log = game.messageLog.slice(-4);

  return (
    <>
      <div className="pointer-events-none absolute bottom-2 left-4 z-10 flex flex-col gap-0.5 text-[12px]">
        {log.map((line, i) => (
          <span
            key={`${game.turnCount}-${i}`}
            className="text-dim"
            style={{ opacity: 0.55 + (i / Math.max(1, log.length)) * 0.45 }}
          >
            {line}
          </span>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-2 right-4 z-10 text-[11px] text-dim">
        move ↑↓←→ / hjkl · bump = attack · [i]nv · [p]ause · [?]help
      </div>
    </>
  );
}
