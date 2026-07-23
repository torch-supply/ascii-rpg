'use client';

import { SoundToggle } from '@/components/ui/SoundToggle';
import { classDef } from '@/content/classes';
import { ITEMS } from '@/content/items';
import { LEVELS } from '@/content/levels';
import { ELITE, MONSTERS } from '@/content/monsters';
import { goalLabel } from '@/game/core/goals';
import { idx } from '@/game/core/grid';
import { STATUS, STATUS_KEYS } from '@/game/core/status';
import { useGameStore } from '@/store/gameStore';
import { useEffect, useState } from 'react';

/**
 * Design 3a — "refined terminal": the existing 3-row header + footer, restyled
 * with clearer hierarchy, segmented glow gauges (HP / turns), and a color-coded
 * message log. All live data (effects, ammo, survive/overtime, goal) is
 * preserved verbatim — only the chrome changed.
 */

// Segmented glow gauge (design 3a): a colored fill under a repeating mask that
// punches it into bars, over a dark inset track.
function SegGauge({
  label,
  pct,
  fill,
  glow,
  width,
  labelWidth,
  children,
}: {
  label: string;
  pct: number;
  fill: string;
  glow: string;
  width: number;
  labelWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="text-[12px] tracking-[0.18em] text-[#8a8a96]"
        style={labelWidth ? { width: labelWidth } : undefined}
      >
        {label}
      </span>
      <div
        className="relative h-2.5 overflow-hidden rounded-[1px] border"
        style={{ width, borderColor: '#3a3a46', background: '#0b0b0f' }}
      >
        <div
          className="absolute inset-0"
          style={{ width: `${pct}%`, background: fill, boxShadow: glow }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'repeating-linear-gradient(90deg,transparent 0 8px,rgba(9,9,12,.92) 8px 10px)',
          }}
        />
      </div>
      {children}
    </div>
  );
}

