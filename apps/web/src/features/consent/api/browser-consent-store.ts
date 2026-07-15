import {
  readBrowserStorage,
  writeBrowserStorage,
} from "../../../lib/browser-storage";
import type { ConsentState } from "../model/consent";

export const CONSENT_STORAGE_KEY = "g304.analytics-consent";

const CONSENT_CHANGE_EVENT = "g304:analytics-consent-change";

export function readConsent(): ConsentState {
  const stored = readBrowserStorage(CONSENT_STORAGE_KEY);
  return stored === "essential_only" || stored === "optional_analytics"
    ? stored
    : "unknown";
}

export function writeConsent(consent: Exclude<ConsentState, "unknown">): void {
  if (writeBrowserStorage(CONSENT_STORAGE_KEY, consent)) {
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
  }
}

export function subscribeToConsent(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CONSENT_STORAGE_KEY) onChange();
  };
  window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function readServerConsent(): ConsentState {
  return "unknown";
}
