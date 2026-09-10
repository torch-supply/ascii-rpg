"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { ITEMS, SHOP_TIERS, sellPrice, type ShopEntry } from "@/content/items";
import { LEVELS } from "@/content/levels";
import { CONFIG } from "@/content/config";
import { MenuButton } from "@/components/ui/MenuButton";
import { AsciiField } from "@/components/ui/AsciiField";
import { BoxFrame } from "@/components/ui/BoxFrame";

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
      return `armour ${d.reduction}`;
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
          return `cross water, chasms & traps · ${d.duration}t`;
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

/**
 * Design 5a — "single cache": the merchant as one box-framed panel with two
 * columns (Your Inventory · For Sale) over the ember field. All buy/sell logic,
 * prices, sold-out / too-poor disabled states and the numbered keys are intact.
 */
export default function Shop() {
  const game = useGameStore((s) => s.game);
  const purchases = useGameStore((s) => s.shopPurchases);
  if (!game) return null;

  const tier = LEVELS[game.currentLevel].shopTier;
  const entries: ShopEntry[] = tier != null ? (SHOP_TIERS[tier] ?? []) : [];
  const coins = game.player.coins;
  const nextTitle = LEVELS[game.currentLevel + 1]?.title ?? "the road ahead";
  const p = game.player;

  const worn: {
    key: string;
    glyph: string;
    color: string;
    name: string;
    sub: string;
  }[] = [
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
    }, {}),
  );

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-auto bg-ink p-[26px]">
      <AsciiField mode="abstract" biome="pit" bottom intensity={0.24} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(52% 48% at 50% 40%, rgba(255,150,50,0.07), transparent 66%), radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.62) 100%)",
        }}
      />

      <BoxFrame
        accent="#ffb347"
        chip="#0b0b0d"
        className="relative z-10 w-[min(94vw,67.5rem)]"
        style={{ background: "rgba(9,9,12,0.68)" }}
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg,rgba(10,10,13,.5),rgba(10,10,13,.72))",
          }}
        />

        <div className="relative flex flex-col gap-4 px-10 pb-[34px] pt-[30px] text-sm">
          <div className="flex flex-col items-center gap-2.5">
            <h2
              className="m-0 text-lg font-semibold uppercase tracking-[0.32em] text-gold"
              style={{ textIndent: "0.32em" }}
            >
              The Wayfarer&apos;s Cache
            </h2>
            <p className="m-0 max-w-md text-balance text-center text-[13px] leading-[1.6] text-dim">
              A hooded merchant spreads their wares before the road to{" "}
              {nextTitle}. Spend well — the way only grows darker.
            </p>
            <span className="border border-[#3a3222] bg-[#0e0b05] px-4 py-[3px] tracking-[0.05em] text-gold">
              $ {coins} gold
            </span>
          </div>

          <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 md:gap-7">
            {/* ── LEFT: your inventory (worn + carried) ── */}
            <div className="flex flex-col gap-2">
              <div className="text-center text-[11px] uppercase tracking-[0.28em] text-[#6f7078]">
                Your Inventory
              </div>
              {worn.map((w) => (
                <div
                  key={w.key}
                  className="flex items-center justify-between gap-2.5 border border-[#2c2c36] bg-[rgba(18,18,22,0.5)] px-[13px] py-2"
                >
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span style={{ color: w.color }}>{w.glyph}</span>
                    <span className="whitespace-nowrap text-fg">{w.name}</span>
                    <span className="whitespace-nowrap text-[#6f7078]">
                      · {w.sub}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-[#5a5a64]">
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
                    className="flex items-center justify-between gap-2.5 border border-[#2c2c36] bg-[rgba(18,18,22,0.5)] px-[13px] py-2"
                  >
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span style={{ color: d.color }}>{d.glyph}</span>
                      <span className="whitespace-nowrap text-fg">
                        {d.name}
                      </span>
                      {count > 1 && (
                        <span className="text-[#6f7078]">×{count}</span>
                      )}
                      {sub && (
                        <span className="whitespace-nowrap text-[#6f7078]">
                          · {sub}
                        </span>
                      )}
                    </span>
                    {sellable ? (
                      <button
                        onClick={() => gameStore.getState().sellBagItem(defId)}
                        className="shrink-0 border border-gold/40 px-2.5 py-[3px] text-xs text-gold transition-colors hover:bg-gold/10"
                      >
                        sell $ {sellPrice(d)}
                      </button>
                    ) : (
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-[#5a5a64]">
                        {d.category === "quest" ? "quest" : "—"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── RIGHT: for sale ── */}
            <div className="flex flex-col gap-2">
              <div className="text-center text-[11px] uppercase tracking-[0.28em] text-[#6f7078]">
                For Sale
              </div>
              {entries.map((entry, i) => {
                const d = ITEMS[entry.itemId];
                const bought = purchases[entry.itemId] ?? 0;
                const soldOut = entry.maxQty != null && bought >= entry.maxQty;
                const tooPoor = coins < entry.price;
                const disabled = soldOut || tooPoor;
                return (
                  <div
                    key={`${entry.itemId}-${i}`}
                    className="flex items-center justify-between gap-2.5 border border-[#2c2c36] bg-[#0c0c10] px-[13px] py-2"
                  >
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="text-magic">[{i + 1}]</span>
                      <span style={{ color: d.color }}>{d.glyph}</span>
                      <span className="whitespace-nowrap text-fg">
                        {d.name}
                      </span>
                      <span className="whitespace-nowrap text-[#6f7078]">
                        · {statLabel(entry.itemId)}
                      </span>
                      {entry.maxQty != null && (
                        <span className="shrink-0 text-[#4a4a54]">
                          ({bought}/{entry.maxQty})
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => gameStore.getState().buyShopEntry(entry)}
                      disabled={disabled}
                      className={`shrink-0 border px-2.5 py-[3px] text-xs transition-colors ${
                        disabled
                          ? "cursor-not-allowed border-[#2c2c36] text-[#5a5a64]"
                          : "border-gold/60 text-gold hover:bg-gold/15"
                      }`}
                    >
                      {soldOut ? "sold" : `$ ${entry.price}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-0.5 flex flex-col items-center gap-2">
            <MenuButton accent onClick={() => gameStore.getState().leaveShop()}>
              Onward — {nextTitle}
              <span className="ml-1 text-xs opacity-70">(Enter)</span>
            </MenuButton>
            <p className="m-0 text-center text-[11px] text-[#5a5a64]">
              press a number (or click) to buy · buying a weapon or armour wears
              it and trades in the old · sell spare items below
            </p>
          </div>
        </div>
      </BoxFrame>
    </div>
  );
}
