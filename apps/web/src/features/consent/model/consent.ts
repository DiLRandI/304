export type ConsentState = "unknown" | "essential_only" | "optional_analytics";

export type AnalyticsEvent =
  | "page_view"
  | "practice_started"
  | "private_room_created"
  | "private_room_joined"
  | "preference_changed";

type AnalyticsProperty = boolean | number | string;
export type AnalyticsProperties = Record<string, AnalyticsProperty>;

export interface AnalyticsPayload {
  event: AnalyticsEvent;
  properties: AnalyticsProperties;
}

const EVENT_PROPERTIES: Record<AnalyticsEvent, ReadonlySet<string>> = {
  page_view: new Set(["screen"]),
  practice_started: new Set(["botDifficulty", "ruleProfileId"]),
  private_room_created: new Set(["botDifficulty", "ruleProfileId"]),
  private_room_joined: new Set(["ruleProfileId"]),
  preference_changed: new Set(["preference", "value"]),
};

export function isAnalyticsEndpoint(
  endpoint: string | undefined,
): endpoint is string {
  if (!endpoint) return false;
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createAnalyticsPayload(
  event: AnalyticsEvent,
  properties: AnalyticsProperties,
): AnalyticsPayload | null {
  const allowed = EVENT_PROPERTIES[event];
  const valid = Object.entries(properties).every(([key, value]) => {
    if (!allowed.has(key)) return false;
    if (typeof value === "string") {
      return value.length > 0 && value.length <= 80;
    }
    if (typeof value === "number") return Number.isFinite(value);
    return typeof value === "boolean";
  });
  return valid ? { event, properties } : null;
}
