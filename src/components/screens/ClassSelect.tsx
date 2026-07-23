"use client";

import { gameStore } from "@/store/gameStore";
import { CLASS_LIST, type ClassDef } from "@/content/classes";
import { ITEMS } from "@/content/items";
import { MenuButton } from "@/components/ui/MenuButton";
import { AccentDivider } from "@/components/ui/AccentDivider";
import { AsciiField } from "@/components/ui/AsciiField";
import { BoxFrame } from "@/components/ui/BoxFrame";

/** Starting weapon · armor · consumables. */
function kitLine(cls: ClassDef): string {
  const gear = `${ITEMS[cls.weaponId].name} · ${ITEMS[cls.armorId].name}`;
  const bag = cls.bag
    .map((b) => `${ITEMS[b.defId].name}${b.count > 1 ? ` ×${b.count}` : ""}`)
    .join(", ");
  return bag ? `${gear} · ${bag}` : gear;
}

/** HP + the passive traits, as compact stat chips. */
function traitLine(cls: ClassDef): string {
  const bits = [`${cls.maxHp} HP`];
  if (cls.damageReduction) bits.push(`−${cls.damageReduction} dmg taken`);
  if (cls.sneakMultiplier) bits.push(`${cls.sneakMultiplier}× sneak`);
  if (cls.critChance) bits.push(`${Math.round(cls.critChance * 100)}% crit`);
  if (cls.bombPower) bits.push(`+${cls.bombPower} bomb dmg`);
  return bits.join(" · ");
}

/**
 * Class select, brought in line with the finalized kit: ember ASCII field +
 * box-framed panel + gold caps title + ◈ divider, with class cards styled like
 * the shop / inventory rows (dark inset, gold hover, magic-blue key). Same store
 * calls (chooseClass / setMode) and content.
 */
export default function ClassSelect() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-auto bg-ink px-6 py-10 text-center">
      {/* ember ASCII field — matches the splash it descends from */}
      <AsciiField mode="abstract" biome="pit" bottom intensity={0.24} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(52% 48% at 50% 38%, rgba(255,140,45,0.08), transparent 66%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 54%, rgba(0,0,0,0.6) 100%)" }}
      />

      <BoxFrame
        accent="#ffb347"
        chip="#0c0c0e"
        className="narr-rise z-10 flex w-[min(92vw,40rem)] flex-col items-center gap-6"
        style={{ background: "rgba(9,9,12,0.5)", padding: "44px 52px" }}
      >
        <div className="flex flex-col items-center gap-4">
          <h2 className="m-0 text-2xl font-semibold uppercase tracking-[0.3em] text-gold" style={{ textIndent: "0.3em" }}>
            Choose Your Path
          </h2>
          <AccentDivider accent="#ffb347" />
        </div>

        <div className="flex w-full flex-col gap-3">
          {CLASS_LIST.map((cls, i) => (
            <button
              key={cls.id}
              onClick={() => gameStore.getState().chooseClass(cls.id)}
              className="pointer-events-auto block w-full border border-[#2c2c36] bg-[#0c0c10] px-5 py-3 text-left transition-colors hover:border-gold focus:border-gold focus:outline-none"
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-magic">[{i + 1}]</span>
                <span className="text-lg" style={{ color: cls.color }}>
                  {cls.glyph} {cls.name}
                </span>
                <span className="text-[11px] text-[#6f7078]">— {traitLine(cls)}</span>
              </div>
              <div className="mt-1 text-sm text-fg">{cls.blurb}</div>
              <div className="mt-1 text-xs text-[#6f7078]">{kitLine(cls)}</div>
            </button>
          ))}
        </div>

        <div className="flex flex-col items-center gap-3">
          <MenuButton onClick={() => gameStore.getState().setMode("splash")}>
            ▸ Back
            <span className="ml-1 text-xs text-dim">(Esc)</span>
          </MenuButton>
          <p className="m-0 max-w-md text-balance text-[11px] text-[#5a5a64]">
            press 1–3 or click to begin · each class changes your opening kit and tactics
          </p>
        </div>
      </BoxFrame>
    </div>
  );
}
