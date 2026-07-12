"use client";

import { useEffect, useRef } from "react";
import { gameStore } from "@/store/gameStore";
import { CanvasRenderer } from "@/render/CanvasRenderer";

// React owns only this host <div>. The rot.js canvas is created in an effect,
// appended into the host, and kept in a ref — React never reconciles it.
export default function GameCanvas() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new CanvasRenderer(host);

    const drawFromStore = () => {
      const g = gameStore.getState().game;
      if (g) renderer.draw(g);
    };

    // initial fit + paint
    renderer.fit();
    drawFromStore();

    // redraw on every committed state change (camera follows the player)
    const unsub = gameStore.subscribe((s) => {
      if (s.game) renderer.draw(s.game);
    });

    // on container resize, recompute the viewport then repaint
    const ro = new ResizeObserver(() => {
      renderer.fit();
      drawFromStore();
    });
    ro.observe(host);

    return () => {
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
