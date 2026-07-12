"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { ITEMS, SHOP_TIERS, type ShopEntry } from "@/content/items";
import { LEVELS } from "@/content/levels";
import { CONFIG } from "@/content/config";
import { MenuButton } from "@/components/ui/MenuButton";

function statLabel(itemId: string): string {
  const d = ITEMS[itemId];
  switch (d.category) {
    case "weapon":
      return `power ${d.power}`;
    case "armor":
      return `armor ${d.reduction}`;
    case "torch":
      return `+${d.lightBonus} light · ${d.fuel} fuel`;
    case "potion":
      switch (d.effect) {
        case "heal":
        case "greaterHeal":
          return `heals ${d.magnitude}`;
        case "bomb":
          return `${d.magnitude} dmg · aimed`;
        case "blast":
          return `${d.magnitude} dmg burst`;
        case "ward":
          return `halves damage · ${d.duration}t`;
        case "might":
          return `+${CONFIG.mightBonus} power · ${d.duration}t`;
        case "detect":
          return "reveals traps";
        default:
          return "";
      }
    default:
      return "";
  }
}

export default function Shop() {
  const game = useGameStore((s) => s.game);
  const purchases = useGameStore((s) => s.shopPurchases);
  if (!game) return null;

  const tier = LEVELS[game.currentLevel].shopTier;
  const entries: ShopEntry[] = tier != null ? SHOP_TIERS[tier] ?? [] : [];
  const coins = game.player.coins;
  const nextTitle = LEVELS[game.currentLevel + 1]?.title ?? "the road ahead";

  return (
    <div className="crt-vignette absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 overflow-auto bg-ink px-6 py-10">
      <h2 className="text-balance text-center text-lg uppercase tracking-[0.3em] text-gold">
        The Wayfarer&apos;s Cache
      </h2>
      <p className="max-w-md text-balance text-center text-sm text-dim">
        A hooded merchant spreads their wares before the road to {nextTitle}.
        Spend well — the way only grows darker.
      </p>
      <div className="text-sm text-gold">$ {coins} gold</div>

      <div className="flex w-full max-w-lg flex-col gap-2">
        {entries.map((entry, i) => {
          const d = ITEMS[entry.itemId];
          const bought = purchases[entry.itemId] ?? 0;
          const soldOut = entry.maxQty != null && bought >= entry.maxQty;
          const tooPoor = coins < entry.price;
          const disabled = soldOut || tooPoor;
          return (
            <div
              key={entry.itemId}
              className="flex items-center justify-between gap-3 border border-edge bg-panel px-4 py-2 text-sm"
            >
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="text-magic">[{i + 1}]</span>
                <span style={{ color: d.color }}>{d.glyph}</span>
                <span className="whitespace-nowrap text-fg">{d.name}</span>
                <span className="whitespace-nowrap text-dim">
                  · {statLabel(entry.itemId)}
                </span>
                {entry.maxQty != null && (
                  <span className="shrink-0 text-edge">
                    ({bought}/{entry.maxQty})
                  </span>
                )}
              </span>
              <button
                onClick={() => gameStore.getState().buyShopEntry(entry)}
                disabled={disabled}
                className={`shrink-0 border px-3 py-1 text-xs transition-colors ${
                  disabled
                    ? "cursor-not-allowed border-edge text-edge"
                    : "border-gold/60 text-gold hover:bg-gold/15"
                }`}
              >
                {soldOut ? "sold" : `$ ${entry.price}`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-dim">
        ⚔ {ITEMS[game.player.weaponId].name} ({game.player.weaponPower}) · ▣{" "}
        {ITEMS[game.player.armorId].name} ({game.player.armorReduction})
        {game.player.hasTorch && " · ( torch"}
      </div>

      <MenuButton accent onClick={() => gameStore.getState().leaveShop()}>
        Onward — {nextTitle}
        <span className="ml-1 text-xs opacity-70">(Enter)</span>
      </MenuButton>
      <p className="max-w-md text-balance text-center text-[11px] text-edge">
        press a number to buy · gear you buy is equipped automatically if it&apos;s
        an upgrade
      </p>
    </div>
  );
}
