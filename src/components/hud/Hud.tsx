"use client";

import { useEffect, useState } from "react";
import { useGameStore } from "@/store/gameStore";
import { LEVELS } from "@/content/levels";
import { ITEMS } from "@/content/items";
import { MONSTERS } from "@/content/monsters";
import { idx } from "@/game/core/grid";
import { STATUS, STATUS_KEYS } from "@/game/core/status";
import { goalLabel } from "@/game/core/goals";

/** Top status bar — rendered in normal flow above the canvas region. */
export function HudBar() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;

  const p = game.player;
  const level = LEVELS[game.currentLevel];
  const weapon = ITEMS[p.weaponId];
  const armor = ITEMS[p.armorId];
  const powerLabel = p.weaponBonus > 0 ? `${p.weaponPower}+${p.weaponBonus}` : `${p.weaponPower}`;
  const ammo = weapon.ranged
    ? p.bag.find((b) => b.defId === weapon.ranged!.ammoId)?.count ?? 0
    : null;
  const hpPct = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
  // On "survive" levels the timer counts down toward zero remaining hold-time.
  const survive = level.goal.type === "survive";
  const surviveLeft = survive
    ? Math.max(0, (level.goal as { turns: number }).turns - game.turnCount)
    : 0;
  const turnLabel = survive ? "HOLD" : "TURNS";
  const turnsVal = survive ? surviveLeft : game.turnsLeft;
  const turnsMax = survive ? (level.goal as { turns: number }).turns : level.turnLimit;
  const turnPct = Math.max(0, Math.round((turnsVal / turnsMax) * 100));
  const lowTurns = !survive && game.turnsLeft <= 40;

  return (
    <div className="z-10 shrink-0 border-b border-edge bg-panel/95 px-4 py-2 text-[15px]">
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
          <span className="text-dim">{turnLabel}</span>
          <span className="h-2 w-28 overflow-hidden rounded-sm border border-edge">
            <span
              className="block h-full"
              style={{
                width: `${turnPct}%`,
                background: lowTurns ? "#ff5555" : survive ? "#ffd24d" : "#7fdfff",
              }}
            />
          </span>
          <span className={lowTurns ? "text-hp blink" : survive ? "text-gold" : "text-magic"}>
            {turnsVal}
          </span>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between gap-4 text-dim">
        <span>
          <span className="text-fg">⚔ {weapon.name}</span>
          <span className="text-dim"> ({powerLabel})</span>
          {ammo !== null && (
            <span className={ammo > 0 ? "text-gold" : "text-hp"}> · » {ammo}</span>
          )}
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
          {STATUS_KEYS.map((k) =>
            (p.effects[k] ?? 0) > 0 ? (
              <span key={k} style={{ color: STATUS[k].hudColor }}>
                {" "}
                · {STATUS[k].hudGlyph} {k} {p.effects[k]}
              </span>
            ) : null
          )}
        </span>
        <span style={{ color: level.palette.accent }}>✦ {goalLabel(game)}</span>
      </div>
    </div>
  );
}

/** Prominent boss bar — shows while a boss is in view (engaged). Overlaid on
   the map region, top-center. */
export function BossBar() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const w = game.map.width;
  const boss = game.monsters.find(
    (m) => MONSTERS[m.defId].isBoss && game.visible.includes(idx(m.x, m.y, w))
  );
  if (!boss) return null;
  const def = MONSTERS[boss.defId];
  const pct = Math.max(0, Math.min(100, Math.round((boss.hp / def.maxHp) * 100)));

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
      <div className="w-80 max-w-[80%] border border-hp/60 bg-panel/90 px-3 py-1.5 shadow-[0_0_12px_rgba(255,60,60,0.25)]">
        <div className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.2em]">
          <span style={{ color: def.color }}>
            {def.glyph} {def.name}
          </span>
          <span className="text-dim">
            {Math.max(0, boss.hp)}/{def.maxHp}
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-sm border border-edge">
          <div
            className="h-full transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%`, background: pct > 40 ? "#c0392b" : "#ff5555" }}
          />
        </div>
      </div>
    </div>
  );
}

/** Level intro card — a brief biome banner + goal that fades in when a level
   opens, then unmounts itself on a timer. */
export function LevelIntro() {
  const game = useGameStore((s) => s.game);
  const level = game ? game.currentLevel : -1;
  const [shownFor, setShownFor] = useState(-1);

  useEffect(() => {
    if (level < 0) return;
    setShownFor(level);
    const t = setTimeout(() => setShownFor(-1), 2600);
    return () => clearTimeout(t);
  }, [level]);

  if (!game || level < 0 || shownFor !== level) return null;
  const cfg = LEVELS[level];

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="intro-card border border-edge bg-ink/85 px-10 py-6 text-center">
        <div className="text-[11px] uppercase tracking-[0.5em] text-dim">
          Level {level + 1} / {LEVELS.length}
        </div>
        <div
          className="mt-2 text-3xl uppercase tracking-[0.15em]"
          style={{ color: cfg.palette.accent }}
        >
          {cfg.title}
        </div>
        <div className="mt-3 text-sm text-dim">✦ {goalLabel(game)}</div>
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
    <div className="z-10 flex shrink-0 items-end justify-between gap-4 border-t border-edge bg-panel/95 px-4 py-1.5 text-[14px]">
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

      <div className="flex shrink-0 items-end gap-3">
        <span className="whitespace-nowrap text-[13px] text-dim">
          move ↑↓←→ / hjkl · bump = attack · [f]ire · [i]nv · [p]ause · [?]help
        </span>
        <SoundToggle />
      </div>
    </div>
  );
}

/** Global SFX on/off toggle (preference persists across sessions). */
function SoundToggle() {
  const soundOn = useGameStore((s) => s.soundOn);
  const toggleSound = useGameStore((s) => s.toggleSound);
  return (
    <button
      onClick={toggleSound}
      title={`Sound ${soundOn ? "on" : "off"} — click or press [m]`}
      aria-label={`Sound ${soundOn ? "on" : "off"}`}
      className={`shrink-0 border px-2 py-0.5 text-[13px] transition-colors ${
        soundOn
          ? "border-gold/50 text-gold hover:bg-gold/15"
          : "border-edge text-edge hover:text-dim"
      }`}
    >
      {soundOn ? "♪ on" : "♪ off"}
    </button>
  );
}
