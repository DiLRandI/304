export type CardSize = "large" | "normal";

export interface DisplayPreferences {
  cardSize: CardSize;
  highContrast: boolean;
  reducedMotion: boolean;
}

export type DisplayPreference = keyof DisplayPreferences;

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = Object.freeze({
  cardSize: "normal",
  highContrast: false,
  reducedMotion: false,
});
