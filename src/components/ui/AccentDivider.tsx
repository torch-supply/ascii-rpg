"use client";

/**
 * The shared chapter motif: a thin accent rule fading in from both sides toward
 * a centred ◈ sigil. Used under every screen title (narration / victory /
 * game-over via CinematicTitle, and the splash wordmark) so they read as one set.
 */
export function AccentDivider({
  accent = "#ffd24d",
  className = "",
}: {
  accent?: string;
  className?: string;
}) {
  return (
    <div className={`flex w-72 max-w-[80vw] items-center gap-3 ${className}`}>
      <span
        className="h-px flex-1"
        style={{ background: `linear-gradient(to right, transparent, ${accent})` }}
      />
      <span className="text-sm" style={{ color: accent }}>
        ◈
      </span>
      <span
        className="h-px flex-1"
        style={{ background: `linear-gradient(to left, transparent, ${accent})` }}
      />
    </div>
  );
}
