"use client";

import { SoundToggle } from "@/components/ui/SoundToggle";
import { classDef } from "@/content/classes";
import { mutatorById } from "@/content/mutators";
import { LEVELS } from "@/content/levels";
import { ELITE, MONSTERS } from "@/content/monsters";
import { goalLabel, goalProgress, goalTitle } from "@/game/core/goals";
import { STATUS, STATUS_KEYS } from "@/game/core/status";
import { idx } from "@/game/core/grid";
import { useGameStore } from "@/store/gameStore";
import { useEffect, useState } from "react";
import { FramePanel } from "./Frame";
import { BG, MARK, TEXT } from "./palette";

/**
 * Design 2a — "Grimoire · slate": persistent chrome as four framed panels.
 *
 * Row 1 is the CHARACTER (identity, vitality, lives, gold — true wherever you
 * are); row 2 is the CURRENT LEVEL (place, objective, progress) plus live
 * status. The loadout and bag moved to the character panel and the message log
 * to its own rail, which is what took this from three crowded rows to two
 * glanceable ones.
 */

/** Most objective pips worth drawing. Collect goals are 3 today, but `killCount`
 * takes an arbitrary N — a dozen diamonds would be uncountable at a glance AND
 * push the objective row wide, so past this the count stands alone. */
const MAX_PIPS = 8;

/** The six terrain/combat buffs, with the app's existing glyphs and colours. */
const BUFFS: { key: string; glyph: string; label: string; color: string }[] = [
  { key: "ward", glyph: "⛨", label: "ward", color: "#7fdfff" },
  { key: "might", glyph: "⚔", label: "might", color: "#ff9d3c" },
  { key: "levitate", glyph: "☁", label: "float", color: "#a9d8ff" },
  { key: "emberstep", glyph: "✷", label: "ember", color: "#ff7a3c" },
  { key: "frostwalk", glyph: "❆", label: "rime", color: "#bfe8ff" },
  { key: "shadow", glyph: "◐", label: "shadow", color: "#9a8cff" },
];

/**
 * Above this many active conditions, the chips drop their `−N/turn` detail so
 * they all still FIT. Deliberately a detail-degrade rather than the "cap and
 * overflow to +N" the design sketched: a hidden condition is the one thing this
 * move exists to prevent you from missing, and "+2" tells you there are more
 * without telling you what — useless precisely when you're deciding whether to
 * quaff an antidote. Buffs may overflow; conditions never do.
 */
const CONDITION_DETAIL_MAX = 2;

/**
 * The low-HP alarm on the vitality gauge. It starts at the same 40% threshold
 * that already turns the gauge red, and tightens from a slow throb at the edge
 * of trouble to an urgent one at death's door — so the pulse RATE carries "how
 * bad is it", information the colour alone can't (red is red at 39% and 4%).
 */
const LOW_PULSE_SLOW = 1700; // ms, at the 40% threshold
const LOW_PULSE_FAST = 620; // ms, at 0 HP

// Segmented glow gauge: a colored fill under a repeating mask that punches it
// into bars, over a dark inset track. `label` is optional — sitting beside the
// objective it already reads as the objective's progress, so a "HOLD" caption
// next to "Hold out" would just be the word twice.
function SegGauge({
  label,
  pct,
  fill,
  glow,
  width,
  labelWidth,
  children,
}: {
  label?: string;
  pct: number;
  fill: string;
  glow: string;
  width: number;
  labelWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      {label && (
        <span
          className="text-[12px] tracking-[0.18em]"
          style={{ color: TEXT.secondary, width: labelWidth }}
        >
          {label}
        </span>
      )}
      <div
        className="relative h-2.5 overflow-hidden rounded-[1px] border"
        style={{ width, borderColor: "#3a3a46", background: "#0b0b0f" }}
      >
        <div
          className="absolute inset-0"
          style={{ width: `${pct}%`, background: fill, boxShadow: glow }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "repeating-linear-gradient(90deg,transparent 0 8px,rgba(9,9,12,.92) 8px 10px)",
          }}
        />
      </div>
      {children}
    </div>
  );
}

