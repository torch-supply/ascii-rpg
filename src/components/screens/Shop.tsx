"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { ITEMS, SHOP_TIERS, sellPrice, type ShopEntry } from "@/content/items";
import { LEVELS } from "@/content/levels";
import { CONFIG } from "@/content/config";
import { MenuButton } from "@/components/ui/MenuButton";

function statLabel(itemId: string): string {
  const d = ITEMS[itemId];
  switch (d.category) {
    case "weapon": {
      const bits = [`power ${d.power}`];
      if (d.ranged) bits.push(`ranged ${d.ranged.range}`);
      if (d.onHit) bits.push(`${d.onHit.effect}s`);
      if (d.knockback) bits.push("knockback");
      return bits.join(" · ");
    }
    case "ammo":
      return `${d.value ?? 0} arrows`;
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
        case "cleanse":
          return "cures poison/bleed/burn";
        case "detect":
          return "reveals traps";
        case "levitate":
          return `walk over water & traps · ${d.duration}t`;
        case "emberstep":
          return `fire immunity · ${d.duration}t`;
        case "frostwalk":
          return `freeze water to ice · ${d.duration}t`;
        case "shadow":
          return `unseen beyond ${CONFIG.shadowSightRadius} tiles · ${d.duration}t`;
        case "blink":
          return `teleport ${CONFIG.blinkRange} tiles`;
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

  const p = game.player;

  // LEFT column — what you're carrying. "Worn" = equipped (never sellable);
  // "carried" = the bag, aggregated by id (sellable spares get a sell button).
  const worn: { key: string; glyph: string; color: string; name: string; sub: string }[] = [
    {
      key: "weapon",
      glyph: ITEMS[p.weaponId].glyph,
      color: ITEMS[p.weaponId].color,
      name: ITEMS[p.weaponId].name,
      sub: `power ${p.weaponPower}${p.weaponBonus > 0 ? ` +${p.weaponBonus}` : ""}`,
    },
    {
      key: "armor",
      glyph: ITEMS[p.armorId].glyph,
      color: ITEMS[p.armorId].color,
      name: ITEMS[p.armorId].name,
      sub: `armor ${p.armorReduction}`,
    },
  ];
  if (p.hasTorch) {
    const t = p.torchId ? ITEMS[p.torchId] : null;
    worn.push({
      key: "torch",
      glyph: t?.glyph ?? "(",
      color: t?.color ?? "#e0a94a",
      name: t?.name ?? "Torch",
      sub: `${p.torchFuel} fuel`,
    });
  }
  const carried = Object.entries(
    p.bag.reduce<Record<string, number>>((acc, b) => {
      acc[b.defId] = (acc[b.defId] ?? 0) + b.count;
      return acc;
    }, {})
  );

  return (
    <div className="crt-vignette absolute inset-0 z-20 overflow-auto bg-ink">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col items-center justify-center gap-4 px-6 py-8">
        <h2 className="text-balance text-center text-lg uppercase tracking-[0.3em] text-gold">
          The Wayfarer&apos;s Cache
        </h2>
        <p className="max-w-md text-balance text-center text-sm text-dim">
          A hooded merchant spreads their wares before the road to {nextTitle}.
          Spend well — the way only grows darker.
        </p>
        <div className="text-sm text-gold">$ {coins} gold</div>

        <div className="grid w-full grid-cols-1 items-start gap-6 md:grid-cols-2">
          {/* ── LEFT: your inventory (worn + carried) ── */}
          <section className="flex flex-col gap-2">
            <h3 className="text-center text-[11px] uppercase tracking-[0.3em] text-dim">
              Your Inventory
            </h3>
            {worn.map((w) => (
              <div
                key={w.key}
                className="flex items-center justify-between gap-3 border border-edge bg-panel/50 px-4 py-2 text-sm"
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span style={{ color: w.color }}>{w.glyph}</span>
                  <span className="whitespace-nowrap text-fg">{w.name}</span>
                  <span className="whitespace-nowrap text-dim">· {w.sub}</span>
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-edge">
                  worn
                </span>
              </div>
            ))}
            {carried.map(([defId, count]) => {
              const d = ITEMS[defId];
              const sellable = sellPrice(d) > 0;
              const sub = statLabel(defId);
              return (
                <div
                  key={defId}
                  className="flex items-center justify-between gap-3 border border-edge bg-panel/50 px-4 py-2 text-sm"
                >
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span style={{ color: d.color }}>{d.glyph}</span>
                    <span className="whitespace-nowrap text-fg">{d.name}</span>
                    {count > 1 && <span className="text-dim">×{count}</span>}
                    {sub && <span className="whitespace-nowrap text-dim">· {sub}</span>}
                  </span>
                  {sellable ? (
                    <button
                      onClick={() => gameStore.getState().sellBagItem(defId)}
                      className="shrink-0 border border-gold/40 px-3 py-1 text-xs text-gold transition-colors hover:bg-gold/10"
                    >
                      sell $ {sellPrice(d)}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-edge">
                      {d.category === "quest" ? "quest" : "—"}
                    </span>
                  )}
                </div>
              );
            })}
          </section>

          {/* ── RIGHT: for sale ── */}
          <section className="flex flex-col gap-2">
            <h3 className="text-center text-[11px] uppercase tracking-[0.3em] text-dim">
              For Sale
            </h3>
            {entries.map((entry, i) => {
              const d = ITEMS[entry.itemId];
              const bought = purchases[entry.itemId] ?? 0;
              const soldOut = entry.maxQty != null && bought >= entry.maxQty;
              const tooPoor = coins < entry.price;
              const disabled = soldOut || tooPoor;
              return (
                <div
                  key={`${entry.itemId}-${i}`}
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
          </section>
        </div>

        <MenuButton accent onClick={() => gameStore.getState().leaveShop()}>
          Onward — {nextTitle}
          <span className="ml-1 text-xs opacity-70">(Enter)</span>
        </MenuButton>
        <p className="max-w-md text-balance text-center text-[11px] text-edge">
          press a number (or click) to buy · sell spare gear from your inventory ·
          upgrades equip automatically
        </p>
      </div>
    </div>
  );
}
