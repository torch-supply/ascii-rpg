import type { CSSProperties, ReactNode } from "react";

/**
 * The persistent-chrome frame: a 1px slate border with box-drawing corner
 * glyphs sitting in the shell gutter, so each HUD region reads as its own panel.
 *
 * Deliberately a DIFFERENT visual language from `ui/BoxFrame` (the modal frame),
 * which uses double rules `╔╗╚╝` in an ember biome accent. Single slate rules
 * here, double ember rules there: quiet and persistent vs. loud and transient.
 * A modal opening over this chrome should read as a distinct layer, not as more
 * of the same.
 *
 * `corners` picks which of the four to draw — only the ones facing the outer
 * shell gutter are drawn, so interior seams between panels stay clean.
 */
import { MARK } from "./palette";

export const FRAME_BORDER = MARK.frame;
const CORNER = MARK.corner;

const GLYPH: Record<string, string> = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
};

const POS: Record<string, CSSProperties> = {
  tl: { top: -7, left: -1 },
  tr: { top: -7, right: -1 },
  bl: { bottom: -7, left: -1 },
  br: { bottom: -7, right: -1 },
};

export function FrameCorners({ corners }: { corners: (keyof typeof GLYPH)[] }) {
  return (
    <>
      {corners.map((c) => (
        <span
          key={c}
          aria-hidden
          className="pointer-events-none absolute text-[11px] leading-none"
          style={{ color: CORNER, ...POS[c] }}
        >
          {GLYPH[c]}
        </span>
      ))}
    </>
  );
}

/**
 * A framed chrome region: border + gradient + the requested corner glyphs.
 *
 * `as` keeps the semantic element the region had before it was framed — the
 * character panel and log rail are `aside` landmarks, so screen readers can
 * still skip them; the header and footer are plain divs.
 */
export function FramePanel({
  as: Tag = "div",
  corners,
  className = "",
  style,
  children,
  ...rest
}: {
  as?: "div" | "aside";
  corners: (keyof typeof GLYPH)[];
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={`relative ${className}`}
      style={{ border: `1px solid ${FRAME_BORDER}`, ...style }}
      {...rest}
    >
      <FrameCorners corners={corners} />
      {children}
    </Tag>
  );
}
