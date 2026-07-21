"use client";

import { gameStore } from "@/store/gameStore";
import { CLASS_LIST, type ClassDef } from "@/content/classes";
import { ITEMS } from "@/content/items";
import { MenuButton } from "@/components/ui/MenuButton";
import { AccentDivider } from "@/components/ui/AccentDivider";

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

export default function ClassSelect() {
  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 overflow-auto bg-ink px-6 py-10 text-center">
      <div className="flex flex-col items-center gap-4">
        <h2 className="text-balance text-2xl uppercase tracking-[0.3em] text-gold">
          Choose Your Path
        </h2>
        <AccentDivider accent="#ffb347" />
      </div>

      <div className="flex w-full max-w-lg flex-col gap-3">
        {CLASS_LIST.map((cls, i) => (
          <button
            key={cls.id}
            onClick={() => gameStore.getState().chooseClass(cls.id)}
            className="pointer-events-auto block w-full border border-edge bg-panel px-5 py-3 text-left transition-colors hover:border-gold focus:border-gold focus:outline-none"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-magic">[{i + 1}]</span>
              <span className="text-lg" style={{ color: cls.color }}>
                {cls.glyph} {cls.name}
              </span>
              <span className="text-[11px] text-dim">— {traitLine(cls)}</span>
            </div>
            <div className="mt-1 text-sm text-fg">{cls.blurb}</div>
            <div className="mt-1 text-xs text-dim">{kitLine(cls)}</div>
          </button>
        ))}
      </div>

      <MenuButton onClick={() => gameStore.getState().setMode("splash")}>
        ▸ Back
        <span className="ml-1 text-xs text-dim">(Esc)</span>
      </MenuButton>
      <p className="max-w-md text-balance text-[11px] text-edge">
        press 1–3 or click to begin · each class changes your opening kit and tactics
      </p>
    </div>
  );
}
