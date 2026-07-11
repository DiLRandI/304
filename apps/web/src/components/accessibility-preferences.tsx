"use client";

import { useEffect, useState } from "react";

type CardSize = "large" | "normal";

const CARD_SIZE_KEY = "g304.card-size";
const CONTRAST_KEY = "g304.high-contrast";
const REDUCED_MOTION_KEY = "g304.reduced-motion";

function storedCardSize(): CardSize {
  return localStorage.getItem(CARD_SIZE_KEY) === "large" ? "large" : "normal";
}

function storedBoolean(key: string): boolean {
  return localStorage.getItem(key) === "true";
}

function applyPreferences(
  cardSize: CardSize,
  highContrast: boolean,
  reducedMotion: boolean,
): void {
  const root = document.documentElement;
  if (cardSize === "large") root.dataset.cardSize = cardSize;
  else delete root.dataset.cardSize;
  if (highContrast) root.dataset.contrast = "high";
  else delete root.dataset.contrast;
  if (reducedMotion) root.dataset.reducedMotion = "true";
  else delete root.dataset.reducedMotion;
}

export function AccessibilityPreferences() {
  const [cardSize, setCardSize] = useState<CardSize>("normal");
  const [highContrast, setHighContrast] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const nextCardSize = storedCardSize();
    const nextHighContrast = storedBoolean(CONTRAST_KEY);
    const nextReducedMotion = storedBoolean(REDUCED_MOTION_KEY);
    setCardSize(nextCardSize);
    setHighContrast(nextHighContrast);
    setReducedMotion(nextReducedMotion);
    applyPreferences(nextCardSize, nextHighContrast, nextReducedMotion);
  }, []);

  function updateCardSize(next: CardSize): void {
    localStorage.setItem(CARD_SIZE_KEY, next);
    setCardSize(next);
    applyPreferences(next, highContrast, reducedMotion);
  }

  function updateHighContrast(next: boolean): void {
    localStorage.setItem(CONTRAST_KEY, String(next));
    setHighContrast(next);
    applyPreferences(cardSize, next, reducedMotion);
  }

  function updateReducedMotion(next: boolean): void {
    localStorage.setItem(REDUCED_MOTION_KEY, String(next));
    setReducedMotion(next);
    applyPreferences(cardSize, highContrast, next);
  }

  return (
    <details className="accessibility-preferences">
      <summary>Display preferences</summary>
      <fieldset>
        <legend>Display preferences</legend>
        <label>
          Card size
          <select
            aria-label="Card size"
            onChange={(event) => updateCardSize(event.target.value as CardSize)}
            value={cardSize}
          >
            <option value="normal">Standard</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label>
          <input
            checked={highContrast}
            onChange={(event) => updateHighContrast(event.target.checked)}
            type="checkbox"
          />
          High contrast
        </label>
        <label>
          <input
            checked={reducedMotion}
            onChange={(event) => updateReducedMotion(event.target.checked)}
            type="checkbox"
          />
          Reduce motion
        </label>
      </fieldset>
    </details>
  );
}
