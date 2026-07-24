import type { PlayerAction } from "@/game/core/types";

// Data-driven input mapping. KeyboardInput turns a keydown into one of these
// commands; the store routes it based on the current UI mode. This is the
// stable contract a future (real-time) input adapter would also produce.
export type InputCommand =
  | { kind: "action"; action: PlayerAction }
  | {
      kind: "ui";
      cmd:
        | "pause"
        | "inventory"
        | "help"
        | "confirm"
        | "cancel"
        | "fire"
        | "ability"
        | "mute"
        | "debugSkip";
    }
  | { kind: "bagSlot"; n: number };

export function keyToCommand(e: KeyboardEvent): InputCommand | null {
  switch (e.key) {
    // ── movement (arrows / hjkl / wasd) ──
    case "ArrowUp":
    case "k":
    case "w":
      return { kind: "action", action: { type: "move", dx: 0, dy: -1 } };
    case "ArrowDown":
    case "j":
    case "s":
      return { kind: "action", action: { type: "move", dx: 0, dy: 1 } };
    case "ArrowLeft":
    case "h":
    case "a":
      return { kind: "action", action: { type: "move", dx: -1, dy: 0 } };
    case "ArrowRight":
    case "l":
    case "d":
      return { kind: "action", action: { type: "move", dx: 1, dy: 0 } };

    // ── wait a turn ──
    case ".":
    case " ":
      return { kind: "action", action: { type: "wait" } };

    // ── close an adjacent open door ──
    case "c":
    case "C":
      return { kind: "action", action: { type: "closeDoor" } };

    // ── UI ──
    case "Escape":
    case "p":
    case "P":
      return { kind: "ui", cmd: "pause" };
    case "i":
    case "I":
      return { kind: "ui", cmd: "inventory" };
    case "?":
      return { kind: "ui", cmd: "help" };
    case "f":
    case "F":
      return { kind: "ui", cmd: "fire" }; // aim/fire the equipped bow
    case "q":
    case "Q":
      return { kind: "ui", cmd: "ability" }; // class active ability
    case "m":
    case "M":
      return { kind: "ui", cmd: "mute" }; // toggle SFX
    case "Enter":
      return { kind: "ui", cmd: "confirm" };
    case ">":
      return { kind: "ui", cmd: "debugSkip" }; // dev-only skip to next level
  }

  // ── bag hotkeys 1-9 ──
  if (/^[1-9]$/.test(e.key)) {
    return { kind: "bagSlot", n: parseInt(e.key, 10) };
  }
  return null;
}

/** Keys we should stop from scrolling the page. */
export function shouldPreventDefault(e: KeyboardEvent): boolean {
  return ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(
    e.key,
  );
}