/** Top status bar — rendered in normal flow above the canvas region. */
export function HudBar() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;

  const p = game.player;
  const cls = classDef(p.classId);
  const level = LEVELS[game.currentLevel];
  const weapon = ITEMS[p.weaponId];
  const armor = ITEMS[p.armorId];
  const powerLabel =
    p.weaponBonus > 0
      ? `${p.weaponPower}+${p.weaponBonus}`
      : `${p.weaponPower}`;
  const ammo = weapon.ranged
    ? (p.bag.find((b) => b.defId === weapon.ranged!.ammoId)?.count ?? 0)
    : null;
  const hpPct = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
  const survive = level.goal.type === 'survive';
  const surviveLeft = survive
    ? Math.max(0, (level.goal as { turns: number }).turns - game.turnCount)
    : 0;
  const overtime = !survive && game.turnsLeft <= 0;
  const turnLabel = overtime ? 'OVERTIME' : survive ? 'HOLD' : 'TURNS';
  const turnsVal = survive ? surviveLeft : game.turnsLeft;
  const turnsMax = survive
    ? (level.goal as { turns: number }).turns
    : level.turnLimit;
  const turnPct = Math.max(0, Math.round((turnsVal / turnsMax) * 100));
  const lowTurns = !survive && game.turnsLeft <= 40;

  const hpFill =
    hpPct > 40
      ? 'linear-gradient(90deg,#2f9e44,#4fd257)'
      : 'linear-gradient(90deg,#7d2f2f,#ff5555)';
  const hpGlow =
    hpPct > 40 ? '0 0 10px rgba(63,191,63,.55)' : '0 0 10px rgba(255,85,85,.5)';
  const turnFill = lowTurns
    ? 'linear-gradient(90deg,#7d2f2f,#ff5555)'
    : survive
      ? 'linear-gradient(90deg,#94823a,#ffd24d)'
      : 'linear-gradient(90deg,#3a7d94,#7fdfff)';
  const turnGlow = lowTurns
    ? '0 0 10px rgba(255,85,85,.5)'
    : survive
      ? '0 0 10px rgba(255,210,77,.45)'
      : '0 0 10px rgba(127,223,255,.45)';

  return (
    <div
      className="relative z-10 shrink-0 border-b border-edge px-[22px] py-[11px] text-[15px]"
      style={{
        background: 'linear-gradient(180deg,#16161c,#101014)',
        boxShadow: '0 1px 0 rgba(255,180,90,.06) inset',
      }}
    >
      {/* ember hairline along the very top edge */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg,transparent,rgba(255,180,90,.35),transparent)',
        }}
      />

      {/* row 1 — identity + lives + gold */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span title={`Class: ${cls.name}`} style={{ color: cls.color }}>
            {cls.glyph} {cls.name}
          </span>
          <span
            className="inline-block h-[13px] w-px translate-y-0.5"
            style={{ background: '#33333c' }}
          />
          <span className="text-dim">
            <span style={{ color: level.palette.accent }}>◈</span> Level{' '}
            {game.currentLevel + 1}/{LEVELS.length} —{' '}
            <span className="font-semibold tracking-[0.02em] text-fg">
              {level.title}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-[18px]">
          <span className="tracking-[2px] text-hp" title="lives">
            {'♥'.repeat(Math.max(0, p.lives))}
            <span className="text-edge">
              {'♥'.repeat(Math.max(0, 3 - p.lives))}
            </span>
          </span>
          <span className="flex items-baseline gap-1.5 text-gold">
            <span className="text-[12px]" style={{ color: '#9a7a12' }}>
              GOLD
            </span>{' '}
            {p.coins}
          </span>
        </div>
      </div>

      {/* row 2 — segmented gauges */}
      <div className="mt-[7px] flex items-center justify-between gap-6">
        <SegGauge
          label="HP"
          pct={hpPct}
          fill={hpFill}
          glow={hpGlow}
          width={190}
        >
          <span className={hpPct > 40 ? 'text-good' : 'text-hp'}>
            {p.hp}
            <span className="text-edge">/{p.maxHp}</span>
          </span>
        </SegGauge>
        <SegGauge
          label={turnLabel}
          pct={turnPct}
          fill={turnFill}
          glow={turnGlow}
          width={150}
        >
          <span
            className={
              lowTurns ? 'text-hp blink' : survive ? 'text-gold' : 'text-magic'
            }
          >
            {overtime ? '⚠' : turnsVal}
          </span>
        </SegGauge>
      </div>

      {/* row 3 — equipped loadout + active effects + objective */}
      <div className="mt-[7px] flex items-center justify-between gap-6 text-dim">
        <span className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <span>
            <span className="text-fg">⚔ {weapon.name}</span>
            <span className="text-dim"> ({powerLabel})</span>
            {ammo !== null && (
              <span className={ammo > 0 ? 'text-gold' : 'text-hp'}>
                {' '}
                · » {ammo}
              </span>
            )}
          </span>
          <span>
            <span className="text-fg">▣ {armor.name}</span>
            <span className="text-dim"> ({armor.reduction})</span>
          </span>
          {p.hasTorch && p.torchFuel > 0 && (
            <span className={p.torchFuel <= 20 ? 'text-hp' : 'text-gold'}>
              ( {p.torchId ? ITEMS[p.torchId].name : 'Torch'} {p.torchFuel}
            </span>
          )}
          {(p.effects.ward ?? 0) > 0 && (
            <span className="text-magic">⛨ ward {p.effects.ward}</span>
          )}
          {(p.effects.might ?? 0) > 0 && (
            <span style={{ color: '#ff9d3c' }}>⚔ might {p.effects.might}</span>
          )}
          {(p.effects.levitate ?? 0) > 0 && (
            <span style={{ color: '#a9d8ff' }}>
              ☁ float {p.effects.levitate}
            </span>
          )}
          {(p.effects.emberstep ?? 0) > 0 && (
            <span style={{ color: '#ff7a3c' }}>
              ✷ ember {p.effects.emberstep}
            </span>
          )}
          {(p.effects.frostwalk ?? 0) > 0 && (
            <span style={{ color: '#bfe8ff' }}>
              ❆ rime {p.effects.frostwalk}
            </span>
          )}
          {(p.effects.shadow ?? 0) > 0 && (
            <span style={{ color: '#9a8cff' }}>
              ◐ shadow {p.effects.shadow}
            </span>
          )}
          {STATUS_KEYS.map((k) =>
            (p.effects[k] ?? 0) > 0 ? (
              <span key={k} style={{ color: STATUS[k].hudColor }}>
                {STATUS[k].hudGlyph} {k} {p.effects[k]}
              </span>
            ) : null,
          )}
        </span>
        <span
          className="flex shrink-0 items-center gap-2 whitespace-nowrap"
          style={{ color: level.palette.accent }}
        >
          ✦ {goalLabel(game)}
        </span>
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
            {def.glyph} {def.name}
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
              background: pct > 40 ? '#c0392b' : '#ff5555',
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
                {def.glyph} {label}
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
                  background: pct > 40 ? '#c0392b' : '#ff5555',
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

// Color-code a log line by intent (design 3a). messageLog is plain strings, so
// this is a keyword heuristic — if you later give log entries a typed `kind`,
// switch on that instead. Order matters: kills before damage ("You slay …" vs
// "… hits you for 3").
function classifyLog(line: string): {
  color: string;
  glyph: string;
  glyphColor: string;
} {
  const s = line.toLowerCase();
  if (
    /(pick up|picks up|you find|found|you get|receive|you buy|you gain)/.test(s)
  )
    return { color: '#ffd700', glyph: '+', glyphColor: '#ffd700' };
  if (/(slay|slain|kill|defeat|destroy|dies|is dead|falls)/.test(s))
    return { color: '#dcdce2', glyph: '×', glyphColor: '#ff7a3c' };
  if (
    /(hits? you|for \d+|damage|wounds|strikes you|bleed|burn|poison|takes \d+)/.test(
      s,
    )
  )
    return { color: '#c78a8a', glyph: '›', glyphColor: '#c0392b' };
  return { color: '#9ea0ad', glyph: '·', glyphColor: '#4a4a58' };
}

/** Bottom status bar — color-coded message log (left) + controls (right). */
export function HudFooter() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const LOG_LINES = 3;
  const recent = game.messageLog.slice(-LOG_LINES);
  const log = [
    ...Array(Math.max(0, LOG_LINES - recent.length)).fill(''),
    ...recent,
  ];

  return (
    <div
      className="relative z-10 flex shrink-0 items-end justify-between gap-6 border-t border-edge px-[22px] py-[9px] text-[15px]"
      style={{ background: 'linear-gradient(0deg,#131318,#0e0e12)' }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        {log.map((line, i) => {
          if (!line)
            return (
              <span key={i} className="truncate" style={{ opacity: 0 }}>
                &nbsp;
              </span>
            );
          const c = classifyLog(line);
          return (
            <span
              key={i}
              className="truncate"
              style={{
                opacity: 0.45 + (i / (LOG_LINES - 1)) * 0.55,
                color: c.color,
              }}
            >
              <span style={{ color: c.glyphColor }}>{c.glyph}</span> {line}
            </span>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-[3px] leading-tight text-[#7a7a86]">
        <div className="mb-0.5">
          <SoundToggle />
        </div>
        <span className="whitespace-nowrap">
          move ↑↓←→ / wasd · bump = attack
        </span>
        <span className="whitespace-nowrap">
          <span className="text-dim">[f]</span>ire ·{' '}
          <span className="text-dim">[c]</span>lose ·{' '}
          <span className="text-dim">[i]</span>nv ·{' '}
          <span className="text-dim">[p]</span>ause ·{' '}
          <span className="text-dim">[?]</span>help
        </span>
      </div>
    </div>
  );
}
