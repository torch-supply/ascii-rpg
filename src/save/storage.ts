import { CONFIG } from "@/content/config";
import { LEVELS } from "@/content/levels";
import { migrate } from "./serialize";
import type { SaveV1 } from "./schema";

export function writeSave(save: SaveV1): void {
  try {
    localStorage.setItem(CONFIG.saveKey, JSON.stringify(save));
  } catch {
    // quota / private mode — ignore, the game just won't persist
  }
}

export function readSave(): SaveV1 | null {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(CONFIG.saveKey);
  } catch {
    // ignore
  }
}

export interface SaveInfo {
  level: number;
  turn: number;
  title: string;
}

/** Lightweight peek for the splash screen's Resume option. */
export function peekSaveInfo(): SaveInfo | null {
  const s = readSave();
  if (!s) return null;
  return {
    level: s.game.currentLevel,
    turn: s.game.turnCount,
    title: LEVELS[s.game.currentLevel]?.title ?? "Unknown",
  };
}
