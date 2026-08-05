"use client";

import { CONFIG } from "@/content/config";
import { classDef } from "@/content/classes";
import { ITEMS } from "@/content/items";
import { HOTBAR_SLOTS, hotbar } from "@/game/core/hotbar";
import { STATUS, STATUS_KEYS } from "@/game/core/status";
import { gameStore, useGameStore } from "@/store/gameStore";
import type { PlayerState } from "@/game/core/types";
import { FramePanel } from "./Frame";
import { BG, MARK, TEXT } from "./palette";

/**
 * The character panel down the right edge — EQUIPPED · ABILITY · BAG ·
 * EFFECTS · CONDITIONS. Grown out of the old `BagPanel`, and it keeps that
 * panel's central rule:
 *
 * the BAG block is a LEGEND, not a control surface. Keys 1-9 are bound
 * globally in `keymap.ts` and act during play; the rows exist so you can see
 * what each holds. Nothing here is focusable — no tab stops, no focus ring.
 * Clicking routes to the same `useBagSlot`, and `onMouseDown` preventDefaults so
 * focus never parks on a row where the next arrow key would re-fire it instead
 * of moving the player.
 *
 * Everything else on the panel is read-only status that used to crowd the
 * header's third row.
 */

/** Costs map COLUMNS, not glyph size (cell size derives from height). Worth
 * re-checking by eye on the wide maps alongside `LOG_RAIL_WIDTH`. */
export const CHAR_PANEL_WIDTH = 256;

const HEADER = "text-[10px] tracking-[0.26em]";
const ROW = "flex items-baseline justify-between text-[12px]";

/** The six terrain/combat buffs, in the order the header used to list them.
 * Glyphs and colors are the app's existing ones, unchanged. */
const BUFFS: { key: string; glyph: string; label: string; color: string }[] = [
  { key: "ward", glyph: "⛨", label: "ward", color: "#7fdfff" },
  { key: "might", glyph: "⚔", label: "might", color: "#ff9d3c" },
  { key: "levitate", glyph: "☁", label: "float", color: "#a9d8ff" },
  { key: "emberstep", glyph: "✷", label: "ember", color: "#ff7a3c" },
  { key: "frostwalk", glyph: "❆", label: "rime", color: "#bfe8ff" },
  { key: "shadow", glyph: "◐", label: "shadow", color: "#9a8cff" },
];

function Section({
  title,
  last = false,
  children,
}: {
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[5px]">
      <div className={HEADER}>
        {last ? "└─" : "├─"} {title}
      </div>
      {children}
    </div>
  );
}

