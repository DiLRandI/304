import {
  readBrowserStorage,
  writeBrowserStorage,
} from "../../../lib/browser-storage";

export const CONSENT_STORAGE_KEY = "g304.analytics-consent";

const CONSENT_CHANGE_EVENT = "g304:analytics-consent-change";

export type ConsentState = "unknown" | "essential_only" | "optional_analytics";

export type AnalyticsEvent =
  | "page_view"
  | "practice_started"
  | "private_room_created"
  | "private_room_joined"
  | "preference_changed";

type AnalyticsProperty = boolean | number | string;
type AnalyticsProperties = Record<string, AnalyticsProperty>;

export interface AnalyticsPayload {
  event: AnalyticsEvent;
  properties: AnalyticsProperties;
}

export type AnalyticsTransport = (
  endpoint: string,
  payload: AnalyticsPayload,
) => void;

export interface TrackOptions {
  consent?: ConsentState;
  endpoint?: string;
  transport?: AnalyticsTransport;
}

const EVENT_PROPERTIES: Record<AnalyticsEvent, ReadonlySet<string>> = {
  page_view: new Set(["screen"]),
  practice_started: new Set(["botDifficulty", "ruleProfileId"]),
  private_room_created: new Set(["botDifficulty", "ruleProfileId"]),
  private_room_joined: new Set(["ruleProfileId"]),
  preference_changed: new Set(["preference", "value"]),
};

function configuredEndpoint(): string | undefined {
  const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT?.trim();
  return endpoint || undefined;
}

function validEndpoint(endpoint: string | undefined): endpoint is string {
  if (!endpoint) return false;
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validProperties(
  event: AnalyticsEvent,
  properties: AnalyticsProperties,
): boolean {
  const allowed = EVENT_PROPERTIES[event];
  return Object.entries(properties).every(([key, value]) => {
    if (!allowed.has(key)) return false;
    if (typeof value === "string")
      return value.length > 0 && value.length <= 80;
    if (typeof value === "number") return Number.isFinite(value);
    return typeof value === "boolean";
  });
}

function browserTransport(endpoint: string, payload: AnalyticsPayload): void {
  const serialized = JSON.stringify(payload);
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(
      endpoint,
      new Blob([serialized], { type: "application/json" }),
    );
    return;
  }
  if (typeof fetch === "function") {
    void fetch(endpoint, {
      body: serialized,
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  }
}

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

export function track(
  event: AnalyticsEvent,
  properties: AnalyticsProperties,
  options: TrackOptions = {},
): boolean {
  const consent = options.consent ?? readConsent();
  const endpoint = options.endpoint ?? configuredEndpoint();
  if (
    consent !== "optional_analytics" ||
    !validEndpoint(endpoint) ||
    !validProperties(event, properties)
  ) {
    return false;
  }
  (options.transport ?? browserTransport)(endpoint, { event, properties });
  return true;
}
