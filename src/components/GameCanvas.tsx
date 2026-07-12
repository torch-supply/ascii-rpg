"use client";

import { useEffect, useRef } from "react";
import { gameStore } from "@/store/gameStore";
import { CanvasRenderer } from "@/render/CanvasRenderer";
import { setEffectSink } from "@/lib/effectBus";

// React owns only this host <div>. The rot.js canvas is created in an effect,
// appended into the host, and kept in a ref — React never reconciles it.
export default function GameCanvas() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new CanvasRenderer(host);

    const drawFromStore = () => {
      const s = gameStore.getState();
      if (s.game) {
        renderer.draw(s.game, s.mode === "targeting" ? s.targeting : null);
      }
    };

    // initial fit + paint
    renderer.fit();
    drawFromStore();

    // redraw on every committed state change (camera follows the player)
    const unsub = gameStore.subscribe((s) => {
      if (s.game) {
        renderer.draw(s.game, s.mode === "targeting" ? s.targeting : null);
      }
    });

    // cosmetic hit/projectile animations emitted by the store each turn
    setEffectSink((fx) => renderer.playEffects(fx));

    // on container resize, recompute the viewport then repaint
    const ro = new ResizeObserver(() => {
      renderer.fit();
      drawFromStore();
    });
    ro.observe(host);

    return () => {
      setEffectSink(null);
      unsub();
      ro.disconnect();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
    />
  );
}
