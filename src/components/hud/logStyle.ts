// Colour-code a log line by what it MEANS.
//
// `messageLog` entries are plain strings, so this is a heuristic over prose. The
// thing that makes it work is keying on the grammatical OBJECT rather than on
// vocabulary: harm to the player always names the player as the target ("hits
// you", "you take", "catches you"), never merely a number.
//
// That distinction is the whole point. An earlier version matched `/for \d+/`,
// which caught "You strike the Skeleton for 8" — the single most common line in
// the game — and painted it the same red as "The Skeleton hits you for 2", so
// your successful blows read as injuries. Numbers appear on both sides of an
// exchange; the second-person object appears on only one.
//
// Order matters: the first match wins, so the most specific tests come first.
// Verified against the real message corpus by core test [64] — if you reword a
// message in `actions/index.ts`, that test is what tells you the colour moved.

export type LogKind = "kill" | "harm" | "good" | "gain" | "attack" | "neutral";

export interface LogStyle {
  kind: LogKind;
  color: string;
  glyph: string;
  glyphColor: string;
}

const STYLE: Record<LogKind, Omit<LogStyle, "kind">> = {
  // something died
  kill: { color: "#dcdce2", glyph: "×", glyphColor: "#ff7a3c" },
  // it happened TO YOU — the one category that must never be missed, so when a
  // line is ambiguous this is the safe direction to err in
  harm: { color: "#c78a8a", glyph: "›", glyphColor: "#c0392b" },
  // healed or buffed
  good: { color: "#5fcf5f", glyph: "+", glyphColor: "#3fbf3f" },
  // loot picked up
  gain: { color: "#ffd700", glyph: "+", glyphColor: "#ffd700" },
  // your own blow landing. Deliberately quiet: it's the highest-volume line in
  // the game and the part that matters is the kill that follows it.
  attack: { color: "#b9bac4", glyph: "»", glyphColor: "#5f6b78" },
  // Ordinary chatter, and deliberately the DIMMEST line in the rail. It was the
  // `--color-dim` grey (#9ea0ad), which measured only 77 from `attack` — under
  // the project's 110 legibility bar, so the two were tellable apart by glyph
  // alone and the colour carried nothing. Dropping it a step both clears the bar
  // (134) and puts the hierarchy the right way up: a kill or a hit should read
  // louder than "You stow the Chainmail."
  neutral: { color: "#8b8d99", glyph: "·", glyphColor: "#4a4a58" },
};

// A monster dying. "succumbs" is the damage-over-time death path.
const KILL = /(you slay|succumbs)/;

// Harm to the PLAYER. Every clause here names you as the target — that's what
// separates it from your own attacks, which carry numbers but never "you" as the
// object. The status lines are second-person only on purpose: `onApply` also
// produces "The Skeleton is poisoned!", which is good news, not harm.
const HARM =
  /(hits? you|hurls you|throws you|catches you|rakes? you|claims you|looms —|you take \d|you choke|crashes down on you|hurls a bolt for|you're bleeding|you are (poisoned|bleeding|frozen)|you catch fire)/;

// Healed or warded. Keyed on the HP delta the message already prints, so a heal
// of any source reads the same.
const GOOD = /(\(\+\d+ hp\)|\+\d+ hp\b|wraps you|scramble to solid ground)/;

// Loot acquired. "you gather \d" is the ammo/pickup phrasing; forage prints
// "— +N HP" instead and is caught by GOOD above.
const GAIN =
  /(pick up|picks up|you find|found|you get|receive|you buy|you gain|you recover|you gather \d)/;

// Your blow landing on something.
const ATTACK =
  /(you strike|you hit the|sneak attack|critical!|you jab|you batter down|you smash|you hack at|you hurl)/;

export function classifyLog(line: string): LogStyle {
  const s = line.toLowerCase();
  const kind: LogKind = KILL.test(s)
    ? "kill"
    : HARM.test(s)
      ? "harm"
      : GOOD.test(s)
        ? "good"
        : GAIN.test(s)
          ? "gain"
          : ATTACK.test(s)
            ? "attack"
            : "neutral";
  return { kind, ...STYLE[kind] };
}
