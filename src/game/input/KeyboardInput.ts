import {
  keyToCommand,
  repeatsWhenHeld,
  shouldPreventDefault,
  type InputCommand,
} from "./keymap";

// Keyboard adapter. Translates keydown events into InputCommands and hands them
// to a dispatch callback (the store's handleCommand). Swapping this for a
// different adapter (e.g. held-key sampling for real-time) leaves the command
// contract and the store untouched.
export class KeyboardInput {
  private dispatch: (cmd: InputCommand) => void;
  private handler: (e: KeyboardEvent) => void;

  constructor(dispatch: (cmd: InputCommand) => void) {
    this.dispatch = dispatch;
    this.handler = (e: KeyboardEvent) => {
      // Ignore when typing into a form field (e.g. the seed input on splash).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

      // Let a focused button handle Enter/Space itself, so keyboard users can
      // activate the button they've tabbed to instead of the global command.
      const active = document.activeElement as HTMLElement | null;
      if (
        active?.tagName === "BUTTON" &&
        (e.key === "Enter" || e.key === " ")
      ) {
        // ...but a HELD key must not auto-activate a button that only just
        // took focus. Otherwise the same Enter that (e.g.) throws a firebomb —
        // dying you into the Game Over screen — repeats and instantly clicks
        // its freshly-focused button, dismissing the screen you never saw.
        if (e.repeat) e.preventDefault();
        return;
      }

      const cmd = keyToCommand(e);
      if (!cmd) return;
      if (shouldPreventDefault(e)) e.preventDefault();
      if (e.repeat && !repeatsWhenHeld(cmd)) return;
      this.dispatch(cmd);
    };
  }

  attach() {
    window.addEventListener("keydown", this.handler);
  }

  detach() {
    window.removeEventListener("keydown", this.handler);
  }
}
