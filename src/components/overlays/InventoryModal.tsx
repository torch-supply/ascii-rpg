"use client";

import { gameStore, useGameStore } from "@/store/gameStore";
import { ITEMS } from "@/content/items";
import { classDef } from "@/content/classes";
import { MenuButton } from "@/components/ui/MenuButton";
import { AsciiField } from "@/components/ui/AsciiField";
import { BoxFrame } from "@/components/ui/BoxFrame";

/**
 * Design 4b — "character sheet": the [i] overlay as a two-pane box-framed modal
 * (Equipped & Stats · Bag) over a faint ember field. Same data and store calls
 * as before; equip/use is still keyboard-driven (the numbers are labels).
 */
export default function InventoryModal() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const p = game.player;
  const cls = classDef(p.classId);
  const weapon = ITEMS[p.weaponId];
  const armor = ITEMS[p.armorId];
  const torch = p.torchId ? ITEMS[p.torchId] : null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center px-4">
      {/* dimmed level behind: a faint ember field bleeds through the scrim */}
      <AsciiField mode="abstract" biome="pit" bottom intensity={0.24} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(200px 150px at 22% 42%, rgba(224,150,60,0.06), transparent 66%), rgba(6,7,6,0.62)",
        }}
      />

      <BoxFrame
        accent="#ffb347"
        chip="#0b0b0d"
        className="relative z-10 w-[min(92vw,45rem)]"
        style={{ background: "rgba(9,10,12,0.72)" }}
      >
        {/* a second faint field + gradient, contained inside the panel */}
        <AsciiField mode="abstract" biome="pit" bottom intensity={0.24} style={{ zIndex: 0 }} />
        <div
          aria-hidden
          className="absolute inset-0 z-0"
          style={{ background: "linear-gradient(180deg,rgba(10,10,13,.55),rgba(10,10,13,.8))" }}
        />

        <div className="relative z-[1] flex flex-col gap-[18px] px-8 py-7 text-sm">
          <div className="flex flex-col items-center gap-[11px]">
            <h2 className="m-0 text-lg font-semibold uppercase tracking-[0.34em] text-gold" style={{ textIndent: "0.34em" }}>
              Inventory
            </h2>
            <div className="flex w-[300px] max-w-full items-center gap-3">
              <span className="h-px flex-1" style={{ background: "linear-gradient(to right,transparent,#ffb347)" }} />
              <span className="text-xs text-[#ffb347]">◈</span>
              <span className="h-px flex-1" style={{ background: "linear-gradient(to left,transparent,#ffb347)" }} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-[26px]">
            {/* ── LEFT: equipped + stats ── */}
            <div className="flex flex-col gap-2.5">
              <div className="text-[11px] uppercase tracking-[0.28em] text-[#6f7078]">
                Equipped &amp; Stats
              </div>
              <div className="flex flex-col gap-[7px]">
                <div className="flex justify-between border border-[#2c2c36] bg-[#0c0c10] px-3 py-1.5">
                  <span className="text-fg">⚔ {weapon.name}</span>
                  <span className="text-[#6f7078]">pow {weapon.power}</span>
                </div>
                <div className="flex justify-between border border-[#2c2c36] bg-[#0c0c10] px-3 py-1.5">
                  <span className="text-fg">▣ {armor.name}</span>
                  <span className="text-[#6f7078]">red {armor.reduction}</span>
                </div>
                {p.hasTorch && (
                  <div className="flex justify-between border border-[#3a3222] bg-[#100d06] px-3 py-1.5">
                    <span className="text-gold">( {torch?.name ?? "Torch"}</span>
                    <span style={{ color: "#c79a2f" }}>{p.torchFuel} fuel</span>
                  </div>
                )}
              </div>
              <div className="mt-0.5 flex flex-col gap-1.5">
                <div className="flex justify-between px-0.5">
                  <span className="text-[#8a8a96]">Class</span>
                  <span style={{ color: cls.color }}>{cls.glyph} {cls.name}</span>
                </div>
                <div className="flex justify-between px-0.5">
                  <span className="text-[#8a8a96]">Gold</span>
                  <span className="text-gold">$ {p.coins}</span>
                </div>
                <div className="flex justify-between px-0.5">
                  <span className="text-[#8a8a96]">Light radius</span>
                  <span className="text-magic">{p.lightRadius}</span>
                </div>
              </div>
            </div>

            {/* ── RIGHT: bag ── */}
            <div className="flex flex-col gap-2.5">
              <div className="text-[11px] uppercase tracking-[0.28em] text-[#6f7078]">Bag</div>
              {p.bag.length === 0 ? (
                <p className="text-[13px] text-edge">Empty. Walk over items to pick them up.</p>
              ) : (
                <div className="flex flex-col gap-[7px]">
                  {p.bag.map((b, i) => {
                    const def = ITEMS[b.defId];
                    const kind =
                      def.category === "potion"
                        ? "use"
                        : def.category === "weapon" || def.category === "armor"
                        ? "equip"
                        : "";
                    return (
                      <div
                        key={`${b.defId}-${i}`}
                        className="flex items-center justify-between gap-2.5 border border-[#2c2c36] bg-[rgba(18,18,22,0.5)] px-3 py-[7px]"
                      >
                        <span>
                          <span className="text-magic">[{i + 1}]</span>{" "}
                          <span style={{ color: def.color }}>{def.glyph}</span>{" "}
                          <span className="text-fg">{def.name}</span>
                          {b.count > 1 && <span className="text-[#6f7078]"> ×{b.count}</span>}
                        </span>
                        {kind && <span className="text-[12px] text-[#5a5a64]">{kind}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-1 text-[12px] leading-[1.5] text-[#5a5a64]">
                Walk over items to pick them up. Numbers use or equip; upgrades swap automatically.
              </p>
            </div>
          </div>

          <div className="flex justify-center border-t border-[#23232b] pt-4">
            <MenuButton accent autoFocus onClick={() => gameStore.getState().setMode("playing")}>
              ▸ Close <span className="text-xs opacity-70">(i / Esc)</span>
            </MenuButton>
          </div>
        </div>
      </BoxFrame>
    </div>
  );
}
