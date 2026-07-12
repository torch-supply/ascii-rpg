"use client";

import type { ReactNode } from "react";

export function MenuButton({
  onClick,
  children,
  accent,
  autoFocus,
}: {
  onClick: () => void;
  children: ReactNode;
  accent?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      autoFocus={autoFocus}
      className={`pointer-events-auto block w-80 max-w-[85vw] border px-5 py-3 text-left text-sm transition-colors ${
        accent
          ? "border-gold/60 bg-gold/10 text-gold hover:bg-gold/20"
          : "border-edge bg-panel text-fg hover:border-gold hover:text-gold"
      }`}
    >
      {children}
    </button>
  );
}
