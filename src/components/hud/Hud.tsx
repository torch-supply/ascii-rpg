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
          {p.hasTorch && p.torchFuel > 0 && (
            <span className={p.torchFuel <= 20 ? "text-hp" : "text-gold"}>
              {" "}
              · ( torch {p.torchFuel}
            </span>
          )}
          {(p.effects.ward ?? 0) > 0 && (
            <span className="text-magic"> · ⛨ ward {p.effects.ward}</span>
          )}
          {(p.effects.might ?? 0) > 0 && (
            <span style={{ color: "#ff9d3c" }}> · ⚔ might {p.effects.might}</span>
          )}
        </span>
        <span style={{ color: level.palette.accent }}>✦ {goalLabel(game)}</span>
      </div>
    </div>
  );
}

/** Bottom status bar — message log (left) + controls (right), in normal flow. */
export function HudFooter() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  // Always render LOG_LINES slots (pad the top with blanks) so the footer is a
  // constant height — otherwise it grows as messages accumulate and the map
  // region resizes/jumps.
  const LOG_LINES = 3;
  const recent = game.messageLog.slice(-LOG_LINES);
  const log = [
    ...Array(Math.max(0, LOG_LINES - recent.length)).fill(""),
    ...recent,
  ];

  return (
    <div className="z-10 flex shrink-0 items-end justify-between gap-4 border-t border-edge bg-panel/95 px-4 py-1.5 text-[12px]">
      <div className="flex min-w-0 flex-col gap-0.5">
        {log.map((line, i) => (
          <span
            key={i}
            className="truncate text-dim"
            style={{ opacity: line ? 0.45 + (i / (LOG_LINES - 1)) * 0.55 : 0 }}
          >
            {line || " "}
          </span>
        ))}
      </div>

      <div className="shrink-0 whitespace-nowrap text-[11px] text-dim">
        move ↑↓←→ / hjkl · bump = attack · [i]nv · [p]ause · [?]help
      </div>
    </div>
  );
}
