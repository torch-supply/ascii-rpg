"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { ITEMS } from "@/content/items";
import { STATUS } from "@/game/core/status";
import { BoxFrame } from "@/components/ui/BoxFrame";
import type { ItemDef } from "@/game/core/types";

/**
 * Weighing a weapon or suit of armour against the one you carry.
 *
 * Gear is a step-onto POI now, like an altar or a lore prop, because you carry
 * ONE weapon and ONE suit and picking a piece up puts down what you were using.
 * It used to be automatic on a bare `power >` test, which silently traded a
 * Frostbrand's chill for one point of axe — and once the displaced piece lands
 * on the FLOOR rather than in your bag, that stops being merely lossy.
 *
 * So the comparison has to show the things `power` cannot: what the weapon DOES
 * (chill, knockback, reach), which the game surfaces nowhere else.
 */
function traits(def: ItemDef): string[] {
  const out: string[] = [];
  if (def.onHit)
    out.push(
      `${STATUS[def.onHit.effect].hudGlyph} ${def.onHit.effect} on hit (${Math.round(def.onHit.chance * 100)}%)`,
    );
  if (def.knockback) out.push(`knocks back ${def.knockback}`);
  if (def.ranged) out.push(`ranged ${def.ranged.range}`);
  return out;
}

function Side({
  d,
  tag,
  label,
  stat,
}: {
  d: ItemDef;
  tag: string;
  label: string;
  stat: number;
}) {
  return (
    <div className="flex-1">
      <div className="text-[10px] uppercase tracking-[0.2em] text-dim">
        {tag}
      </div>
      <div className="mt-1 text-sm" style={{ color: d.color }}>
        {d.glyph} {d.name}
      </div>
      <div className="mt-1 text-xs text-dim">
        {label} {stat}
      </div>
      {traits(d).map((t) => (
        <div key={t} className="text-xs text-magic">
          {t}
        </div>
      ))}
    </div>
  );
}

export default function GearModal() {
  const game = useGameStore((s) => s.game);
  const gear = useGameStore((s) => s.activeGear);
  if (!game || !gear) return null;

  const found = ITEMS[gear.defId];
  const isWeapon = found.category === "weapon";
  const held = ITEMS[isWeapon ? game.player.weaponId : game.player.armorId];
  const statOf = (d: ItemDef) =>
    isWeapon ? (d.power ?? 0) : (d.reduction ?? 0);
  const label = isWeapon ? "power" : "armor";
  const delta = statOf(found) - statOf(held);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/80 px-4">
      <BoxFrame
        accent="#ffd24d"
        chip="#0c0c0e"
        className="flex w-full max-w-lg flex-col gap-4"
        style={{
          background: "rgba(16,16,20,0.94)",
          boxShadow: "0 0 24px rgba(255,210,77,0.12)",
          padding: "24px 28px",
        }}
      >
        <h2 className="text-center text-sm uppercase tracking-[0.25em] text-gold">
          {isWeapon ? "A weapon lies here" : "Armour lies here"}
        </h2>

        <div className="flex items-start gap-4">
          <Side d={held} tag="carrying" label={label} stat={statOf(held)} />
          <div
            className="self-center text-lg"
            style={{
              color: delta > 0 ? "#3fbf3f" : delta < 0 ? "#c0392b" : "#9ea0ad",
            }}
          >
            {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "="}
          </div>
          <Side
            d={found}
            tag="on the ground"
            label={label}
            stat={statOf(found)}
          />
        </div>

        <p className="text-center text-xs leading-relaxed text-dim">
          You can carry only one. Taking this puts the{" "}
          <span className="text-fg">{held.name}</span> down where you stand — it
          will still be here if you want it back.
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <button
            autoFocus
            onClick={() => gameStore.getState().takeGear()}
            className="border border-gold/60 px-4 py-2 text-sm text-gold transition-colors hover:bg-gold/15"
          >
            Take it <span className="text-xs opacity-70">(Enter)</span>
          </button>
          <button
            onClick={() => gameStore.getState().leaveGear()}
            className="border border-edge px-4 py-2 text-sm text-fg transition-colors hover:border-gold hover:text-gold"
          >
            Leave it <span className="text-xs opacity-70">(Esc)</span>
          </button>
        </div>
      </BoxFrame>
    </div>
  );
}
