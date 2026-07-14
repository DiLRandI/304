import {
  readBrowserStorage,
  writeBrowserStorage,
} from "../../../lib/browser-storage";

export type CardSize = "large" | "normal";

export interface DisplayPreferences {
  cardSize: CardSize;
  highContrast: boolean;
  reducedMotion: boolean;
}

type DisplayPreference = keyof DisplayPreferences;

const CARD_SIZE_KEY = "g304.card-size";
const CONTRAST_KEY = "g304.high-contrast";
const REDUCED_MOTION_KEY = "g304.reduced-motion";
const PREFERENCES_CHANGE_EVENT = "g304:display-preferences-change";
const STORAGE_KEYS: Record<DisplayPreference, string> = {
  cardSize: CARD_SIZE_KEY,
  highContrast: CONTRAST_KEY,
  reducedMotion: REDUCED_MOTION_KEY,
};
const DEFAULT_PREFERENCES: DisplayPreferences = Object.freeze({
  cardSize: "normal",
  highContrast: false,
  reducedMotion: false,
});

let memoryOverrides: Partial<DisplayPreferences> = {};
let cachedSignature = "";
let cachedSnapshot = DEFAULT_PREFERENCES;

function storedCardSize(): CardSize {
  return readBrowserStorage(CARD_SIZE_KEY) === "large" ? "large" : "normal";
}

function storedBoolean(key: string): boolean {
  return readBrowserStorage(key) === "true";
}

function clearOverride(preference: DisplayPreference): void {
  const { [preference]: _removed, ...remaining } = memoryOverrides;
  memoryOverrides = remaining;
}

function preferenceForStorageKey(
  storageKey: string | null,
): DisplayPreference | undefined {
  return (Object.entries(STORAGE_KEYS) as [DisplayPreference, string][]).find(
    ([, key]) => key === storageKey,
  )?.[0];
}

export function readDisplayPreferences(): DisplayPreferences {
  const next: DisplayPreferences = {
    cardSize: memoryOverrides.cardSize ?? storedCardSize(),
    highContrast: memoryOverrides.highContrast ?? storedBoolean(CONTRAST_KEY),
    reducedMotion:
      memoryOverrides.reducedMotion ?? storedBoolean(REDUCED_MOTION_KEY),
  };
  const signature = `${next.cardSize}:${next.highContrast}:${next.reducedMotion}`;
  if (signature === cachedSignature) return cachedSnapshot;
  cachedSignature = signature;
  cachedSnapshot = Object.freeze(next);
  return cachedSnapshot;
}

export function readServerDisplayPreferences(): DisplayPreferences {
  return DEFAULT_PREFERENCES;
}

export function writeDisplayPreference<K extends DisplayPreference>(
  preference: K,
  value: DisplayPreferences[K],
): void {
  memoryOverrides = { ...memoryOverrides, [preference]: value };
  if (writeBrowserStorage(STORAGE_KEYS[preference], String(value))) {
    clearOverride(preference);
  }
  cachedSignature = "";
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PREFERENCES_CHANGE_EVENT));
  }
}

export function subscribeToDisplayPreferences(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null) memoryOverrides = {};
    else {
      const preference = preferenceForStorageKey(event.key);
      if (!preference) return;
      clearOverride(preference);
    }
    cachedSignature = "";
    onChange();
  };
  window.addEventListener(PREFERENCES_CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(PREFERENCES_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function applyDisplayPreferences({
  cardSize,
  highContrast,
  reducedMotion,
}: DisplayPreferences): void {
  const root = document.documentElement;
  if (cardSize === "large") root.dataset.cardSize = cardSize;
  else delete root.dataset.cardSize;
  if (highContrast) root.dataset.contrast = "high";
  else delete root.dataset.contrast;
  if (reducedMotion) root.dataset.reducedMotion = "true";
  else delete root.dataset.reducedMotion;
}
