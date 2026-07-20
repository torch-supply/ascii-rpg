"use client";

// Drifting ember sparks that rise behind the title. Fixed configs (no random)
// so there's nothing to mismatch, and it stays out of the way of interaction.
const SPARKS = [
  { left: "5%", size: 2, dur: 7.4, delay: 2.2 },
  { left: "12%", size: 3, dur: 6.0, delay: 0.0 },
  { left: "19%", size: 2, dur: 7.2, delay: 1.6 },
  { left: "26%", size: 4, dur: 5.2, delay: 0.8 },
  { left: "34%", size: 2, dur: 8.0, delay: 3.4 },
  { left: "41%", size: 3, dur: 6.3, delay: 1.9 },
  { left: "48%", size: 2, dur: 7.8, delay: 0.5 },
  { left: "55%", size: 4, dur: 5.5, delay: 2.7 },
  { left: "62%", size: 2, dur: 6.9, delay: 1.2 },
  { left: "69%", size: 3, dur: 7.6, delay: 3.1 },
  { left: "76%", size: 2, dur: 6.4, delay: 0.3 },
  { left: "84%", size: 4, dur: 5.6, delay: 1.1 },
  { left: "91%", size: 2, dur: 7.0, delay: 2.5 },
  { left: "96%", size: 3, dur: 6.6, delay: 0.9 },
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
