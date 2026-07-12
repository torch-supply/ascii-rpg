"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { ITEMS } from "@/content/items";
import { MenuButton } from "@/components/ui/MenuButton";

export default function InventoryModal() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const p = game.player;
  const weapon = ITEMS[p.weaponId];
  const armor = ITEMS[p.armorId];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/80 px-4">
      <div className="flex w-full max-w-lg flex-col gap-4 border border-edge bg-panel px-7 py-6">
        <h2 className="text-balance text-center text-lg uppercase tracking-[0.3em] text-gold">
          Inventory
        </h2>

        <div className="grid grid-cols-2 gap-2 text-[13px]">
          <span className="text-dim">Equipped weapon</span>
          <span className="text-right text-fg">
            ⚔ {weapon.name} <span className="text-edge">(pow {weapon.power})</span>
          </span>
          <span className="text-dim">Equipped armor</span>
          <span className="text-right text-fg">
            ▣ {armor.name}{" "}
            <span className="text-edge">(red {armor.reduction})</span>
          </span>
          <span className="text-dim">Gold</span>
          <span className="text-right text-gold">$ {p.coins}</span>
          <span className="text-dim">Light radius</span>
          <span className="text-right text-magic">{p.lightRadius}</span>
        </div>

        <div className="border-t border-edge pt-3">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-dim">
            Bag
          </h3>
          {p.bag.length === 0 ? (
            <p className="text-[13px] text-edge">
              Empty. Walk over items to pick them up.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px]">
              {p.bag.map((b, i) => {
                const def = ITEMS[b.defId];
                const kind =
                  def.category === "potion"
                    ? "use"
                    : def.category === "weapon" || def.category === "armor"
                    ? "equip"
                    : "";
                return (
                  <li key={b.defId} className="flex items-baseline justify-between gap-4">
                    <span>
                      <span className="text-magic">[{i + 1}]</span>{" "}
                      <span style={{ color: def.color }}>{def.glyph}</span>{" "}
                      <span className="text-fg">{def.name}</span>
                      {b.count > 1 && (
                        <span className="text-dim"> ×{b.count}</span>
                      )}
                    </span>
                    {kind && (
                      <span className="text-edge">press {i + 1} to {kind}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-center pt-1">
          <MenuButton accent autoFocus onClick={() => gameStore.getState().setMode("playing")}>
            ▸ Close <span className="text-xs opacity-70">(i / Esc)</span>
          </MenuButton>
        </div>
      </div>
    </div>
  );
}
