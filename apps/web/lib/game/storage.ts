import type { CharacterId } from "./simulation";

/** Exactly three keys (spec §8 D1). No server, no cookies, no network. */
const KEY_SOUND = "fma.v1.sound";
const KEY_BEST = "fma.v1.best";
const KEY_LAST_CHARACTER = "fma.v1.lastChar";

// Private mode / quota errors must never break the game (spec §8 D4).
const read = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const write = (key: string, value: string) => {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage is optional */
  }
};

export type Preferences = {
  sound: boolean;
  character: CharacterId;
  best: number;
};

/**
 * Values the prerendered HTML is built with. Reading storage during render would
 * desync hydration, so the client subscribes through `useSyncExternalStore` and
 * calls {@link refreshPreferences} once it is mounted.
 */
const DEFAULTS: Preferences = { sound: false, character: "tj", best: 0 };

let snapshot: Preferences = DEFAULTS;
const listeners = new Set<() => void>();

const readAll = (): Preferences => {
  const best = Number.parseInt(read(KEY_BEST) ?? "", 10);
  return {
    sound: read(KEY_SOUND) === "on",
    character: read(KEY_LAST_CHARACTER) === "ta" ? "ta" : "tj",
    best: Number.isFinite(best) && best > 0 ? best : 0,
  };
};

export const subscribePreferences = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getPreferences = () => snapshot;
export const getServerPreferences = () => DEFAULTS;

/** Re-read storage; only publishes a new snapshot when something actually changed. */
export const refreshPreferences = () => {
  const next = readAll();
  if (
    next.sound === snapshot.sound &&
    next.character === snapshot.character &&
    next.best === snapshot.best
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
};

export const writeSound = (on: boolean) => {
  write(KEY_SOUND, on ? "on" : "off");
  refreshPreferences();
};

export const writeBest = (score: number) => {
  if (score > snapshot.best) write(KEY_BEST, String(Math.round(score)));
  refreshPreferences();
};

export const writeLastCharacter = (character: CharacterId) => {
  write(KEY_LAST_CHARACTER, character);
  refreshPreferences();
};
