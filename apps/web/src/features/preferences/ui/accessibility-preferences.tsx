"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  applyDisplayPreferences,
  readDisplayPreferences,
  readServerDisplayPreferences,
  subscribeToDisplayPreferences,
  writeDisplayPreference,
} from "../api/browser-display-preferences";
import type { CardSize } from "../model/display-preferences";

export function AccessibilityPreferences() {
  const preferences = useSyncExternalStore(
    subscribeToDisplayPreferences,
    readDisplayPreferences,
    readServerDisplayPreferences,
  );
  const { cardSize, highContrast, reducedMotion } = preferences;

  useEffect(() => {
    applyDisplayPreferences(preferences);
  }, [preferences]);

  function updateCardSize(next: CardSize): void {
    writeDisplayPreference("cardSize", next);
  }

  function updateHighContrast(next: boolean): void {
    writeDisplayPreference("highContrast", next);
  }

  function updateReducedMotion(next: boolean): void {
    writeDisplayPreference("reducedMotion", next);
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