/** Top status bar — two framed rows above the map region. */
export function HudBar() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;

  const p = game.player;
  const cls = classDef(p.classId);
  const level = LEVELS[game.currentLevel];
  const hpPct = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
  const low = hpPct <= 40;
  // The turn budget is no longer a threat on normal levels (no countdown /
  // overtime) — it's just a par-for-score target. The only visible turn gauge is
  // the "hold out N turns" countdown on survive levels, where the clock IS the
  // goal, so SegGauge survives for exactly that one case.
  const survive = level.goal.type === "survive";
  const surviveMax = survive ? (level.goal as { turns: number }).turns : 1;
  const surviveLeft = survive ? Math.max(0, surviveMax - game.turnCount) : 0;
  const turnPct = Math.max(0, Math.round((surviveLeft / surviveMax) * 100));

  // 15-cell block gauge. Never round a live player down to zero blocks — an
  // empty bar reads as dead, so keep one lit while there's any HP left.
  const CELLS = 15;
  const filled =
    p.hp > 0 ? Math.max(1, Math.round((p.hp / p.maxHp) * CELLS)) : 0;
  // eased across the low band, so the rate says how much trouble you're in
  const lowPulseMs = Math.round(
    LOW_PULSE_FAST +
      (LOW_PULSE_SLOW - LOW_PULSE_FAST) * Math.min(1, Math.max(0, hpPct / 40)),
  );
  const progress = goalProgress(game);
  const buffs = BUFFS.filter((b) => (p.effects[b.key] ?? 0) > 0);
  const conditions = STATUS_KEYS.filter((k) => (p.effects[k] ?? 0) > 0);
  const terse = conditions.length > CONDITION_DETAIL_MAX;

  return (
    <FramePanel
      corners={["tl", "tr"]}
      className="z-10 shrink-0 px-[18px] pb-[11px] pt-[13px]"
      style={{ background: `linear-gradient(180deg,${BG.header},#0f0f13)` }}
    >
      {/* row 1 — identity · vitality · lives · gold */}
      <div className="flex items-center justify-between gap-[26px]">
        <div className="flex items-center gap-[14px]">
          <span
            className="flex items-baseline gap-2.5"
            title={`Class: ${cls.name}`}
          >
            <span
              className="text-[22px] leading-none"
              style={{ color: cls.color }}
            >
              {cls.glyph}
            </span>
            <span className="text-[17px] tracking-[0.04em] text-fg">
              {cls.name}
            </span>
          </span>
          <Sep />
          <span
            className="text-[11px] tracking-[0.2em]"
            style={{ color: TEXT.secondary }}
          >
            VITALITY
          </span>
          {/* Gauge and number pulse as ONE unit when low — the blocks throbbing
              while the figure beside them sat still read as a glitch. The rate
              tightens as HP falls (see `LOW_PULSE_*`), so the alarm escalates. */}
          <span
            className={`flex items-center gap-[14px] ${low ? "status-pulse" : ""}`}
            style={
              low
                ? ({ "--pulse-ms": `${lowPulseMs}ms` } as React.CSSProperties)
                : undefined
            }
          >
            <span
              className="text-[16px] leading-none tracking-[1px]"
              style={{ color: low ? "#ff5555" : "#3fbf3f" }}
              title={`${p.hp} / ${p.maxHp} HP`}
            >
              {"▰".repeat(filled)}
              <span style={{ color: MARK.gaugeEmpty }}>
                {"▱".repeat(CELLS - filled)}
              </span>
            </span>
            <span className={`text-[15px] ${low ? "text-hp" : "text-fg"}`}>
              {p.hp}
              <span className="text-edge">/{p.maxHp}</span>
            </span>
          </span>
          <Sep />
          <span
            className="text-[15px] tracking-[3px] text-danger"
            title="lives"
          >
            {"♥".repeat(Math.max(0, p.lives))}
            <span className="text-edge">
              {"♥".repeat(Math.max(0, 3 - p.lives))}
            </span>
          </span>
        </div>
        {/* The coin is a CSS circle, not the `⬤` glyph it started as. A glyph's
            ink sits wherever its font puts it inside the em box, and this text
            falls back to a different font on every platform — so any alignment
            tuned against one machine is wrong on the next. A div has no metrics
            to fight: `items-center` centres two real boxes, everywhere.

            The nesting is still needed because one flex can't do both jobs —
            the coin centres against the number, while the number and its label
            keep their own shared baseline. */}
        <span className="flex shrink-0 items-center gap-2">
          <span
            aria-hidden
            className="shrink-0 rounded-full"
            style={{ width: 12, height: 12, background: TEXT.key }}
          />
          <span className="flex items-baseline gap-2">
            <span className="text-[17px] leading-none text-gold">
              {p.coins}
            </span>
            <span
              className="text-[10px] leading-none tracking-[0.22em]"
              style={{ color: TEXT.secondary }}
            >
              GOLD
            </span>
          </span>
        </span>
      </div>

      {/* row 2 — place · objective */}
      <div
        className="mt-[11px] flex items-center gap-[14px] pt-[10px]"
        style={{ borderTop: `1px dashed ${MARK.rule}` }}
      >
        <span
          className="shrink-0 text-[11px] tracking-[0.24em]"
          style={{ color: TEXT.secondary }}
        >
          LEVEL {game.currentLevel + 1} / {LEVELS.length}
        </span>
        <Sep />
        <span className="shrink-0 text-[14px] tracking-[0.03em] text-fg">
          {level.title}
        </span>
        <Sep />
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0" style={{ color: TEXT.key }}>
            ✦
          </span>
          {/* TITLE only — the pips and the count beside them carry the numbers,
              and `goalLabel`'s inline "— 0/3" would be the same figure a third
              time. The intro card, which has no pips, still uses the label. */}
          <span className="truncate text-[14px] tracking-[0.03em] text-fg">
            {goalTitle(game)}
          </span>
        </span>
        {/* Row 2's progress slot: whatever form this goal's progress takes — pips
            for a collect goal, the countdown gauge for a survive one. Both sit
            beside the objective they belong to rather than up in row 1. */}
        {survive && (
          <SegGauge
            pct={turnPct}
            fill="linear-gradient(90deg,#94823a,#ffd24d)"
            glow="0 0 10px rgba(255,210,77,.45)"
            width={150}
          >
            <span className="text-gold">{surviveLeft}</span>
          </SegGauge>
        )}
        {progress && (
          <>
            {/* Pips are the at-a-glance read; past a handful they stop being
                countable at a glance and just eat the row, so a long goal falls
                back to the numeral alone. */}
            {progress.total <= MAX_PIPS && (
              <span className="flex shrink-0 items-center gap-1.5 text-[13px]">
                {Array.from({ length: progress.total }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      color:
                        i < progress.current
                          ? level.palette.accent
                          : MARK.pipEmpty,
                    }}
                  >
                    {i < progress.current ? "◆" : "◇"}
                  </span>
                ))}
              </span>
            )}
            <span
              className="shrink-0 text-[12px]"
              style={{ color: TEXT.secondary }}
            >
              {progress.current} of {progress.total}
            </span>
          </>
        )}
        {/* Status lives at row 2's right edge — the same spot you already check
            for HP and gold, and a short saccade from the map. Conditions read as
            alarm chips (tinted, outlined, softly pulsing); buffs sit beside them
            as compact glyph+count tokens, since a buff is reassurance and a
            condition is a decision. */}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {conditions.map((k) => {
            const st = STATUS[k];
            return (
              <span
                key={k}
                className="status-pulse flex items-center gap-1.5 px-2 py-[2px] text-[12px]"
                style={{
                  color: st.hudColor,
                  border: `1px solid ${st.hudColor}66`,
                  background: `${st.hudColor}14`,
                }}
                title={`${k} — ${p.effects[k]} turns, −${st.dmgPerTurn} HP/turn`}
              >
                <span>{st.hudGlyph}</span>
                <span className="capitalize">{k}</span>
                <span>{p.effects[k]}</span>
                {!terse && (
                  <span className="text-[10px]" style={{ opacity: 0.75 }}>
                    −{st.dmgPerTurn}/turn
                  </span>
                )}
              </span>
            );
          })}
          {buffs.map((b) => (
            <span
              key={b.key}
              className="flex items-center gap-1 px-1.5 py-[2px] text-[12px]"
              style={{ color: b.color, border: `1px solid ${b.color}40` }}
              title={`${b.label} — ${p.effects[b.key]} turns`}
            >
              <span>{b.glyph}</span>
              <span>{p.effects[b.key]}</span>
            </span>
          ))}
          {game.mutators?.length > 0 && (
            <span
              className="shrink-0 text-magic"
              title={`Trials: ${game.mutators
                .map((id) => mutatorById(id)?.name ?? id)
                .join(", ")}`}
            >
              ⚠ {game.mutators.length}
            </span>
          )}
        </span>
      </div>
    </FramePanel>
  );
}