export default function CharacterPanel() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const p = game.player;
  const cls = classDef(p.classId);
  const weapon = ITEMS[p.weaponId];
  const armor = ITEMS[p.armorId];
  const powerLabel =
    p.weaponBonus > 0
      ? `${p.weaponPower}+${p.weaponBonus}`
      : `${p.weaponPower}`;
  const ammo = weapon.ranged
    ? (p.bag.find((b) => b.defId === weapon.ranged!.ammoId)?.count ?? 0)
    : null;

  // Pad the hotbar out to all nine rows HERE rather than in `hotbar()` — the
  // helper's contract is "trimmed to the highest claimed slot", which core [62]
  // and store [S16] both pin, and which is the more useful shape for anything
  // that isn't this fixed-height layout.
  const slots = hotbar(p);
  const rows = Array.from({ length: HOTBAR_SLOTS }, (_, i) => slots[i] ?? null);

  const buffs = BUFFS.filter((b) => (p.effects[b.key] ?? 0) > 0);
  const conditions = STATUS_KEYS.filter((k) => (p.effects[k] ?? 0) > 0);

  return (
    <FramePanel
      as="aside"
      corners={["tr", "br"]}
      className="z-10 flex shrink-0 flex-col gap-[17px] overflow-hidden px-3 pb-[11px] pt-3"
      style={{
        width: CHAR_PANEL_WIDTH,
        background: `linear-gradient(180deg,${BG.panel},#0e0e12)`,
      }}
      aria-label="Character"
    >
      {/* ── EQUIPPED ── */}
      <Section title="EQUIPPED">
        <div className={ROW}>
          <span className="truncate text-fg">⚔ {weapon.name}</span>
          <span className="shrink-0 pl-2" style={{ color: TEXT.secondary }}>
            pow {powerLabel}
          </span>
        </div>
        <div className={ROW}>
          <span className="truncate text-fg">▣ {armor.name}</span>
          <span className="shrink-0 pl-2" style={{ color: TEXT.secondary }}>
            def {armor.reduction ?? 0}
          </span>
        </div>
        {ammo !== null && (
          <div className={`${ROW} ${ammo > 0 ? "text-gold" : "text-hp"}`}>
            <span className="truncate">» Arrows</span>
            <span className="shrink-0 pl-2">{ammo}</span>
          </div>
        )}
        {p.hasTorch && p.torchFuel > 0 && <TorchGauge p={p} />}
      </Section>

      {/* ── ABILITY ── */}
      {cls.ability && (
        <Section title="ABILITY">
          <div
            className="flex items-baseline justify-between px-[9px] py-[6px]"
            style={{
              border: `1px solid ${MARK.frame}`,
              background: "rgba(255,140,58,.06)",
            }}
            title={cls.ability.blurb}
          >
            <span className="truncate">
              <span className="text-magic">[q]</span>{" "}
              <span className="text-[13px]" style={{ color: "#ffb37a" }}>
                {cls.ability.name}
              </span>
            </span>
            {p.abilityCooldown > 0 ? (
              <span className="shrink-0 pl-2 text-[11px] text-edge">
                {p.abilityCooldown}
              </span>
            ) : (
              <span className="shrink-0 pl-2 text-[11px] text-good">
                ✦ ready
              </span>
            )}
          </div>
        </Section>
      )}

      {/* ── BAG ──
          This block is the one that gives when the window is short: it takes the
          leftover height and scrolls internally. The panel as a whole must NOT
          scroll — conditions are the thing you need to see without looking for
          it, so they stay pinned below rather than sliding off the bottom. */}
      <div className="flex min-h-0 flex-1 flex-col gap-[5px]">
        <div className="flex items-baseline justify-between">
          <span className={HEADER}>├─ BAG</span>
          <span
            className="text-[9px] tracking-[0.16em]"
            style={{ color: TEXT.tertiary }}
          >
            PRESS 1–9
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {rows.map((entry, i) => {
            const n = i + 1;
            const sep =
              i < HOTBAR_SLOTS - 1
                ? `1px dotted ${MARK.separator}`
                : "1px solid transparent";
            if (!entry) {
              // A reserved-but-spent slot, or one never claimed. Rendered rather
              // than skipped so the numbering stays readable and you can see at a
              // glance what ran out.
              return (
                <div
                  key={n}
                  className="flex items-center gap-2 px-0.5 py-[3px] text-[12px]"
                  style={{ color: MARK.emptySlot, borderBottom: sep }}
                >
                  <span className="shrink-0" style={{ width: 9 }}>
                    {n}
                  </span>
                  <span className="flex-1">—</span>
                </div>
              );
            }
            const def = ITEMS[entry.defId];
            return (
              <button
                key={n}
                type="button"
                tabIndex={-1}
                title={`${def.name}${entry.count > 1 ? ` ×${entry.count}` : ""}`}
                onMouseDown={(e) => e.preventDefault()} // never take focus
                onClick={() => gameStore.getState().useBagSlot(n)}
                className="flex items-center gap-2 px-0.5 py-[3px] text-left text-[12px] hover:bg-[rgba(40,34,20,0.5)]"
                style={{ borderBottom: sep }}
              >
                <span className="shrink-0 text-magic" style={{ width: 9 }}>
                  {n}
                </span>
                <span className="shrink-0" style={{ color: def.color }}>
                  {def.glyph}
                </span>
                <span className="flex-1 truncate text-fg">{def.name}</span>
                {entry.count > 1 && (
                  <span className="shrink-0" style={{ color: TEXT.secondary }}>
                    {entry.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── EFFECTS (buffs) ── */}
      {buffs.length > 0 && (
        <Section title="EFFECTS">
          <div className="flex flex-wrap gap-[5px]">
            {buffs.map((b) => (
              <span
                key={b.key}
                className="px-1.5 py-0.5 text-[11px]"
                style={{ color: b.color, border: `1px solid ${b.color}4d` }}
              >
                {b.glyph} {b.label} {p.effects[b.key]}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* ── CONDITIONS (debuffs) ── */}
      {conditions.length > 0 && (
        <Section title="CONDITIONS" last>
          <div className="flex flex-col gap-1">
            {conditions.map((k) => {
              const st = STATUS[k];
              return (
                <div
                  key={k}
                  className="flex items-center gap-2 px-2 py-[3px] text-[12px]"
                  style={{
                    borderLeft: `2px solid ${st.hudColor}`,
                    background: `${st.hudColor}12`,
                  }}
                >
                  <span style={{ color: st.hudColor }}>{st.hudGlyph}</span>
                  <span
                    className="flex-1 capitalize"
                    style={{ color: st.hudColor }}
                  >
                    {k}
                  </span>
                  <span style={{ color: st.hudColor }}>{p.effects[k]}</span>
                  <span
                    className="text-[10px]"
                    style={{ color: TEXT.tertiary }}
                  >
                    −{st.dmgPerTurn}/turn
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </FramePanel>
  );
}

/**
 * Torch fuel as a bar.
 *
 * There is no stored maximum to divide by: `giveItem` ADDS a torch's fuel to
 * whatever you're carrying (buy a second lantern and you hold 560 against a def
 * of 280), so fuel is an uncapped pool by design. The bar therefore reads
 * against the held light's nominal fuel and CLAMPS at full — an over-full torch
 * shows a full bar rather than overflowing its track. Tracking a real maximum
 * would mean new player state, which this visual pass deliberately avoids.
 */
function TorchGauge({ p }: { p: PlayerState }) {
  const def = p.torchId ? ITEMS[p.torchId] : null;
  const nominal = def?.fuel ?? CONFIG.torchFuel;
  const pct = Math.max(0, Math.min(100, (p.torchFuel / nominal) * 100));
  const low = p.torchFuel <= 20;

  return (
    <div className="flex items-center gap-2 pt-0.5 text-[12px]">
      <span className="shrink-0 text-fg">( {def?.name ?? "Torch"}</span>
      <div
        className="relative h-[6px] flex-1 overflow-hidden"
        style={{ border: `1px solid ${MARK.frame}`, background: "#0b0b0f" }}
      >
        <div
          className="torch-flicker absolute inset-y-0 left-0"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg,#a8630f,#ffb347)",
            boxShadow: "0 0 8px rgba(255,157,60,.5)",
          }}
        />
      </div>
      <span className="shrink-0" style={{ color: low ? "#ff5555" : "#ff9d3c" }}>
        {p.torchFuel}
      </span>
    </div>
  );
}
