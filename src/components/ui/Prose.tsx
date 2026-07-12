"use client";

/**
 * Narrative body text. Keeps the terminal look (inherited monospace font) but
 * renders each paragraph as its own <p> with `text-wrap: balance` and normal
 * wrapping — so lines balance to the container instead of being locked to hard
 * newlines. Split paragraphs with a blank line; single newlines become spaces.
 */
export function Prose({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim().replace(/\s*\n\s*/g, " "))
    .filter(Boolean);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {paragraphs.map((p, i) => (
        <p key={i} className="text-balance leading-relaxed">
          {p}
        </p>
      ))}
    </div>
  );
}
