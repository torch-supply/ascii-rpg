import { keyToCommand, shouldPreventDefault, type InputCommand } from "./keymap";

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

      const cmd = keyToCommand(e);
      if (!cmd) return;
      if (shouldPreventDefault(e)) e.preventDefault();
      if (e.repeat && cmd.kind === "ui") return; // don't spam UI toggles on hold
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
