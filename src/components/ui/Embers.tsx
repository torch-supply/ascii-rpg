"use client";

// Drifting ember sparks that rise behind the title. Fixed configs (no random)
// so there's nothing to mismatch, and it stays out of the way of interaction.
const SPARKS = [
  { left: "8%", size: 3, dur: 6.0, delay: 0.0 },
  { left: "19%", size: 2, dur: 7.2, delay: 1.6 },
  { left: "31%", size: 4, dur: 5.2, delay: 0.8 },
  { left: "44%", size: 2, dur: 8.0, delay: 2.4 },
  { left: "56%", size: 3, dur: 6.6, delay: 0.4 },
  { left: "68%", size: 2, dur: 7.6, delay: 3.1 },
  { left: "81%", size: 4, dur: 5.6, delay: 1.1 },
  { left: "92%", size: 2, dur: 6.9, delay: 2.0 },
];

export function Embers() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="ember-spark"
          style={{
            left: s.left,
            width: `${s.size}px`,
            height: `${s.size}px`,
            animationDuration: `${s.dur}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