/** The thin vertical rule between header groups. */
function Sep() {
  return (
    <span aria-hidden className="shrink-0" style={{ color: MARK.frame }}>
      │
    </span>
  );
}

/** Prominent boss bar — shows while a boss is in view (engaged). Overlaid on
   the map region, top-center. */
export function BossBar() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const w = game.map.width;
  const boss = game.monsters.find(
    (m) => MONSTERS[m.defId].isBoss && game.visible.includes(idx(m.x, m.y, w)),
  );
  if (!boss) return null;
  const def = MONSTERS[boss.defId];
  const pct = Math.max(
    0,
    Math.min(100, Math.round((boss.hp / def.maxHp) * 100)),
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
      <div className="w-80 max-w-[80%] border border-hp/60 bg-panel/90 px-3 py-1.5 shadow-[0_0_12px_rgba(255,60,60,0.25)]">
        <div className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.2em]">
          <span style={{ color: def.color }}>
            <span className="normal-case">{def.glyph}</span> {def.name}
          </span>
          <span className="text-dim">
            {Math.max(0, boss.hp)}/{def.maxHp}
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-sm border border-edge">
          <div
            className="h-full transition-[width] duration-200 ease-out"
            style={{
              width: `${pct}%`,
              background: pct > 40 ? "#c0392b" : "#ff5555",
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Compact HP bars for tough non-boss threats in view — champion elites and
   mini-bosses (e.g. the Gate Wardens). Stacked top-left so they don't collide
   with the prominent boss bar (top-center). */
export function EliteBars() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const w = game.map.width;
  const notable = game.monsters
    .filter((m) => {
      const def = MONSTERS[m.defId];
      return (
        !def.isBoss &&
        (m.elite || def.miniBoss) &&
        game.visible.includes(idx(m.x, m.y, w))
      );
    })
    .slice(0, 4);
  if (notable.length === 0) return null;

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-col gap-1">
      {notable.map((m) => {
        const def = MONSTERS[m.defId];
        const em = m.elite ? ELITE[m.elite] : null;
        const maxHp = em ? Math.round(def.maxHp * em.hpMult) : def.maxHp;
        const pct = Math.max(
          0,
          Math.min(100, Math.round((m.hp / maxHp) * 100)),
        );
        const tint = em ? em.color : def.color;
        const label = em ? `${em.label} ${def.name}` : def.name;
        return (
          <div
            key={m.id}
            className="w-fit min-w-44 max-w-[80vw] border border-edge/70 bg-panel/85 px-2 py-1"
          >
            <div className="flex items-baseline justify-between gap-2 text-[10px] uppercase tracking-[0.15em]">
              <span className="whitespace-nowrap" style={{ color: tint }}>
                {/* The glyph must NOT be uppercased with the name: these bars
                    exist so you can match the readout to a thing on screen, and
                    `text-transform` silently rewrote it. Monster glyphs use both
                    cases and two pairs actually collide — a snow hare's `h`
                    rendered as `H`, the HERALD, and a bat's `b` as `B`, the cave
                    bear. */}
                <span className="normal-case">{def.glyph}</span> {label}
              </span>
              <span className="shrink-0 text-dim">
                {Math.max(0, m.hp)}/{maxHp}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-sm border border-edge">
              <div
                className="h-full transition-[width] duration-200 ease-out"
                style={{
                  width: `${pct}%`,
                  background: pct > 40 ? "#c0392b" : "#ff5555",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Level intro card — a brief biome banner + goal that fades in when a level
   opens, then unmounts itself on a timer. */
export function LevelIntro() {
  const game = useGameStore((s) => s.game);
  const level = game ? game.currentLevel : -1;
  const [visibleFor, setVisibleFor] = useState(-1);

  // When the level changes, reveal the card by adjusting state DURING render
  // (React's recommended pattern) rather than in an effect — the timer effect
  // below then only mutates state from inside a callback, which is allowed.
  //
  // Seeded with -1, NOT `level`: this component mounts with the map, and every
  // real level start (leaving the shop, a restart, resume) sets `game` and
  // `mode` in the same store update — so it mounts already ON the new level.
  // Seeding with the current level made the mount look like "no change" and the
  // card never appeared outside the dev level-skip. The map stays mounted under
  // every overlay (`MODE_OVER_MAP`), so a remount means the level really began.
  const [prevLevel, setPrevLevel] = useState(-1);
  if (level !== prevLevel) {
    setPrevLevel(level);
    if (level >= 0) setVisibleFor(level);
  }

  useEffect(() => {
    if (visibleFor < 0) return;
    const t = setTimeout(() => setVisibleFor(-1), 2600);
    return () => clearTimeout(t);
  }, [visibleFor]);

  if (!game || level < 0 || visibleFor !== level) return null;
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

/** Bottom status bar — a single 30px key strip. The message log moved out to
 * `LogRail`, which is what takes this from ~66px to 30px. */
export function HudFooter() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;

  const keys: [string, string][] = [
    ["f", "fire"],
    ["q", "power"],
    ["c", "close"],
    ["i", "inv"],
    ["p", "pause"],
    ["?", "help"],
  ];

  return (
    <FramePanel
      corners={["bl", "br"]}
      className="z-10 flex h-[30px] shrink-0 items-center justify-between px-[14px] text-[12.5px] tracking-[0.08em]"
      style={{ background: BG.footer, color: TEXT.footer }}
    >
      <span className="truncate">↑↓←→ / wasd move · bump to strike</span>
      <span className="flex shrink-0 items-center gap-[13px]">
        {keys.map(([k, label]) => (
          <span key={k} className="whitespace-nowrap">
            <span style={{ color: TEXT.key }}>{k}</span> {label}
          </span>
        ))}
        <SoundToggle compact />
      </span>
    </FramePanel>
  );
}
